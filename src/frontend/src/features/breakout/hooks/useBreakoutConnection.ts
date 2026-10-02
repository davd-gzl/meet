import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ConnectionError,
  ConnectionState,
  Room,
  type DisconnectReason,
  type RoomOptions,
} from 'livekit-client'
import { breakoutStore, resetBreakout } from '../store'
import { disconnectAction } from '../utils/transitions'

// Each move connects a new Room with a new pass; the attempt keys both. An
// empty pass means the main meeting's, which Conference holds.
export const useBreakoutConnection = (
  slug: string,
  roomOptions: RoomOptions
) => {
  const [connection, setConnection] = useState({ token: '', attempt: 0 })
  // Bumped at once, so a callback of a replaced Room knows it is stale.
  const latest = useRef(0)
  const room = useMemo(
    () => new Room(roomOptions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roomOptions, connection.attempt]
  )

  useEffect(() => resetBreakout, [slug])

  const connect = useCallback((token: string) => {
    latest.current += 1
    setConnection({ token, attempt: latest.current })
  }, [])

  const returnToMain = useCallback(() => {
    Object.assign(breakoutStore, { target: 'main', room: null })
    connect('')
  }, [connect])

  // Kept stable per attempt: LiveKitRoom runs connect() again whenever onError changes.
  const onError = useCallback(
    (error: Error) => {
      // A failed join reaches both onDisconnected and onError; return once.
      if (connection.attempt !== latest.current) return
      // A camera or microphone failure while joining is no failed join.
      if (
        error instanceof ConnectionError &&
        room.state !== ConnectionState.Connected &&
        connection.token !== ''
      )
        return returnToMain()
      breakoutStore.target = null
    },
    [connection, room, returnToMain]
  )

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
    return connection.attempt !== 0
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
