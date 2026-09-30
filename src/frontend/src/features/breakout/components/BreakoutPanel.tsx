import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { css } from '@/styled-system/css'
import { Button, Div, Text } from '@/primitives'
import { queryClient } from '@/api/queryClient'
import { useRoomData } from '@/features/rooms/livekit/hooks/useRoomData'
import { useRoomMetadata } from '@/features/recording/hooks/useRoomMetadata'
import {
  breakoutSessionKey,
  closeBreakoutSession,
  fetchBreakoutSession,
  type BreakoutSession,
} from '../api'
import { BreakoutSetup } from './BreakoutSetup'

const ActiveSession = ({
  roomId,
  session,
}: {
  roomId: string
  session: BreakoutSession
}) => {
  const { t } = useTranslation('rooms', { keyPrefix: 'breakout' })
  const close = useMutation({
    mutationFn: () => closeBreakoutSession(roomId, session.id),
    // The metadata changes when closing starts, not when it ends.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: breakoutSessionKey(roomId) }),
  })

  return (
    <>
      {session.status === 'closing' && (
        <Text variant="note" role="status">
          {t('active.closing')}
        </Text>
      )}
      <ul
        className={css({
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        })}
      >
        {session.rooms.map((room) => (
          <li key={room.id}>
            <Text variant="bodyXsBold">{room.name}</Text>
            <Text variant="xsNote" wrap="pretty">
              {room.participants.map((p) => p.name).join(', ') ||
                t('active.empty')}
            </Text>
          </li>
        ))}
      </ul>
      {close.isError && (
        <Text variant="warning" role="alert">
          {t('error')}
        </Text>
      )}
      <Button
        variant="primary"
        fullWidth
        isDisabled={close.isPending}
        onPress={() => close.mutate()}
      >
        {t('active.close')}
      </Button>
    </>
  )
}

export const BreakoutPanel = () => {
  const roomId = useRoomData()?.id
  // Keyed on the announced session, so an open or close elsewhere refetches.
  const announced: string | null =
    useRoomMetadata()?.breakout?.session_id ?? null
  const {
    data: session,
    isPending,
    isError,
  } = useQuery({
    queryKey: [...breakoutSessionKey(roomId), announced],
    queryFn: () => fetchBreakoutSession(roomId as string),
    enabled: !!roomId,
    retry: false,
    placeholderData: keepPreviousData,
  })
  // A failed list: Open would fail as well, so no form.
  if (!roomId || isPending || isError) return null

  return (
    <Div
      display="flex"
      overflowY="auto"
      padding="0 1.5rem 1.5rem"
      flexGrow={1}
      flexDirection="column"
      gap="1rem"
    >
      {session ? (
        <ActiveSession roomId={roomId} session={session} />
      ) : (
        <BreakoutSetup roomId={roomId} />
      )}
    </Div>
  )
}
