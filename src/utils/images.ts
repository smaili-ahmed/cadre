/**
 * File reading + validation helpers.
 *
 * Everything runs in the browser: files are read with the FileReader API and
 * turned into data URLs, they are NEVER uploaded anywhere.
 */

import { MAX_LOGOS } from './centering'
import type { ImportedImage } from './types'

export const FRAME_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const

export const FRAME_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']
export const LOGO_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.svg']

/** Max source file size: 40 MB. Keeps memory usage reasonable. */
export const MAX_FILE_SIZE = 40 * 1024 * 1024

const EXTENSION_FALLBACK: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

export function extensionOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index === -1 ? '' : name.slice(index + 1).toLowerCase()
}

export function humanFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 o'
  const units = ['o', 'Ko', 'Mo', 'Go']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

export interface ValidationResult {
  ok: boolean
  error?: string
}

export function validateFile(file: File, kind: 'frame' | 'logo', currentCount = 0): ValidationResult {
  const label = kind === 'frame' ? 'l’image principale' : 'un logo'
  const allowed = kind === 'frame' ? FRAME_EXTENSIONS : LOGO_EXTENSIONS
  const allowedNames = kind === 'frame' ? 'PNG, JPG, JPEG ou WEBP' : 'PNG, JPG, JPEG, WEBP ou SVG'

  if (kind === 'logo' && currentCount >= MAX_LOGOS) {
    return { ok: false, error: `Vous ne pouvez pas ajouter plus de ${MAX_LOGOS} logos.` }
  }
  if (file.size === 0) {
    return { ok: false, error: `« ${file.name} » est vide.` }
  }
  if (file.size > MAX_FILE_SIZE) {
    return { ok: false, error: `« ${file.name} » dépasse ${humanFileSize(MAX_FILE_SIZE)}.` }
  }

  const byMime = (kind === 'frame' ? FRAME_MIME_TYPES : LOGO_MIME_TYPES) as readonly string[]
  const mime = file.type || EXTENSION_FALLBACK[extensionOf(file.name)]
  const mimeOk = byMime.includes(mime)
  const extOk = allowed.includes(`.${extensionOf(file.name)}`)

  if (!mimeOk && !extOk) {
    return { ok: false, error: `Format non pris en charge pour ${label} : utilisez ${allowedNames}.` }
  }
  return { ok: true }
}

let counter = 0
export function createId(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') resolve(result)
      else reject(new Error(`Impossible de lire « ${file.name} ».`))
    }
    reader.onerror = () => reject(new Error(`Impossible de lire « ${file.name} ».`))
    reader.onabort = () => reject(new Error(`Lecture interrompue pour « ${file.name} ».`))
    reader.readAsDataURL(file)
  })
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Fichier image invalide ou corrompu.'))
    image.src = src
  })
}

/**
 * SVGs without an intrinsic size (a bare `<svg viewBox="…">`) report a
 * natural size of 0 in some browsers. We re-serialise them with explicit
 * width/height attributes so that the ratio is always known.
 */
async function ensureSvgHasSize(dataUrl: string): Promise<string> {
  try {
    const text = atob(dataUrl.split(',')[1] ?? '')
    const hasWidth = /\bwidth\s*=/i.test(text)
    const hasHeight = /\bheight\s*=/i.test(text)
    if (hasWidth && hasHeight) return dataUrl

    const viewBox = text.match(/viewBox\s*=\s*["']([^"']+)["']/i)
    let width = 512
    let height = 512
    if (viewBox) {
      const parts = viewBox[1].trim().split(/[\s,]+/).map(Number)
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n)) && parts[2] > 0 && parts[3] > 0) {
        width = parts[2]
        height = parts[3]
      }
    }
    const patched = text
      .replace(/<svg\b/i, `<svg width="${width}" height="${height}"`)
      .replace(/(['"])width\s*=\s*["'][^"']*["']/i, '')
      .replace(/(['"])height\s*=\s*["'][^"']*["']/i, '')
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(patched)))}`
  } catch {
    return dataUrl
  }
}

export interface LoadResult {
  image: ImportedImage
  element: HTMLImageElement
}

export async function loadImageFile(file: File): Promise<LoadResult> {
  const isSvg = (file.type || EXTENSION_FALLBACK[extensionOf(file.name)]) === 'image/svg+xml'
  let dataUrl = await readFileAsDataUrl(file)
  if (isSvg) dataUrl = await ensureSvgHasSize(dataUrl)

  const element = await loadImageElement(dataUrl)

  const width = element.naturalWidth || 512
  const height = element.naturalHeight || 512
  if (width < 1 || height < 1) {
    throw new Error(`« ${file.name} » n’a pas de dimensions exploitables.`)
  }

  return {
    element,
    image: {
      id: createId('img'),
      name: file.name,
      url: dataUrl,
      width,
      height,
      mimeType: file.type || EXTENSION_FALLBACK[extensionOf(file.name)] || 'image/png',
      fileSize: file.size,
    },
  }
}

export function extractFiles(list: FileList | File[] | null): File[] {
  if (!list) return []
  return Array.from(list)
}

export function isAccepted(file: File, accept: readonly string[]): boolean {
  const byExtension = accept.some((ext) => file.name.toLowerCase().endsWith(ext))
  return byExtension || accept.includes(file.type)
}
