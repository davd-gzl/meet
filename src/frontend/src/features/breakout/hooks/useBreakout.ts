import { useEffect } from 'react'
import { useConnectionState, useRoomContext } from '@livekit/components-react'
import { ConnectionState, type Room } from 'livekit-client'
import { reportError } from '@/features/analytics/telemetry'
import { useRoomMetadata } from '@/features/recording/hooks/useRoomMetadata'
import { joinBreakoutRoom } from '../api'
import { breakoutStore } from '../store'
import { shouldFetchAssignment } from '../utils/transitions'

// Hands a pass to Conference, which builds a new Room for it.
export type Connect = (token: string) => void

const moveToAssignedRoom = async (
  room: Room,
  mainRoomId: string,
  connect: Connect
) => {
  const pass = await joinBreakoutRoom(mainRoomId)
  if (!pass || breakoutStore.target) return
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

  const sessionId: string | null =
    useRoomMetadata()?.breakout?.session_id ?? null
  useEffect(() => {
    if (!sessionId && breakoutStore.moveFailed) breakoutStore.moveFailed = false
    if (state !== ConnectionState.Connected) return
    if (!shouldFetchAssignment(sessionId, breakoutStore)) return
    Object.assign(breakoutStore, { sessionId, moveFailed: false })
    moveToAssignedRoom(room, mainRoomId, connect).catch((error) => {
      // Forgotten, so the next metadata change or reconnect tries again.
      Object.assign(breakoutStore, { sessionId: null, moveFailed: true })
      reportError('generic_failure', error, { path: 'breakout_move' })
    })
  }, [state, sessionId, room, mainRoomId, connect])
}
