import { type ApiRoom } from './ApiRoom'
import { fetchApi } from '@/api/fetchApi'
import { MOVABLE_QUERY } from '@/features/breakout/api'

export const fetchRoom = ({
  roomId,
  username,
}: {
  roomId: string
  username?: string
}) => {
  const query = username ? `&username=${encodeURIComponent(username)}` : ''

  return fetchApi<ApiRoom>(`/rooms/${roomId}/?${MOVABLE_QUERY}${query}`)
}
