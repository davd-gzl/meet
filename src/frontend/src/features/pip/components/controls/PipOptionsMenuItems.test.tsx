// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PipOptionsMenuItems } from './PipOptionsMenuItems'
import { breakoutStore, resetBreakout } from '@/features/breakout/store'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('../PipControlBar', () => ({
  CollapsibleControls: { HAND: 'hand' },
}))
vi.mock(
  '@/features/rooms/livekit/components/controls/Options/PictureInPictureMenuItem',
  () => ({ PictureInPictureMenuItem: () => null })
)
vi.mock('@livekit/components-react', () => ({
  useRoomContext: () => ({ localParticipant: {} }),
  useTrackToggle: () => ({ buttonProps: {}, enabled: false }),
}))
vi.mock('@/features/reactions/hooks/useReactionsToolbar', () => ({
  useReactionsToolbar: () => ({ toggle: vi.fn() }),
}))
vi.mock('@/features/rooms/livekit/hooks/useRaisedHand', () => ({
  useRaisedHand: () => ({ isHandRaised: false, toggleRaisedHand: vi.fn() }),
}))

const renderMenu = () =>
  render(<PipOptionsMenuItems overflowControls={new Set(['hand'] as const)} />)

afterEach(() => {
  cleanup()
  resetBreakout()
})

describe('PipOptionsMenuItems', () => {
  it('lists the raised hand once it overflows', () => {
    renderMenu()
    expect(screen.queryByText('controls.hand.raise')).not.toBeNull()
  })

  it('lists the raised hand in a breakout room too', () => {
    breakoutStore.room = { id: 'r1', name: 'Room 1' }
    renderMenu()
    expect(screen.queryByText('controls.hand.raise')).not.toBeNull()
  })
})
