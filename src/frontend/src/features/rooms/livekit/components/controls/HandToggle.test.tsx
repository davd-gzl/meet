// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { HandToggle } from './HandToggle'
import { breakoutStore, resetBreakout } from '@/features/breakout/store'
import { keyboardShortcutsStore } from '@/stores/keyboardShortcuts'
import { getShortcutDescriptorById } from '@/features/shortcuts/catalog'
import { formatShortcutKey } from '@/features/shortcuts/utils'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@livekit/components-react', () => ({
  useRoomContext: () => ({ localParticipant: {} }),
  useIsSpeaking: () => false,
}))
vi.mock('@/features/rooms/livekit/hooks/useRaisedHand', () => ({
  useRaisedHand: () => ({
    isHandRaised: false,
    toggleRaisedHand: vi.fn(),
    lowerHand: vi.fn(),
  }),
}))
vi.mock('@/features/notifications/utils', () => ({
  closeLowerHandToasts: vi.fn(),
  showLowerHandToast: vi.fn(),
}))

const raiseHandKey = formatShortcutKey(
  getShortcutDescriptorById('raise-hand')!.shortcut!
)

afterEach(() => {
  cleanup()
  resetBreakout()
  keyboardShortcutsStore.shortcuts.clear()
})

describe('HandToggle', () => {
  it('raises a hand in the main meeting', () => {
    render(<HandToggle />)
    expect(screen.queryByRole('button', { name: 'raise' })).not.toBeNull()
    expect(keyboardShortcutsStore.shortcuts.has(raiseHandKey)).toBe(true)
  })

  it('is gone in a breakout room, shortcut included', () => {
    const { unmount } = render(<HandToggle />)
    unmount()
    breakoutStore.room = { id: 'r1', name: 'Room 1' }
    render(<HandToggle />)
    expect(screen.queryByRole('button', { name: 'raise' })).toBeNull()
    expect(keyboardShortcutsStore.shortcuts.has(raiseHandKey)).toBe(false)
  })
})
