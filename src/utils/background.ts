/**
 * Solid-colour backgrounds.
 *
 * A background does not have to be a photo: a flat colour is often what is
 * needed (a black plate for a set of logos, a white proof, a coloured panel).
 * The canvas therefore has a size in both modes, so the centring maths and the
 * export work exactly the same way whether the background is an image or a
 * colour.
 */

import type { Background, FrameSize, ImportedImage } from './types'

/** Ready-made colours, including the black plate most often asked for. */
export const COLOR_PRESETS: { id: string; label: string; color: string }[] = [
  { id: 'noir', label: 'Noir', color: '#000000' },
  { id: 'blanc', label: 'Blanc', color: '#ffffff' },
  { id: 'gris-clair', label: 'Gris clair', color: '#e5e7eb' },
  { id: 'gris', label: 'Gris', color: '#9ca3af' },
  { id: 'gris-fonce', label: 'Gris foncé', color: '#374151' },
  { id: 'marine', label: 'Marine', color: '#0f172a' },
]

/** Common output sizes, so the user never has to compute a ratio by hand. */
export const BACKGROUND_SIZES: { id: string; label: string; width: number; height: number }[] = [
  { id: '1920x1080', label: '1920 × 1080 — 16:9', width: 1920, height: 1080 },
  { id: '1080x1080', label: '1080 × 1080 — 1:1', width: 1080, height: 1080 },
  { id: '2048x2048', label: '2048 × 2048 — 1:1', width: 2048, height: 2048 },
  { id: '2480x3508', label: '2480 × 3508 — A4 portrait', width: 2480, height: 3508 },
  { id: '3508x2480', label: '3508 × 2480 — A4 paysage', width: 3508, height: 2480 },
]

export const DEFAULT_BACKGROUND_COLOR = '#000000'
export const DEFAULT_BACKGROUND_SIZE = { width: 1920, height: 1080 }

/** Smallest allowed canvas, which also keeps the centring maths well defined. */
export const MIN_BACKGROUND_SIDE = 16

/**
 * Normalises a colour to a `#rrggbb` string, because the alpha channel of a
 * colour background has no meaning: the plate is opaque, and the export fills
 * the whole canvas with it.
 */
export function normalizeColor(value: string, fallback = DEFAULT_BACKGROUND_COLOR): string {
  const hex = value.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex
  if (/^#[0-9a-f]{3}$/.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
  }
  return fallback
}

export function colorBackground(
  color: string,
  size: { width: number; height: number } = DEFAULT_BACKGROUND_SIZE,
): Background {
  return {
    kind: 'color',
    color: normalizeColor(color),
    width: Math.max(MIN_BACKGROUND_SIDE, Math.round(size.width)),
    height: Math.max(MIN_BACKGROUND_SIDE, Math.round(size.height)),
  }
}

export function imageBackground(image: ImportedImage): Background {
  return { kind: 'image', image }
}

export function isColorBackground(background: Background | null): background is Extract<Background, { kind: 'color' }> {
  return background?.kind === 'color'
}

/** The canvas size, whatever the kind of background. */
export function backgroundSize(background: Background | null): FrameSize | null {
  if (!background) return null
  return background.kind === 'image'
    ? { width: background.image.width, height: background.image.height }
    : { width: background.width, height: background.height }
}

/** Replaces the size of a background, keeping its kind and colour. */
export function withBackgroundSize(background: Background, size: FrameSize): Background {
  const width = Math.max(MIN_BACKGROUND_SIDE, Math.round(size.width))
  const height = Math.max(MIN_BACKGROUND_SIDE, Math.round(size.height))
  return background.kind === 'color' ? { ...background, width, height } : { ...background, image: { ...background.image, width, height } }
}

/** Short human description used in the status bar and the export summary. */
export function backgroundLabel(background: Background | null): string {
  const size = backgroundSize(background)
  if (!background || !size) return '—'
  const label = `${Math.round(size.width)} × ${Math.round(size.height)} px`
  return background.kind === 'image' ? label : `${label} · ${background.color}`
}
