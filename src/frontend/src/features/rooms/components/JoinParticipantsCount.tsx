import { useTranslation } from 'react-i18next'
import { Text } from '@/primitives'
import { useParticipants } from '../hooks/useParticipants'

// Past this many, the roster stops being a sentence and becomes a wall.
const MAX_NAMES = 5

/**
 * Isolated from the join form so the poll re-renders these lines alone, and
 * never the name field someone is typing in.
 */
export const JoinParticipantsCount = ({ roomId }: { roomId: string }) => {
  const { t, i18n } = useTranslation('rooms', {
    keyPrefix: 'join.participants',
  })
  const participants = useParticipants(roomId)

  if (!participants) {
    return null
  }

  const { count, names } = participants
  const shown = names.slice(0, MAX_NAMES)
  const unnamed = count - shown.length
  // Intl builds the list in the reader's own language, so the word joining the
  // last two names never has to be translated here.
  const listed = new Intl.ListFormat(i18n.language, {
    type: 'conjunction',
  }).format(unnamed > 0 ? [...shown, t('more', { count: unnamed })] : shown)

  return (
    <div role="status">
      <Text as="p" variant="note" centered margin="sm">
        {count === 0 ? t('empty') : t('count', { count })}
      </Text>
      {!!listed && (
        <Text as="p" variant="note" centered margin="sm">
          {listed}
        </Text>
      )}
    </div>
  )
}
