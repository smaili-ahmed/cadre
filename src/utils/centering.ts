/**
 * Pure, framework-free centring / layout maths.
 *
 * The most important rule implemented here: the logos are treated as ONE
 * SINGLE GROUP. We never centre each logo independently, we compute the
 * bounding box of the whole group and then position the group so that its
 * centre matches the centre of the frame.
 *
 * All coordinates are expressed in "image space": pixel 0,0 is the top-left
 * corner of the main image and the units are the original pixels of that
 * image, whatever the zoom level currently displayed on screen.
 */

import type { Box, CenterMode, FrameSize } from './types'

export const DEFAULT_SPACING = 40
export const MIN_SPACING = 0
export const MAX_SPACING = 300
export const MIN_SIZE_PCT = 10
export const MAX_SIZE_PCT = 200
export const MAX_LOGOS = 3

/** Fraction of the frame height a logo may reach, by default. */
export const AUTO_MAX_HEIGHT_RATIO = 0.3
/** Fraction of the frame width the whole logo group should use, by default. */
export const AUTO_GROUP_WIDTH_RATIO = 0.62
/** A single logo on its own is allowed to be wider. */
export const AUTO_SINGLE_WIDTH_RATIO = 0.85
/** Hard limit: the group is never allowed to exceed this fraction. */
export const GROUP_MAX_WIDTH_RATIO = 0.9

/* -------------------------------------------------------------------------- */
/*                                  Measures                                  */
/* -------------------------------------------------------------------------- */

export function sumWidths(boxes: Box[]): number {
  return boxes.reduce((total, box) => total + box.width, 0)
}

export function sumHeights(boxes: Box[]): number {
  return boxes.reduce((total, box) => total + box.height, 0)
}

/** Total width of a row: w1 + gap + w2 + gap + w3 */
export function groupWidth(boxes: Box[], gap: number): number {
  if (boxes.length === 0) return 0
  return sumWidths(boxes) + gap * (boxes.length - 1)
}

/** Total height of a column: h1 + gap + h2 + gap + h3 */
export function groupHeight(boxes: Box[], gap: number): number {
  if (boxes.length === 0) return 0
  return sumHeights(boxes) + gap * (boxes.length - 1)
}

export interface Bounds {
  left: number
  top: number
  width: number
  height: number
  centerX: number
  centerY: number
}

export function boundsOf(boxes: Box[]): Bounds {
  if (boxes.length === 0) {
    return { left: 0, top: 0, width: 0, height: 0, centerX: 0, centerY: 0 }
  }
  const left = Math.min(...boxes.map((b) => b.left))
  const top = Math.min(...boxes.map((b) => b.top))
  const right = Math.max(...boxes.map((b) => b.left + b.width))
  const bottom = Math.max(...boxes.map((b) => b.top + b.height))
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  }
}

/* -------------------------------------------------------------------------- */
/*                              Automatic sizing                               */
/* -------------------------------------------------------------------------- */

export interface NaturalSize {
  width: number
  height: number
}

/**
 * Computes ONE uniform scale shared by every logo of the group.
 *
 * A single factor applied to all the logos is what guarantees:
 *  - the original aspect ratio of each logo is preserved;
 *  - all the logos end up with the SAME height, so they look visually
 *    aligned even when their natural sizes are wildly different
 *    (a wide wordmark and a square icon sit on the same baseline);
 *  - the resulting lock-up has a controlled, balanced width.
 *
 * The factor is the smallest of:
 *   - the factor making the group use `widthRatio` of the frame width,
 *   - the factor keeping the tallest logo under `maxHeightRatio` of the height,
 *   - the factor keeping the group strictly inside the frame.
 */
export function computeUniformAutoScale(
  items: NaturalSize[],
  frame: FrameSize,
  options: { gap?: number; widthRatio?: number; maxHeightRatio?: number } = {},
): number {
  if (items.length === 0) return 1
  const gap = Math.max(0, options.gap ?? 0)
  const widthRatio = options.widthRatio ?? (items.length === 1 ? AUTO_SINGLE_WIDTH_RATIO : AUTO_GROUP_WIDTH_RATIO)
  const maxHeightRatio = options.maxHeightRatio ?? AUTO_MAX_HEIGHT_RATIO

  const totalNaturalWidth = items.reduce((sum, item) => sum + Math.max(0, item.width), 0)
  const tallestNatural = items.reduce((max, item) => Math.max(max, item.height), 0)
  if (totalNaturalWidth <= 0 || tallestNatural <= 0) return 1

  const gaps = gap * (items.length - 1)
  const byWidth = (frame.width * widthRatio - gaps) / totalNaturalWidth
  const byHeight = (frame.height * maxHeightRatio) / tallestNatural
  const byFrame = (frame.width * GROUP_MAX_WIDTH_RATIO - gaps) / totalNaturalWidth

  return Math.max(0.01, Math.min(byWidth, byHeight, byFrame))
}

