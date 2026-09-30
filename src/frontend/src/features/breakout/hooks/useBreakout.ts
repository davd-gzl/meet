import { useEffect } from 'react'
import {
  useConnectionState,
  useLocalParticipant,
  useRoomContext,
} from '@livekit/components-react'
import { ConnectionState, type Room } from 'livekit-client'
import { reportError } from '@/features/analytics/telemetry'
import { useRoomMetadata } from '@/features/recording/hooks/useRoomMetadata'
import { fetchBreakoutAssignment, joinBreakoutRoom } from '../api'
import { breakoutStore } from '../store'
import { leaveCurrentRoom } from '../utils/roomLifecycle'
import { shouldFetchAssignment } from '../utils/transitions'

// Hands a pass to Conference, which builds a new Room for it.
export type Connect = (token: string) => void

const moveToAssignedRoom = async (
  room: Room,
  mainRoomId: string,
  connect: Connect
) => {
  const assignment = await fetchBreakoutAssignment(mainRoomId)
  if (!assignment || breakoutStore.target) return
  breakoutStore.target = assignment.room
  try {
    const pass = await joinBreakoutRoom(
      mainRoomId,
      assignment.session_id,
      assignment.room.id
    )
    breakoutStore.pendingMedia = breakoutStore.media
    breakoutStore.leaving = true
    await leaveCurrentRoom(room)
    breakoutStore.leaving = false
    breakoutStore.room = assignment.room
    connect(pass.token)
  } catch (error) {
    Object.assign(breakoutStore, {
      target: null,
      leaving: false,
      pendingMedia: null,
    })
    throw error
  }
}

export const useBreakout = (mainRoomId: string, connect: Connect) => {
  const room = useRoomContext()
  const state = useConnectionState()
  const { isCameraEnabled, isMicrophoneEnabled } = useLocalParticipant()

  // Recorded while connected, since a deleted room has already unpublished them.
  useEffect(() => {
    if (state !== ConnectionState.Connected || breakoutStore.pendingMedia)
      return
    breakoutStore.media = {
      camera: isCameraEnabled,
      microphone: isMicrophoneEnabled,
    }
  }, [state, isCameraEnabled, isMicrophoneEnabled])

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
