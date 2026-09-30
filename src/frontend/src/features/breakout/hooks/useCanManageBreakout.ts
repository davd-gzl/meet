import { useConfig } from '@/api/useConfig'
import { useIsAdminOrOwner } from '@/features/rooms/livekit/hooks/useIsAdminOrOwner'

// Closed while the config loads: with the flag off every breakout endpoint answers 404.
export const useCanManageBreakout = () => {
  const isAdminOrOwner = useIsAdminOrOwner()
  const { data } = useConfig()
  return isAdminOrOwner && data?.breakout_rooms?.is_enabled === true
}
