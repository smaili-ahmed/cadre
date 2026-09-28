/**
 * End-to-end browser test.
 *
 * Reproduces the reference case: a solid black 1920x1080 frame + the white
 * "ALFIA" and "NEXGEGL" wordmarks, then verifies the exported pixels.
 *
 * Run with:  npm run build && npx tsx scripts/e2e.ts
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer, { type Browser, type Page } from 'puppeteer'

const PORT = 4183
const URL = `http://localhost:${PORT}/`
const FIXTURES = join(process.cwd(), 'scripts', 'fixtures')
const SHOTS = join(process.cwd(), 'scripts', 'screenshots')

let failures = 0
function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL  ${label} ${detail}`)
  }
}
const near = (a: number, b: number, eps = 1) => Math.abs(a - b) <= eps

mkdirSync(SHOTS, { recursive: true })

/* -------------------------------------------------------------------------- */
/*                                  Dev server                                */
/* -------------------------------------------------------------------------- */

async function waitForServer(url: string, timeoutMs = 40000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      /* not ready yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  throw new Error(`Le serveur n'a pas démarré sur ${url}`)
}

/* -------------------------------------------------------------------------- */
/*                                Page helpers                                */
/* -------------------------------------------------------------------------- */

async function fileInputs(page: Page) {
  return page.$$('input[type=file]')
}

/** Reads the "W × H px · N %" lines of the logo list. */
async function listedLogoSizes(page: Page): Promise<string[]> {
  return (await page.evaluate(`
    document.body.innerText.split('\\n').filter(function (line) {
      return /\\d+ \\u00d7 \\d+ px \\u00b7 \\d+ %/.test(line);
    })
  `)) as string[]
}

/** Uploads on the Nth (0-based) file input of the page. */
async function upload(page: Page, inputIndex: number, files: string[]) {
  const inputs = await fileInputs(page)
  const input = inputs[inputIndex]
  if (!input) throw new Error(`Input fichier #${inputIndex} introuvable (${inputs.length} trouvés)`)
  await input.uploadFile(...files)
}

/** Click the first button whose label contains (or equals) one of the needles. */
function snippetClickText(needles: string[], exact = false): string {
  return `
    (function () {
      var needles = ${JSON.stringify(needles)};
      var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
      for (var i = 0; i < buttons.length; i++) {
        var text = (buttons[i].textContent || '').trim();
        for (var j = 0; j < needles.length; j++) {
          var hit = ${exact ? 'text === needles[j]' : 'text.indexOf(needles[j]) !== -1'};
          if (hit) { buttons[i].click(); return text; }
        }
      }
      return null;
    })()
  `
}

/** Click the first element matching a selector. */
function snippetClickSelector(selector: string): string {
  return `
    (function () {
      var element = document.querySelector(${JSON.stringify(selector)});
      if (!element) { return false; }
      element.click();
      return true;
    })()
  `
}

/** Drives a React-controlled range input. */
async function setSlider(page: Page, selector: string, value: string): Promise<void> {
  const ok = await page.evaluate(`
    (function () {
      var slider = document.querySelector(${JSON.stringify(selector)});
      if (!slider) { return false; }
      var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(slider, ${JSON.stringify(value)});
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `)
  if (!ok) throw new Error(`Slider introuvable : ${selector}`)
}

/**
 * NOTE: every browser-side snippet is passed to page.evaluate as a STRING.
 * Passing a real function would let the bundler inject helpers such as
 * `__name` into the page context, where they do not exist.
 */

/** Captures the blob produced by the next download. */
async function armDownloadCapture(page: Page) {
  await page.evaluate(`
    (function () {
      window.__blob = null;
      window.__name = '';
      var originalCreate = URL.createObjectURL;
      URL.createObjectURL = function (blob) {
        window.__blob = blob;
        return originalCreate(blob);
      };
      var originalClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        window.__name = this.download;
        if (this.href.indexOf('blob:') === 0) { return; }
        return originalClick.call(this);
      };
    })();
  `)
}

/**
 * Reads the real dimensions of an encoded file ON DISK, in Node, with no
 * browser involved: PNG from the IHDR chunk, JPEG by walking the markers up to
 * the first SOFn. This is the check that cannot be fooled by the app, because
 * it only looks at the bytes that were actually downloaded.
 */
function readFileDimensions(path: string): { width: number; height: number; format: string } {
  const bytes = readFileSync(path)
  const isPng =
    bytes.length > 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  if (isPng) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), format: 'png' }
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = bytes[offset + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2
        continue
      }
      const length = bytes.readUInt16BE(offset + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7), format: 'jpeg' }
      }
      offset += 2 + length
    }
  }
  throw new Error(`Format d’image non reconnu : ${path}`)
}

interface PixelAnalysis {
  width: number
  height: number
  mime: string
  bytes: number
  hasAlpha: boolean
  nonBlackCount: number
  minX: number
  maxX: number
  minY: number
  maxY: number
  centerX: number
  centerY: number
  /** Contiguous runs of non-empty columns. */
  columnRuns: { start: number; end: number; width: number }[]
  /** Contiguous runs of non-empty rows. */
  rowRuns: { start: number; end: number; height: number }[]
  /** Gaps between consecutive column runs. */
  columnGaps: number[]
  /** Width of each logo, derived from the column runs. */
  logoWidths: number[]
  /** For each logo run, the top / bottom of its ink. */
  logoBands: { top: number; bottom: number; height: number }[]
  corners: number[]
  pinkPixels: number
  /**
   * Width in pixels of the widest black->white transition found on the border
   * of a logo. A crisp render transitions in 1-2 px; a logo exported from a
   * low-resolution thumbnail smears every edge over many pixels.
   */
  maxEdgeRamp: number
  /** Share of intermediate grey pixels inside the artwork: 0 = hard edges. */
  greyRatio: number
  /**
   * Number of black<->ink transitions along the middle row of each logo.
   * A logo made of fine stripes only keeps its transitions if the export read
   * the original bitmap: a thumbnail averaged at the display zoom destroys them.
   */
  transitions: number[]
}

