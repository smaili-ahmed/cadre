import { Check, Download, Loader2 } from 'lucide-react'
import { useState } from 'react'
import {
  humanResolution,
  outputSizeFor,
  triggerDownload,
  type ExportResult,
} from '../utils/export'
import type { ExportFormat } from '../utils/export'

export interface ExportButtonProps {
  disabled: boolean
  format: ExportFormat
  quality: number
  /** Natural size of the imported image, or of the colour plate. */
  frameSize: { width: number; height: number } | null
  /** Shown next to the size, e.g. "fond #000000". Null in image mode. */
  backgroundColor?: string | null
  /** Label of the source row: "Image d’origine" or "Fond". */
  sourceLabel?: string
  onBuild: (
    format: ExportFormat,
    quality: number,
    requestedWidth?: number,
  ) => Promise<ExportResult | null>
  onError: (message: string) => void
  onExported?: (result: ExportResult) => void
}

/** Multipliers offered as one-click buttons next to the manual width. */
const SCALE_PRESETS = [1, 2, 3, 4] as const

/** Renders a "label / value" row of the export summary. */
function Row({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'pending' }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-ink-500">{label}</span>
      <span
        className={`font-semibold tabular-nums ${
          tone === 'ok' ? 'text-emerald-600' : tone === 'pending' ? 'text-ink-400' : 'text-ink-800'
        }`}
      >
        {value}
      </span>
    </div>
  )
}

export function ExportButton({
  disabled,
  format,
  quality,
  frameSize,
  backgroundColor = null,
  sourceLabel = 'Image d’origine',
  onBuild,
  onError,
  onExported,
}: ExportButtonProps) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  // Dimensions of the file that was actually written, read back from its bytes.
  const [exported, setExported] = useState<{ label: string; bytes: number } | null>(null)
  /** `null` = follow the preset, a number = the width typed by the user. */
  const [customWidth, setCustomWidth] = useState<number | null>(null)
  const [presetScale, setPresetScale] = useState(1)

  // When the image changes, any width typed for the previous one is meaningless.
  const frameKey = frameSize ? `${frameSize.width}x${frameSize.height}` : ''
  const [widthFrameKey, setWidthFrameKey] = useState(frameKey)
  if (frameKey !== widthFrameKey) {
    setWidthFrameKey(frameKey)
    setCustomWidth(null)
    setPresetScale(1)
    setExported(null)
  }

  const requestedWidth =
    frameSize === null
      ? undefined
      : customWidth ?? Math.round(frameSize.width * presetScale)
  const target = frameSize ? outputSizeFor(frameSize, requestedWidth) : null

  const handleClick = async () => {
    if (busy || disabled) return
    setBusy(true)
    setDone(false)
    setExported(null)
    try {
      const result = await onBuild(format, quality, requestedWidth)
      if (!result) {
        onError('Export impossible : le canvas n’est pas prêt.')
        return
      }
      triggerDownload(result.blob, result.filename)
      setExported({
        label: `${Math.round(result.width)} × ${Math.round(result.height)} px`,
        bytes: result.bytes,
      })
      onExported?.(result)
      setDone(true)
      window.setTimeout(() => setDone(false), 2600)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Export impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || busy || target === null}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-600/25 transition hover:bg-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-ink-200 disabled:text-ink-400 disabled:shadow-none"
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : done ? <Check size={18} /> : <Download size={18} />}
        {busy ? 'Génération…' : done ? 'Image téléchargée' : 'Télécharger en HD'}
      </button>

      {frameSize && target && (
        <div className="mt-2.5 rounded-xl border border-ink-200/70 bg-ink-50/60 px-3 py-2.5">
          <p className="text-[11px] font-semibold text-ink-600">Taille du fichier</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {SCALE_PRESETS.map((scale) => {
              const active = customWidth === null && presetScale === scale
              return (
                <button
                  key={scale}
                  type="button"
                  onClick={() => {
                    setPresetScale(scale)
                    setCustomWidth(null)
                    setExported(null)
                  }}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                    active
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white text-ink-600 ring-1 ring-ink-200 hover:bg-ink-100'
                  }`}
                >
                  {scale === 1 ? 'Original' : `×${scale}`}
                </button>
              )
            })}
          </div>
          <label className="mt-2 flex items-center gap-2 text-[11px] text-ink-600">
            <span className="shrink-0">Largeur</span>
            <input
              type="number"
              min={1}
              step={1}
              value={customWidth ?? Math.round(frameSize.width * presetScale)}
              onChange={(event) => {
                const value = Number(event.target.value)
                setCustomWidth(Number.isFinite(value) && value > 0 ? Math.round(value) : 1)
                setExported(null)
              }}
              className="w-20 rounded-lg bg-white px-2 py-1 text-[11px] font-semibold tabular-nums text-ink-800 ring-1 ring-ink-200 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <span className="shrink-0">px</span>
            <span className="ml-auto tabular-nums text-ink-500">
              → {target.width} × {target.height} px
            </span>
          </label>
          {target.upscaled && (
            <p className="mt-1.5 text-[10px] text-amber-700">
              Image agrandie de ×{target.scale.toFixed(target.scale < 1.5 ? 2 : 1).replace('.', ',')} :
              le fichier sera plus grand, mais les détails restent ceux de l’image d’origine
              ({humanResolution(frameSize.width, frameSize.height)}). Pour un vrai gain de définition,
              utilisez une image source plus grande.
            </p>
          )}
        </div>
      )}

      <div className="mt-2.5 space-y-1 rounded-xl border border-ink-200/70 bg-ink-50/60 px-3 py-2.5 text-[11px]">
        <Row
          label={sourceLabel}
          value={
            frameSize
              ? `${humanResolution(frameSize.width, frameSize.height)}${backgroundColor ? ` · ${backgroundColor}` : ''}`
              : '—'
          }
        />
        <Row
          label="Résolution exportée"
          value={exported ? exported.label : target ? humanResolution(target.width, target.height) : '—'}
          tone={exported ? 'ok' : 'pending'}
        />
        <Row label="Format" value={format === 'png' ? 'PNG (sans perte)' : `JPG (qualité ${Math.round(quality * 100)} %)`} />
        {exported ? (
          <p className="pt-0.5 text-[10px] text-emerald-700">
            ✓ {exported.label} vérifiée dans le fichier téléchargé ({Math.max(1, Math.round(exported.bytes / 1024))} Ko)
          </p>
        ) : (
          <p className="pt-0.5 text-[10px] text-ink-400">
            Le fichier sera créé sans interface ni guides, à la taille choisie ci-dessus.
          </p>
        )}
      </div>
    </div>
  )
}

export default ExportButton
