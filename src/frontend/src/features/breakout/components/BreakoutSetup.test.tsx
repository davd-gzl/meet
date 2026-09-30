// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ParticipantKind } from 'livekit-client'
import { BreakoutSetup } from './BreakoutSetup'
import { resetBreakout } from '../store'

const h = vi.hoisted(() => ({ participants: [] as unknown[] }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@livekit/components-react', () => ({
  useRemoteParticipants: () => h.participants,
}))
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  createBreakoutSession: vi.fn(async () => ({})),
}))

const guest = {
  identity: 'guest-1',
  name: 'Ann',
  isLocal: false,
  kind: ParticipantKind.STANDARD,
  attributes: { room_role: 'member' },
}

const renderSetup = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BreakoutSetup roomId="room-1" />
    </QueryClientProvider>
  )

afterEach(() => {
  cleanup()
  resetBreakout()
  h.participants = []
})

describe('BreakoutSetup', () => {
  it('names the room-count selector for screen readers', () => {
    renderSetup()
    expect(
      screen.queryByRole('button', { name: /setup\.roomCount/ })
    ).not.toBeNull()
  })

  it('keeps Open disabled until someone is assigned', async () => {
    h.participants = [guest]
    renderSetup()
    const open = screen.getByRole('button', { name: 'setup.open' })
    expect(open.hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'setup.shuffle' }))
    await waitFor(() => expect(open.hasAttribute('disabled')).toBe(false))
  })

  it('keeps the plan when the panel closes and opens again', () => {
    h.participants = [guest]
    const { unmount } = renderSetup()
    fireEvent.click(screen.getByRole('button', { name: 'setup.shuffle' }))
    unmount()
    renderSetup()
    expect(screen.queryByText('setup.allAssigned')).not.toBeNull()
  })

  it('starts a fresh plan once the rooms are open', async () => {
    h.participants = [guest]
    renderSetup()
    fireEvent.click(screen.getByRole('button', { name: 'setup.shuffle' }))
    await screen.findByText('setup.allAssigned')
    fireEvent.click(screen.getByRole('button', { name: 'setup.open' }))
    await waitFor(() =>
      expect(screen.queryByText('setup.unassigned')).not.toBeNull()
    )
  })
})
