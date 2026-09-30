import { RiLayoutGridLine } from '@remixicon/react'
import { MenuItem } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import { menuRecipe } from '@/primitives/menuRecipe'
import { useConfig } from '@/api/useConfig'
import { useSidePanel } from '@/features/rooms/livekit/hooks/useSidePanel'
import { useIsAdminOrOwner } from '@/features/rooms/livekit/hooks/useIsAdminOrOwner'
import { useRoomMetadata } from '@/features/recording/hooks/useRoomMetadata'

export const BreakoutMenuItem = () => {
  const { t } = useTranslation('rooms', { keyPrefix: 'options.items' })
  const { toggleBreakout } = useSidePanel()
  const isAdminOrOwner = useIsAdminOrOwner()
  const { data: config } = useConfig()
  const announced = useRoomMetadata()?.breakout?.session_id

  // Closed while the config loads; an open session stays closable with the flag off.
  const isEnabled = config?.breakout_rooms?.is_enabled === true
  if (!isAdminOrOwner || !(isEnabled || announced)) return null

  return (
    <MenuItem
      onAction={() => toggleBreakout()}
      className={menuRecipe({ icon: true, variant: 'dark' }).item}
    >
      <RiLayoutGridLine size={20} />
      {t('breakout')}
    </MenuItem>
  )
}
