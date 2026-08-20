import { useTranslation } from 'react-i18next'
import { css } from '@/styled-system/css'
import { Text } from '@/primitives'
import { useJoinParticipantsCount } from '../hooks/useJoinParticipantsCount'

// <output> is a live region already, so a screen reader reads the line again
// when the meeting changes without the element announcing itself as a form value.
const lines = css({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  width: '100%',
})

/**
 * Isolated from the join form so the poll re-renders this line alone, and never
 * the name field someone is typing in.
 */
export const JoinParticipantsCount = ({ roomId }: { roomId: string }) => {
  const { t } = useTranslation('rooms', { keyPrefix: 'join.participants' })
  const count = useJoinParticipantsCount(roomId)

  if (count === undefined) {
    return null
  }

  return (
    <output className={lines}>
      <Text as="span" variant="note" centered margin="sm">
        {count === 0 ? t('empty') : t('count', { count })}
      </Text>
    </output>
  )
}
