import { ConnectionState, type Room } from 'livekit-client'

// Room.connect() on a room already connected resolves without reading its token,
// so a move leaves the current room, and waits for it, before the new pass is used.
export const leaveCurrentRoom = async (
  room?: Pick<Room, 'state' | 'disconnect'> | null
): Promise<void> => {
  if (!room || room.state === ConnectionState.Disconnected) return
  await room.disconnect()
}
