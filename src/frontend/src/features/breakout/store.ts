import { proxy } from 'valtio'
import type { Assignments } from './utils/setup'

export type MediaIntent = { camera: boolean; microphone: boolean }

type BreakoutRoomRef = { id: string; name: string }

type BreakoutState = {
  // The breakout room this browser is in, null in the main meeting.
  room: BreakoutRoomRef | null
  // Where a move in progress goes, for the overlay.
  target: BreakoutRoomRef | 'main' | null
  // True while this browser disconnects on purpose.
  leaving: boolean
  // The session whose assignment was fetched, so each is fetched once.
  sessionId: string | null
  // The session already sent back into its room once since the room was last reached.
  resentFor: string | null
  // The last move failed; cleared by the next attempt or when the session ends.
  moveFailed: boolean
  // Camera and microphone as last seen while connected.
  media: MediaIntent | null
  // Restored once the next connection is up.
  pendingMedia: MediaIntent | null
  // Neither the held pass nor a new entry brought this browser back.
  returnFailed: boolean
  // The host's plan before Open, kept while the panel is closed.
  setup: Setup
}

// How the host chose to split; none yet shows the choice.
export type SplitMode = 'auto' | 'manual' | 'last'

type Setup = {
  // Null until the host picks one or chooses how to split.
  roomCount: number | null
  mode: SplitMode | null
  assignments: Assignments
}

export const initialSetup = (): Setup => ({
  roomCount: null,
  mode: null,
  assignments: {},
})

const initialState = (): BreakoutState => ({
  room: null,
  target: null,
  leaving: false,
  sessionId: null,
  resentFor: null,
  moveFailed: false,
  media: null,
  pendingMedia: null,
  returnFailed: false,
  setup: initialSetup(),
})

// In memory only: a reload rejoins the main meeting, whose metadata moves it again.
export const breakoutStore = proxy<BreakoutState>(initialState())

export const resetBreakout = () => {
  Object.assign(breakoutStore, initialState())
}

// What a host set up in a meeting, kept for the tab's life: the plan edited
// by hand, and the plan and room count last opened.
export type SetupMemory = {
  manual?: Assignments
  last?: Assignments
  lastCount?: number
}

const memoryKey = (roomId: string) => `breakout-setup-${roomId}`
// The copy a blocked sessionStorage leaves.
const memory = new Map<string, SetupMemory>()

export const readMemory = (roomId: string): SetupMemory => {
  try {
    const stored = sessionStorage.getItem(memoryKey(roomId))
    if (stored) return JSON.parse(stored)
  } catch {
    // Blocked or unreadable: the copy in memory stands.
  }
  return memory.get(roomId) ?? {}
}

export const writeMemory = (roomId: string, patch: SetupMemory) => {
  const next = { ...readMemory(roomId), ...patch }
  memory.set(roomId, next)
  try {
    sessionStorage.setItem(memoryKey(roomId), JSON.stringify(next))
  } catch {
    // Blocked: kept in memory only.
  }
}
