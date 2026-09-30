import { useIsAdminOrOwner } from './useIsAdminOrOwner'
import type { Participant } from 'livekit-client'
import { useRoomData } from '@/features/rooms/livekit/hooks/useRoomData'
import { useIsInBreakoutRoom } from '@/features/breakout/hooks/useIsInBreakoutRoom'

export const useCanMute = (participant: Participant) => {
  const apiRoomData = useRoomData()
  const isAdminOrOwner = useIsAdminOrOwner()
  // Muting someone else addresses the main meeting, which a breakout room is not.
  const isInBreakoutRoom = useIsInBreakoutRoom()
  return (
    participant.isLocal ||
    (!isInBreakoutRoom &&
      (isAdminOrOwner ||
        apiRoomData?.configuration?.everyone_can_mute !== false))
  )
}
