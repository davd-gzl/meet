// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Tab, TabList, Tabs } from 'react-aria-components'
import { AccountTab } from './AccountTab'
import { breakoutStore, resetBreakout } from '@/features/breakout/store'

const h = vi.hoisted(() => ({ rename: vi.fn(async () => ({})) }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: () => null,
}))
vi.mock('@livekit/components-react', () => ({
  useRoomContext: () => ({ localParticipant: { name: 'Ann' } }),
}))
vi.mock('@/features/auth/api/useUser', () => ({
  useUser: () => ({ user: undefined, isLoggedIn: false }),
}))
vi.mock('@/api/useConfig', () => ({ useConfig: () => ({ data: {} }) }))
vi.mock('@/components/LoginButton', () => ({ LoginButton: () => null }))
vi.mock('@/features/rooms/api/renameParticipant', () => ({
  useRenameParticipant: () => ({ renameParticipant: h.rename }),
}))
vi.mock('@/stores/user', () => ({ saveUsername: vi.fn() }))

const renderTab = () =>
  render(
    <Tabs>
      <TabList aria-label="settings">
        <Tab id="account">account</Tab>
      </TabList>
      <AccountTab id="account" onOpenChange={vi.fn()} />
    </Tabs>
  )

afterEach(() => {
  cleanup()
  resetBreakout()
  h.rename.mockClear()
})

describe('AccountTab', () => {
  it('renames in the main meeting', async () => {
    renderTab()
    expect(screen.queryByRole('textbox')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))
    await vi.waitFor(() => expect(h.rename).toHaveBeenCalledWith('Ann'))
  })

  it('offers no rename in a breakout room', async () => {
    breakoutStore.room = { id: 'r1', name: 'Room 1' }
    renderTab()
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'submit' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(h.rename).not.toHaveBeenCalled()
  })
})
