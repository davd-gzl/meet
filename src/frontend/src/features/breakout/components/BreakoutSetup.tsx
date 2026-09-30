import { useId } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useRemoteParticipants } from '@livekit/components-react'
import { RoomEvent } from 'livekit-client'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiDragDropLine,
  RiHistoryLine,
  RiShuffleLine,
} from '@remixicon/react'
import { css } from '@/styled-system/css'
import { Button, Text, ToggleButton } from '@/primitives'
import { Select } from '@/primitives/Select'
import { queryClient } from '@/api/queryClient'
import { breakoutSessionKey, createBreakoutSession } from '../api'
import {
  breakoutStore,
  initialSetup,
  readMemory,
  writeMemory,
  type SplitMode,
} from '../store'
import {
  MAX_ROOMS,
  MIN_ROOMS,
  buildRooms,
  countUnassigned,
  defaultRoomCount,
  isAssignable,
  placeEvenly,
  restorePlan,
  roomHue,
  shuffleAssignments,
  type Assignments,
  type RoomHue,
} from '../utils/setup'

const UNASSIGNED = -1
const ROOM_COUNTS = Array.from(
  { length: MAX_ROOMS - MIN_ROOMS + 1 },
  (_, i) => MIN_ROOMS + i
)
// Past this many rooms, the numbers go on a line of their own.
const INLINE_ROOMS = 6
// Names a preview card lists before summing up the rest.
const PREVIEW_NAMES = 4

const SPLITS = [
  { mode: 'auto', Icon: RiShuffleLine },
  { mode: 'manual', Icon: RiDragDropLine },
  { mode: 'last', Icon: RiHistoryLine },
] as const

// Written out so the stylesheet carries each one.
const PALETTES: Record<RoomHue, string> = {
  violet: css({ colorPalette: 'violet' }),
  teal: css({ colorPalette: 'teal' }),
  orange: css({ colorPalette: 'orange' }),
  pink: css({ colorPalette: 'pink' }),
  sky: css({ colorPalette: 'sky' }),
  lime: css({ colorPalette: 'lime' }),
  amber: css({ colorPalette: 'amber' }),
  red: css({ colorPalette: 'red' }),
  indigo: css({ colorPalette: 'indigo' }),
  emerald: css({ colorPalette: 'emerald' }),
}
const palette = (index: number) => PALETTES[roomHue(index)]

