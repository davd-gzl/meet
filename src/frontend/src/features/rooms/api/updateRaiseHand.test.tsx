// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { fetchApi } from '@/api/fetchApi'
import { breakoutStore, resetBreakout } from '@/features/breakout/store'
import { useRaiseHand } from './updateRaiseHand'

vi.mock('@/api/fetchApi', () => ({ fetchApi: vi.fn(async () => ({})) }))
vi.mock('@/features/rooms/livekit/hooks/useRoomData', () => ({
  useRoomData: () => ({
    id: 'main-id',
    livekit: { url: 'https://lk.test', room: 'main-id', token: 'main-token' },
  }),
}))

const sentBody = () =>
  JSON.parse(vi.mocked(fetchApi).mock.calls[0][1]!.body as string)

afterEach(() => {
  vi.mocked(fetchApi).mockClear()
  resetBreakout()
})

describe('raising a hand', () => {
  it('raises it in the breakout room the caller is in', async () => {
    breakoutStore.room = { id: 'r1', name: 'Room 1' }
    const { result } = renderHook(() => useRaiseHand())

    await result.current.raiseHand(true)

    expect(sentBody()).toEqual({ raised: true, breakout_room_id: 'r1' })
  })

  it('raises it in the meeting itself outside a breakout room', async () => {
    const { result } = renderHook(() => useRaiseHand())

    await result.current.raiseHand(true)

    expect(sentBody()).toEqual({ raised: true })
  })
})
