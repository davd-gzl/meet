import { useEffect, useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { css } from '@/styled-system/css'
import { Button, Div, Text } from '@/primitives'
import { queryClient } from '@/api/queryClient'
import { useCanManageBreakout } from '../hooks/useCanManageBreakout'
import { useRoomData } from '@/features/rooms/livekit/hooks/useRoomData'
import { useRoomInfo } from '@livekit/components-react'
import { NO_ROOM } from '../utils/setup'
import { useAssignablePeople } from '../hooks/useAssignablePeople'
import { readSignal } from '../utils/group'
import {
  breakoutSessionKey,
  closeBreakoutSession,
  fetchBreakoutSession,
  moveBreakoutParticipant,
  type MoveBreakoutParticipant,
  type BreakoutSession,
} from '../api'
import { BreakoutSetup } from './BreakoutSetup'
import { ErrorNote } from './ErrorNote'
import { PersonRow } from './PersonRow'

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
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: breakoutSessionKey(roomId) }),
  })
  const move = useMutation({
    mutationFn: (body: MoveBreakoutParticipant) =>
      moveBreakoutParticipant(roomId, session.id, body),
    onSuccess: (moved) =>
      queryClient.setQueryData(breakoutSessionKey(roomId), moved),
    onError: () =>
      queryClient.invalidateQueries({ queryKey: breakoutSessionKey(roomId) }),
  })

  // The main room holds whoever is here and in no room, latecomers included.
  const assigned = new Set(
    session.rooms.flatMap((room) => room.participants.map((p) => p.identity))
  )
  const main = useAssignablePeople().filter((p) => !assigned.has(p.identity))
  const groups = [
    ...session.rooms.map((room, position) => ({
      position,
      name: room.name,
      people: room.participants,
    })),
    { position: NO_ROOM, name: t('active.mainRoom'), people: main },
  ]
  const roomItems = groups.map((group) => ({
    value: group.position,
    label: group.name,
  }))

  return (
    <>
      <ul
        className={css({
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        })}
      >
        {groups.map((group) => (
          <li key={group.position}>
            <Text variant="bodyXsBold">{group.name}</Text>
            {group.people.length === 0 && (
              <Text variant="xsNote">{t('active.empty')}</Text>
            )}
            <ul>
              {group.people.map((p) => (
                <PersonRow
                  key={p.identity}
                  name={p.name}
                  items={roomItems}
                  selectedKey={group.position}
                  isDisabled={move.isPending}
                  onChange={(room) => {
                    if (room === group.position) return
                    move.mutate({ ...p, room: room === NO_ROOM ? null : room })
                  }}
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {(close.isError || move.isError) && <ErrorNote />}
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
  const { canOpen } = useCanManageBreakout()
  const announced = readSignal(useRoomInfo().metadata)
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
  // An open, a move or a close elsewhere refetches, the shown session kept meanwhile.
  const seen = useRef(announced)
  useEffect(() => {
    if (seen.current === announced) return
    seen.current = announced
    void queryClient.invalidateQueries({ queryKey: breakoutSessionKey(roomId) })
  }, [announced, roomId])
  if (!roomId || isPending) return null

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
      {session && <ActiveSession roomId={roomId} session={session} />}
      {/* A first list that failed leaves no form: Open would fail as well. */}
      {session === null && canOpen && <BreakoutSetup roomId={roomId} />}
    </Div>
  )
}
