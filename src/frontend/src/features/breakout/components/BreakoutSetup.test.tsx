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
import { breakoutSetupStore, resetBreakoutSetup } from '../store'
import { createBreakoutSession } from '../api'

const h = vi.hoisted(() => ({
  participants: [] as unknown[],
  metadata: undefined as string | undefined,
}))

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
// This browser is the meeting's owner.
vi.mock('@livekit/components-react', () => ({
  useRemoteParticipants: () => h.participants,
  useLocalParticipant: () => ({
    localParticipant: {
      identity: 'me',
      name: 'Me',
      isLocal: true,
      kind: 0,
      attributes: { room_role: 'owner' },
    },
  }),
  useRoomInfo: () => ({ metadata: h.metadata }),
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
  attributes: { room_role: 'member' },
})
const NAMES = ['Ann', 'Bob', 'Cy', 'Dee', 'Eve', 'Fay']
const people = (count: number) => NAMES.slice(0, count).map(guest)
const ME = 'setup.you(name=Me)'

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
  screen.getByRole('radio', {
    name: `setup.placeIn(number=${room} name=${name})`,
  })
// The room each guest is in, 0 for none, in the order of the rows.
const rooms = () =>
  screen.getAllByRole('group').flatMap((row) => {
    const name = row.getAttribute('aria-label') as string
    if (!NAMES.includes(name)) return []
    const pressed = Array.from(row.querySelectorAll('button')).findIndex(
      (button) => button.getAttribute('aria-checked') === 'true'
    )
    return [[name, pressed + 1] as const]
  })
const countField = () => screen.getByRole('textbox', { name: 'roomCount' })

afterEach(() => {
  cleanup()
  queryClient.clear()
  resetBreakoutSetup()
  sessionStorage.clear()
  vi.mocked(createBreakoutSession).mockClear()
  h.participants = []
  h.metadata = undefined
})

describe('BreakoutSetup', () => {
  it('takes a typed room count, kept between 2 and 20', async () => {
    renderSetup()
    for (const [typed, kept] of [
      ['30', 20],
      ['1', 2],
    ] as const) {
      fireEvent.change(countField(), { target: { value: typed } })
      fireEvent.blur(countField())
      expect(breakoutSetupStore.roomCount).toBe(kept)
      await waitFor(() =>
        expect(countField()).toHaveProperty('value', String(kept))
      )
    }
  })

  it('deals the guests evenly on Automatically, and never the host', async () => {
    h.participants = people(4)
    renderSetup()
    await choose('auto')
    expect(screen.queryByText('setup.auto.summary(count=2)')).not.toBeNull()
    const placed = rooms().map(([, room]) => room)
    expect(placed.filter((room) => room === 1)).toHaveLength(2)
    expect(placed.filter((room) => room === 2)).toHaveLength(2)
    expect(number(1, ME).getAttribute('aria-checked')).toBe('false')
    expect(number(2, ME).getAttribute('aria-checked')).toBe('false')
  })

  it('keeps a host placed by hand when the guests are dealt again', async () => {
    h.participants = people(2)
    renderSetup()
    await choose('manual')
    await click(number(2, ME))
    await press('setup.back')
    await choose('auto')
    expect(number(2, ME).getAttribute('aria-checked')).toBe('true')
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
    // The host left out stays in the main room and is not counted.
    expect(screen.queryByText('setup.noRoom(count=3)')).not.toBeNull()
  })

  it('places a person with one press and takes them out with a second', async () => {
    h.participants = people(2)
    renderSetup()
    await choose('manual')
    await click(number(2, 'Ann'))
    expect(number(2, 'Ann').getAttribute('aria-checked')).toBe('true')
    expect(number(1, 'Ann').getAttribute('aria-checked')).toBe('false')
    await click(number(2, 'Ann'))
    expect(number(2, 'Ann').getAttribute('aria-checked')).toBe('false')
  })

  it('gives each person one Tab stop, the arrow keys moving between rooms', async () => {
    h.participants = people(2)
    breakoutSetupStore.roomCount = 3
    renderSetup()
    await choose('manual')
    act(() => number(1, 'Ann').focus())
    fireEvent.keyDown(number(1, 'Ann'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(number(2, 'Ann'))
    // Tab lands on the row's last number, so the browser's own Tab leaves the row.
    fireEvent.keyDown(number(2, 'Ann'), { key: 'Tab' })
    expect(document.activeElement).toBe(number(3, 'Ann'))
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

  it('places only the guests with no room, emptiest room first', async () => {
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
    expect(number(1, ME).getAttribute('aria-checked')).toBe('false')
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

  it('keeps the room of someone who leaves while the host edits the plan', async () => {
    h.participants = people(2)
    renderSetup()
    await choose('manual')
    await click(number(2, 'Ann'))
    await click(number(1, 'Bob'))
    h.participants = people(1)
    cleanup()
    renderSetup()
    await click(number(1, 'Ann'))
    await press('setup.back')
    await choose('manual')
    h.participants = people(2)
    cleanup()
    renderSetup()
    expect(rooms()).toEqual([
      ['Ann', 1],
      ['Bob', 1],
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
    resetBreakoutSetup()
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
      resetBreakoutSetup()
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

  it('remembers the plan sent, not one edited while Open was answering', async () => {
    let answer = (_: unknown) => {}
    vi.mocked(createBreakoutSession).mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)) as never
    )
    h.participants = people(2)
    renderSetup()
    await choose('manual')
    await click(number(2, 'Ann'))
    await press('setup.openStaying(rooms=2 count=1)')
    await click(number(1, 'Bob'))
    await act(async () => answer({ id: 's1', is_active: true, rooms: [] }))
    await choose('last')
    expect(rooms()).toEqual([
      ['Ann', 2],
      ['Bob', 0],
    ])
  })

  it('starts from the count last opened, else a room per 4 guests', async () => {
    h.participants = Array.from({ length: 9 }, (_, i) => guest(`P${i}`))
    renderSetup()
    expect(countField()).toHaveProperty('value', '3')
    cleanup()
    sessionStorage.setItem(
      `breakout-setup-${roomId}`,
      JSON.stringify({ lastCount: 7 })
    )
    renderSetup()
    expect(countField()).toHaveProperty('value', '7')
  })

  it('puts the numbers under the name past 6 rooms', async () => {
    h.participants = people(1)
    breakoutSetupStore.roomCount = 6
    const { unmount } = renderSetup()
    await choose('manual')
    const row = screen.getByRole('group', { name: 'Ann' })
    expect(row.className).not.toContain('flex-d_column')
    unmount()
    breakoutSetupStore.mode = null
    breakoutSetupStore.roomCount = 7
    renderSetup()
    await choose('manual')
    expect(screen.getByRole('group', { name: 'Ann' }).className).toContain(
      'flex-d_column'
    )
    expect(number(7, 'Ann')).not.toBeNull()
  })

  it('sends the plan on Open, names alone', async () => {
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
        stop_recording: false,
      })
    )
  })

  it('stores the host under their own name, "(you)" being shown alone', async () => {
    renderSetup()
    await choose('manual')
    await click(number(1, 'setup.you(name=Me)'))
    await press(/^setup\.open/)
    await waitFor(() =>
      expect(createBreakoutSession).toHaveBeenCalledWith(
        roomId,
        expect.objectContaining({
          rooms: expect.arrayContaining([
            expect.objectContaining({
              participants: [{ identity: 'me', name: 'Me' }],
            }),
          ]),
        })
      )
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

  it('warns that Open stops a running recording, and asks for it to stop', async () => {
    h.metadata = JSON.stringify({ recording_status: 'started' })
    h.participants = people(1)
    renderSetup()
    await choose('auto')
    expect(screen.queryByText('setup.recording')).not.toBeNull()
    await press('setup.open(count=2)')
    await waitFor(() =>
      expect(createBreakoutSession).toHaveBeenLastCalledWith(
        roomId,
        expect.objectContaining({ stop_recording: true })
      )
    )
  })

  it('warns that anyone outside a browser stays in the main room, and lists none', async () => {
    const caller = {
      ...guest('Caller'),
      identity: 'sip-1',
      kind: ParticipantKind.SIP,
    }
    h.participants = [guest('Ann'), caller]
    renderSetup()
    await choose('manual')
    expect(screen.queryByText('setup.notInBrowser')).not.toBeNull()
    expect(screen.queryByRole('group', { name: 'Caller' })).toBeNull()
  })

  it('shows the open rooms and goes back to the choice once they are open', async () => {
    const opened = { id: 's1', is_active: true, rooms: [] }
    vi.mocked(createBreakoutSession).mockResolvedValueOnce(opened as never)
    h.participants = people(1)
    renderSetup()
    await choose('auto')
    await press('setup.open(count=2)')
    await screen.findByRole('button', { name: /setup\.auto\.title/ })
    expect(queryClient.getQueryData(['breakoutSession', roomId])).toBe(opened)
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