const ANALYSE_SNIPPET = `
(async function () {
  var blob = window.__blob;
  if (!blob) { throw new Error('Aucun fichier exporte'); }
  var bitmap = await createImageBitmap(blob);
  var canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  var ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  var img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  var data = img.data;
  var width = bitmap.width;
  var height = bitmap.height;

  var nonBlack = 0, minX = width, maxX = -1, minY = height, maxY = -1, pink = 0, hasAlpha = false;
  var colHit = new Uint8Array(width);
  var rowHit = new Uint8Array(height);

  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      var i = (y * width + x) * 4;
      var r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 250) { hasAlpha = true; }
      if (r > 200 && b > 140 && g < 170 && a > 100) { pink++; }
      if (r + g + b > 90) {
        nonBlack++;
        colHit[x] = 1; rowHit[y] = 1;
        if (x < minX) { minX = x; }
        if (x > maxX) { maxX = x; }
        if (y < minY) { minY = y; }
        if (y > maxY) { maxY = y; }
      }
    }
  }

  function runsOf(hits, key) {
    var runs = [], start = -1;
    for (var i = 0; i < hits.length; i++) {
      if (hits[i] && start === -1) { start = i; }
      if (!hits[i] && start !== -1) {
        var o = { start: start, end: i - 1 };
        o[key] = i - start;
        runs.push(o);
        start = -1;
      }
    }
    if (start !== -1) {
      var last = { start: start, end: hits.length - 1 };
      last[key] = hits.length - start;
      runs.push(last);
    }
    return runs;
  }

  // A wordmark is made of separate letters, so a raw run per column/row would
  // fragment each logo. Runs closer than maxGap belong to the same logo.
  function cluster(runs, maxGap, key) {
    var out = [];
    for (var i = 0; i < runs.length; i++) {
      if (out.length && runs[i].start - out[out.length - 1].end - 1 <= maxGap) {
        out[out.length - 1].end = runs[i].end;
      } else {
        out.push({ start: runs[i].start, end: runs[i].end });
      }
    }
    return out.map(function (r) {
      r[key] = r.end - r.start + 1;
      return r;
    });
  }

  var colRuns = cluster(runsOf(colHit, 'width'), 20, 'width');
  var rowRuns = cluster(runsOf(rowHit, 'height'), 8, 'height');

  var logoBands = colRuns.map(function (run) {
    var top = height, bottom = -1;
    for (var y = 0; y < height; y++) {
      for (var x = run.start; x <= run.end; x++) {
        var i = (y * width + x) * 4;
        if (data[i] + data[i + 1] + data[i + 2] > 90) {
          if (y < top) { top = y; }
          if (y > bottom) { bottom = y; }
          break;
        }
      }
    }
    return { top: top, bottom: bottom, height: bottom - top + 1 };
  });

  var columnGaps = [];
  for (var k = 1; k < colRuns.length; k++) { columnGaps.push(colRuns[k].start - colRuns[k - 1].end - 1); }

  var corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].map(function (p) {
    var i = (p[1] * width + p[0]) * 4;
    return data[i] + data[i + 1] + data[i + 2];
  });

  // ---- sharpness ---------------------------------------------------------
  // Solid white logos on a solid black frame have hard edges: every pixel is
  // either ink or background. Any pixel in between means an edge was resampled.
  var INK = 20, PAPER = 235, grey = 0;
  function lum(x, y) {
    var i = (y * width + x) * 4;
    return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  var maxEdgeRamp = 0;
  for (var b = 0; b < colRuns.length; b++) {
    var run = colRuns[b];
    var band = logoBands[b];
    if (!band || band.bottom <= band.top) { continue; }
    var y = Math.floor((band.top + band.bottom) / 2);
    [run.start - 1, run.start, run.end, run.end + 1].forEach(function (x0) {
      if (x0 < 0 || x0 >= width) { return; }
      var left = 0, right = 0;
      while (x0 - left - 1 >= 0) { var l = lum(x0 - left - 1, y); if (l <= INK || l >= PAPER) { break; } left++; }
      while (x0 + right < width) { var r = lum(x0 + right, y); if (r <= INK || r >= PAPER) { break; } right++; }
      if (left + right > maxEdgeRamp) { maxEdgeRamp = left + right; }
    });
  }
  for (var p2 = 0; p2 < data.length; p2 += 4) {
    var v = 0.299 * data[p2] + 0.587 * data[p2 + 1] + 0.114 * data[p2 + 2];
    if (v > INK && v < PAPER) { grey++; }
  }

  // ---- fine detail --------------------------------------------------------
  // Counts black<->ink transitions across the middle row of every logo. Fine
  // stripes are averaged into flat grey if the logo is rasterised at the
  // display zoom instead of being read from its original bitmap.
  var transitions = colRuns.map(function (run, index) {
    var band = logoBands[index];
    if (!band || band.bottom <= band.top) { return 0; }
    var y = Math.floor((band.top + band.bottom) / 2);
    var count = 0, previous = lum(run.start, y) > INK;
    for (var x = run.start + 1; x <= run.end; x++) {
      var ink = lum(x, y) > INK;
      if (ink !== previous) { count++; previous = ink; }
    }
    return count;
  });

  return {
    width: width, height: height, mime: blob.type, bytes: blob.size, hasAlpha: hasAlpha,
    nonBlackCount: nonBlack, minX: minX, maxX: maxX, minY: minY, maxY: maxY,
    centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2,
    columnRuns: colRuns, rowRuns: rowRuns, columnGaps: columnGaps,
    logoWidths: colRuns.map(function (r) { return r.width; }),
    logoBands: logoBands, corners: corners, pinkPixels: pink,
    maxEdgeRamp: maxEdgeRamp, greyRatio: nonBlack ? grey / nonBlack : 0,
    transitions: transitions
  };
})()
`

async function analyseLastExport(page: Page): Promise<PixelAnalysis> {
  return (await page.evaluate(ANALYSE_SNIPPET)) as PixelAnalysis
}

/**
 * Triggers one export and returns both the in-browser analysis and the bytes
 * of the file that was really handed to the download, so they can be verified
 * independently.
 */
async function exportOnce(
  page: Page,
  downloadDir?: string,
): Promise<PixelAnalysis & { savedTo?: string; savedName?: string }> {
  // The button stays in a transient state for a couple of seconds after each
  // export ("Génération…" then "Image téléchargée"), so wait for it to settle.
  await page.waitForFunction(
    `Array.prototype.some.call(document.querySelectorAll('button'), function (b) {
      return (b.textContent || '').trim() === 'T\\u00e9l\\u00e9charger en HD' && !b.disabled;
    })`,
    { timeout: 20000 },
  )
  await armDownloadCapture(page)
  const clicked = await page.evaluate(snippetClickText(['Télécharger en HD']))
  if (!clicked) throw new Error('Bouton « Télécharger en HD » introuvable')
  await page.waitForFunction('Boolean(window.__blob)', { timeout: 20000 })
  await new Promise((resolve) => setTimeout(resolve, 250))
  const analysis = await analyseLastExport(page)

  if (!downloadDir) return analysis

  // Same bytes as the browser saw, written to disk for an out-of-browser check.
  const dataUrl = (await page.evaluate(
    'new Promise(function (r) { var fr = new FileReader(); fr.onload = function () { r(fr.result) }; fr.readAsDataURL(window.__blob) })',
  )) as string
  const savedName = `${String((await page.evaluate('window.__name')) || 'export')}`
  const savedTo = join(downloadDir, savedName)
  writeFileSync(savedTo, Buffer.from(dataUrl.split(',')[1], 'base64'))
  return { ...analysis, savedTo, savedName }
}

const fixtures = {
  frame: join(FIXTURES, 'fond-noir.png'),
  frameSquare: join(FIXTURES, 'fond-2048-carre.png'),
  frameLarge: join(FIXTURES, 'fond-4000x3000.png'),
  frameDetail: join(FIXTURES, 'fond-detaille.png'),
  frameDetailSquare: join(FIXTURES, 'fond-detaille-2048.png'),
  alfia: join(FIXTURES, 'logo-alfia.png'),
  nexgegl: join(FIXTURES, 'logo-nexgegl.png'),
  petit: join(FIXTURES, 'logo-petit.png'),
  fins: join(FIXTURES, 'logo-fins.png'),
  hires: join(FIXTURES, 'logo-hires.png'),
}

/** Natural sizes written by scripts/make-fixtures.ts. */
const manifest = JSON.parse(readFileSync(join(FIXTURES, 'manifest.json'), 'utf8')) as Record<
  string,
  { width: number; height: number }
