import { useTranslation } from 'react-i18next'
import { RiClosedCaptioningLine } from '@remixicon/react'
import { ToggleButton } from '@/primitives'
import { css } from '@/styled-system/css'
import { useSubtitles } from '@/features/subtitle/hooks/useSubtitles'
import { useAreSubtitlesAvailable } from '@/features/subtitle/hooks/useAreSubtitlesAvailable'
import { useIsInBreakoutRoom } from '@/features/breakout/hooks/useIsInBreakoutRoom'

export const SubtitlesToggle = () => {
  const { t } = useTranslation('rooms', { keyPrefix: 'controls.subtitles' })
  const { areSubtitlesOpen, toggleSubtitles, areSubtitlesPending } =
    useSubtitles()
  const tooltipLabel = areSubtitlesOpen ? 'open' : 'closed'
  const areSubtitlesAvailable = useAreSubtitlesAvailable()
  // Subtitles start in the main meeting, which a breakout room is not.
  const isInBreakoutRoom = useIsInBreakoutRoom()

  if (!areSubtitlesAvailable || isInBreakoutRoom) return null

  return (
    <div
      className={css({
        position: 'relative',
        display: 'inline-block',
      })}
    >
      <ToggleButton
        square
        variant="primaryDark"
        aria-label={t(tooltipLabel)}
        tooltip={t(tooltipLabel)}
        isSelected={areSubtitlesOpen}
        isDisabled={areSubtitlesPending}
        onPress={toggleSubtitles}
        data-attr={`controls-subtitles-${tooltipLabel}`}
      >
        <RiClosedCaptioningLine />
      </ToggleButton>
    </div>
  )
}