/** Convenience wrapper for a single logo. */
export function computeAutoScale(
  naturalWidth: number,
  naturalHeight: number,
  frame: FrameSize,
  options: { gap?: number; widthRatio?: number; maxHeightRatio?: number } = {},
): number {
  return computeUniformAutoScale([{ width: naturalWidth, height: naturalHeight }], frame, options)
}

/**
 * Returns a uniform down-scale factor so that a row of logos stays inside the
 * frame. Returns 1 when everything already fits.
 */
export function groupFitFactor(boxes: Box[], gap: number, frame: FrameSize, maxWidthRatio = GROUP_MAX_WIDTH_RATIO): number {
  if (boxes.length === 0) return 1
  const available = frame.width * maxWidthRatio
  const needed = groupWidth(boxes, gap)
  if (needed <= available || needed === 0) return 1
  const gaps = gap * (boxes.length - 1)
  const usable = Math.max(1, available - gaps)
  return Math.max(0.05, Math.min(1, usable / sumWidths(boxes)))
}

/* -------------------------------------------------------------------------- */
/*                                 Centring                                    */
/* -------------------------------------------------------------------------- */

function centerX(box: Box, frame: FrameSize): number {
  return (frame.width - box.width) / 2
}

function centerY(box: Box, frame: FrameSize): number {
  return (frame.height - box.height) / 2
}

/**
 * THE core function.
 *
 * Places the logos as a single group, then aligns that group with the frame.
 *
 * - `both`             the group is perfectly centred horizontally AND vertically
 * - `horizontal`       row layout + group centred in X, the vertical placement
 *                      of each logo is left untouched
 * - `vertical`         the X layout is left untouched, the whole group is
 *                      translated so that it is vertically centred
 * - `alignHorizontal`  row layout + group centred in X, and every logo shares
 *                      the SAME vertical centre line (the current one of the
 *                      group) so the row looks perfectly aligned
 * - `alignVertical`    the logos are stacked in a column, all sharing the same
 *                      horizontal centre line, the group is centred in X and Y
 */
export function layoutGroup(
  boxes: Box[],
  gap: number,
  frame: FrameSize,
  mode: CenterMode = 'both',
): Box[] {
  if (boxes.length === 0) return []

  // A single logo: plain centring, no group concept.
  if (boxes.length === 1) {
    const [box] = boxes
    switch (mode) {
      case 'horizontal':
        return [{ ...box, left: centerX(box, frame) }]
      case 'vertical':
        return [{ ...box, top: centerY(box, frame) }]
      default:
        return [{ ...box, left: centerX(box, frame), top: centerY(box, frame) }]
    }
  }

  // --- Vertical stacking -----------------------------------------------------
  if (mode === 'alignVertical') {
    const total = groupHeight(boxes, gap)
    // startY = (hauteur_image - hauteur_du_groupe) / 2
    let cursorY = (frame.height - total) / 2
    return boxes.map((box) => {
      const placed: Box = {
        ...box,
        top: cursorY,
        left: (frame.width - box.width) / 2,
      }
      cursorY += box.height + gap
      return placed
    })
  }

  // --- Vertical only: keep the current X layout, centre the group in Y --------
  if (mode === 'vertical') {
    const bounds = boundsOf(boxes)
    const dy = frame.height / 2 - bounds.centerY
    return boxes.map((box) => ({ ...box, top: box.top + dy }))
  }

  // --- Horizontal row --------------------------------------------------------
  // largeur_groupe = largeur logo 1 + espace + largeur logo 2 + espace + ...
  const total = groupWidth(boxes, gap)
  // x_depart = (largeur_image - largeur_groupe) / 2
  const startX = (frame.width - total) / 2

  // `both` centres the row on the frame axis, `alignHorizontal` keeps the
  // current vertical position of the group and only aligns the logos on it.
  const currentBounds = boundsOf(boxes)
  const sharedCenterY = mode === 'both' ? frame.height / 2 : currentBounds.centerY

  let cursorX = startX
  return boxes.map((box) => {
    let top: number
    if (mode === 'horizontal') {
      // Vertical position preserved exactly as it is.
      top = box.top
    } else {
      // Every logo is centred on the shared axis, therefore the bounding box
      // of the group is itself centred on that axis.
      top = sharedCenterY - box.height / 2
    }
    const placed: Box = { ...box, left: cursorX, top }
    cursorX += box.width + gap
    return placed
  })
}

/** Convenience wrapper: centring using the default "both" mode. */
export function centerGroup(boxes: Box[], gap: number, frame: FrameSize): Box[] {
  return layoutGroup(boxes, gap, frame, 'both')
}

