// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ParticipantKind } from 'livekit-client'
import { queryClient } from '@/api/queryClient'
import { ApiError } from '@/api/ApiError'
import { BreakoutSetup } from './BreakoutSetup'
import { breakoutStore, resetBreakout } from '../store'
import { createBreakoutSession } from '../api'

const h = vi.hoisted(() => ({ participants: [] as unknown[] }))

// The key, then its values, so each room's button has a name of its own.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values
        ? `${key}(${Object.entries(values)
            .map(([name, value]) => `${name}=${value}`)
            .join(' ')})`
        : key,
  }),
}))
vi.mock('@livekit/components-react', () => ({
  useRemoteParticipants: () => h.participants,
}))
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  createBreakoutSession: vi.fn(async () => ({})),
}))

const guest = (name: string) => ({
  identity: `id-${name}`,
  name,
  isLocal: false,
  kind: ParticipantKind.STANDARD,
  attributes: { room_role: 'member', breakout: 'true' },
})
const NAMES = ['Ann', 'Bob', 'Cy', 'Dee', 'Eve', 'Fay']
const people = (count: number) => NAMES.slice(0, count).map(guest)

// A meeting of its own per test: the memory of a blocked storage outlives a test.
let meeting = 0
let roomId = ''
beforeEach(() => {
  roomId = `room-${++meeting}`
})

const renderSetup = (id = roomId) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BreakoutSetup roomId={id} />
    </QueryClientProvider>
  )

// The store tells the panel on the next microtask, so each press waits it out.
const click = async (element: HTMLElement) => {
  fireEvent.click(element)
  await act(async () => {})
}
const press = (name: string | RegExp) =>
  click(screen.getByRole('button', { name }))
const choose = (mode: 'auto' | 'manual' | 'last') =>
  press(new RegExp(`setup\\.${mode}\\.title`))
const number = (room: number, name: string) =>
  screen.getByRole('button', {
    name: `setup.placeIn(number=${room} name=${name})`,
  })
// The room each person is in, 0 for none, in the order of the rows.
const rooms = () =>
  screen.getAllByRole('group').flatMap((row) => {
    const name = row.getAttribute('aria-label') as string
    if (!NAMES.includes(name)) return []
    const pressed = Array.from(row.querySelectorAll('button')).findIndex(
      (button) => button.getAttribute('aria-pressed') === 'true'
    )
    return [[name, pressed + 1] as const]
  })
const roomCountShown = () =>
  screen.getByRole('button', { name: /setup\.roomCount/ }).textContent

afterEach(() => {
  cleanup()
  resetBreakout()
  sessionStorage.clear()
  h.participants = []
})

