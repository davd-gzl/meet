import { proxy } from 'valtio'
import type { Assignments } from './utils/setup'

// How the host chose to split; none yet shows the choice.
export type SplitMode = 'auto' | 'manual' | 'last'

type Setup = {
  // Null until the host picks one or chooses how to split.
  roomCount: number | null
  mode: SplitMode | null
  assignments: Assignments
}

const initialSetup = (): Setup => ({
  roomCount: null,
  mode: null,
  assignments: {},
})

// The host's plan before Open, kept while the panel is closed.
export const breakoutSetupStore = proxy(initialSetup())

export const resetBreakoutSetup = () => {
  Object.assign(breakoutSetupStore, initialSetup())
}

// What a host set up in a meeting, kept for the tab's life: the plan edited
// by hand, and the plan and room count last opened.
export type SetupMemory = {
  manual?: Assignments
  last?: Assignments
  lastCount?: number
}

const memoryKey = (roomId: string) => `breakout-setup-${roomId}`
// This tab's copy, which a blocked sessionStorage leaves alone.
const memory = new Map<string, SetupMemory>()

// Every write lands in memory first, so that copy is the newest one; storage
// carries the plan across a reload of the tab.
export const readMemory = (roomId: string): SetupMemory => {
  const kept = memory.get(roomId)
  if (kept) return kept
  try {
    const stored = sessionStorage.getItem(memoryKey(roomId))
    if (stored) return JSON.parse(stored)
  } catch {
    // Blocked or unreadable: nothing remembered.
  }
  return {}
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
