import { useRemoteParticipants } from '@livekit/components-react'
import { RoomEvent } from 'livekit-client'
import { getParticipantName } from '@/features/rooms/utils/getParticipantName'
import { isAssignable } from '../utils/setup'

// Who the host can send to a room. Joins and leaves always update; a name or a
// role is all else the list reads.
export const useAssignablePeople = () =>
  useRemoteParticipants({
    updateOnlyOn: [
      RoomEvent.ParticipantNameChanged,
      RoomEvent.ParticipantAttributesChanged,
    ],
  })
    .filter(isAssignable)
    .map((p) => ({ identity: p.identity, name: getParticipantName(p) }))
