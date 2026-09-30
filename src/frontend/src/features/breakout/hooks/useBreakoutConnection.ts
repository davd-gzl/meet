import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import {
  ConnectionError,
  ConnectionErrorReason,
  ConnectionState,
  MediaDeviceFailure,
  Room,
  decodeTokenPayload,
  type DisconnectReason,
  type RoomOptions,
} from 'livekit-client'
import { requestEntry } from '@/features/rooms/api/requestEntry'
import { reportError } from '@/features/analytics/telemetry'
import { getMediaDeviceFailure } from '@/features/rooms/livekit/utils/mediaPermissions'
import { BackgroundProcessorFactory } from '@/features/rooms/livekit/components/blur'
import { userChoicesStore } from '@/stores/userChoices'
import { userStore } from '@/stores/user'
import { breakoutStore, resetBreakout } from '../store'
import { disconnectAction } from '../utils/transitions'

// Where the pass of the current Room came from: the page's own, a breakout
// room's, the main-meeting pass held since the page opened, or a new entry.
type Via = 'page' | 'breakout' | 'held' | 'entry'

// Conference reads the devices once at mount; a move takes those picked since.
const withChosenDevices = (options: RoomOptions): RoomOptions => {
  const { audioDeviceId, videoDeviceId, audioOutputDeviceId } = userChoicesStore
  return {
    ...options,
    audioCaptureDefaults: {
      ...options.audioCaptureDefaults,
      deviceId: audioDeviceId ?? options.audioCaptureDefaults?.deviceId,
    },
    videoCaptureDefaults: {
      ...options.videoCaptureDefaults,
      deviceId: videoDeviceId ?? options.videoCaptureDefaults?.deviceId,
    },
    audioOutput: {
      ...options.audioOutput,
      deviceId: audioOutputDeviceId ?? options.audioOutput?.deviceId,
    },
  }
}

const tokenName = (token: string) => {
  try {
    return decodeTokenPayload(token).name
  } catch {
    return undefined
  }
}

// Each move connects a new Room with a new pass; the attempt keys both.
export const useBreakoutConnection = (
  slug: string,
  roomOptions: RoomOptions,
  heldToken?: string
) => {
  const [connection, setConnection] = useState({
    token: '',
    attempt: 0,
    via: 'page' as Via,
  })
  // Bumped at once, so a callback of a replaced Room knows it is stale.
  const latest = useRef(0)
  // The held pass the server refused, which a Rejoin does not try again.
  const refusedHeld = useRef<string>()
  const room = useMemo(
    () =>
      new Room(
        connection.attempt ? withChosenDevices(roomOptions) : roomOptions
      ),
    [roomOptions, connection.attempt]
  )
  const { pendingMedia } = useSnapshot(breakoutStore)

  useEffect(() => resetBreakout, [slug])

  const open = useCallback((token: string, via: Via) => {
    latest.current += 1
    setConnection({ token, attempt: latest.current, via })
  }, [])
  const connect = useCallback(
    (token: string) => open(token, 'breakout'),
    [open]
  )

  // The lobby, asked only once the held pass is refused.
  const enterAgain = useCallback(async () => {
    const username = userStore.username || room.localParticipant.name || ''
    const entry = await requestEntry({ roomId: slug, username }).catch(
      (error) => {
        reportError('generic_failure', error, { path: 'breakout_return' })
        return null
      }
    )
    if (entry?.livekit) return open(entry.livekit.token, 'entry')
    Object.assign(breakoutStore, { target: null, returnFailed: true })
  }, [slug, room, open])

  const returnToMain = useCallback(() => {
    // A failed join reaches both onDisconnected and onError; return once.
    if (breakoutStore.target === 'main') return
    Object.assign(breakoutStore, {
      target: 'main',
      room: null,
      returnFailed: false,
      pendingMedia: breakoutStore.media,
    })
    // The held pass carries the name from page load, so a rename asks anew.
    const name = room.localParticipant.name
    const held = tokenName(heldToken ?? '')
    const renamed = !!name && held !== undefined && held !== name
    if (heldToken && heldToken !== refusedHeld.current && !renamed)
      open(heldToken, 'held')
    else void enterAgain()
  }, [heldToken, room, open, enterAgain])

  // Kept stable per attempt: LiveKitRoom runs connect() again whenever onError changes.
  const onError = useCallback(
    (error?: Error) => {
      if (connection.attempt !== latest.current) return
      if (room.state === ConnectionState.Connected) {
        breakoutStore.target = null
        return
      }
      if (connection.via === 'breakout') return returnToMain()
      if (connection.via === 'held') {
        if (
          error instanceof ConnectionError &&
          error.reason === ConnectionErrorReason.NotAllowed
        )
          refusedHeld.current = connection.token
        return void enterAgain()
      }
      Object.assign(breakoutStore, {
        target: null,
        returnFailed: connection.via === 'entry',
      })
    },
    [connection, room, returnToMain, enterAgain]
  )

  // True when the disconnect is breakout's to handle.
  const onDisconnected = (reason?: DisconnectReason) => {
    if (connection.attempt !== latest.current) return true
    const action = disconnectAction(reason, breakoutStore)
    if (action === 'returnToMain') returnToMain()
    return action !== 'default'
  }

  // True when a move's camera and microphone were restored instead.
  const onConnected = async () => {
    const media = breakoutStore.pendingMedia
    Object.assign(breakoutStore, { target: null, returnFailed: false })
    if (!media) return false
    // Back as before the move, background effect included.
    try {
      await Promise.all([
        room.localParticipant.setCameraEnabled(media.camera, {
          processor: BackgroundProcessorFactory.fromProcessorConfig(
            userChoicesStore.processorConfig
          ),
        }),
        room.localParticipant.setMicrophoneEnabled(media.microphone),
      ])
    } catch (error) {
      // As on join: a device failure is shown to the user, not reported.
      const failure = getMediaDeviceFailure(error as Error)
      if (!failure || failure === MediaDeviceFailure.Other)
        reportError('livekit_room_error', error, { path: 'breakout_restore' })
    } finally {
      breakoutStore.pendingMedia = null
    }
    return true
  }

  return {
    room,
    attempt: connection.attempt,
    token: connection.token,
    pendingMedia,
    connect,
    rejoin: returnToMain,
    onError,
    onConnected,
    onDisconnected,
  }
}
