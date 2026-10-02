// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { BreakoutParticipant } from '../components/BreakoutParticipant'
import { ApiError } from '@/api/ApiError'
import { joinBreakoutRoom } from '../api'
import { breakoutStore, resetBreakout } from '../store'

const h = vi.hoisted(() => ({
  state: 'connected',
  room: { disconnect: async () => {} },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@livekit/components-react', () => ({
  useRoomContext: () => h.room,
  useRoomInfo: () => ({
    metadata: JSON.stringify({ breakout: { session_id: 's1' } }),
  }),
  useConnectionState: () => h.state,
}))
vi.mock('@/features/analytics/telemetry', () => ({ reportError: vi.fn() }))
vi.mock('../api', () => ({
  joinBreakoutRoom: vi
    .fn()
    .mockRejectedValueOnce(new Error('503 Service Unavailable'))
    .mockResolvedValue({
      room: { id: 'r1', name: 'R1' },
      token: 'breakout-token',
    }),
}))

const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)))

afterEach(() => {
  cleanup()
  resetBreakout()
})

describe('a failed move to the assigned room', () => {
  it('is shown, then tried again once the main room reconnects', async () => {
    const connect = vi.fn()
    const ui = () => <BreakoutParticipant mainRoomId="main" connect={connect} />
    const { rerender } = render(ui())
    await flush()
    expect(screen.getByRole('status').textContent).toBe('moveFailed')

    h.state = 'reconnecting'
    rerender(ui())
    h.state = 'connected'
    rerender(ui())
    await flush()

    expect(vi.mocked(joinBreakoutRoom)).toHaveBeenCalledTimes(2)
    expect(connect).toHaveBeenCalledWith('breakout-token')
  })

  it('is tried again after a delay while the main room stays up', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(joinBreakoutRoom).mockClear()
      vi.mocked(joinBreakoutRoom).mockRejectedValueOnce(new Error('503'))
      const connect = vi.fn()
      render(<BreakoutParticipant mainRoomId="main" connect={connect} />)
      await act(async () => vi.advanceTimersByTimeAsync(0))
      expect(screen.getByRole('status').textContent).toBe('moveFailed')

      await act(async () => vi.advanceTimersByTimeAsync(5000))

      expect(vi.mocked(joinBreakoutRoom)).toHaveBeenCalledTimes(2)
      expect(connect).toHaveBeenCalledWith('breakout-token')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a move the server refuses', () => {
  it('is not tried again on a timer', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(joinBreakoutRoom).mockClear()
      vi.mocked(joinBreakoutRoom).mockRejectedValueOnce(
        new ApiError(403, { detail: 'Invalid LiveKit token' })
      )
      render(<BreakoutParticipant mainRoomId="main" connect={vi.fn()} />)
      await act(async () => vi.advanceTimersByTimeAsync(0))

      await act(async () => vi.advanceTimersByTimeAsync(5000))

      expect(vi.mocked(joinBreakoutRoom)).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a move still running when the meeting is left', () => {
  it('leaves nothing behind for the next meeting', async () => {
    let answer: (pass: unknown) => void = () => {}
    vi.mocked(joinBreakoutRoom).mockReturnValueOnce(
      new Promise((resolve) => (answer = resolve)) as never
    )
    const connect = vi.fn()
    const { unmount } = render(
      <BreakoutParticipant mainRoomId="main" connect={connect} />
    )
    await flush()
    unmount()
    resetBreakout()

    await act(async () =>
      answer({ room: { id: 'r1', name: 'R1' }, token: 'breakout-token' })
    )
    await flush()

    expect(breakoutStore.room).toBeNull()
    expect(breakoutStore.target).toBeNull()
    expect(connect).not.toHaveBeenCalled()
  })
})
