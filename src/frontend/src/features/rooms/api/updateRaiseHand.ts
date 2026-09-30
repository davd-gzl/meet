import { fetchApi } from '@/api/fetchApi'
import { useRoomData } from '@/features/rooms/livekit/hooks/useRoomData'
import { useSnapshot } from 'valtio'
import { breakoutStore } from '@/features/breakout/store'

export const useRaiseHand = () => {
  const data = useRoomData()
  // In a breakout room, the hand goes up in that room.
  const breakoutRoomId = useSnapshot(breakoutStore).room?.id

  const raiseHand = async (raised: boolean) => {
    if (!data?.id) {
      throw new Error('Room id is not available')
    }

    const token = data?.livekit?.token

    if (!token) {
      throw new Error('LiveKit token is not available')
    }

    return fetchApi(`rooms/${data.id}/toggle-hand/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        raised,
        breakout_room_id: breakoutRoomId,
      }),
    })
  }

  return { raiseHand }
}
