// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ConnectionError, DisconnectReason } from 'livekit-client'
import { Conference } from './Conference'
import type { ApiRoom } from '../api/ApiRoom'
import { ApiLobbyStatus, requestEntry } from '@/features/rooms/api/requestEntry'
import {
  saveAudioInputDeviceId,
  saveAudioOutputDeviceId,
  saveProcessorConfig,
  saveVideoInputDeviceId,
} from '@/stores/userChoices'
import { reportError } from '@/features/analytics/telemetry'
import { breakoutStore, resetBreakout } from '@/features/breakout/store'
import { ProcessorType } from '@/features/rooms/livekit/components/blur'

/* eslint-disable @typescript-eslint/no-explicit-any */
const h = vi.hoisted(() => ({
  props: {} as Record<string, any>,
  connect: null as null | ((token: string) => void),
  rejoin: null as null | (() => void),
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
    localParticipant = {
      name: 'guest',
      setCameraEnabled: vi.fn(async () => undefined),
      setMicrophoneEnabled: vi.fn(async () => undefined),
    }
    prepareConnection = async () => undefined
    options: unknown
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
  BreakoutParticipant: (p: {
    connect: (t: string) => void
    onRejoin: () => void
  }) => {
    h.connect = p.connect
    h.rejoin = p.onRejoin
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
vi.mock('@/features/rooms/api/requestEntry', async (orig) => ({
  ...(await orig<typeof import('@/features/rooms/api/requestEntry')>()),
  requestEntry: vi.fn(async () => ({
    status: 'accepted',
    livekit: { url: 'https://lk.test', room: 'main-id', token: 'main-token-2' },
  })),
}))

const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)))

// A pass the page could decode, minted under that name.
const passNamed = (name: string) =>
  ['e30', btoa(JSON.stringify({ name })).replace(/=+$/, ''), 'sig'].join('.')

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
    breakoutStore.pendingMedia = { camera: true, microphone: false }
    breakoutStore.room = { id: 'r1', name: 'Room 1' }
    h.connect!('breakout-token')
  })