describe('BreakoutSetup', () => {
  it('names the room-count selector for screen readers', async () => {
    renderSetup()
    expect(
      screen.queryByRole('button', { name: /setup\.roomCount/ })
    ).not.toBeNull()
  })

  it('deals everyone evenly on Automatically', async () => {
    h.participants = people(4)
    renderSetup()
    await choose('auto')
    expect(screen.queryByText('setup.auto.summary(count=2)')).not.toBeNull()
    const placed = rooms().map(([, room]) => room)
    expect(placed.filter((room) => room === 1)).toHaveLength(2)
    expect(placed.filter((room) => room === 2)).toHaveLength(2)
  })

  it('starts Manually with nobody placed the first time', async () => {
    h.participants = people(3)
    renderSetup()
    await choose('manual')
    expect(screen.queryByText('setup.manual.summary(count=2)')).not.toBeNull()
    expect(rooms()).toEqual([
      ['Ann', 0],
      ['Bob', 0],
      ['Cy', 0],
    ])
    expect(screen.queryByText('setup.noRoom(count=3)')).not.toBeNull()
  })

  it('places a person with one press and takes them out with a second', async () => {
    h.participants = people(2)
    renderSetup()
    await choose('manual')
    await click(number(2, 'Ann'))
    expect(number(2, 'Ann').getAttribute('aria-pressed')).toBe('true')
    expect(number(1, 'Ann').getAttribute('aria-pressed')).toBe('false')
    await click(number(2, 'Ann'))
    expect(number(2, 'Ann').getAttribute('aria-pressed')).toBe('false')
  })

  it('keeps every row where it is as people are placed', async () => {
    h.participants = people(4)
    renderSetup()
    await choose('manual')
    await click(number(2, 'Ann'))
    await click(number(1, 'Dee'))
    await click(number(2, 'Cy'))
    expect(rooms()).toEqual([
      ['Ann', 2],
      ['Bob', 0],
      ['Cy', 2],
      ['Dee', 1],
    ])
  })

  it('places only the people with no room, emptiest room first', async () => {
    h.participants = people(6)
    renderSetup()
    await choose('manual')
    await click(number(1, 'Ann'))
    await click(number(1, 'Bob'))
    await press('setup.placeEvenly')
    const placed = rooms()
    expect(placed.slice(0, 2)).toEqual([
      ['Ann', 1],
      ['Bob', 1],
    ])
    expect(placed.filter(([, room]) => room === 1)).toHaveLength(3)
    expect(placed.filter(([, room]) => room === 2)).toHaveLength(3)
    expect(screen.queryByText(/setup\.noRoom/)).toBeNull()
  })

  it('picks the manual plan up again, whatever was done in between', async () => {
    h.participants = people(3)
    renderSetup()
    await choose('manual')
    await click(number(2, 'Ann'))
    await press('setup.back')
    await choose('auto')
    await click(number(1, 'Bob'))
    await press('setup.back')
    await choose('manual')
    expect(rooms()).toEqual([
      ['Ann', 2],
      ['Bob', 0],
      ['Cy', 0],
    ])
  })

  it('reads the manual plan back from sessionStorage', async () => {
    h.participants = people(2)
    const { unmount } = renderSetup()
    await choose('manual')
    await click(number(2, 'Bob'))
    expect(
      JSON.parse(sessionStorage.getItem(`breakout-setup-${roomId}`) as string)
    ).toEqual({ manual: { 'id-Bob': 1 } })
    unmount()
    resetBreakout()
    // A meeting this page never edited: only the storage knows its plan.
    sessionStorage.setItem(
      'breakout-setup-elsewhere',
      JSON.stringify({ manual: { 'id-Ann': 1 } })
    )
    renderSetup('elsewhere')
    await choose('manual')
    expect(rooms()).toEqual([
      ['Ann', 2],
      ['Bob', 0],
    ])
  })

  it('keeps the manual plan in memory when sessionStorage throws', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'sessionStorage'
    ) as PropertyDescriptor
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('Blocked', 'SecurityError')
      },
    })
    try {
      h.participants = people(2)
      const { unmount } = renderSetup()
      await choose('manual')
      await click(number(1, 'Ann'))
      unmount()
      resetBreakout()
      renderSetup()
      await choose('manual')
      expect(rooms()).toEqual([
        ['Ann', 1],
        ['Bob', 0],
      ])
    } finally {
      Object.defineProperty(globalThis, 'sessionStorage', descriptor)
    }
  })

  it('offers Same as last time only once a split was opened, and restores it', async () => {
    h.participants = people(3)
    renderSetup()
    expect(screen.queryByRole('button', { name: /setup\.last/ })).toBeNull()
    await choose('manual')
    await click(number(2, 'Ann'))
    await click(number(1, 'Cy'))
    await press('setup.openStaying(rooms=2 count=1)')
    await screen.findByRole('button', { name: /setup\.last\.title/ })
    await choose('last')
    expect(screen.queryByText('setup.last.summary(count=2)')).not.toBeNull()
    expect(rooms()).toEqual([
      ['Ann', 2],
      ['Bob', 0],
      ['Cy', 1],
    ])
  })

  it('starts from the count last opened, else a room per 4 people', async () => {
    h.participants = Array.from({ length: 9 }, (_, i) => guest(`P${i}`))
    renderSetup()
    expect(roomCountShown()).toContain('3')
    cleanup()
    sessionStorage.setItem(
      `breakout-setup-${roomId}`,
      JSON.stringify({ lastCount: 7 })
    )
    renderSetup()
    expect(roomCountShown()).toContain('7')
  })

  it('puts the numbers under the name past 6 rooms', async () => {
    h.participants = people(1)
    breakoutStore.setup.roomCount = 6
    const { unmount } = renderSetup()
    await choose('manual')
    const row = screen.getByRole('group', { name: 'Ann' })
    expect(row.className).not.toContain('flex-d_column')
    unmount()
    breakoutStore.setup.mode = null
    breakoutStore.setup.roomCount = 7
    renderSetup()
    await choose('manual')
    expect(screen.getByRole('group', { name: 'Ann' }).className).toContain(
      'flex-d_column'
    )
    expect(number(7, 'Ann')).not.toBeNull()
  })

  it('sends the plan on Open', async () => {
    h.participants = people(3)
    renderSetup()
    await choose('manual')
    await click(number(2, 'Ann'))
    await click(number(1, 'Bob'))
    await press('setup.openStaying(rooms=2 count=1)')
    await waitFor(() =>
      expect(createBreakoutSession).toHaveBeenCalledWith(roomId, {
        rooms: [
          {
            name: 'roomName(number=1)',
            participants: [{ identity: 'id-Bob', name: 'Bob' }],
          },
          {
            name: 'roomName(number=2)',
            participants: [{ identity: 'id-Ann', name: 'Ann' }],
          },
        ],
      })
    )
  })

  it('keeps Open disabled until someone is placed', async () => {
    h.participants = people(1)
    renderSetup()
    await choose('manual')
    const open = screen.getByRole('button', { name: /setup\.open/ })
    expect(open.hasAttribute('disabled')).toBe(true)
    await click(number(1, 'Ann'))
    expect(open.hasAttribute('disabled')).toBe(false)
  })

  it('keeps the page and the plan when the panel closes and opens again', async () => {
    h.participants = people(1)
    const { unmount } = renderSetup()
    await choose('manual')
    await click(number(2, 'Ann'))
    unmount()
    renderSetup()
    expect(rooms()).toEqual([['Ann', 2]])
  })

  it('goes back to the choice once the rooms are open', async () => {
    h.participants = people(1)
    renderSetup()
    await choose('auto')
    await press('setup.open(count=2)')
    await screen.findByRole('button', { name: /setup\.auto\.title/ })
  })

  it('shows a refused Open and refetches the session it collided with', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    vi.mocked(createBreakoutSession).mockRejectedValueOnce(
      new ApiError(409, { detail: 'Already active.' })
    )
    h.participants = people(1)
    renderSetup()
    await choose('auto')
    await press('setup.open(count=2)')
    await screen.findByRole('alert')
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['breakoutSession', roomId],
    })
    invalidate.mockRestore()
  })
})
