import { ImagePlus, Plus, Trash2 } from 'lucide-react'
import { useRef } from 'react'
import { MAX_LOGOS } from '../utils/centering'
import { LOGO_EXTENSIONS, humanFileSize } from '../utils/images'

export interface LogoUploaderProps {
  count: number
  disabled?: boolean
  onFiles: (files: File[]) => void
}

export function LogoUploader({ count, disabled, onFiles }: LogoUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const full = count >= MAX_LOGOS
  const remaining = Math.max(0, MAX_LOGOS - count)

  return (
    <div>
      <div
        className={`rounded-2xl border border-ink-100 bg-ink-50/60 px-4 py-4 transition ${
          disabled ? 'opacity-60' : ''
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink-800">Ajouter vos logos</p>
            <p className="mt-0.5 text-xs text-ink-500">
              {full ? 'Maximum de 3 logos atteint' : `Encore ${remaining} logo${remaining > 1 ? 's' : ''} possible`}
            </p>
          </div>
          <div className="flex gap-1.5" aria-hidden>
            {Array.from({ length: MAX_LOGOS }).map((_, index) => (
              <span
                key={index}
                className={`h-2.5 w-2.5 rounded-full transition ${
                  index < count ? 'bg-indigo-500' : 'bg-ink-200'
                }`}
              />
            ))}
          </div>
        </div>

        <button
          type="button"
          disabled={disabled || full}
          onClick={() => inputRef.current?.click()}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 py-2.5 text-sm font-semibold text-indigo-700 shadow-sm transition hover:border-indigo-400 hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border-ink-200 disabled:text-ink-400 disabled:shadow-none"
        >
          {full ? <ImagePlus size={16} /> : <Plus size={16} />}
          {full ? 'Limite de 3 logos' : 'Ajouter un logo'}
        </button>

        <p className="mt-2 text-center text-[11px] text-ink-400">PNG · JPG · JPEG · WEBP · SVG — transparence conservée</p>

        <input
          ref={inputRef}
          type="file"
          accept={LOGO_EXTENSIONS.join(',')}
          multiple
          className="sr-only"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            if (files.length > 0) onFiles(files)
            event.target.value = ''
          }}
        />
      </div>
    </div>
  )
}

export interface LogoListItem {
  id: string
  name: string
  url: string
  fileSize: number
  width: number
  height: number
  sizePct: number
  active: boolean
}

export interface LogoListProps {
  items: LogoListItem[]
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onReorder: (id: string, direction: -1 | 1) => void
  onClearAll: () => void
}

export function LogoList({ items, onSelect, onRemove, onReorder, onClearAll }: LogoListProps) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-ink-200 bg-white px-4 py-6 text-center text-sm text-ink-400">
        Aucun logo pour le moment.
        <br />
        Ajoutez 2 ou 3 logos pour commencer.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div
          key={item.id}
          className={`group rounded-xl border bg-white p-2.5 transition ${
            item.active ? 'border-indigo-400 shadow-sm ring-1 ring-indigo-200' : 'border-ink-100 hover:border-ink-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              title="Sélectionner ce logo"
              className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-ink-100 bg-[repeating-conic-gradient(#eef0f4_0%_25%,#ffffff_0%_50%)] bg-[length:12px_12px] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <img src={item.url} alt={item.name} className="h-full w-full object-contain p-1" />
            </button>

            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-medium text-ink-800">
                <span className="grid h-4 w-4 shrink-0 place-items-center rounded bg-ink-100 text-[10px] font-bold text-ink-600">
                  {index + 1}
                </span>
                <span className="truncate">{item.name}</span>
              </p>
              <p className="mt-0.5 text-[11px] text-ink-500">
                {Math.round(item.width)} × {Math.round(item.height)} px · {Math.round(item.sizePct)} % ·{' '}
                {humanFileSize(item.fileSize)}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => onReorder(item.id, -1)}
                disabled={index === 0}
                title="Placer avant"
                className="grid h-7 w-7 place-items-center rounded-md text-ink-400 transition hover:bg-ink-50 hover:text-ink-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <span className="text-sm leading-none">←</span>
              </button>
              <button
                type="button"
                onClick={() => onReorder(item.id, 1)}
                disabled={index === items.length - 1}
                title="Placer après"
                className="grid h-7 w-7 place-items-center rounded-md text-ink-400 transition hover:bg-ink-50 hover:text-ink-700 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <span className="text-sm leading-none">→</span>
              </button>
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                title="Supprimer ce logo"
                className="grid h-7 w-7 place-items-center rounded-md text-ink-400 transition hover:bg-rose-50 hover:text-rose-600"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </div>
      ))}

      {items.length > 0 && (
        <button
          type="button"
          onClick={onClearAll}
          className="w-full rounded-lg py-1.5 text-xs font-medium text-ink-400 transition hover:text-rose-600"
        >
          Tout supprimer
        </button>
      )}
    </div>
  )
}

export default LogoUploader