afterEach(async () => {
  cleanup()
  vi.mocked(requestEntry).mockClear()
  vi.mocked(requestEntry).mockImplementation(async () => ({
    status: ApiLobbyStatus.ACCEPTED,
    livekit: { url: 'https://lk.test', room: 'main-id', token: 'main-token-2' },
  }))
  resetBreakout()
  saveProcessorConfig(undefined)
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
    expect(vi.mocked(requestEntry)).not.toHaveBeenCalled()
    expect(h.rooms.length - roomsBefore).toBe(1)
  })

  it('stays in a breakout room whose camera fails while joining', async () => {
    mount()
    await flush()
    await enterBreakout()
    await act(async () => h.props.onError(new Error('could not start video')))
    await flush()
    expect(h.props.token).toBe('breakout-token')
  })

  it('returns once through the lobby when it holds no pass', async () => {
    mount('')
    await flush()
    await enterBreakout()
    const { onDisconnected, onError } = h.props
    await act(async () => {
      onDisconnected(DisconnectReason.JOIN_FAILURE)
      await Promise.resolve()
      onError(ConnectionError.serverUnreachable('no signal connection'))
    })
    await flush()
    expect(vi.mocked(requestEntry)).toHaveBeenCalledTimes(1)
    expect(h.props.token).toBe('main-token-2')
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
    expect(vi.mocked(requestEntry)).not.toHaveBeenCalled()
    expect(h.props.token).toBe('breakout-token')
  })

  it.each([
    ['unchanged', 'guest', false],
    ['changed since page load', 'Ann', true],
  ])(
    'returns with the held pass only when the name is %s',
    async (_case, heldName, asksEntry) => {
      const held = passNamed(heldName)
      mount(held)
      await flush()
      await enterBreakout()
      await act(async () =>
        h.props.onDisconnected(DisconnectReason.ROOM_DELETED)
      )
      await flush()
      expect(vi.mocked(requestEntry).mock.calls.length).toBe(asksEntry ? 1 : 0)
      expect(h.props.token).toBe(asksEntry ? 'main-token-2' : held)
    }
  )

  it('returns with the main-meeting pass it holds, asking nothing', async () => {
    vi.mocked(requestEntry).mockRejectedValue(new Error('lobby down'))
    mount()
    await flush()
    await enterBreakout()
    const roomsBefore = h.rooms.length
    await act(async () => h.props.onDisconnected(DisconnectReason.ROOM_DELETED))
    await flush()
    expect(h.props.token).toBe('t')
    expect(h.rooms.length - roomsBefore).toBe(1)
    expect(vi.mocked(requestEntry)).not.toHaveBeenCalled()
    expect(breakoutStore.room).toBeNull()
  })

  it('asks for entry only once the held pass is refused', async () => {
    mount()
    await flush()
    await enterBreakout()
    await act(async () => h.props.onDisconnected(DisconnectReason.ROOM_DELETED))
    await flush()
    expect(h.props.token).toBe('t')
    expect(vi.mocked(requestEntry)).not.toHaveBeenCalled()
    await act(async () =>
      h.props.onError(ConnectionError.notAllowed('token expired', 401))
    )
    await flush()
    expect(vi.mocked(requestEntry)).toHaveBeenCalledTimes(1)
    expect(h.props.token).toBe('main-token-2')
  })

  it('offers a rejoin instead of reloading when entry fails too', async () => {
    vi.mocked(requestEntry).mockRejectedValue(new Error('lobby down'))
    mount()
    await flush()
    await enterBreakout()
    await act(async () => h.props.onDisconnected(DisconnectReason.ROOM_DELETED))
    await flush()
    await act(async () =>
      h.props.onError(ConnectionError.notAllowed('token expired', 401))
    )
    await flush()
    expect(breakoutStore).toMatchObject({ returnFailed: true, target: null })
    expect(vi.mocked(requestEntry)).toHaveBeenCalledTimes(1)

    // Rejoin asks the lobby again rather than the pass it refused.
    vi.mocked(requestEntry).mockResolvedValue({
      status: ApiLobbyStatus.ACCEPTED,
      livekit: {
        url: 'https://lk.test',
        room: 'main-id',
        token: 'main-token-2',
      },
    })
    const roomsBefore = h.rooms.length
    await act(async () => h.rejoin!())
    await flush()
    expect(breakoutStore).toMatchObject({ returnFailed: false, target: 'main' })
    expect(vi.mocked(requestEntry)).toHaveBeenCalledTimes(2)
    expect(h.props.token).toBe('main-token-2')
    expect(h.rooms.length - roomsBefore).toBe(1)
  })

  it('restores the camera with the effect chosen in the meeting', async () => {
    mount()
    await flush()
    await act(async () =>
      saveProcessorConfig({ type: ProcessorType.BLUR, blurRadius: 10 })
    )
    await enterBreakout()
    await act(async () => {
      await h.props.onConnected()
    })
    expect(
      h.rooms.at(-1).localParticipant.setCameraEnabled
    ).toHaveBeenCalledWith(true, { processor: { effect: 'blur' } })
  })

  it('opens the breakout room on the devices picked during the call', async () => {
    mount()
    await flush()
    await act(async () => {
      saveAudioInputDeviceId('headset-mic')
      saveVideoInputDeviceId('usb-cam')
      saveAudioOutputDeviceId('headset-out')
    })
    await enterBreakout()
    const { options } = h.rooms.at(-1)
    expect(options.audioCaptureDefaults.deviceId).toBe('headset-mic')
    expect(options.videoCaptureDefaults.deviceId).toBe('usb-cam')
    expect(options.audioOutput.deviceId).toBe('headset-out')
  })

  it('reports a camera that fails to come back unless a device is to blame', async () => {
    vi.mocked(reportError).mockClear()
    mount()
    await flush()
    await enterBreakout()
    const camera = h.rooms.at(-1).localParticipant.setCameraEnabled
    const denied = Object.assign(new Error('denied'), {
      name: 'NotAllowedError',
    })
    camera.mockRejectedValueOnce(denied)
    await act(async () => {
      await expect(h.props.onConnected()).resolves.toBeUndefined()
    })
    expect(vi.mocked(reportError)).not.toHaveBeenCalled()

    const broken = new Error('boom')
    camera.mockRejectedValueOnce(broken)
    breakoutStore.pendingMedia = { camera: true, microphone: false }
    await act(async () => {
      await expect(h.props.onConnected()).resolves.toBeUndefined()
    })
    expect(vi.mocked(reportError)).toHaveBeenCalledWith(
      'livekit_room_error',
      broken,
      { path: 'breakout_restore' }
    )
  })
})
