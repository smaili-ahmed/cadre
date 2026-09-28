/**
 * Export at the original resolution.
 *
 * The export does NOT reuse the preview canvas and does NOT go through fabric:
 * a brand new canvas is allocated at exactly `originalWidth x originalHeight`
 * and the whole scene is rebuilt inside it from the ORIGINAL sources:
 *
 *   1. the original main image, drawn 1:1;
 *   2. each logo, drawn from its original bitmap (never a thumbnail) at the
 *      position and size it has in the editor.
 *
 * The editor stores every logo in IMAGE coordinates (the preview zoom only
 * ever changes the fabric viewport, never the geometry), so the conversion
 * asked for in the specification is the identity by construction:
 *
 *   scaleX = originalWidth / previewWidth = 1
 *   scaleY = originalHeight / previewHeight = 1
 *
 * That is what makes the following irrelevant to the exported file: the size of
 * the preview canvas, the zoom level, `devicePixelRatio`, the screen size, the
 * retina flag and the browser's own retina handling.
 *
 * The encoded bytes are parsed back and compared with the source image, so a
 * browser that silently caps an oversized canvas is reported as an error
 * instead of quietly downloading a smaller file.
 */

import type { Box } from './types'

export type ExportFormat = 'png' | 'jpeg'

export const EXPORT_MIME: Record<ExportFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
}

/** Chrome's own canvas limits, used to fail early with a readable message. */
const MAX_CANVAS_SIDE = 16384
const MAX_CANVAS_AREA = 268435456

/** The original main image, with the dimensions captured at import time. */
export interface ExportFrame {
  /** Original data URL. The image never leaves the browser. */
  url: string
  /** `naturalWidth` of the original file, in pixels. */
  width: number
  /** `naturalHeight` of the original file, in pixels. */
  height: number
}

/** One logo: its original source plus where it sits, in image coordinates. */
export interface ExportLogo {
  id: string
  /** Original data URL of the logo (the original file, or the original SVG). */
  url: string
  /** Natural size of the source, used to detect a downgraded source. */
  naturalWidth: number
  naturalHeight: number
  /** Position and size in IMAGE coordinates. */
  box: Box
}

export interface ExportResult {
  blob: Blob
  filename: string
  /** Dimensions read back from the encoded file, not from the canvas. */
  width: number
  height: number
  mimeType: string
  bytes: number
  /**
   * Output size relative to the source: 1 = pixel for pixel, 2 = doubled.
   * A value above 1 means the image was interpolated, so it contains no more
   * real detail than the source: it is a convenience, not extra resolution.
   */
  scale: number
  /** True when the output is larger than the source and was interpolated. */
  upscaled: boolean
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PNG_IHDR = 0x49484452

/**
 * Reads the real pixel dimensions out of the encoded bytes, without decoding
 * the image. PNG is read from the IHDR chunk, JPEG by walking the markers up
 * to the first SOFn.
 */
export function readEncodedImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length >= 24 && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (view.getUint32(12) !== PNG_IHDR) return null
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = bytes[offset + 1]
      // Standalone markers carry no payload.
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2
        continue
      }
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
      const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isStartOfFrame) {
        return {
          height: (bytes[offset + 5] << 8) | bytes[offset + 6],
          width: (bytes[offset + 7] << 8) | bytes[offset + 8],
        }
      }
      offset += 2 + length
    }
  }

  return null
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Une des images sources est illisible.'))
    image.src = url
  })
}

function assertCanvasSizeSupported(width: number, height: number): void {
  if (width < 1 || height < 1) {
    throw new Error(`Dimensions d’image invalides : ${width} × ${height}.`)
  }
  if (width > MAX_CANVAS_SIDE || height > MAX_CANVAS_SIDE || width * height > MAX_CANVAS_AREA) {
    throw new Error(
      `Cette image (${width} × ${height} px) dépasse la taille maximale que le navigateur ` +
        `peut encoder (${MAX_CANVAS_SIDE} px par côté). Réduisez l’image avant de l’exporter.`,
    )
  }
}

function canvasToBytes(
  element: HTMLCanvasElement,
  format: ExportFormat,
  quality: number,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    element.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error(`Le navigateur n’a pas pu encoder l’image en ${format.toUpperCase()}.`))
          return
        }
        blob.arrayBuffer().then(
          (buffer) => resolve(new Uint8Array(buffer)),
          () => reject(new Error(`Lecture de l’image encodée impossible (${format.toUpperCase()}).`)),
        )
      },
      EXPORT_MIME[format],
      // PNG is lossless: passing a quality value would be meaningless.
      format === 'jpeg' ? quality : undefined,
    )
  })
}

/**
 * Output size for a given source and requested width.
 *
 * The aspect ratio of the source is always preserved: only the width is asked
 * for, the height follows. `requestedWidth` is ignored when it is not a finite
 * number or not larger than 0, in which case the export stays 1:1.
 */
