import { ParticipantKind, type Participant } from 'livekit-client'
import type { BreakoutPerson } from '../api'

export const MIN_ROOMS = 2
export const MAX_ROOMS = 20

// People a room is sized for when the host has not picked a count yet.
const PEOPLE_PER_ROOM = 4

// Only browsers keep themselves to a room: phone callers and agents stay.
// Hosts, this browser included, can be placed too, though never at random.
export const isAssignable = (p: Participant) =>
  p.isLocal || p.kind === ParticipantKind.STANDARD

// Room index per identity. An identity missing, or whose index is MAIN_ROOM or
// past the room count, is unassigned and stays in the main room.
export type Assignments = Record<string, number>

// The count the host last opened, else a room per 4 people.
export const defaultRoomCount = (people: number, lastCount?: number) =>
  Math.min(
    MAX_ROOMS,
    Math.max(
      MIN_ROOMS,
      typeof lastCount === 'number' && Number.isInteger(lastCount)
        ? lastCount
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
      return index !== undefined &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < roomCount
        ? [[identity, index] as const]
        : []
    })
  )

// Puts each of identities with no room in the emptiest room; everyone in a
// room stays, and anyone not in identities is left as they are.
export const placeEvenly = (
  identities: string[],
  assignments: Assignments,
  roomCount: number
): Assignments => {
  const plan = { ...assignments }
  const sizes = Array.from({ length: roomCount }, () => 0)
  Object.values(plan).forEach((index) => {
    if (index >= 0 && index < roomCount) sizes[index]++
  })
  identities
    .filter((identity) => !(plan[identity] >= 0 && plan[identity] < roomCount))
    .forEach((identity) => {
      const index = sizes.indexOf(Math.min(...sizes))
      plan[identity] = index
      sizes[index]++
    })
  return plan
}

export const shuffleAssignments = (
  identities: string[],
  roomCount: number,
  random: () => number = Math.random
): Assignments => {
  // Fisher-Yates shuffle, then deal round-robin so room sizes differ by one
  // at most.
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
    participants: people
      .filter((p) => assignments[p.identity] === index)
      .map(({ identity, name }) => ({ identity, name })),
  }))
