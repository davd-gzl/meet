import { css } from '@/styled-system/css'

// Hues far apart on the wheel, written out so the stylesheet carries each
// one; past the tenth room they come round again.
const PALETTES = [
  css({ colorPalette: 'violet' }),
  css({ colorPalette: 'teal' }),
  css({ colorPalette: 'orange' }),
  css({ colorPalette: 'pink' }),
  css({ colorPalette: 'sky' }),
  css({ colorPalette: 'lime' }),
  css({ colorPalette: 'amber' }),
  css({ colorPalette: 'red' }),
  css({ colorPalette: 'indigo' }),
  css({ colorPalette: 'emerald' }),
]

export const roomPalette = (index: number) => PALETTES[index % PALETTES.length]
