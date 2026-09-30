// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ConnectionError, DisconnectReason } from 'livekit-client'
import { Conference } from './Conference'
import type { ApiRoom } from '../api/ApiRoom'
import { breakoutStore, resetBreakout } from '@/features/breakout/store'

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => ({
  props: {} as Record<string, any>,
  connect: null as null | ((token: string) => void),
  rooms: [] as any[],
}))

vi.mock('@livekit/components-react', async (orig) => ({
  ...(await orig<typeof import('@livekit/components-react')>()),
  LiveKitRoom: (props: { children: ReactNode }) => {
    h.props = props
    return <>{props.children}</>
  },
}))
vi.mock('livekit-client', async (orig) => {
  const actual = await orig<typeof import('livekit-client')>()
  class FakeRoom {
    state = 'disconnected'
    numParticipants = 1
    options: unknown
    localParticipant = { name: 'guest' }
    prepareConnection = async () => undefined
    constructor(options: unknown) {
      this.options = options
      h.rooms.push(this)
    }
  }
  return { ...actual, Room: FakeRoom }
})
vi.mock('@/features/rooms/livekit/components/blur', () => ({
  ProcessorType: { BLUR: 'blur', VIRTUAL: 'virtual' },
  BackgroundProcessorFactory: {
    fromProcessorConfig: (c?: { type: string }) =>
      c ? { effect: c.type } : undefined,
  },
}))
vi.mock('@/api/useConfig', () => ({
  useConfig: () => ({
    data: {
      livekit: { url: 'https://lk.test', default_video_codec: 'vp9' },
      auto_mute_on_join_threshold: 100,
    },
  }),
}))
vi.mock('@/features/analytics/telemetry', () => ({
  captureEvent: vi.fn(),
  captureMediaEvent: vi.fn(async () => undefined),
  reportError: vi.fn(),
}))
vi.mock('@/features/breakout/components/BreakoutParticipant', () => ({
  BreakoutParticipant: (p: { connect: (t: string) => void }) => {
    h.connect = p.connect
    return null
  },
}))
vi.mock('../livekit/prefabs/VideoConference', () => ({
  VideoConference: () => null,
}))
vi.mock('./InviteDialog', () => ({ InviteDialog: () => null }))
vi.mock('@/features/pip/components/PictureInPictureConference', () => ({
  PictureInPictureConference: () => null,
}))
vi.mock('@/features/devtools', () => ({ MeetDevtools: () => null }))
vi.mock('./WatchMediaDeviceErrors', () => ({
  WatchMediaDeviceErrors: () => null,
}))
vi.mock('@/layout/Screen', () => ({
  Screen: (p: { children: ReactNode }) => <>{p.children}</>,
}))
vi.mock('@/components/QueryAware', () => ({
  QueryAware: (p: { children: ReactNode }) => <>{p.children}</>,
}))
vi.mock('@/utils/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('@/navigation/navigateTo', () => ({ navigateTo: vi.fn() }))
vi.mock('@/features/notifications/utils', () => ({
  notifyAutoMutedOnJoin: vi.fn(),
}))

const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)))

const mount = (token = 't') =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Conference
        roomId="abc-defg-hij"
        initialRoomData={
          {
            id: 'main-id',
            slug: 'abc-defg-hij',
            livekit: { url: 'https://lk.test', room: 'main-id', token },
          } as ApiRoom
        }
      />
    </QueryClientProvider>
  )

// What moveToAssignedRoom does once the pass is in hand.
const enterBreakout = () =>
  act(async () => {
    breakoutStore.room = { id: 'r1', name: 'Room 1' }
    h.connect!('breakout-token')
  })

afterEach(async () => {
  cleanup()
  resetBreakout()
  await flush()
  localStorage.clear()
})

describe('Conference during a breakout move', () => {
  it('returns once from a breakout room it cannot join', async () => {
    mount()
    await flush()
    await enterBreakout()
    const roomsBefore = h.rooms.length
    const { onDisconnected, onError } = h.props
    // Room.connect's catch emits Disconnected, then rejects.
    await act(async () => {
      onDisconnected(DisconnectReason.JOIN_FAILURE)
      await Promise.resolve()
      onError(
        ConnectionError.serverUnreachable(
          'could not establish signal connection'
        )
      )
    })
    await flush()
    expect(h.props.token).toBe('t')
    expect(h.rooms.length - roomsBefore).toBe(1)
  })

  it('ignores the refusal of a held pass a later move replaced', async () => {
    mount()
    await flush()
    await enterBreakout()
    await act(async () => h.props.onDisconnected(DisconnectReason.ROOM_DELETED))
    await flush()
    const staleOnError = h.props.onError
    await enterBreakout()
    await act(async () =>
      staleOnError(ConnectionError.notAllowed('token expired', 401))
    )
    await flush()
    expect(h.props.token).toBe('breakout-token')
  })

  it('returns with the main-meeting pass it holds', async () => {
    mount()
    await flush()
    await enterBreakout()
    const roomsBefore = h.rooms.length
    await act(async () => h.props.onDisconnected(DisconnectReason.ROOM_DELETED))
    await flush()
    expect(h.props.token).toBe('t')
    expect(h.rooms.length - roomsBefore).toBe(1)
    expect(breakoutStore.room).toBeNull()
  })
})
