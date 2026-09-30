import { ParticipantKind, type Participant } from 'livekit-client'
import { getParticipantIsRoomAdminOrOwner } from '@/features/rooms/utils/getParticipantIsRoomAdminOrOwner'
import type { BreakoutPerson } from '../api'

export const MIN_ROOMS = 2
export const MAX_ROOMS = 20

// People a room is sized for when the host has not picked a count yet.
const PEOPLE_PER_ROOM = 4

// Only browsers whose pass says they follow a move: not phone callers, agents,
// hosts, nor a tab loaded before the feature.
export const isAssignable = (p: Participant) =>
  !p.isLocal &&
  p.kind === ParticipantKind.STANDARD &&
  p.attributes?.breakout === 'true' &&
  !getParticipantIsRoomAdminOrOwner(p)

// Room index per identity; an index past the room count means unassigned.
export type Assignments = Record<string, number>

export const countUnassigned = (
  identities: string[],
  assignments: Assignments,
  roomCount: number
) =>
  identities.filter((identity) => {
    const index = assignments[identity] ?? -1
    return index < 0 || index >= roomCount
  }).length

// The count the host last opened, else a room per 4 people.
export const defaultRoomCount = (people: number, lastCount?: number) =>
  Math.min(
    MAX_ROOMS,
    Math.max(
      MIN_ROOMS,
      Number.isInteger(lastCount)
        ? (lastCount as number)
        : Math.ceil(people / PEOPLE_PER_ROOM)
    )
  )

// A remembered plan, kept to the people still here and the rooms that still exist.
export const restorePlan = (
  plan: Assignments | undefined,
  identities: string[],
  roomCount: number
): Assignments =>
  Object.fromEntries(
    identities.flatMap((identity) => {
      const index = plan?.[identity]
      return typeof index === 'number' &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < roomCount
        ? [[identity, index] as const]
        : []
    })
  )

// Puts each person with no room in the emptiest room; everyone else stays.
export const placeEvenly = (
  identities: string[],
  assignments: Assignments,
  roomCount: number
): Assignments => {
  const plan = restorePlan(assignments, identities, roomCount)
  const sizes = Array.from({ length: roomCount }, () => 0)
  Object.values(plan).forEach((index) => sizes[index]++)
  identities
    .filter((identity) => !(identity in plan))
    .forEach((identity) => {
      const index = sizes.indexOf(Math.min(...sizes))
      plan[identity] = index
      sizes[index]++
    })
  return plan
}

// Hues far apart on the wheel; past the tenth room they come round again.
export const ROOM_HUES = [
  'violet',
  'teal',
  'orange',
  'pink',
  'sky',
  'lime',
  'amber',
  'red',
  'indigo',
  'emerald',
] as const

export type RoomHue = (typeof ROOM_HUES)[number]

export const roomHue = (index: number): RoomHue =>
  ROOM_HUES[index % ROOM_HUES.length]

export const shuffleAssignments = (
  identities: string[],
  roomCount: number,
  random: () => number = Math.random
): Assignments => {
  const order = [...identities]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return Object.fromEntries(order.map((id, i) => [id, i % roomCount]))
}

export const buildRooms = (
  roomNames: string[],
  people: BreakoutPerson[],
  assignments: Assignments
) =>
  roomNames.map((name, index) => ({
    name,
    participants: people.filter((p) => assignments[p.identity] === index),
  }))
