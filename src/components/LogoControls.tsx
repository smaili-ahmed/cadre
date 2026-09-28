import { Crosshair, Move, Ruler, Sparkles } from 'lucide-react'
import { MAX_SIZE_PCT, MAX_SPACING, MIN_SIZE_PCT, MIN_SPACING } from '../utils/centering'
import { CENTER_MODES, type CenterMode } from '../utils/types'

export interface LogoControlsProps {
  selectedName: string | null
  selectedSizePct: number
  globalSizePct: number
  spacing: number
  centerMode: CenterMode
  frame: { width: number; height: number } | null
  hasLogos: boolean
  overflow: boolean
  onSizePct: (pct: number) => void
  onGlobalSizePct: (pct: number) => void
  onSpacing: (value: number) => void
  onCenterMode: (mode: CenterMode) => void
  onCenterNow: () => void
  onNudge: (dx: number, dy: number) => void
}

function Slider({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
  icon: Icon,
  hint,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix: string
  onChange: (value: number) => void
  icon?: typeof Ruler
  hint?: string
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="flex items-center gap-1.5 text-xs font-semibold text-ink-600">
          {Icon ? <Icon size={13} /> : null}
          {label}
        </label>
        <span className="text-xs font-bold tabular-nums text-indigo-600">
          {Math.round(value)}
          {suffix}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1"
        title={hint}
      />
    </div>
  )
}

export function LogoControls(props: LogoControlsProps) {
  const {
    selectedName,
    selectedSizePct,
    globalSizePct,
    spacing,
    centerMode,
    frame,
    hasLogos,
    overflow,
  } = props

  const nudgeStep = frame ? Math.max(1, Math.round(frame.width * 0.005)) : 1

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Centrage intelligent</p>
        <div className="mt-2 grid grid-cols-1 gap-1.5">
          {CENTER_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => props.onCenterMode(mode.id)}
              title={mode.hint}
              className={`rounded-lg border px-3 py-2 text-left text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                centerMode === mode.id
                  ? 'border-indigo-400 bg-indigo-50 text-indigo-700 shadow-sm'
                  : 'border-ink-100 bg-white text-ink-600 hover:border-ink-300 hover:bg-ink-50'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
          {CENTER_MODES.find((mode) => mode.id === centerMode)?.hint}
        </p>
      </div>

      <button
        type="button"
        onClick={props.onCenterNow}
        disabled={!hasLogos || !frame}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-600/25 transition hover:from-indigo-500 hover:to-violet-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 active:scale-[0.99] disabled:cursor-not-allowed disabled:from-ink-200 disabled:to-ink-200 disabled:text-ink-400 disabled:shadow-none"
      >
        <Sparkles size={17} />
        Centrer automatiquement
      </button>

      {overflow && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700">
          Le groupe dépasse du cadre. Réduisez la taille des logos ou l’espacement.
        </p>
      )}

      <div className="space-y-3 rounded-xl border border-ink-100 bg-white p-3">
        <Slider
          id="spacing"
          label="Espacement"
          value={spacing}
          min={MIN_SPACING}
          max={MAX_SPACING}
          suffix=" px"
          onChange={props.onSpacing}
          icon={Ruler}
          hint="Espace régulier entre les logos (en pixels de l’image d’origine)"
        />
        <Slider
          id="global-size"
          label="Taille des logos"
          value={globalSizePct}
          min={MIN_SIZE_PCT}
          max={MAX_SIZE_PCT}
          suffix=" %"
          onChange={props.onGlobalSizePct}
          icon={Move}
          hint="Taille appliquée à tous les logos (rapport conservé)"
        />
        <Slider
          id="logo-size"
          label={selectedName ? `Taille — ${selectedName}` : 'Taille du logo sélectionné'}
          value={selectedSizePct}
          min={MIN_SIZE_PCT}
          max={MAX_SIZE_PCT}
          suffix=" %"
          onChange={props.onSizePct}
          icon={Crosshair}
          hint="Taille du logo sélectionné, dans les deux axes (jamais déformé)"
        />
        <p className="text-[11px] leading-relaxed text-ink-400">
          Le rapport largeur/hauteur d’origine est toujours conservé : les logos ne sont jamais déformés.
        </p>
      </div>

      <div className="rounded-xl border border-ink-100 bg-white p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Position du logo sélectionné</p>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => props.onNudge(-nudgeStep, 0)}
            className="rounded-lg border border-ink-100 bg-white py-1.5 text-xs font-semibold text-ink-600 transition hover:border-ink-300 hover:bg-ink-50"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => props.onNudge(0, -nudgeStep)}
            className="rounded-lg border border-ink-100 bg-white py-1.5 text-xs font-semibold text-ink-600 transition hover:border-ink-300 hover:bg-ink-50"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => props.onNudge(nudgeStep, 0)}
            className="rounded-lg border border-ink-100 bg-white py-1.5 text-xs font-semibold text-ink-600 transition hover:border-ink-300 hover:bg-ink-50"
          >
            →
          </button>
          <button
            type="button"
            onClick={() => props.onNudge(0, nudgeStep)}
            className="rounded-lg border border-ink-100 bg-white py-1.5 text-xs font-semibold text-ink-600 transition hover:border-ink-300 hover:bg-ink-50"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => props.onNudge(-nudgeStep * 5, -nudgeStep * 5)}
            className="rounded-lg border border-ink-100 bg-white py-1.5 text-xs font-semibold text-ink-600 transition hover:border-ink-300 hover:bg-ink-50"
          >
            ↖
          </button>
          <button
            type="button"
            onClick={() => props.onNudge(nudgeStep * 5, nudgeStep * 5)}
            className="rounded-lg border border-ink-100 bg-white py-1.5 text-xs font-semibold text-ink-600 transition hover:border-ink-300 hover:bg-ink-50"
          >
            ↘
          </button>
        </div>
        <p className="mt-2 text-[11px] text-ink-400">Déplacement au pixel près (pas de {nudgeStep} px).</p>
      </div>
    </div>
  )
}

export default LogoControls