/** Translates the group so that it is perfectly centred, without re-ordering. */
export function nudgeGroupToCenter(boxes: Box[], frame: FrameSize): Box[] {
  if (boxes.length === 0) return []
  const bounds = boundsOf(boxes)
  const dx = frame.width / 2 - bounds.centerX
  const dy = frame.height / 2 - bounds.centerY
  return boxes.map((box) => ({ ...box, left: box.left + dx, top: box.top + dy }))
}

/* -------------------------------------------------------------------------- */
/*                            Align / distribute                              */
/* -------------------------------------------------------------------------- */

export type Edge = 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom'

/** Aligns the logos on a single edge, keeping their current positions. */
export function alignToEdge(boxes: Box[], edge: Edge, frame?: FrameSize): Box[] {
  if (boxes.length <= 1) return boxes
  const bounds = boundsOf(boxes)
  return boxes.map((box) => {
    switch (edge) {
      case 'left':
        return { ...box, left: bounds.left }
      case 'right':
        return { ...box, left: bounds.left + bounds.width - box.width }
      case 'top':
        return { ...box, top: bounds.top }
      case 'bottom':
        return { ...box, top: bounds.top + bounds.height - box.height }
      case 'centerH': {
        const base = frame ? frame.width / 2 : bounds.centerX
        return { ...box, left: base - box.width / 2 }
      }
      case 'centerV': {
        const base = frame ? frame.height / 2 : bounds.centerY
        return { ...box, top: base - box.height / 2 }
      }
      default:
        return box
    }
  })
}

/**
 * Distributes the logos so that the free space is split evenly between them.
 *
 * - 3+ logos: the two extremes keep their position, the middle ones are spread.
 * - 2 logos  : the gap is normalised to a visually comfortable value.
 */
export function distributeHorizontal(boxes: Box[], gap: number): Box[] {
  if (boxes.length < 2) return boxes
  const sorted = [...boxes].sort((a, b) => a.left - b.left)

  if (sorted.length === 2) {
    const total = gap || defaultGapFor(sorted)
    const bounds = boundsOf(sorted)
    const groupSize = sorted[0].width + total + sorted[1].width
    let cursor = bounds.centerX - groupSize / 2
    return sorted.map((box) => {
      const placed = { ...box, left: cursor }
      cursor += box.width + total
      return placed
    })
  }

  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const spanStart = first.left
  const spanEnd = last.left + last.width
  const innerWidths = sorted.slice(1, -1).reduce((sum, box) => sum + box.width, 0)
  const freeSpace = spanEnd - spanStart - first.width - last.width - innerWidths
  const step = freeSpace / (sorted.length - 1)

  let cursor = spanStart + first.width + step
  const result: Box[] = [first]
  for (let i = 1; i < sorted.length - 1; i += 1) {
    result.push({ ...sorted[i], left: cursor })
    cursor += sorted[i].width + step
  }
  result.push(last)
  return result
}

/** A comfortable gap derived from the logos themselves (50 % of the average width). */
export function defaultGapFor(boxes: Box[]): number {
  if (boxes.length === 0) return DEFAULT_SPACING
  const average = sumWidths(boxes) / boxes.length
  return Math.max(8, Math.round(average * 0.5))
}

/**
 * Re-lays out the row when the gap changes, keeping the group centred and the
 * vertical placement identical (this is what makes the gap slider feel live).
 */
export function applySpacing(boxes: Box[], gap: number, frame: FrameSize, mode: CenterMode = 'both'): Box[] {
  return layoutGroup(boxes, gap, frame, mode)
}

/* -------------------------------------------------------------------------- */
/*                            Safety / overflow                                */
/* -------------------------------------------------------------------------- */

export interface OverflowInfo {
  overflows: boolean
  left: number
  right: number
  top: number
  bottom: number
  amountX: number
  amountY: number
}

export function detectOverflow(boxes: Box[], frame: FrameSize): OverflowInfo {
  if (boxes.length === 0) {
    return { overflows: false, left: 0, right: 0, top: 0, bottom: 0, amountX: 0, amountY: 0 }
  }
  const bounds = boundsOf(boxes)
  const left = bounds.left
  const top = bounds.top
  const right = bounds.left + bounds.width
  const bottom = bounds.top + bounds.height
  const amountX = Math.max(0, -left) + Math.max(0, right - frame.width)
  const amountY = Math.max(0, -top) + Math.max(0, bottom - frame.height)
  return { overflows: amountX > 0.5 || amountY > 0.5, left, right, top, bottom, amountX, amountY }
}

/** Uniformly scales the group so that it fits inside the frame. */
export function shrinkToFit(boxes: Box[], gap: number, frame: FrameSize, maxWidthRatio = GROUP_MAX_WIDTH_RATIO): { boxes: Box[]; factor: number } {
  const factor = groupFitFactor(boxes, gap, frame, maxWidthRatio)
  if (factor >= 1) return { boxes, factor: 1 }
  return {
    boxes: boxes.map((box) => ({
      ...box,
      width: box.width * factor,
      height: box.height * factor,
    })),
    factor,
  }
}
