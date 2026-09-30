import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import {
  ConnectionState,
  Room,
  type DisconnectReason,
  type RoomOptions,
} from 'livekit-client'
import { requestEntry } from '@/features/rooms/api/requestEntry'
import { reportError } from '@/features/analytics/telemetry'
import { BackgroundProcessorFactory } from '@/features/rooms/livekit/components/blur'
import { userChoicesStore } from '@/stores/userChoices'
import { userStore } from '@/stores/user'
import { breakoutStore, resetBreakout } from '../store'
import { disconnectAction } from '../utils/transitions'

// Where the pass of the current Room came from: the page's own, a breakout
// room's, the main-meeting pass held since the page opened, or a new entry.
type Via = 'page' | 'breakout' | 'held' | 'entry'

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
  const room = useMemo(
    () => new Room(roomOptions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (heldToken) open(heldToken, 'held')
    else void enterAgain()
  }, [heldToken, open, enterAgain])

  // Kept stable per attempt: LiveKitRoom runs connect() again whenever onError changes.
  const onError = useCallback(() => {
    if (connection.attempt !== latest.current) return
    if (room.state === ConnectionState.Connected) {
      breakoutStore.target = null
      return
    }
    if (connection.via === 'breakout') return returnToMain()
    if (connection.via === 'held') return void enterAgain()
    Object.assign(breakoutStore, {
      target: null,
      returnFailed: connection.via === 'entry',
    })
  }, [connection, room, returnToMain, enterAgain])

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
