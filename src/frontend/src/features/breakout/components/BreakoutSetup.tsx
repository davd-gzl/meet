import { useMutation } from '@tanstack/react-query'
import { useRemoteParticipants } from '@livekit/components-react'
import { RoomEvent } from 'livekit-client'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'
import { RiShuffleLine } from '@remixicon/react'
import { css } from '@/styled-system/css'
import { Button, Text } from '@/primitives'
import { Select } from '@/primitives/Select'
import { queryClient } from '@/api/queryClient'
import { breakoutSessionKey, createBreakoutSession } from '../api'
import { breakoutStore, initialSetup } from '../store'
import {
  MAX_ROOMS,
  MIN_ROOMS,
  buildRooms,
  isAssignable,
  shuffleAssignments,
} from '../utils/setup'
import { ErrorNote } from './ErrorNote'

const UNASSIGNED = -1
const ROOM_COUNT_ITEMS = Array.from(
  { length: MAX_ROOMS - MIN_ROOMS + 1 },
  (_, i) => ({ value: MIN_ROOMS + i, label: String(MIN_ROOMS + i) })
)

export const BreakoutSetup = ({ roomId }: { roomId: string }) => {
  const { t } = useTranslation('rooms', { keyPrefix: 'breakout' })
  // In the store, so switching panels keeps the plan.
  const { roomCount, assignments } = useSnapshot(breakoutStore).setup

  // Joins and leaves always update; a name or a role is all else the list reads.
  const people = useRemoteParticipants({
    updateOnlyOn: [
      RoomEvent.ParticipantNameChanged,
      RoomEvent.ParticipantAttributesChanged,
    ],
  })
    .filter(isAssignable)
    .map((p) => ({ identity: p.identity, name: p.name || p.identity }))
  // A room removed by lowering the room count leaves its people unassigned.
  const roomOf = (identity: string) => {
    const index = assignments[identity] ?? UNASSIGNED
    return index >= 0 && index < roomCount ? index : UNASSIGNED
  }
  const unassigned = people.filter(
    (p) => roomOf(p.identity) === UNASSIGNED
  ).length
  let assignmentStatus = t('setup.allAssigned')
  if (people.length === 0) assignmentStatus = t('setup.nobody')
  else if (unassigned > 0)
    assignmentStatus = t('setup.unassigned', { count: unassigned })
  const roomNames = Array.from({ length: roomCount }, (_, i) =>
    t('roomName', { number: i + 1 })
  )
  const roomItems = [
    { value: UNASSIGNED, label: t('setup.unassignedOption') },
    ...roomNames.map((label, value) => ({ value, label })),
  ]

  const open = useMutation({
    mutationFn: () =>
      createBreakoutSession(roomId, {
        rooms: buildRooms(roomNames, people, assignments),
      }),
    onSuccess: () => {
      breakoutStore.setup = initialSetup()
    },
    // An open that lands changes the metadata, and so the query key.
    onError: () =>
      queryClient.invalidateQueries({ queryKey: breakoutSessionKey(roomId) }),
  })

  return (
    <>
      <Select
        aria-label={t('setup.roomCount')}
        label={t('setup.roomCount')}
        items={ROOM_COUNT_ITEMS}
        selectedKey={roomCount}
        onSelectionChange={(key) =>
          (breakoutStore.setup.roomCount = Number(key))
        }
      />
      <div
        className={css({
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        })}
      >
        <Text variant="bodyXsBold">{assignmentStatus}</Text>
        <Button
          variant="secondaryText"
          size="sm"
          isDisabled={people.length === 0}
          onPress={() =>
            (breakoutStore.setup.assignments = shuffleAssignments(
              people.map((p) => p.identity),
              roomCount
            ))
          }
        >
          <RiShuffleLine size={16} aria-hidden />
          {t('setup.shuffle')}
        </Button>
      </div>
      <ul
        className={css({
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        })}
      >
        {people.map((p) => (
          <li
            key={p.identity}
            className={css({
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.5rem',
            })}
          >
            <Text variant="sm" wrap="pretty">
              {p.name}
            </Text>
            <div className={css({ width: '10rem', flexShrink: 0 })}>
              <Select
                aria-label={t('setup.assign', { name: p.name })}
                label=""
                items={roomItems}
                selectedKey={roomOf(p.identity)}
                onSelectionChange={(key) =>
                  (breakoutStore.setup.assignments[p.identity] = Number(key))
                }
              />
            </div>
          </li>
        ))}
      </ul>
      {open.isError && <ErrorNote />}
      <Button
        variant="primary"
        fullWidth
        isDisabled={open.isPending || unassigned === people.length}
        onPress={() => open.mutate()}
      >
        {t('setup.open')}
      </Button>
    </>
  )
}