export function outputSizeFor(
  frame: { width: number; height: number },
  requestedWidth?: number,
): { width: number; height: number; scale: number; upscaled: boolean } {
  const source = { width: Math.max(1, frame.width), height: Math.max(1, frame.height) }
  const wanted =
    typeof requestedWidth === 'number' && Number.isFinite(requestedWidth) && requestedWidth > 0
      ? requestedWidth
      : source.width
  const width = Math.max(1, Math.round(wanted))
  const scale = width / source.width
  const height = Math.max(1, Math.round(source.height * scale))
  return { width, height, scale, upscaled: scale > 1.0001 }
}

export function timestampSuffix(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/**
 * Builds the final image in a dedicated canvas at the requested output size.
 *
 * When `requestedWidth` is omitted the output is exactly 1:1 with the source.
 * A larger width upscales the scene: the whole composition (frame and logos) is
 * scaled by the same factor, so the layout is unchanged, only the resolution.
 *
 * The returned width/height are read back from the encoded file, so a caller
 * can display exactly what was written to disk.
 */
export async function renderComposition(options: {
  frame: ExportFrame
  logos: ExportLogo[]
  format: ExportFormat
  quality: number
  /** Target width in pixels. Defaults to the original width (no scaling). */
  requestedWidth?: number
  baseName?: string
}): Promise<ExportResult> {
  const { frame, logos, format, quality, requestedWidth, baseName } = options
  const target = outputSizeFor(frame, requestedWidth)
  assertCanvasSizeSupported(target.width, target.height)

  const exportCanvas = document.createElement('canvas')
  exportCanvas.width = target.width
  exportCanvas.height = target.height
  const ctx = exportCanvas.getContext('2d')
  if (!ctx) {
    throw new Error('Le navigateur n’a pas fourni de contexte 2D pour l’export.')
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // JPEG has no alpha channel: the frame is flattened onto white, as in the
  // preview, so a logo on a transparent PNG does not turn black.
  if (format === 'jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, target.width, target.height)
  }

  const frameImage = await loadImage(frame.url)
  if (frameImage.naturalWidth !== frame.width || frameImage.naturalHeight !== frame.height) {
    throw new Error(
      `L’image source fait ${frameImage.naturalWidth} × ${frameImage.naturalHeight} px alors que ` +
        `${frame.width} × ${frame.height} px ont été enregistrés à l’import.`,
    )
  }
  // The frame fills the whole canvas, which is the requested size.
  ctx.drawImage(frameImage, 0, 0, target.width, target.height)

  // Logos live in image coordinates, so they are multiplied by the same factor
  // as the frame. Below 1:1 (never the case by default) the factor would shrink
  // them; the layout therefore always matches the preview, whatever the output.
  for (const logo of logos) {
    const image = await loadImage(logo.url)
    if (image.naturalWidth !== logo.naturalWidth || image.naturalHeight !== logo.naturalHeight) {
      throw new Error(
        `La source du logo « ${logo.id} » fait ${image.naturalWidth} × ${image.naturalHeight} px ` +
          `au lieu de ${logo.naturalWidth} × ${logo.naturalHeight} px : le fichier original a été remplacé.`,
      )
    }
    ctx.drawImage(
      image,
      logo.box.left * target.scale,
      logo.box.top * target.scale,
      logo.box.width * target.scale,
      logo.box.height * target.scale,
    )
  }

  const bytes = await canvasToBytes(exportCanvas, format, quality)

  // Final gate: the file that is about to be downloaded must match the request.
  const size = readEncodedImageSize(bytes)
  if (!size) {
    throw new Error(`L’image encodée en ${format.toUpperCase()} est illisible.`)
  }
  if (size.width !== target.width || size.height !== target.height) {
    throw new Error(
      `Le fichier exporté fait ${size.width} × ${size.height} px au lieu de ` +
        `${target.width} × ${target.height} px. L’image est trop volumineuse pour le navigateur.`,
    )
  }

  const blob = new Blob([bytes], { type: EXPORT_MIME[format] })
  const base = (baseName ?? 'logo-center')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w-]+/g, '-')
    .toLowerCase()
  const extension = format === 'jpeg' ? 'jpg' : 'png'
  const filename = `${base || 'logo-center'}-${timestampSuffix()}.${extension}`

  return {
    blob,
    filename,
    width: size.width,
    height: size.height,
    mimeType: EXPORT_MIME[format],
    bytes: bytes.length,
    scale: target.scale,
    upscaled: target.upscaled,
  }
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // Give the browser a tick to start the download before revoking.
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function humanResolution(width: number, height: number): string {
  const round = (value: number) => Math.round(value)
  return `${round(width)} × ${round(height)} px`
}