>

/* -------------------------------------------------------------------------- */

async function main() {
  for (const path of Object.values(fixtures)) {
    if (!existsSync(path)) throw new Error(`Fixture manquante : ${path}`)
  }

  const server: ChildProcess = spawn(
    process.execPath,
    [join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PORT), '--strictPort'],
    { stdio: 'ignore', windowsHide: true },
  )

  const downloadDir = mkdtempSync(join(tmpdir(), 'lc-dl-'))
  let browser: Browser | undefined

  try {
    await waitForServer(URL)
    console.log(`Serveur prêt sur ${URL}`)

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--force-device-scale-factor=1'],
      defaultViewport: { width: 1600, height: 1000 },
    })
    const page = await browser.newPage()

    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`))

    await page.goto(URL, { waitUntil: 'networkidle0' })

    /* ---------------------------------------------------------------- */
    console.log('\n[1] Chargement de l’application')
    check('le titre est affiché', (await page.title()).includes('Logo Center'))
    const h1 = await page.evaluate('(document.querySelector("h1") || {}).textContent || ""')
    check('le titre principal est correct', h1.includes('Logo Center'), `-> ${h1}`)
    check(
      'la description est présente',
      (await page.content()).includes('Importez votre cadre ou votre photo'),
    )
    await page.screenshot({ path: join(SHOTS, '01-accueil.png') as `${string}.png` })

    /* ---------------------------------------------------------------- */
    console.log('\n[2] Import du fond noir 1920x1080')
    await upload(page, 0, [fixtures.frame])
    await page.waitForSelector('canvas.upper-canvas', { timeout: 20000 })
    await page.waitForFunction('document.body.innerText.indexOf("fond-noir.png") !== -1', { timeout: 20000 })
    check('le nom du fichier est affiché', (await page.content()).includes('fond-noir.png'))
    check('la résolution est affichée', (await page.content()).includes('1920 × 1080 px'))

    /* ---------------------------------------------------------------- */
    console.log('\n[3] Import des deux logos (ALFIA + NEXGEGL)')
    await upload(page, 1, [fixtures.alfia, fixtures.nexgegl])
    await page.waitForFunction(
      '/alfia/i.test(document.body.innerText) && /nexgegl/i.test(document.body.innerText)',
      { timeout: 20000 },
    )
    await page.waitForFunction('document.body.innerText.indexOf("Centre H \\u2713") !== -1', { timeout: 20000 })
    await new Promise((resolve) => setTimeout(resolve, 900))

    const listedSizes = await listedLogoSizes(page)
    check('les deux logos sont listés', listedSizes.length === 2, `-> ${JSON.stringify(listedSizes)}`)
    // A single uniform factor is shared by the group, so both logos must be
    // multiplied by the same ratio relative to their natural size.
    const listedFixtures = [manifest['logo-alfia.png'], manifest['logo-nexgegl.png']]
    const factors = listedSizes.map((line, index) => {
      const size = /(\d+) × (\d+) px/.exec(line)
      return size && listedFixtures[index] ? Number(size[1]) / listedFixtures[index].width : 0
    })
    check(
      'les deux logos partagent le MÊME facteur d’échelle (uniforme)',
      factors.length === 2 && near(factors[0], factors[1], 0.005),
      `-> ${factors.map((f) => f.toFixed(3)).join(' / ')}`,
    )
    console.log(`    -> tailles automatiques : ${listedSizes.join(' | ')} · facteur ≈ ${factors[0]?.toFixed(3)}`)

    /* ---------------------------------------------------------------- */
    console.log('\n[4] Centrage automatique — vérification mathématique')
    const status = (await page.evaluate(`
      (function () {
        var nodes = Array.prototype.slice.call(document.querySelectorAll('div'));
        for (var i = 0; i < nodes.length; i++) {
          var text = nodes[i].textContent || '';
          if (text.indexOf('Centre H') !== -1 && text.indexOf('Centre V') !== -1 && text.length < 200) { return text; }
        }
        return '';
      })()
    `)) as string
    check('le bandeau indique un centrage horizontal correct', status.includes('Centre H ✓'), `-> ${status}`)
    check('le bandeau indique un centrage vertical correct', status.includes('Centre V ✓'), `-> ${status}`)
    check('aucun débordement signalé', !status.includes('Débordement'), `-> ${status}`)
    await page.screenshot({ path: join(SHOTS, '02-centre-deux-logos.png') as `${string}.png` })

    /* ---------------------------------------------------------------- */
    console.log('\n[5] Export PNG — analyse des pixels')
    const png = await exportOnce(page)
    check('le format exporté est PNG', png.mime === 'image/png', `-> ${png.mime}`)
    check('la résolution d’origine est conservée (1920x1080)', png.width === 1920 && png.height === 1080, `-> ${png.width}x${png.height}`)
    check('le fichier exporté est volumineux (> 5 Ko)', png.bytes > 5000, `-> ${png.bytes} o`)
    check('les logos sont bien présents', png.nonBlackCount > 500, `-> ${png.nonBlackCount} px`)
    check('le fond noir est conservé (4 coins noirs)', png.corners.every((c) => c === 0), `-> ${png.corners}`)
    check('aucun guide rose dans l’export', png.pinkPixels === 0, `-> ${png.pinkPixels} px`)

    // Sharpness. Measured on the exported pixels: a crisp render puts the
    // black->white transition on 1-2 px and leaves almost no intermediate grey.
    // Calibrated by forcing a 40 % thumbnail on import, which drops this to 0
    // transitions and a 206 px ramp (see the "qualité du logo" scenario).
    check(
      'les logos sont NETS (transition black→white ≤ 3 px)',
      png.maxEdgeRamp <= 3,
      `-> rampe max ${png.maxEdgeRamp} px, ${(png.greyRatio * 100).toFixed(2)} % de gris intermédiaires`,
    )
    console.log(
      `    -> netteté : rampe max ${png.maxEdgeRamp} px · ${(png.greyRatio * 100).toFixed(2)} % de gris intermédiaires · ${(png.bytes / 1024).toFixed(0)} Ko`,
    )

    check(
      `le GROUPE est centré horizontalement (centre = ${png.centerX})`,
      near(png.centerX, 960),
      `-> bbox ${png.minX}..${png.maxX}`,
    )
    check(
      `le GROUPE est centré verticalement (centre = ${png.centerY})`,
      near(png.centerY, 540),
      `-> bbox ${png.minY}..${png.maxY}`,
    )
    check('marge gauche == marge droite', near(png.minX, 1920 - 1 - png.maxX), `-> ${png.minX} / ${1920 - 1 - png.maxX}`)

    check(`2 logos détectés`, png.columnRuns.length === 2, `-> ${png.columnRuns.length} runs`)
    check(
      `l'espace entre les logos vaut exactement 40 px`,
      png.columnGaps.length === 1 && png.columnGaps[0] === 40,
      `-> ${png.columnGaps}`,
    )
    check(
      'les deux logos sont côte à côte (une seule bande verticale)',
      png.rowRuns.length === 1,
      `-> ${png.rowRuns.length}`,
    )
    check(
      'les logos ne se chevauchent pas',
      png.columnRuns[0].end < png.columnRuns[1].start,
      `-> ${JSON.stringify(png.columnRuns)}`,
    )
    // A uniform scale means the same multiplier, not the same height: the
    // natural heights differ, so the rendered heights differ proportionally.
    check(
      'chaque logo reçoit le MÊME facteur d’échelle',
      png.logoWidths.length === 2 &&
        near(
          png.logoWidths[0] / manifest['logo-alfia.png'].width,
          png.logoWidths[1] / manifest['logo-nexgegl.png'].width,
          0.01,
        ),
      `-> ${(png.logoWidths[0] / manifest['logo-alfia.png'].width).toFixed(3)} / ${(png.logoWidths[1] / manifest['logo-nexgegl.png'].width).toFixed(3)}`,
    )
    // The ink fills each logo canvas, so the measured ink ratio must equal the
    // natural ratio of the fixture: no distortion, whatever the uniform scale.
    png.logoWidths.forEach((measured, index) => {
      const fixture = [manifest['logo-alfia.png'], manifest['logo-nexgegl.png']][index]
      const expected = fixture.width / fixture.height
      const got = measured / png.logoBands[index].height
      check(
        `le ratio du logo ${index + 1} est préservé (${expected.toFixed(3)}:1)`,
        near(got, expected, 0.02),
        `-> ${got.toFixed(3)}:1`,
      )
    })
    console.log(
      `    -> bbox globale ${png.minX}..${png.maxX} x ${png.minY}..${png.maxY}, largeur groupe ${png.maxX - png.minX + 1} (${(((png.maxX - png.minX + 1) / 1920) * 100).toFixed(1)} % de l’image), logos ${png.logoWidths.join('/')} px`,
    )

    /* ---------------------------------------------------------------- */
    console.log('\n[6] Réglage de l’espacement (effet immédiat)')
    await setSlider(page, '#spacing', '150')
    await new Promise((resolve) => setTimeout(resolve, 700))
    const gap150 = await exportOnce(page)
    check(`l’espace passe à 150 px`, gap150.columnGaps.length === 1 && gap150.columnGaps[0] === 150, `-> ${gap150.columnGaps}`)
    check('le groupe reste centré après changement d’espacement', near(gap150.centerX, 960), `-> ${gap150.centerX}`)
    check('le groupe reste centré verticalement', near(gap150.centerY, 540), `-> ${gap150.centerY}`)
    check('la hauteur des logos est inchangée', gap150.rowRuns.length === 1 && near(gap150.rowRuns[0].height, png.rowRuns[0].height, 1), `-> ${gap150.rowRuns[0].height} vs ${png.rowRuns[0].height}`)

    // Back to 40
    await setSlider(page, '#spacing', '40')
    await new Promise((resolve) => setTimeout(resolve, 600))

    /* ---------------------------------------------------------------- */
    console.log('\n[7] Slider de taille (ratio conservé)')
    await setSlider(page, '#global-size', '150')
    await new Promise((resolve) => setTimeout(resolve, 700))
    const big = await exportOnce(page)
    check('la taille a augmenté de 50 %', big.rowRuns[0].height > png.rowRuns[0].height * 1.4, `-> ${big.rowRuns[0].height} vs ${png.rowRuns[0].height}`)
    check('le groupe reste centré après redimensionnement', near(big.centerX, 960) && near(big.centerY, 540), `-> ${big.centerX} / ${big.centerY}`)
    check('l’espace de 40 px est conservé', big.columnGaps[0] === 40, `-> ${big.columnGaps}`)
    const bigExpected = manifest['logo-alfia.png'].width / manifest['logo-alfia.png'].height
    const bigGot = big.logoWidths[0] / big.logoBands[0].height
    check(
      `le ratio largeur/hauteur d’ALFIA est conservé (${bigExpected.toFixed(3)}:1)`,
      near(bigGot, bigExpected, 0.02),
      `-> ${bigGot.toFixed(3)}:1`,
    )

    // Back to 100 %
    await setSlider(page, '#global-size', '100')
    await new Promise((resolve) => setTimeout(resolve, 600))

    /* ---------------------------------------------------------------- */
    console.log('\n[8] Limite de 3 logos')
    await upload(page, 1, [fixtures.petit])
    await page.waitForFunction('document.body.innerText.indexOf("Maximum de 3 logos") !== -1', { timeout: 20000 })
    await new Promise((resolve) => setTimeout(resolve, 900))
    const three = await exportOnce(page)
    check('3 logos exportés', three.columnRuns.length === 3, `-> ${three.columnRuns.length}`)
    check('le groupe de 3 logos est centré horizontalement', near(three.centerX, 960), `-> ${three.centerX}`)
    check('le groupe de 3 logos est centré verticalement', near(three.centerY, 540), `-> ${three.centerY}`)
    check('les deux espacements valent 40 px', three.columnGaps.length === 2 && three.columnGaps.every((g) => g === 40), `-> ${three.columnGaps}`)
    const threeFixtures = [manifest['logo-alfia.png'], manifest['logo-nexgegl.png'], manifest['logo-petit.png']]
    const threeFactors = threeFixtures.map((fixture, index) => three.logoWidths[index] / fixture.width)
    check(
      'les 3 logos ont EXACTEMENT le même facteur d’échelle (échelle unique)',
      threeFactors.length === 3 && near(threeFactors[0], threeFactors[1], 0.01) && near(threeFactors[1], threeFactors[2], 0.01),
      `-> ${threeFactors.map((f) => f.toFixed(3)).join(' / ')}`,
    )
    check('le groupe tient dans le cadre', three.minX >= 0 && three.maxX < 1920)
    check('le bouton d’ajout est désactivé', (await page.content()).includes('Limite de 3 logos'))
    await page.screenshot({ path: join(SHOTS, '03-trois-logos.png') as `${string}.png` })

    // A 4th file must be rejected.
    await upload(page, 1, [fixtures.alfia])
    await new Promise((resolve) => setTimeout(resolve, 700))
    const afterFourth = await exportOnce(page)
    check('un 4e logo est refusé', afterFourth.columnRuns.length === 3, `-> ${afterFourth.columnRuns.length}`)

    /* ---------------------------------------------------------------- */
    console.log('\n[9] Suppression d’un logo')
    await page.evaluate(snippetClickSelector('button[title="Supprimer ce logo"]'))
    await new Promise((resolve) => setTimeout(resolve, 900))
    const afterDelete = await exportOnce(page)
    check('il reste 2 logos', afterDelete.columnRuns.length === 2, `-> ${afterDelete.columnRuns.length}`)
    check('le groupe restant est recentré', near(afterDelete.centerX, 960) && near(afterDelete.centerY, 540), `-> ${afterDelete.centerX} / ${afterDelete.centerY}`)

    /* ---------------------------------------------------------------- */
    console.log('\n[10] Export JPG (fond blanc, pas de transparence)')
    await page.evaluate(snippetClickText(['JPG'], true))
    await new Promise((resolve) => setTimeout(resolve, 400))
    const jpg = await exportOnce(page)
    check('le format exporté est JPEG', jpg.mime === 'image/jpeg', `-> ${jpg.mime}`)
    check('la résolution est conservée', jpg.width === 1920 && jpg.height === 1080, `-> ${jpg.width}x${jpg.height}`)
    check('le JPG est opaque', jpg.hasAlpha === false)
    check('le groupe est centré', near(jpg.centerX, 960) && near(jpg.centerY, 540), `-> ${jpg.centerX} / ${jpg.centerY}`)
    check('les logos sont visibles sur fond blanc', jpg.nonBlackCount > 500, `-> ${jpg.nonBlackCount}`)

    /* ---------------------------------------------------------------- */
    console.log('\n[11] Téléchargement réel (nom de fichier)')
    const downloadNames = (await page.evaluate('window.__name')) as string
    check('le nom du fichier téléchargé est correct', /\.jpg$/.test(downloadNames), `-> ${downloadNames}`)

    /* ---------------------------------------------------------------- */
    console.log('\n[12] Déplacement d’un logo à la souris + annulation')
    // The canvas rect must be read AFTER the last export, because an export
    // briefly resizes the canvas element and can move the page.
    const before = await exportOnce(page)
    const canvasBox = (await page.evaluate(`
      (function () {
        var rect = document.querySelector('canvas.upper-canvas').getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })()
    `)) as { x: number; y: number; width: number; height: number }

    // Select the first logo by clicking on the middle of its ink.
    const firstRun = before.columnRuns[0]
    const firstBand = before.logoBands[0]
    const logoCenterScreen = {
      x: canvasBox.x + ((firstRun.start + firstRun.end) / 2 / 1920) * canvasBox.width,
      y: canvasBox.y + (((firstBand.top + firstBand.bottom) / 2) / 1080) * canvasBox.height,
    }
    await page.mouse.click(logoCenterScreen.x, logoCenterScreen.y)
    await new Promise((resolve) => setTimeout(resolve, 300))
    const sizesBefore = await listedLogoSizes(page)
    await page.mouse.move(logoCenterScreen.x, logoCenterScreen.y)
    await page.mouse.down()
    // Horizontal drag only: a diagonal move would overlap the two logos and the
    // ink bands could no longer be attributed to one logo.
    await page.mouse.move(logoCenterScreen.x + 120, logoCenterScreen.y, { steps: 12 })
    await page.mouse.up()
    await new Promise((resolve) => setTimeout(resolve, 700))

    const moved = await exportOnce(page)
    const sizesAfter = await listedLogoSizes(page)
    check(
      'le déplacement souris modifie la position',
      moved.minX !== before.minX,
      `-> minX ${before.minX} => ${moved.minX}`,
    )
    check(
      'un déplacement horizontal ne change pas la position verticale',
      near(moved.minY, before.minY, 1),
      `-> minY ${before.minY} => ${moved.minY}`,
    )
    // The logo keeps its exact size: only its position changed. The size is read
    // from the panel, because a drag may make two logos overlap and the ink
    // bands would then no longer belong to a single logo.
    check(
      'le déplacement ne change pas la taille des logos',
      sizesBefore.length > 0 && sizesBefore.join('|') === sizesAfter.join('|'),
      `-> ${sizesBefore.join(' | ')}  =>  ${sizesAfter.join(' | ')}`,
    )

    // Undo
    await page.evaluate(snippetClickSelector('button[aria-label="Annuler"]'))
    await new Promise((resolve) => setTimeout(resolve, 800))
    const undone = await exportOnce(page)
    check('l’annulation restaure la position précédente', near(undone.minX, before.minX, 1) && near(undone.minY, before.minY, 1), `-> ${undone.minX},${undone.minY} vs ${before.minX},${before.minY}`)

    // Redo
    await page.evaluate(snippetClickSelector('button[aria-label="Rétablir"]'))
    await new Promise((resolve) => setTimeout(resolve, 800))
    const redone = await exportOnce(page)
    check('le rétablissement rejoue le déplacement', near(redone.minX, moved.minX, 1), `-> ${redone.minX} vs ${moved.minX}`)

    /* ---------------------------------------------------------------- */
    console.log('\n[13] Recentrage après déplacement')
    await page.evaluate(snippetClickText(['Tout centrer']))
    await new Promise((resolve) => setTimeout(resolve, 800))
    const recentred = await exportOnce(page)
    check('le bouton « Tout centrer » recentre le groupe', near(recentred.centerX, 960) && near(recentred.centerY, 540), `-> ${recentred.centerX} / ${recentred.centerY}`)
    check('l’espace de 40 px est rétabli', recentred.columnGaps[0] === 40, `-> ${recentred.columnGaps}`)

    // Every toolbar action must be undoable, not only a mouse drag.
    console.log('\n[13b] Annulation des actions de la barre d’outils')
    await page.evaluate(snippetClickText(['Bord droit']))
    await new Promise((resolve) => setTimeout(resolve, 800))
    const aligned = await exportOnce(page)
    check(
      '« Bord droit » colle le groupe au bord droit',
      Math.abs(aligned.maxX - (1920 - 1 - recentred.maxX)) >= 3,
      `-> maxX ${recentred.maxX} => ${aligned.maxX}`,
    )

    await page.evaluate(snippetClickSelector('button[aria-label="Annuler"]'))
    await new Promise((resolve) => setTimeout(resolve, 800))
    const undoneAlign = await exportOnce(page)
    check(
      'l’annulation restaure la position d’avant « Bord droit »',
      near(undoneAlign.minX, recentred.minX, 1) && near(undoneAlign.centerX, 960),
      `-> ${undoneAlign.minX} vs ${recentred.minX}`,
    )

    await page.evaluate(snippetClickText(['Centrer H']))
    await new Promise((resolve) => setTimeout(resolve, 700))
    const centreH = await exportOnce(page)
    check('« Centrer H » garde le groupe centré horizontalement', near(centreH.centerX, 960), `-> ${centreH.centerX}`)
    await page.evaluate(snippetClickSelector('button[aria-label="Annuler"]'))
    await new Promise((resolve) => setTimeout(resolve, 800))
    const undoneH = await exportOnce(page)
    check('« Centrer H » est annulable', near(undoneH.minX, recentred.minX, 1), `-> ${undoneH.minX} vs ${recentred.minX}`)
    await page.evaluate(snippetClickText(['Tout centrer']))
    await new Promise((resolve) => setTimeout(resolve, 600))

    /* ---------------------------------------------------------------- */
    console.log('\n[14] Formats invalides et erreurs')
    await page.evaluate(`
      (function () {
        var input = document.querySelectorAll('input[type=file]')[0];
        var file = new File(['not an image'], 'bidon.txt', { type: 'text/plain' });
        var transfer = new DataTransfer();
        transfer.items.add(file);
        input.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
      })()
    `)
    await new Promise((resolve) => setTimeout(resolve, 600))
    const errorText = (await page.evaluate('document.body.innerText')) as string
    check('un message d’erreur clair est affiché', /non pris en charge|Format non pris en charge/i.test(errorText), '-> aucun message')
    await page.screenshot({ path: join(SHOTS, '04-final.png') as `${string}.png` })

    /* ---------------------------------------------------------------- */
    console.log('\n[15] Responsive mobile (390x844)')
    await page.setViewport({ width: 390, height: 844 })
    await new Promise((resolve) => setTimeout(resolve, 900))
    const mobile = (await page.evaluate(`
      (function () {
        var grid = document.querySelector('main .grid');
        if (!grid) { return null; }
        var style = getComputedStyle(grid);
        return {
          columns: style.gridTemplateColumns,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth
        };
      })()
    `)) as { columns: string; scrollWidth: number; clientWidth: number } | null
    check('la mise en page passe en colonne unique', mobile !== null && mobile.columns.split(' ').length === 1, `-> ${JSON.stringify(mobile)}`)
    check('pas de débordement horizontal', mobile !== null && mobile.scrollWidth <= mobile.clientWidth + 2, `-> ${JSON.stringify(mobile)}`)
    await page.screenshot({ path: join(SHOTS, '05-mobile.png') as `${string}.png`, fullPage: true })

    await page.setViewport({ width: 1600, height: 1000 })
    await new Promise((resolve) => setTimeout(resolve, 500))

    /* ---------------------------------------------------------------- */
    /* ---------------------------------------------------------------- */
    console.log('\n[16] Export haute résolution — vérification du FICHIER sur disque')
    // The 16 and 17 scenarios below verify the bytes that were actually
    // downloaded, read back by Node with no browser involved. This first pass
    // checks the required 2048x2048 case end to end.
    {
      await page.goto(URL, { waitUntil: 'networkidle0' })
      await new Promise((resolve) => setTimeout(resolve, 400))
      await upload(page, 0, [fixtures.frameSquare])
      await page.waitForSelector('canvas.upper-canvas', { timeout: 20000 })
      await upload(page, 1, [fixtures.alfia, fixtures.nexgegl])
      await page.waitForFunction(
        '/alfia/i.test(document.body.innerText) && /nexgegl/i.test(document.body.innerText)',
        { timeout: 20000 },
      )
      await new Promise((resolve) => setTimeout(resolve, 900))
      await page.evaluate(snippetClickText(['Tout centrer']))
      await new Promise((resolve) => setTimeout(resolve, 700))

      const png = await exportOnce(page, downloadDir)
      check(
        '[2048x2048] le FICHIER téléchargé fait bien 2048x2048 (lu sur disque)',
        png.savedTo !== undefined &&
          (() => {
            const d = readFileDimensions(png.savedTo as string)
            return d.width === 2048 && d.height === 2048
          })(),
        png.savedTo ? `-> ${readFileDimensions(png.savedTo).width}x${readFileDimensions(png.savedTo).height} (${png.savedName})` : '-> non enregistré',
      )
      check(
        '[2048x2048] le nom de fichier se termine par .png',
        /\.png$/.test(png.savedName ?? ''),
        `-> ${png.savedName}`,
      )
      const displayW = (await page.evaluate(
        "document.querySelector('canvas.lower-canvas').width",
      )) as number
      console.log(
        `    -> canvas d’AFFICHAGE ${displayW} px · FICHIER ${readFileDimensions(png.savedTo as string).width}x${readFileDimensions(png.savedTo as string).height} · logos ${png.logoWidths.join('/')} px · rampe ${png.maxEdgeRamp} px`,
      )
    }

    console.log('\n[16b] Export haute résolution — 2048x2048 puis 4000x3000')
    // The whole point of the export: the preview is displayed at whatever size
    // the layout allows, but the downloaded file must keep the exact
    // resolution of the imported image.
    for (const highRes of [
      { frame: fixtures.frameSquare, width: 2048, height: 2048, label: '2048x2048' },
      { frame: fixtures.frameLarge, width: 4000, height: 3000, label: '4000x3000' },
    ]) {
      await page.goto(URL, { waitUntil: 'networkidle0' })
      await new Promise((resolve) => setTimeout(resolve, 400))
      await upload(page, 0, [highRes.frame])
      await page.waitForSelector('canvas.upper-canvas', { timeout: 20000 })
      await upload(page, 1, [fixtures.alfia, fixtures.nexgegl])
      await page.waitForFunction(
        '/alfia/i.test(document.body.innerText) && /nexgegl/i.test(document.body.innerText)',
        { timeout: 20000 },
      )
      await new Promise((resolve) => setTimeout(resolve, 900))
      // "Centrer automatiquement" before exporting, as a user would.
      await page.evaluate(snippetClickText(['Tout centrer']))
      await new Promise((resolve) => setTimeout(resolve, 700))

      // The displayed canvas is much smaller than the source image: that is
      // exactly the case where a naive implementation would export the preview.
      const displayed = (await page.evaluate(`
        (function () {
          var el = document.querySelector('canvas.lower-canvas');
          if (!el) { return null; }
          return { width: el.width, height: el.height, cssWidth: el.getBoundingClientRect().width };
        })()
      `)) as { width: number; height: number; cssWidth: number } | null
      check(
        `[${highRes.label}] le canvas d’AFFICHAGE est plus petit que l’image`,
        displayed !== null && displayed.width < highRes.width,
        `-> canvas ${displayed?.width}x${displayed?.height} (affiché ${displayed?.cssWidth.toFixed(0)} px de large)`,
      )

      for (const format of ['png', 'jpg'] as const) {
        const wantJpeg = format === 'jpg'
        await page.evaluate(snippetClickText([wantJpeg ? 'JPG' : 'PNG'], true))
        await new Promise((resolve) => setTimeout(resolve, 400))
        const out = await exportOnce(page)
        const kind = wantJpeg ? 'JPG' : 'PNG'
        check(
          `[${highRes.label}] ${kind} : la résolution d’origine est conservée`,
          out.width === highRes.width && out.height === highRes.height,
          `-> ${out.width}x${out.height} (attendu ${highRes.width}x${highRes.height})`,
        )
        check(
          `[${highRes.label}] ${kind} : le ratio de l’image est préservé`,
          near(out.width / out.height, highRes.width / highRes.height, 0.0005),
          `-> ${(out.width / out.height).toFixed(4)}`,
        )
        check(
          `[${highRes.label}] ${kind} : les logos sont suffisamment grands (≥ 10 % de la largeur)`,
          out.logoWidths.length === 2 && out.logoWidths.every((w) => w > highRes.width * 0.1),
          `-> largeurs ${out.logoWidths.join(' / ')} px sur ${highRes.width}`,
        )
        check(
          `[${highRes.label}] ${kind} : le groupe est centré`,
          near(out.centerX, (highRes.width - 1) / 2, 1) && near(out.centerY, (highRes.height - 1) / 2, 1),
          `-> centre ${out.centerX} / ${out.centerY} (attendu ${(highRes.width - 1) / 2} / ${(highRes.height - 1) / 2})`,
        )
        check(
          `[${highRes.label}] ${kind} : l’espace de 40 px (en pixels d’image) est respecté`,
          out.columnGaps.length === 1 && out.columnGaps[0] === 40,
          `-> ${out.columnGaps}`,
        )
        check(
          `[${highRes.label}] ${kind} : le groupe occupe 62 % de la largeur`,
          near(
            out.maxX - out.minX + 1,
            highRes.width * 0.62,
            highRes.width * 0.005,
          ),
          `-> ${out.maxX - out.minX + 1} px sur ${highRes.width}`,
        )
        check(
          `[${highRes.label}] ${kind} : les logos sont NETS (rampe ≤ 3 px)`,
          out.maxEdgeRamp <= 3,
          `-> rampe max ${out.maxEdgeRamp} px, ${(out.greyRatio * 100).toFixed(2)} % de gris`,
        )
        check(
          `[${highRes.label}] ${kind} : les logos ne sont pas déformés (même facteur d’échelle)`,
          out.logoWidths.length === 2 &&
            near(
              out.logoWidths[0] / manifest['logo-alfia.png'].width,
              out.logoWidths[1] / manifest['logo-nexgegl.png'].width,
              0.01,
            ),
          `-> ${out.logoWidths.map((w, i) => (w / (i === 0 ? manifest['logo-alfia.png'].width : manifest['logo-nexgegl.png'].width)).toFixed(3)).join(' / ')}`,
        )
        console.log(
          `    -> ${highRes.label} ${kind} : ${out.width}x${out.height}, logos ${out.logoWidths.join('/')} px, rampe ${out.maxEdgeRamp} px, ${(out.bytes / 1024).toFixed(0)} Ko`,
        )
      }
    }
    await page.screenshot({ path: join(SHOTS, '06-haute-resolution.png') as `${string}.png` })

    /* ---------------------------------------------------------------- */
    console.log('\n[17] Qualité du logo : la source originale est-elle utilisée ?')
    // ALFIA + a logo made of 2px stripes, on a 2048x2048 frame shown in a much
    // smaller box. Rasterising the stripes at the display zoom (0.4) would
    // average them into flat grey, so the transitions measured in the export
    // prove the original bitmap was read instead of a thumbnail.
    await page.goto(URL, { waitUntil: 'networkidle0' })
    await new Promise((resolve) => setTimeout(resolve, 400))
    await upload(page, 0, [fixtures.frameSquare])
    await page.waitForSelector('canvas.upper-canvas', { timeout: 20000 })
    await upload(page, 1, [fixtures.alfia, fixtures.fins])
    await page.waitForFunction(
      '/alfia/i.test(document.body.innerText) && /logo-fins/i.test(document.body.innerText)',
      { timeout: 20000 },
    )
    await new Promise((resolve) => setTimeout(resolve, 900))
    await page.evaluate(snippetClickText(['Tout centrer']))
    await new Promise((resolve) => setTimeout(resolve, 700))

    // Fabric sizes the displayed canvas to `imageWidth * zoom`, so the ratio
    // gives the display zoom without touching the app.
    const displayWidth = (await page.evaluate(`
      (function () {
        var el = document.querySelector('canvas.lower-canvas');
        return el ? el.width : 0;
      })()
    `)) as number
    const zoom = displayWidth / 2048
    check(
      'le canvas est bien affiché en dessous de 100 % (le test est discriminant)',
      zoom > 0 && zoom < 0.9,
      `-> zoom ${zoom.toFixed(3)} (canvas ${displayWidth} px de large)`,
    )

    const finsPng = await exportOnce(page, downloadDir)
    check(
      'la résolution est bien 2048x2048',
      finsPng.width === 2048 && finsPng.height === 2048,
      `-> ${finsPng.width}x${finsPng.height}`,
    )
    check(
      'le FICHIER sur disque fait bien 2048x2048',
      finsPng.savedTo !== undefined &&
        (() => {
          const d = readFileDimensions(finsPng.savedTo as string)
          return d.width === 2048 && d.height === 2048
        })(),
      finsPng.savedTo
        ? `-> ${readFileDimensions(finsPng.savedTo).width}x${readFileDimensions(finsPng.savedTo).height}`
        : '-> non enregistré',
    )
    // The striped logo is the rightmost one. Its stripes have a period of 4px
    // in the source, so its rendered width holds about width/4 stripes, each
    // contributing two transitions.
    const finsIndex = finsPng.columnRuns.length - 1
    const finsWidth = finsPng.logoWidths[finsIndex] ?? 0
    const measured = finsPng.transitions[finsIndex] ?? 0
    const expected = Math.floor(finsWidth / 4) * 2
    check(
      'les détails fins du logo sont conservés (source originale, pas de miniature)',
      measured >= expected * 0.6,
      `-> ${measured} transitions mesurées pour ~${expected} attendues (logo de ${finsWidth} px de large)`,
    )
    console.log(
      `    -> logo à fines rayures : ${measured} transitions (attendu ~${expected}) · zoom d’affichage ${zoom.toFixed(3)} · rampe ${finsPng.maxEdgeRamp} px · ${(finsPng.greyRatio * 100).toFixed(2)} % gris`,
    )

    /* ---------------------------------------------------------------- */
    console.log('\n[18] Cas réel : photo détaillée + logo 2000x500, sur disque')
    // A noisy frame hides nothing: any blur, resampling or wrong scaling shows
    // up. The logo is bigger than the space it is given, so it must be scaled
    // DOWN cleanly rather than cropped or re-sampled from a thumbnail.
    await page.goto(URL, { waitUntil: 'networkidle0' })
    await new Promise((resolve) => setTimeout(resolve, 400))
    await upload(page, 0, [fixtures.frameDetail])
    await page.waitForSelector('canvas.upper-canvas', { timeout: 20000 })
    await upload(page, 1, [fixtures.alfia, fixtures.hires])
    await page.waitForFunction(
      '/alfia/i.test(document.body.innerText) && /logo-hires/i.test(document.body.innerText)',
      { timeout: 20000 },
    )
    await new Promise((resolve) => setTimeout(resolve, 900))
    await page.evaluate(snippetClickText(['Tout centrer']))
    await new Promise((resolve) => setTimeout(resolve, 700))

    const hiresPng = await exportOnce(page, downloadDir)
    const hiresDisk = hiresPng.savedTo ? readFileDimensions(hiresPng.savedTo) : null
    check(
      'le FICHIER fait 1920x1080 (photo détaillée)',
      hiresDisk !== null && hiresDisk.width === 1920 && hiresDisk.height === 1080,
      `-> ${hiresDisk ? `${hiresDisk.width}x${hiresDisk.height}` : 'non enregistré'}`,
    )
    check(
      'le logo 2000x500 a été réduit proprement (dépassement d’un côté, pas de rognage)',
      hiresPng.logoWidths.length === 2 &&
        hiresPng.logoWidths.every((w) => w > 100 && w < 1920 * 0.62),
      `-> largeurs ${hiresPng.logoWidths.join(' / ')} px`,
    )
    check(
      'le groupe reste centré',
      near(hiresPng.centerX, 959.5, 1) && near(hiresPng.centerY, 539.5, 1),
      `-> centre ${hiresPng.centerX} / ${hiresPng.centerY}`,
    )
    check(
      'le logo réduit garde ses détails (transitions nettes)',
      hiresPng.transitions.some((t) => t > 20),
      `-> transitions ${hiresPng.transitions.join(' / ')}`,
    )
    await page.screenshot({ path: join(SHOTS, '07-photo-detaillee.png') as `${string}.png` })

    /* ---------------------------------------------------------------- */
    console.log('\n[19] Écran retina / devicePixelRatio = 2')
    // The export must not depend on the screen at all: a retina display
    // doubles the preview canvas but must leave the file untouched.
    const page2 = await browser.newPage()
    await page2.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 })
    await page2.goto(URL, { waitUntil: 'networkidle0' })
    await new Promise((resolve) => setTimeout(resolve, 600))
    await upload(page2, 0, [fixtures.frameSquare])
    await page2.waitForSelector('canvas.upper-canvas', { timeout: 20000 })
    await upload(page2, 1, [fixtures.alfia, fixtures.nexgegl])
    await page2.waitForFunction(
      '/alfia/i.test(document.body.innerText) && /nexgegl/i.test(document.body.innerText)',
      { timeout: 20000 },
    )
    await new Promise((resolve) => setTimeout(resolve, 900))
    await page2.evaluate(snippetClickText(['Tout centrer']))
    await new Promise((resolve) => setTimeout(resolve, 700))
    const dpr = (await page2.evaluate('window.devicePixelRatio')) as number
    const retinaCanvas = (await page2.evaluate(
      "document.querySelector('canvas.lower-canvas').width",
    )) as number
    const retina = await exportOnce(page2, downloadDir)
    const retinaDisk = retina.savedTo ? readFileDimensions(retina.savedTo) : null
    check('le navigateur est bien en devicePixelRatio = 2', dpr === 2, `-> ${dpr}`)
    check(
      'le canvas d’AFFICHAGE est bien plus grand qu’en DPR 1',
      retinaCanvas > displayWidth,
      `-> ${retinaCanvas} px contre ${displayWidth} px en DPR 1`,
    )
    check(
      'le FICHIER fait TOUJOURS 2048x2048 malgré le DPR = 2',
      retinaDisk !== null && retinaDisk.width === 2048 && retinaDisk.height === 2048,
      `-> ${retinaDisk ? `${retinaDisk.width}x${retinaDisk.height}` : 'non enregistré'}`,
    )
    console.log(
      `    -> DPR 2 : canvas ${retinaCanvas} px → fichier ${retinaDisk ? `${retinaDisk.width}x${retinaDisk.height}` : '?'} (identique au DPR 1)`,
    )
    await page2.close()

    /* ---------------------------------------------------------------- */
    console.log('\n[20] Taille de sortie choisie à la main (×2 puis largeur libre)')
    // Small sources are legitimate (a 212×148 web banner, for instance). The
    // 1:1 export is then genuinely small, so the user must be able to ask for a
    // larger FILE. This checks the manual control end to end, on disk.
    const page3 = await browser.newPage()
    await page3.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 })
    await page3.goto(URL, { waitUntil: 'networkidle0' })
    await new Promise((resolve) => setTimeout(resolve, 600))
    await upload(page3, 0, [fixtures.frameSquare])
    await page3.waitForSelector('canvas.upper-canvas', { timeout: 20000 })
    await upload(page3, 1, [fixtures.alfia, fixtures.nexgegl])
    await page3.waitForFunction(
      '/alfia/i.test(document.body.innerText) && /nexgegl/i.test(document.body.innerText)',
      { timeout: 20000 },
    )
    await new Promise((resolve) => setTimeout(resolve, 900))
    await page3.evaluate(snippetClickText(['Tout centrer']))
    await new Promise((resolve) => setTimeout(resolve, 700))

    const sizeControls = await page3.evaluate(`
      (function () {
        return {
          presets: Array.prototype.map.call(
            document.querySelectorAll('button'),
            function (b) { return (b.textContent || '').trim() }
          ).filter(function (t) { return /^(Original|×[0-9]+)$/.test(t) }),
          width: document.querySelector('input[type=number]') ? true : false
        };
      })()
    `)
    check(
      'les boutons de taille (Original / ×2 / ×3 / ×4) sont présents',
      Array.isArray(sizeControls.presets) &&
        sizeControls.presets.length >= 4 &&
        sizeControls.presets.includes('Original') &&
        sizeControls.presets.includes('×2'),
      `-> ${JSON.stringify(sizeControls.presets)}`,
    )
    check('un champ de largeur en pixels est disponible', sizeControls.width === true)

    const doubled = await page3.evaluate(snippetClickText(['×2'], true))
    check('le bouton ×2 est cliquable', doubled === '×2', `-> clic sur ${JSON.stringify(doubled)}`)
    await new Promise((resolve) => setTimeout(resolve, 400))
    const panelText = await page3.evaluate('document.body.innerText')
    const warningShown = panelText.includes('agrandie de') && panelText.includes('détails')
    check(
      'l’avertissement « image agrandie » est affiché',
      warningShown,
      warningShown
        ? '-> « Image agrandie de ×2 : … les détails restent ceux de l’image d’origine »'
        : `-> absent (panneau : ${JSON.stringify(panelText.slice(-260))})`,
    )

    const twice = await exportOnce(page3, downloadDir)
    const twiceDisk = twice.savedTo ? readFileDimensions(twice.savedTo) : null
    check(
      'le FICHIER fait 4096x4096 en ×2 (2048 × 2)',
      twiceDisk !== null && twiceDisk.width === 4096 && twiceDisk.height === 4096,
      `-> ${twiceDisk ? `${twiceDisk.width}x${twiceDisk.height}` : 'non enregistré'}`,
    )
    check(
      'la mise en page est inchangée : le groupe reste centré dans le fichier agrandi',
      near(twice.centerX, 2048, 2) && near(twice.centerY, 2048, 2),
      `-> centre ${twice.centerX} / ${twice.centerY} (attendu 2048 / 2048)`,
    )

    // A free width, not a multiple: the aspect ratio of the source must hold.
    await page3.evaluate(`
      (function () {
        var input = document.querySelector('input[type=number]');
        var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, '1000');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()
    `)
    await new Promise((resolve) => setTimeout(resolve, 300))
    const custom = await exportOnce(page3, downloadDir)
    const customDisk = custom.savedTo ? readFileDimensions(custom.savedTo) : null
    check(
      'une largeur libre de 1000 px donne un fichier 1000x1000',
      customDisk !== null && customDisk.width === 1000 && customDisk.height === 1000,
      `-> ${customDisk ? `${customDisk.width}x${customDisk.height}` : 'non enregistré'}`,
    )
    check(
      'le groupe reste centré à 1000 px',
      near(custom.centerX, 500, 2) && near(custom.centerY, 500, 2),
      `-> centre ${custom.centerX} / ${custom.centerY} (attendu 500 / 500)`,
    )
    console.log(
      `    -> ×2 : ${twice.logoWidths.join(' / ')} px · largeur libre : ${custom.logoWidths.join(' / ')} px`,
    )
    await page3.screenshot({ path: join(SHOTS, '08-taille-manuelle.png') as `${string}.png` })
    await page3.close()

    /* ---------------------------------------------------------------- */
    console.log('\n[21] Aucune erreur JavaScript')
    const relevant = consoleErrors.filter((e) => !/favicon|404|Failed to load resource/i.test(e))
    check('aucune erreur console', relevant.length === 0, `-> ${relevant.slice(0, 5).join(' | ')}`)

    const files = existsSync(downloadDir) ? readdirSync(downloadDir) : []
    console.log(`\n    -> fichiers exportés écrits sur disque : ${files.length}`)
    for (const file of files) {
      const d = readFileDimensions(join(downloadDir, file))
      console.log(`       ${file}  →  ${d.width} × ${d.height} (${d.format})`)
    }
  } finally {
    await browser?.close()
    server.kill()
    if (process.env.KEEP_DOWNLOADS !== '1') {
      try {
        rmSync(downloadDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    } else {
      console.log(`\n    -> fichiers conservés dans : ${downloadDir}`)
    }
  }

  console.log(`\n${failures === 0 ? 'E2E : TOUS LES TESTS PASSENT' : `E2E : ${failures} TEST(S) EN ECHEC`}\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('\nE2E : ERREUR FATALE\n', error)
  process.exit(1)
})
