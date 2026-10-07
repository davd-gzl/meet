import { useCallback, useId } from 'react'
import { useMutation } from '@tanstack/react-query'
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
import { Button, Text } from '@/primitives'
import { queryClient } from '@/api/queryClient'
import { breakoutSessionKey, createBreakoutSession } from '../api'
import {
  breakoutSetupStore,
  readMemory,
  resetBreakoutSetup,
  writeMemory,
  type SplitMode,
} from '../store'
import {
  buildRooms,
  defaultRoomCount,
  placeEvenly,
  restorePlan,
  shuffleAssignments,
  type Assignments,
} from '../utils/setup'
import { MAIN_ROOM } from '../utils/split'
import { ErrorNote } from './ErrorNote'
import { PersonRow, type Person } from './PersonRow'
import { RoomCountField } from './RoomCountField'
import { roomPalette } from './roomPalette'
import { useAssignablePeople } from '../hooks/useAssignablePeople'
import { useOpenShortcut } from '../hooks/useOpenShortcut'
import { useRoomMetadata } from '@/features/recording/hooks/useRoomMetadata'
import { RecordingStatus } from '@/features/recording/hooks/useRecordingStatuses'

// Names a preview card lists before summing up the rest.
const PREVIEW_NAMES = 4

const SPLITS = [
  { mode: 'auto', Icon: RiShuffleLine },
  { mode: 'manual', Icon: RiDragDropLine },
  { mode: 'last', Icon: RiHistoryLine },
] as const

export const BreakoutSetup = ({ roomId }: { roomId: string }) => {
  const { t } = useTranslation('rooms', { keyPrefix: 'breakout' })
  const splitLabel = useId()
  // In the store, so switching panels keeps the page and the plan.
  const {
    mode,
    assignments,
    roomCount: chosenCount,
  } = useSnapshot(breakoutSetupStore)

  const { people, hasNonBrowsers } = useAssignablePeople()
  const identities = people.map((p) => p.identity)
  // A host left unplaced stays in the main room, as hosts do by default, and
  // no split ever places one at random.
  const guests = people.filter((p) => !p.isHost).map((p) => p.identity)
  const memory = readMemory(roomId)
  const roomCount =
    chosenCount ?? defaultRoomCount(guests.length, memory.lastCount)
  // A room removed by lowering the room count leaves its people unassigned.
  const plan = restorePlan(assignments, identities, roomCount)
  const unassigned = guests.filter((identity) => !(identity in plan)).length
  const roomNames = Array.from({ length: roomCount }, (_, i) =>
    t('roomName', { number: i + 1 })
  )
  const rooms = buildRooms(roomNames, people, plan)
  // A recording would hear every room, so Open stops it, and says so first.
  const isRecording = [
    RecordingStatus.Starting,
    RecordingStatus.Started,
  ].includes(useRoomMetadata()?.recording_status)

  const choose = (next: SplitMode) => {
    // Hosts keep the room they were given by hand; only guests are dealt.
    const hostPlaces = Object.fromEntries(
      people
        .filter((p) => p.isHost && p.identity in plan)
        .map((p) => [p.identity, plan[p.identity]])
    )
    let nextPlan: Assignments
    if (next === 'auto')
      nextPlan = { ...hostPlaces, ...shuffleAssignments(guests, roomCount) }
    // The manual plan comes back whole, so someone who left and rejoins keeps
    // their room; the screen and Open read it through restorePlan.
    else if (next === 'manual') nextPlan = { ...memory.manual }
    else nextPlan = restorePlan(memory.last, identities, roomCount)
    Object.assign(breakoutSetupStore, {
      roomCount,
      mode: next,
      assignments: nextPlan,
    })
  }
  // Only a plan edited by hand is the one Manually picks up again.
  const edit = useCallback(
    (next: Assignments) => {
      breakoutSetupStore.assignments = next
      if (breakoutSetupStore.mode === 'manual')
        writeMemory(roomId, { manual: next })
    },
    [roomId]
  )
  // Reads the store, not the snapshot, so it stays the same across renders.
  const place = useCallback(
    ({ identity }: Person, room: number) => {
      const next = { ...breakoutSetupStore.assignments }
      if (room === MAIN_ROOM) delete next[identity]
      else next[identity] = room
      edit(next)
    },
    [edit]
  )

  const open = useMutation({
    mutationFn: ({ plan }: { plan: Assignments; count: number }) =>
      createBreakoutSession(roomId, {
        rooms: buildRooms(roomNames, people, plan),
        stop_recording: isRecording,
      }),
    // The plan sent, not the one on screen once the answer comes back.
    onSuccess: (session, { plan, count }) => {
      writeMemory(roomId, { last: plan, lastCount: count })
      queryClient.setQueryData(breakoutSessionKey(roomId), session)
      resetBreakoutSetup()
    },
    // A failed open leaves the metadata as it was, so nothing else refetches.
    onError: () =>
      queryClient.invalidateQueries({ queryKey: breakoutSessionKey(roomId) }),
  })

  const canOpen = !open.isPending && Object.keys(plan).length > 0
  const openRooms = () => open.mutate({ plan, count: roomCount })
  useOpenShortcut(openRooms, mode !== null && canOpen)

  if (mode === null) {
    return (
      <>
        <RoomCountField
          value={roomCount}
          onChange={(count) => (breakoutSetupStore.roomCount = count)}
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
          onPress={() => (breakoutSetupStore.mode = null)}
        >
          <RiArrowLeftSLine size={16} aria-hidden />
          {t('setup.back')}
        </Button>
        <Text variant="xsNote">
          {t(`setup.${mode}.summary`, { count: roomCount })}
        </Text>
      </div>
      {guests.length === 0 && <Text variant="sm">{t('setup.nobody')}</Text>}
      <ul
        className={css({
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
        })}
      >
        {people.map((p) => {
          const room = plan[p.identity] ?? MAIN_ROOM
          return (
            <PersonRow
              key={p.identity}
              identity={p.identity}
              name={p.label}
              roomCount={roomCount}
              room={room}
              isUnplaced={!p.isHost && room === MAIN_ROOM}
              onChange={place}
            />
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
          {rooms.map(({ name, participants }, room) => {
            const names = participants.map((p) => p.name)
            return (
              <li
                key={room}
                className={[
                  roomPalette(room),
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
              onPress={() => edit(placeEvenly(guests, plan, roomCount))}
            >
              {t('setup.placeEvenly')}
            </Button>
          </div>
        )}
        {hasNonBrowsers && (
          <Text variant="warning">{t('setup.notInBrowser')}</Text>
        )}
        {isRecording && <Text variant="warning">{t('setup.recording')}</Text>}
        {open.isError && <ErrorNote />}
        <Button
          variant="primary"
          fullWidth
          isDisabled={!canOpen}
          onPress={openRooms}
        >
          {unassigned > 0
            ? t('setup.openStaying', { rooms: roomCount, count: unassigned })
            : t('setup.open', { count: roomCount })}
        </Button>
      </div>
    </>
  )
}
