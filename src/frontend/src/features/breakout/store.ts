import { proxy } from 'valtio'
import type { BreakoutRoomRef } from './api'
import { MIN_ROOMS, type Assignments } from './utils/setup'

type BreakoutState = {
  // The breakout room this browser is in, null in the main meeting.
  room: BreakoutRoomRef | null
  // Where a move in progress goes, for the overlay.
  target: BreakoutRoomRef | 'main' | null
  // True while this browser disconnects on purpose.
  leaving: boolean
  // The session whose assignment was fetched, so each is fetched once.
  sessionId: string | null
  // The last move failed; cleared by the next attempt or when the session ends.
  moveFailed: boolean
  // The host's plan before Open, kept while the panel is closed.
  setup: { roomCount: number; assignments: Assignments }
}

export const initialSetup = () => ({ roomCount: MIN_ROOMS, assignments: {} })

const initialState = (): BreakoutState => ({
  room: null,
  target: null,
  leaving: false,
  sessionId: null,
  moveFailed: false,
  setup: initialSetup(),
})

// In memory only: a reload rejoins the main meeting, whose metadata moves it again.
export const breakoutStore = proxy<BreakoutState>(initialState())

export const resetBreakout = () => {
  Object.assign(breakoutStore, initialState())
}
