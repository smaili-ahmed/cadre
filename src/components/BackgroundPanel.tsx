import { useState } from 'react'
import { Check } from 'lucide-react'
import ImageUploader from './ImageUploader'
import {
  BACKGROUND_SIZES,
  COLOR_PRESETS,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_BACKGROUND_SIZE,
  MIN_BACKGROUND_SIDE,
  backgroundSize,
  normalizeColor,
} from '../utils/background'
import type { Background, BackgroundKind, ImportedImage } from '../utils/types'
import { humanResolution } from '../utils/export'

export interface BackgroundPanelProps {
  background: Background
  /** Metadata of the imported image, used for the file summary. */
  frameImage: ImportedImage | null
  onKindChange: (kind: BackgroundKind) => void
  onColorChange: (color: string) => void
  onSizeChange: (size: { width: number; height: number }) => void
  onFiles: (files: File[]) => void
}

/** The first step, before any background exists, lives in App (screen « Intro »). */

function Tab({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
        active ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
      }`}
    >
      {label}
    </button>
  )
}

export function BackgroundPanel({
  background,
  frameImage,
  onKindChange,
  onColorChange,
  onSizeChange,
  onFiles,
}: BackgroundPanelProps) {
  // The tab can be on "Image" even without an image (it then shows the file
  // picker), so it is local UI state, seeded and kept in sync with the real
  // background.
  const [tab, setTab] = useState<BackgroundKind>(background.kind)
  const [syncedKind, setSyncedKind] = useState(background.kind)
  if (background.kind !== syncedKind) {
    setSyncedKind(background.kind)
    setTab(background.kind)
  }
  const isColor = tab === 'color'
  // On the colour tab the plate is a colour, so its size is read from there; the
  // two shapes are unified by `size` to keep the inputs below simple.
  const size = backgroundSize(background) ?? DEFAULT_BACKGROUND_SIZE
  const color = background.kind === 'color' ? background.color : DEFAULT_BACKGROUND_COLOR

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-xl bg-ink-100/80 p-1">
        <Tab
          active={!isColor}
          label="Image"
          onClick={() => {
            setTab('image')
            if (background.kind === 'color') onKindChange('image')
          }}
        />
        <Tab
          active={isColor}
          label="Couleur"
          onClick={() => {
            setTab('color')
            onKindChange('color')
          }}
        />
      </div>

      {!isColor ? (
        frameImage ? (
          <>
            <ImageUploader
              fileName={frameImage.name}
              resolution={humanResolution(frameImage.width, frameImage.height)}
              fileSize={frameImage.fileSize}
              onFiles={onFiles}
            />
            <button
              type="button"
              onClick={() => onKindChange('color')}
              className="w-full rounded-xl border border-ink-200 px-3 py-2 text-xs font-semibold text-ink-600 transition hover:bg-ink-50"
            >
              Utiliser un fond uni à la place
            </button>
          </>
        ) : (
          <ImageUploader fileName={null} resolution={null} fileSize={null} onFiles={onFiles} />
        )
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-xl border border-ink-100 bg-ink-50/70 px-3 py-2.5">
            <input
              type="color"
              value={color}
              onChange={(event) => onColorChange(normalizeColor(event.target.value))}
              aria-label="Couleur du fond"
              className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-ink-200 bg-white p-1"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink-800">Couleur du fond</p>
              <p className="font-mono text-xs uppercase text-ink-500">{color}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {COLOR_PRESETS.map((preset) => {
              const active = color === preset.color
              return (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.label}
                  aria-label={preset.label}
                  onClick={() => onColorChange(preset.color)}
                  style={{ backgroundColor: preset.color }}
                  className={`relative grid h-8 w-8 place-items-center rounded-lg border transition ${
                    active ? 'border-emerald-500 ring-2 ring-emerald-500/30' : 'border-ink-200'
                  }`}
                >
                  {active && (
                    <Check
                      size={14}
                      className={preset.color === '#ffffff' || preset.color === '#e5e7eb' ? 'text-ink-800' : 'text-white'}
                    />
                  )}
                </button>
              )
            })}
          </div>

          <div>
            <p className="text-xs font-semibold text-ink-600">Dimensions</p>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-600">
                <span className="w-8 shrink-0">L</span>
                <input
                  type="number"
                  min={MIN_BACKGROUND_SIDE}
                  value={size.width}
                  onChange={(event) => {
                    const width = Math.max(MIN_BACKGROUND_SIDE, Math.round(Number(event.target.value) || MIN_BACKGROUND_SIDE))
                    onSizeChange({ width, height: size.height })
                  }}
                  className="w-full min-w-0 bg-transparent font-semibold tabular-nums text-ink-800 focus:outline-none"
                />
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-xs text-ink-600">
                <span className="w-8 shrink-0">H</span>
                <input
                  type="number"
                  min={MIN_BACKGROUND_SIDE}
                  value={size.height}
                  onChange={(event) => {
                    const height = Math.max(MIN_BACKGROUND_SIDE, Math.round(Number(event.target.value) || MIN_BACKGROUND_SIDE))
                    onSizeChange({ width: size.width, height })
                  }}
                  className="w-full min-w-0 bg-transparent font-semibold tabular-nums text-ink-800 focus:outline-none"
                />
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {BACKGROUND_SIZES.map((presetSize) => {
              const active = size.width === presetSize.width && size.height === presetSize.height
              return (
                <button
                  key={presetSize.id}
                  type="button"
                  onClick={() => onSizeChange({ width: presetSize.width, height: presetSize.height })}
                  className={`rounded-lg px-2 py-1 text-[11px] font-semibold transition ${
                    active
                      ? 'bg-emerald-600 text-white'
                      : 'bg-ink-50 text-ink-600 ring-1 ring-ink-200 hover:bg-ink-100'
                  }`}
                >
                  {presetSize.label}
                </button>
              )
            })}
          </div>

          <button
            type="button"
            onClick={() => onKindChange('image')}
            className="w-full rounded-xl border border-ink-200 px-3 py-2 text-xs font-semibold text-ink-600 transition hover:bg-ink-50"
          >
            Importer une image à la place
          </button>
        </>
      )}
    </div>
  )
}

export default BackgroundPanel
