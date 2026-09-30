import { describe, expect, it } from 'vitest'
import { DisconnectReason } from 'livekit-client'
import { disconnectAction, shouldFetchAssignment } from './transitions'

const inMain = { room: null, target: null, sessionId: null }
const breakoutRoom = { id: 'r1', name: 'Room 1' }

describe('shouldFetchAssignment', () => {
  it('fetches when a session appears in the main meeting', () => {
    expect(shouldFetchAssignment('s1', inMain)).toBe(true)
  })

  it('fetches once per session', () => {
    expect(shouldFetchAssignment('s1', { ...inMain, sessionId: 's1' })).toBe(
      false
    )
    expect(shouldFetchAssignment('s2', { ...inMain, sessionId: 's1' })).toBe(
      true
    )
  })

  it('does nothing without a session, in a breakout room or during a move', () => {
    expect(shouldFetchAssignment(null, inMain)).toBe(false)
    expect(shouldFetchAssignment('s1', { ...inMain, room: breakoutRoom })).toBe(
      false
    )
    expect(shouldFetchAssignment('s1', { ...inMain, target: 'main' })).toBe(
      false
    )
  })
})

describe('disconnectAction', () => {
  const inBreakout = { leaving: false, room: breakoutRoom }
  const mainMeeting = { leaving: false, room: null }

  it('ignores the disconnect a move starts', () => {
    const leaving = { leaving: true, room: null }
    expect(disconnectAction(DisconnectReason.CLIENT_INITIATED, leaving)).toBe(
      'ignore'
    )
    expect(
      disconnectAction(DisconnectReason.CLIENT_INITIATED, {
        ...inBreakout,
        leaving: true,
      })
    ).toBe('ignore')
  })

  it('returns to the main meeting when a breakout room goes away', () => {
    for (const reason of [
      DisconnectReason.ROOM_DELETED,
      DisconnectReason.SERVER_SHUTDOWN,
      DisconnectReason.PARTICIPANT_REMOVED,
      DisconnectReason.JOIN_FAILURE,
      undefined,
    ]) {
      expect(disconnectAction(reason, inBreakout)).toBe('returnToMain')
    }
  })

  it('lets a participant who hangs up in a breakout room leave', () => {
    expect(
      disconnectAction(DisconnectReason.CLIENT_INITIATED, inBreakout)
    ).toBe('default')
    expect(
      disconnectAction(DisconnectReason.DUPLICATE_IDENTITY, inBreakout)
    ).toBe('default')
  })

  it('keeps the existing behaviour in the main meeting', () => {
    for (const reason of [
      DisconnectReason.CLIENT_INITIATED,
      DisconnectReason.ROOM_DELETED,
      DisconnectReason.PARTICIPANT_REMOVED,
      undefined,
    ]) {
      expect(disconnectAction(reason, mainMeeting)).toBe('default')
    }
  })
})
