// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SubtitlesToggle } from './SubtitlesToggle'
import { breakoutStore, resetBreakout } from '@/features/breakout/store'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/features/subtitle/hooks/useSubtitles', () => ({
  useSubtitles: () => ({
    areSubtitlesOpen: false,
    toggleSubtitles: vi.fn(),
    areSubtitlesPending: false,
  }),
}))
vi.mock('@/features/subtitle/hooks/useAreSubtitlesAvailable', () => ({
  useAreSubtitlesAvailable: () => true,
}))

afterEach(() => {
  cleanup()
  resetBreakout()
})

describe('SubtitlesToggle', () => {
  it('offers subtitles in the main meeting', () => {
    render(<SubtitlesToggle />)
    expect(screen.queryByRole('button', { name: 'closed' })).not.toBeNull()
  })

  it('is gone in a breakout room', () => {
    breakoutStore.room = { id: 'r1', name: 'Room 1' }
    render(<SubtitlesToggle />)
    expect(screen.queryByRole('button', { name: 'closed' })).toBeNull()
  })
})
