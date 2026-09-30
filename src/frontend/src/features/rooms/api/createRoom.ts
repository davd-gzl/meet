import { useMutation, UseMutationOptions } from '@tanstack/react-query'
import { fetchApi } from '@/api/fetchApi'
import type { ApiError } from '@/api/ApiError'
import type { ApiRoom } from './ApiRoom'
import { MOVABLE_QUERY } from '@/features/breakout/api'

export interface CreateRoomParams {
  slug: string
  callbackId?: string
  username?: string
}

const createRoom = ({
  slug,
  callbackId,
  username = '',
}: CreateRoomParams): Promise<ApiRoom> => {
  const query = `${MOVABLE_QUERY}&username=${encodeURIComponent(username)}`
  return fetchApi(`rooms/?${query}`, {
    method: 'POST',
    body: JSON.stringify({
      name: slug,
      callback_id: callbackId,
    }),
  })
}

export function useCreateRoom(
  options?: UseMutationOptions<ApiRoom, ApiError, CreateRoomParams>
) {
  return useMutation<ApiRoom, ApiError, CreateRoomParams>({
    mutationFn: createRoom,
    onSuccess: options?.onSuccess,
  })
}
