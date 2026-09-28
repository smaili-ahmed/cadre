/** Shared editor types. */

export interface FrameSize {
  width: number
  height: number
}

export interface FrameSource extends FrameSize {
  url: string
}

/** What is painted behind the logos: a real image, or a flat colour. */
export type Background =
  | { kind: 'image'; image: ImportedImage }
  | { kind: 'color'; color: string; width: number; height: number }

export type BackgroundKind = Background['kind']

export interface ImportedImage {
  id: string
  /** Original file name, used in the UI. */
  name: string
  /** Data URL. The image never leaves the browser. */
  url: string
  /** Decoded intrinsic size, in pixels. */
  width: number
  height: number
  mimeType: string
  fileSize: number
}

export interface LogoItem extends ImportedImage {
  /**
   * Size multiplier relative to the automatically fitted size, in percent.
   * 100 % = the "ideal" size for the current frame.
   */
  sizePct: number
  /** Fabric scale applied to the natural image size (image-space). */
  scale: number
  /** The "ideal" scale for the current frame; `scale = autoScale * sizePct / 100`. */
  autoScale: number
  /** Position of the top-left corner, in image-space pixels. */
  left: number
  top: number
  /** Rendered size, in image-space pixels. */
  width: number
  height: number
  /** Natural (unscaled) size, kept to preserve the original aspect ratio. */
  naturalWidth: number
  naturalHeight: number
}

/** A plain rectangle, used by the (framework free) centering maths. */
export interface Box {
  id: string
  left: number
  top: number
  width: number
  height: number
}

export type CenterMode =
  | 'both'
  | 'horizontal'
  | 'vertical'
  | 'alignHorizontal'
  | 'alignVertical'

export const CENTER_MODES: {
  id: CenterMode
  label: string
  hint: string
}[] = [
  { id: 'both', label: 'Centre H + V', hint: 'Le groupe est centré horizontalement et verticalement.' },
  { id: 'horizontal', label: 'Centre H', hint: 'Le groupe est centré horizontalement, la position verticale est conservée.' },
  { id: 'vertical', label: 'Centre V', hint: 'Le groupe est centré verticalement, la position horizontale est conservée.' },
  { id: 'alignHorizontal', label: 'Alignement H', hint: 'Les logos partagent le même axe horizontal, le groupe est centré horizontalement.' },
  { id: 'alignVertical', label: 'Alignement V', hint: 'Les logos sont empilés en colonne, le groupe est centré dans les deux axes.' },
]

export interface EditorSnapshot {
  logos: {
    id: string
    left: number
    top: number
    width: number
    height: number
    sizePct: number
  }[]
  spacing: number
}
