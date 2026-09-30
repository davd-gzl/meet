import { useSnapshot } from 'valtio'
import { breakoutStore } from '../store'

// Rename addresses the main meeting's room with its pass.
export const useIsInBreakoutRoom = () =>
  useSnapshot(breakoutStore).room !== null
