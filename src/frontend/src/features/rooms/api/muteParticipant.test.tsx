// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { Participant } from 'livekit-client'
import { fetchApi } from '@/api/fetchApi'
import { breakoutStore, resetBreakout } from '@/features/breakout/store'
import { useMuteParticipant } from './muteParticipant'

vi.mock('@/api/fetchApi', () => ({ fetchApi: vi.fn(async () => ({})) }))
vi.mock('../livekit/hooks/useRoomData', () => ({
  useRoomData: () => ({
    id: 'main-id',
    livekit: { url: 'https://lk.test', room: 'main-id', token: 'main-token' },
  }),
}))
vi.mock('../livekit/hooks/useIsAdminOrOwner', () => ({
  useIsAdminOrOwner: () => false,
}))
vi.mock('@/features/notifications', () => ({
  NotificationType: { ParticipantMuted: 'participantMuted' },
  useNotifyParticipants: () => ({ notifyParticipants: vi.fn() }),
}))
vi.mock('@/features/analytics/telemetry', () => ({ reportError: vi.fn() }))

const bob = {
  identity: 'bob',
  getTrackPublication: () => ({ trackSid: 'TR_mic' }),
} as unknown as Participant

const sentBody = () => {
  const [url, options] = vi.mocked(fetchApi).mock.calls[0]
  return { url, body: JSON.parse(options!.body as string) }
}

afterEach(() => {
  vi.mocked(fetchApi).mockClear()
  resetBreakout()
})

describe('muting someone', () => {
  it('addresses the breakout room both people are in', async () => {
    breakoutStore.room = { id: 'r1', name: 'Room 1' }
    const { result } = renderHook(() => useMuteParticipant())

    await act(() => result.current.muteParticipant(bob))

    expect(sentBody()).toEqual({
      url: 'rooms/main-id/mute-participant/',
      body: {
        participant_identity: 'bob',
        track_sid: 'TR_mic',
        breakout_room_id: 'r1',
      },
    })
  })

  it('addresses the meeting itself outside a breakout room', async () => {
    const { result } = renderHook(() => useMuteParticipant())

    await act(() => result.current.muteParticipant(bob))

    expect(sentBody().body).toEqual({
      participant_identity: 'bob',
      track_sid: 'TR_mic',
    })
  })
})
