import { useSnapshot } from 'valtio'
import { layoutStore } from '@/stores/layout'
import { useStartSubtitle } from '../api/startSubtitle'
import { useRoomData } from '@/features/rooms/livekit/hooks/useRoomData'
import { useRoomContext } from '@livekit/components-react'
import { useEffect } from 'react'
import { RoomEvent } from 'livekit-client'
import { breakoutStore } from '@/features/breakout/store'

export const useSubtitles = () => {
  const layoutSnap = useSnapshot(layoutStore)
  // In a breakout room, the transcription runs in that room.
  const breakoutRoomId = useSnapshot(breakoutStore).room?.id

  const room = useRoomContext()
  const apiRoomData = useRoomData()
  const { mutateAsync: startSubtitleRoom, isPending } = useStartSubtitle()

  const toggleSubtitles = async () => {
    if (!layoutSnap.showSubtitles && apiRoomData?.livekit) {
      await startSubtitleRoom({
        id: apiRoomData?.livekit?.room,
        token: apiRoomData?.livekit?.token,
        breakoutRoomId,
      })
    }

    layoutStore.showSubtitles = !layoutSnap.showSubtitles
  }

  useEffect(() => {
    if (!room) return

    const closeSubtitles = () => {
      layoutStore.showSubtitles = false
    }
    room.on(RoomEvent.Disconnected, closeSubtitles)
    return () => {
      room.off(RoomEvent.Disconnected, closeSubtitles)
    }
  }, [room])

  return {
    areSubtitlesOpen: layoutSnap.showSubtitles,
    toggleSubtitles,
    areSubtitlesPending: isPending,
  }
}
