/**
 * Generates the test fixtures used by the browser test:
 *  - fond-noir.png     : 1920x1080 solid black frame
 *  - fond-2048-carre.png : 2048x2048 square frame (high-resolution export test)
 *  - fond-4000x3000.png : 4000x3000 large non-16:9 frame
 *  - logo-alfia.png    : white "ALFIA" wordmark (transparent background)
 *  - logo-nexgegl.png  : white "NEXGEGL" wordmark, a different natural height
 *  - logo-petit.png    : small logo (uneven-size test)
 *  - logo-fins.png     : 2px stripes, quality canary for the export
 *  - manifest.json     : natural size of each logo, to check aspect ratios
 *
 * The ink of every logo fills its whole canvas and its letters are separated by
 * a small gap, so the pixel analysis of the browser test can measure the exact
 * spacing between logos and each logo's aspect ratio.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

/* --------------------------- minimal PNG writer --------------------------- */

function crc32(buffer: Buffer): number {
  let c
  const table: number[] = []
  for (let n = 0; n < 256; n += 1) {
    c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

type Pixel = [number, number, number, number]

function writePng(path: string, width: number, height: number, shade: (x: number, y: number) => Pixel) {
  const raw = Buffer.alloc(height * (width * 4 + 1))
  let offset = 0
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0 // filter: none
    offset += 1
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = shade(x, y)
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
      raw[offset + 3] = a
      offset += 4
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])

  writeFileSync(path, png)
  console.log(`  ${path}  (${width}x${height}, ${(png.length / 1024).toFixed(1)} Ko)`)
}

/* ------------------------------ wordmarks --------------------------------- */

const LETTER_GAP = 6

function wordmarkSize(letterCount: number, letterWidth: number, height: number) {
  return { width: letterCount * letterWidth + (letterCount - 1) * LETTER_GAP, height }
}

function wordmarkMask(letterCount: number, letterWidth: number, width: number, height: number) {
  return (x: number, y: number) => {
    if (y < 0 || y >= height) return false
    if (x < 0 || x >= width) return false
    const index = Math.floor(x / (letterWidth + LETTER_GAP))
    if (index < 0 || index >= letterCount) return false
    return x - index * (letterWidth + LETTER_GAP) < letterWidth
  }
}

/* --------------------------------- output --------------------------------- */

const outDir = process.argv[2] ?? join(process.cwd(), 'scripts', 'fixtures')
mkdirSync(outDir, { recursive: true })

console.log('Génération des fixtures :')

const manifest: Record<string, { width: number; height: number }> = {}

// 1. Solid black frame, 1920x1080
writePng(join(outDir, 'fond-noir.png'), 1920, 1080, () => [0, 0, 0, 255])

// 1b. Extra frames used by the high-resolution export tests: a square one and a
// big non-16:9 one, to prove the export never resizes or crops the image.
writePng(join(outDir, 'fond-2048-carre.png'), 2048, 2048, () => [0, 0, 0, 255])
writePng(join(outDir, 'fond-4000x3000.png'), 4000, 3000, () => [0, 0, 0, 255])

// 2. White ALFIA wordmark, 5 letters
const alfiaSize = wordmarkSize(5, 96, 120)
const alfia = wordmarkMask(5, 96, alfiaSize.width, alfiaSize.height)
writePng(join(outDir, 'logo-alfia.png'), alfiaSize.width, alfiaSize.height, (x, y) =>
  alfia(x, y) ? [255, 255, 255, 255] : [0, 0, 0, 0],
)
manifest['logo-alfia.png'] = alfiaSize

// 3. White NEXGEGL wordmark, 7 letters and a smaller natural height
const nexgeglSize = wordmarkSize(7, 60, 90)
const nexgegl = wordmarkMask(7, 60, nexgeglSize.width, nexgeglSize.height)
writePng(join(outDir, 'logo-nexgegl.png'), nexgeglSize.width, nexgeglSize.height, (x, y) =>
  nexgegl(x, y) ? [255, 255, 255, 255] : [0, 0, 0, 0],
)
manifest['logo-nexgegl.png'] = nexgeglSize

// 4. A small logo, to test uneven logo sizes
const petitSize = wordmarkSize(2, 54, 90)
const petit = wordmarkMask(2, 54, petitSize.width, petitSize.height)
writePng(join(outDir, 'logo-petit.png'), petitSize.width, petitSize.height, (x, y) =>
  petit(x, y) ? [255, 214, 10, 255] : [0, 0, 0, 0],
)
manifest['logo-petit.png'] = petitSize

// 4b. A high-resolution logo (2000x500). The app is expected to scale it DOWN to
// its automatic size (~600 px wide) on a 1920 px frame, i.e. render it at
// roughly 30 % of its native size: a good downscaler keeps the fine detail
// readable, which is what the export test measures.
const hiresSize = { width: 2000, height: 500 }
writePng(join(outDir, 'logo-hires.png'), hiresSize.width, hiresSize.height, (x, y) => {
  // Vertical bars of varying width (2..11 px) plus a hairline grid, so any
  // blur or resampling shows up immediately in the pixel analysis.
  const bar = 2 + ((x / 37) | 0) % 10
  if (x % bar === 0) return [255, 255, 255, 255]
  if (x % 97 === 0 || y % 97 === 0) return [120, 120, 120, 255]
  return [0, 0, 0, 0]
})
manifest['logo-hires.png'] = hiresSize

// 4c. A "photographic" frame with fine detail everywhere. A flat black frame
// hides resampling artefacts, so the export tests also use a textured one.
// The values stay dark on purpose: the pixel analysis treats a pixel as "ink"
// when r+g+b > 90, so the background must remain below that to be countable.
const DARK_MAX = 28 // r+g+b = 84 at most, safely under the 90 threshold
writePng(join(outDir, 'fond-detaille.png'), 1920, 1080, (x, y) => {
  // 1px checkerboard plus diagonal hatching: high spatial frequency, so any
  // blur or resampling is immediately visible in the exported file.
  const checker = (x + y) % 2 === 0 ? DARK_MAX : 0
  const hatch = x % 37 === 0 || y % 41 === 0 ? 4 : 0
  const v = Math.max(0, Math.min(DARK_MAX, checker + hatch))
  return [v, v, v, 255]
})
writePng(join(outDir, 'fond-detaille-2048.png'), 2048, 2048, (x, y) => {
  const checker = (x + y) % 2 === 0 ? DARK_MAX : 0
  const hatch = x % 37 === 0 || y % 41 === 0 ? 4 : 0
  const v = Math.max(0, Math.min(DARK_MAX, checker + hatch))
  return [v, v, v, 255]
})

// 5. A logo made of very fine 2px stripes. Such a logo is the quality canary:
// it only survives an export that reads the ORIGINAL bitmap. Rasterised at the
// display zoom (a 2048 px image shown in ~800 px) the stripes fall below one
// pixel and get averaged into flat grey, so counting the remaining transitions
// tells whether the export used a thumbnail or the real source.
const FINS_STRIPE = 2
const finsSize = { width: 400, height: 100 }
writePng(join(outDir, 'logo-fins.png'), finsSize.width, finsSize.height, (x) =>
  Math.floor(x / FINS_STRIPE) % 2 === 0 ? [255, 255, 255, 255] : [0, 0, 0, 0],
)
manifest['logo-fins.png'] = finsSize

writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log('  manifest.json')
console.log('\nTerminé.')
