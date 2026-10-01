import { fetchApi } from '@/api/fetchApi'
import { ApiError } from '@/api/ApiError'
import { keys } from '@/api/queryKeys'

export type BreakoutPerson = { identity: string; name: string }

export type BreakoutSession = {
  id: string
  status: 'active' | 'closing' | 'closed'
  rooms: { id: string; name: string; participants: BreakoutPerson[] }[]
}

export type BreakoutPass = {
  room: { id: string; name: string }
  token: string
}

export type CreateBreakoutSession = {
  rooms: { name: string; participants: BreakoutPerson[] }[]
}

const sessionsUrl = (roomId: string) => `/rooms/${roomId}/breakout-sessions/`

export const breakoutSessionKey = (roomId?: string) => [
  keys.breakoutSession,
  roomId,
]

export const fetchBreakoutSession = async (
  roomId: string
): Promise<BreakoutSession | null> => {
  const sessions = await fetchApi<BreakoutSession[]>(sessionsUrl(roomId))
  return sessions[0] ?? null
}

export const createBreakoutSession = (
  roomId: string,
  body: CreateBreakoutSession
) =>
  fetchApi<BreakoutSession>(sessionsUrl(roomId), {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const closeBreakoutSession = (roomId: string, sessionId: string) =>
  fetchApi(`${sessionsUrl(roomId)}${sessionId}/close/`, { method: 'POST' })

// Resolves to null when the caller has no room in the active session.
export const joinBreakoutRoom = (roomId: string) =>
  fetchApi<BreakoutPass>(`${sessionsUrl(roomId)}join/`, {
    method: 'POST',
  }).catch((error) => {
    if (error instanceof ApiError && error.statusCode === 404) return null
    throw error
  })
