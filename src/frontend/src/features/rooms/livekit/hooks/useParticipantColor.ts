import { useMemo } from 'react'
import type { Participant } from 'livekit-client'
import { useParticipants } from '@livekit/components-react'
import { getParticipantColor } from '@/features/rooms/utils/getParticipantColor'
import { spreadParticipantColors } from '@/features/rooms/utils/spreadParticipantColors'

/**
 * Return the colour to draw a participant in, told apart from the others.
 *
 * Recomputed from the room's participants, so a colour freed by someone
 * leaving is available again.
 */
export const useParticipantColor = (participant: Participant): string => {
  const participants = useParticipants()

  const spread = useMemo(
    () => spreadParticipantColors(participants),
    [participants]
  )

  return spread.get(participant.identity) ?? getParticipantColor(participant)
}
