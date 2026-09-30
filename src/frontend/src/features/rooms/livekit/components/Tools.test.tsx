// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Tools } from './Tools'
import { closeSidePanel } from '@/stores/layout'

const h = vi.hoisted(() => ({
  isHost: true,
  config: { breakout_rooms: { is_enabled: true } } as object | undefined,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/api/useConfig', () => ({ useConfig: () => ({ data: h.config }) }))
vi.mock('@/features/rooms/livekit/hooks/useIsAdminOrOwner', () => ({
  useIsAdminOrOwner: () => h.isHost,
}))
vi.mock('@/features/recording', () => ({
  RecordingMode: { Transcript: 'transcript', ScreenRecording: 'screen' },
  useIsRecordingModeEnabled: () => false,
  TranscriptSidePanel: () => null,
  ScreenRecordingSidePanel: () => null,
}))
vi.mock('@/features/breakout/components/BreakoutPanel', () => ({
  BreakoutPanel: () => <p>breakout panel</p>,
}))

const breakoutTool = () =>
  screen.queryByRole('button', { name: /tools\.breakout\.title/ })

afterEach(() => {
  cleanup()
  closeSidePanel()
  h.isHost = true
  h.config = { breakout_rooms: { is_enabled: true } }
})

describe('Tools', () => {
  it('opens breakout rooms as a tool for a host', async () => {
    render(<Tools />)
    fireEvent.click(breakoutTool()!)
    await screen.findByText('breakout panel')
  })

  it('offers no breakout rooms to a member, with the flag off, or while the config loads', () => {
    h.isHost = false
    const { unmount } = render(<Tools />)
    expect(breakoutTool()).toBeNull()
    unmount()

    h.isHost = true
    h.config = { breakout_rooms: { is_enabled: false } }
    const second = render(<Tools />)
    expect(breakoutTool()).toBeNull()
    second.unmount()

    h.config = undefined
    render(<Tools />)
    expect(breakoutTool()).toBeNull()
  })
})
