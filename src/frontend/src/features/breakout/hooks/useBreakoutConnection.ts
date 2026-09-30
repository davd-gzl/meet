import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ConnectionState,
  Room,
  type DisconnectReason,
  type RoomOptions,
} from 'livekit-client'
import { breakoutStore, resetBreakout } from '../store'
import { disconnectAction } from '../utils/transitions'

// Where the pass of the current Room came from: the page's own, a breakout
// room's, or the main-meeting pass held since the page opened.
type Via = 'page' | 'breakout' | 'held'

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

  useEffect(() => resetBreakout, [slug])

  const open = useCallback((token: string, via: Via) => {
    latest.current += 1
    setConnection({ token, attempt: latest.current, via })
  }, [])
  const connect = useCallback(
    (token: string) => open(token, 'breakout'),
    [open]
  )

  const returnToMain = useCallback(() => {
    // A failed join reaches both onDisconnected and onError; return once.
    if (breakoutStore.target === 'main') return
    Object.assign(breakoutStore, { target: 'main', room: null })
    open(heldToken ?? '', 'held')
  }, [heldToken, open])

  // Kept stable per attempt: LiveKitRoom runs connect() again whenever onError changes.
  const onError = useCallback(() => {
    if (connection.attempt !== latest.current) return
    if (
      room.state !== ConnectionState.Connected &&
      connection.via === 'breakout'
    )
      return returnToMain()
    breakoutStore.target = null
  }, [connection, room, returnToMain])

  // True when the disconnect is breakout's to handle.
  const onDisconnected = (reason?: DisconnectReason) => {
    if (connection.attempt !== latest.current) return true
    const action = disconnectAction(reason, breakoutStore)
    if (action === 'returnToMain') returnToMain()
    return action !== 'default'
  }

  // True after a move, whose join is not a first join.
  const onConnected = () => {
    breakoutStore.target = null
    return connection.via !== 'page'
  }

  return {
    room,
    attempt: connection.attempt,
    token: connection.token,
    connect,
    onError,
    onConnected,
    onDisconnected,
  }
}
