import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { css } from '@/styled-system/css'
import { ToggleButtonGroup } from 'react-aria-components'
import { Text, ToggleButton } from '@/primitives'
import { MAIN_ROOM } from '../utils/split'
import { roomPalette } from './roomPalette'

// Past this many rooms, the numbers go on a line of their own.
const INLINE_ROOMS = 6
const NUMBER = css({ width: '26px', height: '26px', fontSize: 12 })

export type Person = { identity: string; name: string }

// One person and a numbered button per room; a second press on their room
// takes them out of it. Memoised, so a press in the setup redraws one row.
export const PersonRow = memo(function PersonRow({
  identity,
  name,
  roomCount,
  room,
  isUnplaced,
  isDisabled,
  onChange,
}: {
  identity: string
  name: string
  roomCount: number
  room: number
  // A setup's person with no room yet, named in the warning colour.
  isUnplaced?: boolean
  isDisabled?: boolean
  onChange: (person: Person, room: number) => void
}) {
  const { t } = useTranslation('rooms', { keyPrefix: 'breakout' })
  const wrap = roomCount > INLINE_ROOMS
  return (
    <li>
      <div
        role="group"
        aria-label={name}
        className={
          wrap
            ? css({ display: 'flex', flexDirection: 'column', gap: '0.25rem' })
            : css({
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.5rem',
              })
        }
      >
        <Text
          variant="sm"
          wrap="pretty"
          className={
            isUnplaced ? css({ color: 'warning.subtle-text' }) : undefined
          }
        >
          {name}
        </Text>
        {/* One Tab stop per person; the arrow keys move between rooms. */}
        <ToggleButtonGroup
          aria-label={name}
          selectionMode="single"
          selectedKeys={room === MAIN_ROOM ? [] : [room]}
          isDisabled={isDisabled}
          onSelectionChange={(keys) => {
            const [next] = keys
            onChange({ identity, name }, next === undefined ? MAIN_ROOM : +next)
          }}
          className={
            wrap
              ? css({
                  display: 'grid',
                  gridTemplateColumns: 'repeat(10, minmax(0, 26px))',
                  gap: '0.25rem',
                })
              : css({ display: 'flex', gap: '0.25rem' })
          }
        >
          {Array.from({ length: roomCount }, (_, index) => (
            <ToggleButton
              key={index}
              id={index}
              variant="palette"
              size="xs"
              className={`${roomPalette(index)} ${NUMBER}`}
              aria-label={t('setup.placeIn', { number: index + 1, name })}
            >
              {index + 1}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>
    </li>
  )
})
