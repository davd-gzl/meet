// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MobileControlBar } from './MobileControlBar'
import { breakoutStore, resetBreakout } from '@/features/breakout/store'
import { keyboardShortcutsStore } from '@/stores/keyboardShortcuts'
import { getShortcutDescriptorById } from '@/features/shortcuts/catalog'
import { formatShortcutKey } from '@/features/shortcuts/utils'

const { none } = vi.hoisted(() => ({ none: () => null }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@livekit/components-react', () => ({
  useRoomContext: () => ({ localParticipant: {} }),
}))
vi.mock('@livekit/components-core', () => ({
  supportsScreenSharing: () => false,
}))
vi.mock('@/features/rooms/livekit/hooks/useRaisedHand', () => ({
  useRaisedHand: () => ({ toggleRaisedHand: vi.fn() }),
}))
vi.mock('@/api/useConfig', () => ({ useConfig: () => ({ data: {} }) }))
vi.mock('../../components/controls/LeaveButton', () => ({ LeaveButton: none }))
vi.mock('../../components/controls/HandToggle', () => ({ HandToggle: none }))
vi.mock('../../components/controls/ScreenShareToggle', () => ({
  ScreenShareToggle: none,
}))
vi.mock('../../components/controls/ChatToggle', () => ({ ChatToggle: none }))
vi.mock('../../components/controls/ParticipantsToggle', () => ({
  ParticipantsToggle: none,
}))
vi.mock('../../components/controls/ToolsToggle', () => ({ ToolsToggle: none }))
vi.mock('../../components/controls/CameraSwitchButton', () => ({
  CameraSwitchButton: none,
}))
vi.mock('../../components/controls/Device/AudioDevicesControl', () => ({
  AudioDevicesControl: none,
}))
vi.mock('../../components/controls/Device/VideoDeviceControl', () => ({
  VideoDeviceControl: none,
}))
vi.mock('../../hooks/useResizeObserver', () => ({
  useSize: () => ({ width: 0, height: 0 }),
}))
vi.mock('./ResponsiveMenu', () => ({ ResponsiveMenu: none }))
vi.mock('@/features/layout/components/ControlBarRegion', () => ({
  ControlBarRegion: (p: { children: ReactNode }) => <>{p.children}</>,
}))
vi.mock('@/features/reactions/components/ReactionsToggle', () => ({
  ReactionsToggle: none,
  reactionShortcutHandler: vi.fn(),
}))

const raiseHandKey = formatShortcutKey(
  getShortcutDescriptorById('raise-hand')!.shortcut!
)

afterEach(() => {
  cleanup()
  resetBreakout()
  keyboardShortcutsStore.shortcuts.clear()
})

describe('MobileControlBar', () => {
  it('binds the raise-hand shortcut in the main meeting', () => {
    render(<MobileControlBar />)
    expect(keyboardShortcutsStore.shortcuts.has(raiseHandKey)).toBe(true)
  })

  it('binds no raise-hand shortcut in a breakout room', () => {
    breakoutStore.room = { id: 'r1', name: 'Room 1' }
    render(<MobileControlBar />)
    expect(keyboardShortcutsStore.shortcuts.has(raiseHandKey)).toBe(false)
  })
})
