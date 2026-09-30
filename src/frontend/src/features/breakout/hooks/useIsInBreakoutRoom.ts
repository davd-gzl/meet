import { useSnapshot } from 'valtio'
import { breakoutStore } from '../store'

// Raise hand and rename address the main meeting's room with its pass.
export const useIsInBreakoutRoom = () =>
  useSnapshot(breakoutStore).room !== null
