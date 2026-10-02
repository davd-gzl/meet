import { useEffect, useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
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
import { ErrorNote } from './ErrorNote'

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
      {close.isError && <ErrorNote />}
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
  const announced: string | null =
    useRoomMetadata()?.breakout?.session_id ?? null
  const {
    data: session,
    isPending,
    isError,
  } = useQuery({
    queryKey: breakoutSessionKey(roomId),
    queryFn: () => fetchBreakoutSession(roomId as string),
    enabled: !!roomId,
    retry: false,
  })
  // An open or close elsewhere refetches, the shown session kept meanwhile.
  const seen = useRef(announced)
  useEffect(() => {
    if (seen.current === announced) return
    seen.current = announced
    void queryClient.invalidateQueries({ queryKey: breakoutSessionKey(roomId) })
  }, [announced, roomId])
  // A first list that failed: Open would fail as well, so no form.
  if (!roomId || isPending || (isError && session === undefined)) return null

  return (
    <Div
      display="flex"
      overflowY="auto"
      padding="0 1.5rem 1.5rem"
      flexGrow={1}
      flexDirection="column"
      gap="1rem"
    >
      {isError && <ErrorNote />}
      {session ? (
        <ActiveSession roomId={roomId} session={session} />
      ) : (
        <BreakoutSetup roomId={roomId} />
      )}
    </Div>
  )
}
