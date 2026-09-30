import { useSnapshot } from 'valtio'
import { breakoutStore } from '../store'

// Raise hand, rename, mute and subtitles address the main meeting's room
// with its pass.
export const useIsInBreakoutRoom = () =>
  useSnapshot(breakoutStore).room !== null
