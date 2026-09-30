// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ConnectionError, DisconnectReason } from 'livekit-client'
import { useBreakoutConnection } from './useBreakoutConnection'
import { breakoutStore, resetBreakout } from '../store'
import { shouldFetchAssignment } from '../utils/transitions'

vi.mock('livekit-client', async (orig) => {
  const actual = await orig<typeof import('livekit-client')>()
  class FakeRoom {
    state = actual.ConnectionState.Disconnected
    localParticipant = { name: 'Ann' }
  }
  return { ...actual, Room: FakeRoom }
})
vi.mock('@/features/rooms/api/requestEntry', () => ({ requestEntry: vi.fn() }))
vi.mock('@/features/analytics/telemetry', () => ({ reportError: vi.fn() }))
vi.mock('@/features/rooms/livekit/components/blur', () => ({
  ProcessorType: { BLUR: 'blur', VIRTUAL: 'virtual' },
  BackgroundProcessorFactory: { fromProcessorConfig: () => undefined },
}))

const SESSION = 's1'
const ROOM = { id: 'r1', name: 'Room 1' }
const OPTIONS = {}

afterEach(() => resetBreakout())

type Hook = { result: { current: ReturnType<typeof useBreakoutConnection> } }

// What useBreakout leaves once it has a pass to the assigned room.
const moveIn = (hook: Hook, token: string) =>
  act(() => {
    Object.assign(breakoutStore, { sessionId: SESSION, target: ROOM })
    breakoutStore.room = ROOM
    hook.result.current.connect(token)
  })

const connected = (hook: Hook) =>
  act(async () => {
    await hook.result.current.onConnected()
  })

const mount = async () => {
  const hook = renderHook(() =>
    useBreakoutConnection('abc-defg-hij', OPTIONS, 'held-pass')
  )
  moveIn(hook, 'breakout-pass')
  await connected(hook)
  return hook
}

// Back in the main meeting on the held pass, the session still announced.
const backInMain = async (hook: Hook) => {
  expect(hook.result.current.token).toBe('held-pass')
  await connected(hook)
  expect(breakoutStore).toMatchObject({ room: null, target: null })
}

describe('a browser that loses its breakout room while the split is open', () => {
  it.each([
    ['a dropped connection', undefined],
    ['a media server shutting down', DisconnectReason.SERVER_SHUTDOWN],
    ['a failed join', DisconnectReason.JOIN_FAILURE],
  ])('goes back into its room after %s', async (_case, reason) => {
    const hook = await mount()

    act(() => {
      expect(hook.result.current.onDisconnected(reason)).toBe(true)
    })
    await backInMain(hook)

    expect(shouldFetchAssignment(SESSION, breakoutStore)).toBe(true)
  })

  it('goes back into its room when its first join fails', async () => {
    const hook = renderHook(() =>
      useBreakoutConnection('abc-defg-hij', OPTIONS, 'held-pass')
    )
    moveIn(hook, 'breakout-pass')

    act(() =>
      hook.result.current.onError(ConnectionError.serverUnreachable('down'))
    )
    await backInMain(hook)

    expect(shouldFetchAssignment(SESSION, breakoutStore)).toBe(true)
  })

  it('tries once only when the room it goes back to fails too', async () => {
    const hook = await mount()
    act(() => {
      hook.result.current.onDisconnected(DisconnectReason.SERVER_SHUTDOWN)
    })
    await backInMain(hook)

    moveIn(hook, 'breakout-pass-2')
    act(() => {
      hook.result.current.onDisconnected(DisconnectReason.JOIN_FAILURE)
    })
    await backInMain(hook)

    expect(shouldFetchAssignment(SESSION, breakoutStore)).toBe(false)
    expect(breakoutStore.moveFailed).toBe(true)
  })

  it('stays in the main meeting when the split closes', async () => {
    const hook = await mount()

    act(() => {
      hook.result.current.onDisconnected(DisconnectReason.ROOM_DELETED)
    })
    await backInMain(hook)

    expect(shouldFetchAssignment(SESSION, breakoutStore)).toBe(false)
  })

  it('leaves the meeting when removed from its breakout room', async () => {
    const hook = await mount()

    act(() => {
      expect(
        hook.result.current.onDisconnected(DisconnectReason.PARTICIPANT_REMOVED)
      ).toBe(false)
    })

    expect(hook.result.current.token).toBe('breakout-pass')
  })
})
