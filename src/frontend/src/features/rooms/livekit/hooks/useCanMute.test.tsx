// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { Participant } from 'livekit-client'
import { breakoutStore, resetBreakout } from '@/features/breakout/store'
import { useCanMute } from './useCanMute'

vi.mock('@/features/rooms/livekit/hooks/useRoomData', () => ({
  useRoomData: () => ({ configuration: {} }),
}))
vi.mock('./useIsAdminOrOwner', () => ({ useIsAdminOrOwner: () => false }))

const bob = { isLocal: false } as unknown as Participant
const me = { isLocal: true } as unknown as Participant

const canMute = (participant: Participant) =>
  renderHook(() => useCanMute(participant)).result.current

afterEach(() => resetBreakout())

describe('useCanMute', () => {
  it('mutes someone else in the main meeting', () => {
    expect(canMute(bob)).toBe(true)
  })

  it('mutes only oneself in a breakout room', () => {
    breakoutStore.room = { id: 'r1', name: 'Room 1' }
    expect(canMute(bob)).toBe(false)
    expect(canMute(me)).toBe(true)
  })
})
