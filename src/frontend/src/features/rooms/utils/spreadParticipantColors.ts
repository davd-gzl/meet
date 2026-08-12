import type { Participant } from 'livekit-client'
import { getParticipantColor } from './getParticipantColor'

// Two hues closer than this read as the same colour on a tile.
const MIN_HUE_DISTANCE = 30
const HUE_STEPS = 360 / MIN_HUE_DISTANCE

const hueOf = (color: string): number | null => {
  const match = /^hsl\((\d+),/.exec(color)
  return match ? Number(match[1]) : null
}

const isFarEnough = (hue: number, taken: number[]) =>
  taken.every((other) => {
    const distance = Math.abs(hue - other)
    return Math.min(distance, 360 - distance) >= MIN_HUE_DISTANCE
  })

/**
 * Give every participant of a room a colour nobody else there is wearing.
 *
 * The colour a participant carries is kept while it stands out. Otherwise its
 * hue turns until it clears the others, so two people with the same name are
 * still told apart at a glance. Participants are walked in identity order, so
 * every client computes the same answer and nobody's colour depends on the
 * order they arrived.
 */
export const spreadParticipantColors = (
  participants: Participant[]
): Map<string, string> => {
  const spread = new Map<string, string>()
  const taken: number[] = []

  for (const participant of [...participants].sort((a, b) =>
    a.identity.localeCompare(b.identity)
  )) {
    const color = getParticipantColor(participant)
    const hue = hueOf(color)

    if (hue === null) {
      spread.set(participant.identity, color)
      continue
    }

    let chosen = hue

    for (let step = 0; step < HUE_STEPS; step++) {
      chosen = (hue + step * MIN_HUE_DISTANCE) % 360
      if (isFarEnough(chosen, taken)) {
        break
      }
    }

    taken.push(chosen)
    spread.set(
      participant.identity,
      color.replace(/^hsl\(\d+,/, `hsl(${chosen},`)
    )
  }

  return spread
}
