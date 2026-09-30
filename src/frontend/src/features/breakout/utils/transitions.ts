import { DisconnectReason } from 'livekit-client'

type MoveState = {
  room: unknown
  target: unknown
  sessionId: string | null
}

// A browser in the main meeting fetches its assignment once per session.
export const shouldFetchAssignment = (
  announcedSessionId: string | null,
  state: MoveState
) =>
  !!announcedSessionId &&
  state.room === null &&
  state.target === null &&
  state.sessionId !== announcedSessionId

export type DisconnectAction = 'ignore' | 'returnToMain' | 'default'

// A breakout room left by anything but the browser itself sends it back.
export const disconnectAction = (
  reason: DisconnectReason | undefined,
  state: { leaving: boolean; room: unknown }
): DisconnectAction => {
  if (state.leaving) return 'ignore'
  if (
    state.room !== null &&
    reason !== DisconnectReason.CLIENT_INITIATED &&
    reason !== DisconnectReason.DUPLICATE_IDENTITY
  )
    return 'returnToMain'
  return 'default'
}
