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
  countUnassigned,
  isAssignable,
  shuffleAssignments,
} from '../utils/setup'

const UNASSIGNED = -1
const ROOM_COUNTS = Array.from(
  { length: MAX_ROOMS - MIN_ROOMS + 1 },
  (_, i) => MIN_ROOMS + i
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
  const identities = people.map((p) => p.identity)
  const unassigned = countUnassigned(identities, assignments, roomCount)
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
        items={ROOM_COUNTS.map((n) => ({ value: n, label: String(n) }))}
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
        <Text variant="bodyXsBold">
          {people.length === 0
            ? t('setup.nobody')
            : unassigned > 0
              ? t('setup.unassigned', { count: unassigned })
              : t('setup.allAssigned')}
        </Text>
        <Button
          variant="secondaryText"
          size="sm"
          isDisabled={people.length === 0}
          onPress={() =>
            (breakoutStore.setup.assignments = shuffleAssignments(
              identities,
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
        {people.map((p) => {
          const index = assignments[p.identity] ?? UNASSIGNED
          return (
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
                  selectedKey={index < roomCount ? index : UNASSIGNED}
                  onSelectionChange={(key) =>
                    (breakoutStore.setup.assignments[p.identity] = Number(key))
                  }
                />
              </div>
            </li>
          )
        })}
      </ul>
      {open.isError && (
        <Text variant="warning" role="alert">
          {t('error')}
        </Text>
      )}
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
