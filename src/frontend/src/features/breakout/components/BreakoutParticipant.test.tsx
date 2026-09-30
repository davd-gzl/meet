// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BreakoutParticipant } from './BreakoutParticipant'
import { breakoutStore, resetBreakout } from '../store'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('../hooks/useBreakout', () => ({ useBreakout: () => undefined }))

afterEach(() => {
  cleanup()
  resetBreakout()
})

describe('BreakoutParticipant', () => {
  it('offers a rejoin once the way back to the main meeting failed', () => {
    breakoutStore.returnFailed = true
    const onRejoin = vi.fn()
    render(
      <BreakoutParticipant
        mainRoomId="main"
        connect={vi.fn()}
        onRejoin={onRejoin}
      />
    )
    expect(screen.getByRole('alert').textContent).toContain('returnFailed')
    fireEvent.click(screen.getByRole('button', { name: 'rejoin' }))
    expect(onRejoin).toHaveBeenCalledTimes(1)
  })
})
