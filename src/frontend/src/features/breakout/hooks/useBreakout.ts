import { useEffect, useRef, useState, type RefObject } from 'react'
import { useConnectionState, useRoomContext } from '@livekit/components-react'
import { ConnectionState, type Room } from 'livekit-client'
import { ApiError } from '@/api/ApiError'
import { reportError } from '@/features/analytics/telemetry'
import { useRoomMetadata } from '@/features/recording/hooks/useRoomMetadata'
import { useRoomData } from '@/features/rooms/livekit/hooks/useRoomData'
import { joinBreakoutRoom } from '../api'
import { breakoutStore } from '../store'
import { shouldFetchAssignment } from '../utils/transitions'

// Hands a pass to Conference, which builds a new Room for it.
export type Connect = (token: string) => void

const RETRY_DELAY_MS = 5000

const moveToAssignedRoom = async (
  room: Room,
  mainRoomId: string,
  mainToken: string,
  connect: Connect,
  mounted: RefObject<boolean>
) => {
  const pass = await joinBreakoutRoom(mainRoomId, mainToken)
  // A meeting left while the request ran keeps the store clean for the next one.
  if (!pass || breakoutStore.target || !mounted.current) return
  breakoutStore.target = pass.room
  try {
    breakoutStore.leaving = true
    // connect() on a connected Room ignores its token, so leave first and wait.
    await room.disconnect()
    breakoutStore.leaving = false
    breakoutStore.room = pass.room
    connect(pass.token)
  } catch (error) {
    Object.assign(breakoutStore, { target: null, leaving: false })
    throw error
  }
}

export const useBreakout = (mainRoomId: string, connect: Connect) => {
  const room = useRoomContext()
  const state = useConnectionState()
  const mainToken = useRoomData()?.livekit?.token ?? ''
  const mounted = useRef(true)
  const [retries, setRetries] = useState(0)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const sessionId: string | null =
    useRoomMetadata()?.breakout?.session_id ?? null
  useEffect(() => {
    if (!sessionId && breakoutStore.moveFailed) breakoutStore.moveFailed = false
    if (state !== ConnectionState.Connected) return
    if (!shouldFetchAssignment(sessionId, breakoutStore)) return
    Object.assign(breakoutStore, { sessionId, moveFailed: false })
    moveToAssignedRoom(room, mainRoomId, mainToken, connect, mounted).catch(
      (error) => {
        // Forgotten and tried again after a delay, or on a reconnect.
        Object.assign(breakoutStore, { sessionId: null, moveFailed: true })
        reportError('generic_failure', error, { path: 'breakout_move' })
        // A refused request, such as an expired pass, fails the same way again.
        if (error instanceof ApiError && error.statusCode < 500) return
        setTimeout(() => {
          if (mounted.current) setRetries((n) => n + 1)
        }, RETRY_DELAY_MS)
      }
    )
  }, [state, sessionId, room, mainRoomId, mainToken, connect, retries])
}
