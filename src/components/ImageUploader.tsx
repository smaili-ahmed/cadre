import { Image as ImageIcon, RefreshCw, Upload } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { FRAME_EXTENSIONS, humanFileSize } from '../utils/images'

export interface ImageUploaderProps {
  fileName: string | null
  resolution: string | null
  fileSize: number | null
  disabled?: boolean
  onFiles: (files: File[]) => void
}

export function ImageUploader({ fileName, resolution, fileSize, disabled, onFiles }: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  const accept = FRAME_EXTENSIONS.join(',')

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      if (disabled) return
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length > 0) onFiles(files)
    },
    [disabled, onFiles],
  )

  const summary = fileName ? (
    <div className="mt-3 flex items-center gap-3 rounded-xl border border-ink-100 bg-ink-50/70 px-3 py-2.5">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white text-indigo-600 shadow-sm">
        <ImageIcon className="h-4.5 w-4.5" size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-800">{fileName}</p>
        <p className="text-xs text-ink-500">
          {resolution}
          {fileSize ? ` · ${humanFileSize(fileSize)}` : ''}
        </p>
      </div>
    </div>
  ) : null

  return (
    <div>
      <div
        onDragEnter={(event) => {
          event.preventDefault()
          dragDepth.current += 1
          if (!disabled) setDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault()
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDragging(false)
        }}
        onDrop={handleDrop}
        className={`group relative rounded-2xl border-2 border-dashed px-4 py-7 text-center transition-all ${
          dragging
            ? 'border-indigo-500 bg-indigo-50/80'
            : 'border-ink-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/30'
        }`}
      >
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/25 transition-transform group-hover:scale-105">
          <Upload size={22} />
        </div>
        <p className="mt-3 text-sm font-semibold text-ink-800">Déposez votre photo ou votre cadre ici</p>
        <p className="mt-1 text-xs text-ink-500">PNG · JPG · JPEG · WEBP — la résolution d’origine est conservée</p>

        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-ink-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {fileName ? <RefreshCw size={16} /> : <Upload size={16} />}
          {fileName ? 'Remplacer l’image' : 'Importer une image'}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            if (files.length > 0) onFiles(files)
            event.target.value = ''
          }}
        />
      </div>
      {summary}
    </div>
  )
}

export default ImageUploader