export const BreakoutSetup = ({ roomId }: { roomId: string }) => {
  const { t } = useTranslation('rooms', { keyPrefix: 'breakout' })
  const splitLabel = useId()
  // In the store, so switching panels keeps the page and the plan.
  const setup = useSnapshot(breakoutStore).setup
  const { mode, assignments } = setup

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
  const memory = readMemory(roomId)
  const roomCount =
    setup.roomCount ?? defaultRoomCount(people.length, memory.lastCount)
  const unassigned = countUnassigned(identities, assignments, roomCount)
  const roomNames = Array.from({ length: roomCount }, (_, i) =>
    t('roomName', { number: i + 1 })
  )
  const roomOf = (identity: string) => {
    const index = assignments[identity] ?? UNASSIGNED
    return index < roomCount ? index : UNASSIGNED
  }

  const choose = (next: SplitMode) => {
    breakoutStore.setup = {
      roomCount,
      mode: next,
      assignments:
        next === 'auto'
          ? shuffleAssignments(identities, roomCount)
          : restorePlan(memory[next], identities, roomCount),
    }
  }
  // Only a plan edited by hand is the one Manually picks up again.
  const edit = (next: Assignments) => {
    breakoutStore.setup.assignments = next
    if (mode === 'manual') writeMemory(roomId, { manual: next })
  }

  const open = useMutation({
    mutationFn: ({ plan }: { plan: Assignments; count: number }) =>
      createBreakoutSession(roomId, {
        rooms: buildRooms(roomNames, people, plan),
      }),
    onSuccess: (_, { plan, count }) => {
      writeMemory(roomId, {
        last: restorePlan(plan, identities, count),
        lastCount: count,
      })
      breakoutStore.setup = initialSetup()
    },
    // An open that lands changes the metadata, and so the query key.
    onError: () =>
      queryClient.invalidateQueries({ queryKey: breakoutSessionKey(roomId) }),
  })

  if (mode === null) {
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
          role="group"
          aria-labelledby={splitLabel}
          className={css({
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          })}
        >
          <Text variant="bodyXsBold" id={splitLabel}>
            {t('setup.howToSplit')}
          </Text>
          {SPLITS.filter((s) => s.mode !== 'last' || memory.last).map(
            ({ mode: split, Icon }) => (
              <Button
                key={split}
                variant="secondary"
                fullWidth
                onPress={() => choose(split)}
              >
                <Icon size={20} aria-hidden />
                <span
                  className={css({
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    textAlign: 'left',
                  })}
                >
                  <Text as="span" variant="bodyXsBold">
                    {t(`setup.${split}.title`)}
                  </Text>
                  <Text as="span" variant="xsNote">
                    {t(`setup.${split}.description`)}
                  </Text>
                </span>
                <RiArrowRightSLine size={20} aria-hidden />
              </Button>
            )
          )}
        </div>
      </>
    )
  }

  const wrap = roomCount > INLINE_ROOMS
  return (
    <>
      <div
        className={css({
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.5rem',
        })}
      >
        <Button
          variant="secondaryText"
          size="sm"
          onPress={() => (breakoutStore.setup.mode = null)}
        >
          <RiArrowLeftSLine size={16} aria-hidden />
          {t('setup.back')}
        </Button>
        <Text variant="xsNote">
          {t(`setup.${mode}.summary`, { count: roomCount })}
        </Text>
      </div>
      {people.length === 0 && <Text variant="sm">{t('setup.nobody')}</Text>}
      <ul
        className={css({
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        })}
      >
        {people.map((p) => {
          const index = roomOf(p.identity)
          return (
            <li key={p.identity}>
              <div
                role="group"
                aria-label={p.name}
                className={
                  wrap
                    ? css({
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.25rem',
                      })
                    : css({
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '0.5rem',
                      })
                }
              >
                <Text
                  variant="sm"
                  wrap="pretty"
                  className={
                    index === UNASSIGNED
                      ? css({ color: 'warning.subtle-text' })
                      : undefined
                  }
                >
                  {p.name}
                </Text>
                <div
                  className={
                    wrap
                      ? css({
                          display: 'grid',
                          gridTemplateColumns: 'repeat(10, minmax(0, 26px))',
                          gap: '0.25rem',
                        })
                      : css({ display: 'flex', gap: '0.25rem' })
                  }
                >
                  {roomNames.map((_, room) => (
                    <ToggleButton
                      key={room}
                      variant="palette"
                      size="xs"
                      className={[
                        palette(room),
                        css({ width: '26px', height: '26px', fontSize: 12 }),
                      ].join(' ')}
                      aria-label={t('setup.placeIn', {
                        number: room + 1,
                        name: p.name,
                      })}
                      isSelected={index === room}
                      // A second press on their room takes them out of it.
                      onChange={(inRoom) =>
                        edit({
                          ...assignments,
                          [p.identity]: inRoom ? room : UNASSIGNED,
                        })
                      }
                    >
                      {room + 1}
                    </ToggleButton>
                  ))}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      <section
        aria-label={t('setup.preview')}
        className={css({
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          borderTop: '1px solid',
          borderColor: 'box.border',
          paddingTop: '0.75rem',
        })}
      >
        <Text variant="bodyXsBold">{t('setup.preview')}</Text>
        <ul
          className={css({
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '0.5rem',
          })}
        >
          {roomNames.map((name, room) => {
            const names = people
              .filter((p) => roomOf(p.identity) === room)
              .map((p) => p.name)
            return (
              <li
                key={room}
                className={[
                  palette(room),
                  css({
                    backgroundColor: 'colorPalette.100',
                    color: 'colorPalette.900',
                    borderRadius: 4,
                    padding: '0.375rem 0.5rem',
                    minWidth: 0,
                  }),
                ].join(' ')}
              >
                <div
                  className={css({
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '0.25rem',
                  })}
                >
                  <Text as="span" variant="bodyXsBold">
                    {name}
                  </Text>
                  <Text as="span" variant="bodyXsBold">
                    {names.length}
                  </Text>
                </div>
                <Text
                  variant="xsNote"
                  className={css({
                    color: 'colorPalette.800',
                    overflowWrap: 'anywhere',
                  })}
                >
                  {names.length === 0
                    ? t('setup.nobodyYet')
                    : names.slice(0, PREVIEW_NAMES).join(', ')}
                  {names.length > PREVIEW_NAMES &&
                    ` ${t('setup.more', { count: names.length - PREVIEW_NAMES })}`}
                </Text>
              </li>
            )
          })}
        </ul>
      </section>
      <div
        className={css({
          // Only what acts stays pinned, over the panel's bottom padding;
          // the room cards scroll with the list, so the list keeps the room.
          position: 'sticky',
          bottom: '-1.5rem',
          marginTop: 'auto',
          marginBottom: '-1.5rem',
          paddingTop: '1rem',
          paddingBottom: '1.5rem',
          backgroundColor: 'box.bg',
          borderTop: '1px solid',
          borderColor: 'box.border',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        })}
      >
        {unassigned > 0 && (
          <div
            className={css({
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.5rem',
            })}
          >
            <Text
              variant="sm"
              className={css({ color: 'warning.subtle-text' })}
            >
              {t('setup.noRoom', { count: unassigned })}
            </Text>
            <Button
              variant="secondaryText"
              size="sm"
              onPress={() =>
                edit(placeEvenly(identities, assignments, roomCount))
              }
            >
              {t('setup.placeEvenly')}
            </Button>
          </div>
        )}
        {open.isError && (
          <Text variant="warning" role="alert">
            {t('error')}
          </Text>
        )}
        <Button
          variant="primary"
          fullWidth
          isDisabled={open.isPending || unassigned === people.length}
          onPress={() => open.mutate({ plan: assignments, count: roomCount })}
        >
          {unassigned > 0
            ? t('setup.openStaying', { rooms: roomCount, count: unassigned })
            : t('setup.open', { count: roomCount })}
        </Button>
      </div>
    </>
  )
}
