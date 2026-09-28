/**
 * Headless verification of the centring maths.
 * Run with:  npx tsx scripts/verify-centering.ts
 */

import {
  boundsOf,
  centerGroup,
  computeUniformAutoScale,
  distributeHorizontal,
  groupFitFactor,
  groupWidth,
  layoutGroup,
  shrinkToFit,
} from '../src/utils/centering'
import type { Box, CenterMode, FrameSize } from '../src/utils/types'

let failures = 0

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL  ${label} ${detail}`)
  }
}

function near(a: number, b: number, epsilon = 1e-6) {
  return Math.abs(a - b) <= epsilon
}

const box = (id: string, left: number, top: number, width: number, height: number): Box => ({
  id,
  left,
  top,
  width,
  height,
})

/* -------------------------------------------------------------------------- */
/* 1. The reference case: black 1920x1080 + two equal wordmark logos           */
/* -------------------------------------------------------------------------- */
console.log('\n[1] Fond noir 1920x1080 + ALFIA (600x120) + NEXGEGL (520x120), gap 40')
{
  const frame: FrameSize = { width: 1920, height: 1080 }
  const logos = [box('alfia', 0, 0, 600, 120), box('nexgegl', 0, 0, 520, 120)]
  const gap = 40
  const laid = centerGroup(logos, gap, frame)

  const total = groupWidth(laid, gap)
  check('largeur du groupe = 600 + 40 + 520 = 1160', near(total, 1160), `-> ${total}`)
  check('x de départ = (1920 - 1160) / 2 = 380', near(laid[0].left, 380), `-> ${laid[0].left}`)
  check('x du 2e logo = 380 + 600 + 40 = 1020', near(laid[1].left, 1020), `-> ${laid[1].left}`)
  check('y du 1er logo = (1080 - 120) / 2 = 480', near(laid[0].top, 480), `-> ${laid[0].top}`)
  check('y du 2e logo = 480', near(laid[1].top, 480), `-> ${laid[1].top}`)

  const bounds = boundsOf(laid)
  check('centre X du groupe = 960 (= centre image)', near(bounds.centerX, 960), `-> ${bounds.centerX}`)
  check('centre Y du groupe = 540 (= centre image)', near(bounds.centerY, 540), `-> ${bounds.centerY}`)
  check('bord droit du groupe = 1540', near(laid[1].left + laid[1].width, 1540))
  check('marge gauche == marge droite', near(laid[0].left, 1920 - (laid[1].left + laid[1].width)))
  check('espace réel entre les logos = 40', near(laid[1].left - (laid[0].left + laid[0].width), gap))
  check('logos alignés verticalement', near(laid[0].top, laid[1].top))
}

/* -------------------------------------------------------------------------- */
/* 2. Three logos, very different sizes (the "PETIT / GRAND / PETIT" case)      */
/* -------------------------------------------------------------------------- */
console.log('\n[2] 3 logos de tailles très différentes (200x60, 900x300, 150x400), gap 60')
{
  const frame: FrameSize = { width: 1600, height: 1200 }
  const gap = 60
  const logos = [box('a', 0, 0, 200, 60), box('b', 0, 0, 900, 300), box('c', 0, 0, 150, 400)]
  const laid = centerGroup(logos, gap, frame)
  const bounds = boundsOf(laid)

  check('centre X du groupe == centre image', near(bounds.centerX, 800), `-> ${bounds.centerX}`)
  check('centre Y du groupe == centre image', near(bounds.centerY, 600), `-> ${bounds.centerY}`)

  const gaps = [
    laid[1].left - (laid[0].left + laid[0].width),
    laid[2].left - (laid[1].left + laid[1].width),
  ]
  check('espacements réguliers (60 et 60)', near(gaps[0], gap) && near(gaps[1], gap), `-> ${gaps}`)
  check('aucun chevauchement', gaps.every((g) => g > 0))

  // Every logo shares the same vertical centre line => visual alignment.
  const centers = laid.map((b) => b.top + b.height / 2)
  check(
    'les 3 logos partagent le même axe vertical',
    centers.every((c) => near(c, 600, 1e-9)),
    `-> ${centers}`,
  )
  check('largeur totale = 200+60+900+60+150 = 1370', near(groupWidth(laid, gap), 1370))
  check('x de départ = (1600-1370)/2 = 115', near(laid[0].left, 115), `-> ${laid[0].left}`)
}

/* -------------------------------------------------------------------------- */
/* 3. Odd frame + single logo                                                 */
/* -------------------------------------------------------------------------- */
console.log('\n[3] Logo unique sur une image impaire 1001x667')
{
  const frame: FrameSize = { width: 1001, height: 667 }
  const laid = centerGroup([box('only', 10, 10, 300, 200)], 40, frame)
  check('x = (1001-300)/2 = 350.5', near(laid[0].left, 350.5), `-> ${laid[0].left}`)
  check('y = (667-200)/2 = 233.5', near(laid[0].top, 233.5), `-> ${laid[0].top}`)
}

/* -------------------------------------------------------------------------- */
/* 4. Every centring mode                                                    */
/* -------------------------------------------------------------------------- */
console.log('\n[4] Modes de centrage intelligent (3 logos, 1400x900, gap 50)')
{
  const frame: FrameSize = { width: 1400, height: 900 }
  const gap = 50
  const logos = [box('a', 10, 20, 200, 100), box('b', 500, 700, 300, 150), box('c', 900, 300, 250, 80)]

  const modes: CenterMode[] = ['both', 'horizontal', 'vertical', 'alignHorizontal', 'alignVertical']

  for (const mode of modes) {
    const laid = layoutGroup(logos, gap, frame, mode)
    const bounds = boundsOf(laid)
    const label = `[${mode}]`

    if (mode === 'both') {
      check(`${label} centre X == 700`, near(bounds.centerX, 700), `-> ${bounds.centerX}`)
      check(`${label} centre Y == 450`, near(bounds.centerY, 450), `-> ${bounds.centerY}`)
    }
    if (mode === 'horizontal') {
      check(`${label} centre X == 700`, near(bounds.centerX, 700), `-> ${bounds.centerX}`)
      check(`${label} Y inchangé (20)`, near(laid[0].top, 20), `-> ${laid[0].top}`)
    }
    if (mode === 'vertical') {
      check(`${label} centre Y == 450`, near(bounds.centerY, 450), `-> ${bounds.centerY}`)
      check(`${label} X inchangé (10)`, near(laid[0].left, 10), `-> ${laid[0].left}`)
    }
    if (mode === 'alignHorizontal') {
      check(`${label} centre X == 700`, near(bounds.centerX, 700), `-> ${bounds.centerX}`)
      const centers = laid.map((b) => b.top + b.height / 2)
      check(`${label} axe vertical commun`, new Set(centers.map((c) => c.toFixed(6))).size === 1, `-> ${centers}`)
      check(`${label} centre vertical conservé`, near(bounds.centerY, boundsOf(logos).centerY))
    }
    if (mode === 'alignVertical') {
      check(`${label} centre X == 700`, near(bounds.centerX, 700), `-> ${bounds.centerX}`)
      check(`${label} centre Y == 450`, near(bounds.centerY, 450), `-> ${bounds.centerY}`)
      const gapsY = [
        laid[1].top - (laid[0].top + laid[0].height),
        laid[2].top - (laid[1].top + laid[1].height),
      ]
      check(`${label} colonne espacée régulièrement`, gapsY.every((g) => near(g, gap)), `-> ${gapsY}`)
      const centersX = laid.map((b) => b.left + b.width / 2)
      check(`${label} axe horizontal commun`, new Set(centersX.map((c) => c.toFixed(6))).size === 1)
    }
    check(`${label} proportions et tailles inchangées`, laid.every((l, i) => l.width === logos[i].width && l.height === logos[i].height))
  }
}

/* -------------------------------------------------------------------------- */
/* 5. Automatic sizing: ONE uniform scale => equal optical height              */
/* -------------------------------------------------------------------------- */
console.log('\n[5] Taille automatique (scale unique partagé => hauteurs égales)')
{
  const frame: FrameSize = { width: 1920, height: 1080 }
  const sizes = [
    { width: 600, height: 120 }, // ALFIA
    { width: 520, height: 120 }, // NEXGEGL
  ]
  const scale = computeUniformAutoScale(sizes, frame, { gap: 40 })
  const widths = sizes.map((s) => s.width * scale)
  const heights = sizes.map((s) => s.height * scale)
  const group = widths[0] + 40 + widths[1]

  check('les deux logos ont EXACTEMENT la même hauteur (même hauteur naturelle)', near(heights[0], heights[1]), `-> ${heights}`)
  check(`le groupe utilise ~62 % de la largeur (${(frame.width * 0.62).toFixed(0)})`, near(group, frame.width * 0.62, 0.5), `-> ${group.toFixed(2)}`)
  check('le groupe tient dans le cadre', group <= frame.width * 0.9)
  check('hauteur <= 30 % de l’image', Math.max(...heights) <= frame.height * 0.3 + 1e-9, `-> ${Math.max(...heights).toFixed(1)}`)
  check('les logos restent petits (14 % de la hauteur max)', Math.max(...heights) / frame.height < 0.2, `-> ${(Math.max(...heights) / frame.height * 100).toFixed(1)} %`)
  check('proportions conservées', near(widths[0] / heights[0], 5) && near(widths[1] / heights[1], 520 / 120))

  // 3 logos, very different natural sizes: the group stays balanced.
  const mixedNatural = [
    { width: 4000, height: 100 },
    { width: 300, height: 300 },
    { width: 120, height: 900 },
  ]
  const mixed = computeUniformAutoScale(mixedNatural, frame, { gap: 40 })
  const mh = mixedNatural.map((s) => s.height * mixed)
  const mw = mixedNatural.map((s) => s.width * mixed)
  check('le logo le plus haut reste sous 30 % de la hauteur', Math.max(...mh) <= frame.height * 0.3 + 1e-9, `-> ${Math.max(...mh).toFixed(1)}`)
  check('chaque logo garde son ratio', mw.every((w, i) => near(w / mh[i], mixedNatural[i].width / mixedNatural[i].height)))
  const mGroup = mw[0] + 40 + mw[1] + 40 + mw[2]
  check('le groupe hétérogène tient dans le cadre', mGroup <= frame.width * 0.9, `-> ${mGroup.toFixed(0)}`)
  check('le logo très large est bien plus petit que le cadre', mw[0] < frame.width, `-> ${mw[0].toFixed(0)}`)

  // Very large gap: the group must still stay inside the frame.
  const tight = computeUniformAutoScale(sizes, frame, { gap: 300 })
  const tightGroup = 600 * tight + 300 + 520 * tight
  check('espace de 300 px : le groupe reste dans le cadre', tightGroup <= frame.width * 0.9, `-> ${tightGroup.toFixed(0)}`)

  // Single logo: bounded both by width and by height.
  const single = computeUniformAutoScale([{ width: 600, height: 120 }], frame)
  check('logo seul : largeur <= 85 %', 600 * single <= frame.width * 0.85 + 1e-6, `-> ${(600 * single).toFixed(0)}`)
  check('logo seul : hauteur <= 30 %', 120 * single <= frame.height * 0.3 + 1e-6, `-> ${(120 * single).toFixed(0)}`)

  // Group fit: 3 huge logos must be shrunk so the row fits in the frame.
  const huge = [box('a', 0, 0, 1500, 300), box('b', 0, 0, 1500, 300), box('c', 0, 0, 1500, 300)]
  const factor = groupFitFactor(huge, 40, frame)
  const shrunk = shrinkToFit(huge, 40, frame)
  const bounds = boundsOf(shrunk.boxes)
  check('facteur de réduction < 1', factor < 1, `-> ${factor.toFixed(3)}`)
  check(`groupe réduit <= 90 % de la largeur (${frame.width * 0.9})`, bounds.width <= frame.width * 0.9 + 1e-6, `-> ${bounds.width.toFixed(0)}`)
  check('ratio préservé après réduction', near(shrunk.boxes[0].width / shrunk.boxes[0].height, 5))
}

/* -------------------------------------------------------------------------- */
/* 6. Distribution                                                           */
/* -------------------------------------------------------------------------- */
console.log('\n[6] Distribution horizontale')
{
  const frame: FrameSize = { width: 1200, height: 600 }
  const clustered = [box('a', 100, 250, 100, 100), box('b', 110, 250, 100, 100), box('c', 120, 250, 100, 100)]
  const spread = distributeHorizontal(clustered, 0)
  const g1 = spread[1].left - (spread[0].left + spread[0].width)
  const g2 = spread[2].left - (spread[1].left + spread[1].width)
  check('espacements égaux après distribution', near(g1, g2), `-> ${g1} / ${g2}`)
  check('le groupe reste dans le cadre', spread[2].left + spread[2].width <= frame.width)
  void frame
}

/* -------------------------------------------------------------------------- */
/* 7. Idempotence: centrer deux fois donne le même résultat                    */
/* -------------------------------------------------------------------------- */
console.log('\n[7] Idempotence du centrage')
{
  const frame: FrameSize = { width: 2000, height: 1000 }
  const logos = [box('a', 5, 7, 321, 123), box('b', 900, 40, 654, 210), box('c', 1500, 800, 100, 250)]
  const once = centerGroup(logos, 75, frame)
  const twice = centerGroup(once, 75, frame)
  check('résultat stable', once.every((b, i) => near(b.left, twice[i].left, 1e-9) && near(b.top, twice[i].top, 1e-9)))
  check('centre final == centre image', near(boundsOf(twice).centerX, 1000) && near(boundsOf(twice).centerY, 500))
}

console.log(`\n${failures === 0 ? 'TOUS LES TESTS PASSENT' : `${failures} TEST(S) EN ECHEC`}\n`)
process.exit(failures === 0 ? 0 : 1)
