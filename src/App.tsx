import {
  Boxes,
  CheckCircle2,
  FileImage,
  Image as ImageIcon,
  Lock,
  MousePointerClick,
  Sparkles,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CanvasEditor, { type CommitReason, type EditorApi } from './components/CanvasEditor'
import ExportButton from './components/ExportButton'
import ImageUploader from './components/ImageUploader'
import LogoControls from './components/LogoControls'
import { LogoList, LogoUploader } from './components/LogoUploader'
import ToastStack, { type ToastKind, type ToastMessage } from './components/ToastStack'
import Toolbar from './components/Toolbar'
import {
  DEFAULT_SPACING,
  MAX_LOGOS,
  MAX_SIZE_PCT,
  MIN_SIZE_PCT,
  computeUniformAutoScale,
  detectOverflow,
  layoutGroup,
} from './utils/centering'
import { humanResolution, renderComposition, type ExportFormat, type ExportLogo, type ExportResult } from './utils/export'
import { loadImageFile, validateFile } from './utils/images'
import type { Box, CenterMode, EditorSnapshot, FrameSource, ImportedImage, LogoItem } from './utils/types'

const HISTORY_LIMIT = 60

interface GroupStats {
  centerX: number
  centerY: number
  width: number
  height: number
}

export default function App() {
  /* ------------------------------ state ------------------------------ */
  const [frameImage, setFrameImage] = useState<ImportedImage | null>(null)
  const [logos, setLogos] = useState<LogoItem[]>([])
  const [spacing, setSpacing] = useState(DEFAULT_SPACING)
  const [centerMode, setCenterMode] = useState<CenterMode>('both')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [showGuides, setShowGuides] = useState(true)
  const [showGrid, setShowGrid] = useState(false)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png')
  const [exportQuality, setExportQuality] = useState(1)
  const [groupStats, setGroupStats] = useState<GroupStats | null>(null)
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [history, setHistory] = useState<EditorSnapshot[]>([])
  const [future, setFuture] = useState<EditorSnapshot[]>([])

  const editorRef = useRef<EditorApi | null>(null)
  const toastId = useRef(0)
  // Mirrors the current frame for the async handlers, so they never close over a
  // stale value. Written from an effect rather than during render.
  const frameRef = useRef<ImportedImage | null>(null)
  useEffect(() => {
    frameRef.current = frameImage
  }, [frameImage])

  /* ----------------------------- toasts ------------------------------ */
  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const notify = useCallback(
    (kind: ToastKind, text: string) => {
      toastId.current += 1
      const id = toastId.current
      setToasts((current) => [...current.slice(-3), { id, kind, text }])
    },
    [],
  )

  /* ----------------------------- derived ----------------------------- */
  const frame = useMemo<FrameSource | null>(
    () => (frameImage ? { url: frameImage.url, width: frameImage.width, height: frameImage.height } : null),
    [frameImage],
  )

  const boxes = useMemo<Box[]>(
    () => logos.map((logo) => ({ id: logo.id, left: logo.left, top: logo.top, width: logo.width, height: logo.height })),
    [logos],
  )

  const overflow = useMemo(() => (frame ? detectOverflow(boxes, frame).overflows : false), [boxes, frame])

  const selectedLogo = useMemo(() => logos.find((logo) => logo.id === activeId) ?? null, [activeId, logos])

  const globalSizePct = useMemo(() => {
    if (logos.length === 0) return 100
    return Math.round(logos.reduce((sum, logo) => sum + logo.sizePct, 0) / logos.length)
  }, [logos])

  /* ------------------------- history handling ------------------------ */
  const captureSnapshot = useCallback((): EditorSnapshot => {
    const api = editorRef.current
    if (api) return api.captureSnapshot(spacing)
    return {
      spacing,
      logos: logos.map((logo) => ({
        id: logo.id,
        left: logo.left,
        top: logo.top,
        width: logo.width,
        height: logo.height,
        sizePct: logo.sizePct,
      })),
    }
  }, [logos, spacing])

  const resetHistory = useCallback(() => {
    setHistory([])
    setFuture([])
  }, [])

  /**
   * Records an undo step.
   *
   * The snapshot is captured synchronously, right now: reading it from inside a
   * state updater would be too late, since React may run the updater after the
   * change has already been applied. Callers MUST invoke this BEFORE mutating
   * anything, otherwise the "undo" stack stores the new state and undoing is a
   * no-op.
   */
  const pushHistory = useCallback(
    (previous?: EditorSnapshot) => {
      const snapshot = previous ?? captureSnapshot()
      setHistory((current) => {
        const next = [...current, snapshot]
        return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next
      })
      setFuture([])
    },
    [captureSnapshot],
  )

  const undo = useCallback(() => {
    setHistory((current) => {
      if (current.length === 0) return current
      const previous = current[current.length - 1]
      const api = editorRef.current
      const currentSnapshot = api ? api.captureSnapshot(spacing) : null
      if (api) api.applySnapshot(previous)
      setSpacing(previous.spacing)
      setFuture((stack) => (currentSnapshot ? [...stack, currentSnapshot].slice(-HISTORY_LIMIT) : stack))
      return current.slice(0, -1)
    })
  }, [spacing])

  const redo = useCallback(() => {
    setFuture((current) => {
      if (current.length === 0) return current
      const next = current[current.length - 1]
      const api = editorRef.current
      const currentSnapshot = api ? api.captureSnapshot(spacing) : null
      if (api) api.applySnapshot(next)
      setSpacing(next.spacing)
      setHistory((stack) => (currentSnapshot ? [...stack, currentSnapshot].slice(-HISTORY_LIMIT) : stack))
      return current.slice(0, -1)
    })
  }, [spacing])

  /* ------------------------- geometry to canvas ---------------------- */
  const handleGeometryChange = useCallback(
    (id: string, patch: Partial<Pick<Box, 'left' | 'top' | 'width' | 'height'>>) => {
      setLogos((current) =>
        current.map((logo) => {
          if (logo.id !== id) return logo
          const width = patch.width ?? logo.width
          const height = patch.height ?? logo.height
          return {
            ...logo,
            left: patch.left ?? logo.left,
            top: patch.top ?? logo.top,
            width,
            height,
            // Keep the size slider in sync with a manual resize.
            sizePct: logo.autoScale > 0 ? clampPct((width / (logo.naturalWidth * logo.autoScale)) * 100) : logo.sizePct,
          }
        }),
      )
    },
    [],
  )

  const handleCommit = useCallback(
    (reason: CommitReason, previous?: EditorSnapshot) => {
      if (reason === 'move' || reason === 'resize' || reason === 'delete' || reason === 'order') {
        pushHistory(previous)
      }
    },
    [pushHistory],
  )

  /* ---------------------------- auto sizing -------------------------- */
  /**
   * Recomputes the ideal uniform scale of the group for the current frame, then
   * re-applies each logo's own sizePct on top of it. Because a SINGLE factor is
   * shared by all the logos, they all end up with the same height and each one
   * keeps its original aspect ratio.
   */
  const recomputeAutoScales = useCallback(
    (items: LogoItem[], currentFrame: { width: number; height: number }) => {
      if (items.length === 0) return items
      const autoScale = computeUniformAutoScale(
        items.map((logo) => ({ width: logo.naturalWidth, height: logo.naturalHeight })),
        currentFrame,
        { gap: spacing },
      )
      return items.map((logo) => {
        const factor = (autoScale * logo.sizePct) / 100
        return {
          ...logo,
          autoScale,
          scale: factor,
          width: logo.naturalWidth * factor,
          height: logo.naturalHeight * factor,
        }
      })
    },
    [spacing],
  )

  /* ------------------------- import: main image ---------------------- */
  const handleFrameFiles = useCallback(
    async (files: File[]) => {
      const file = files[0]
      if (!file) return
      const check = validateFile(file, 'frame')
      if (!check.ok) {
        notify('error', check.error ?? 'Fichier non pris en charge.')
        return
      }
      try {
        const { image } = await loadImageFile(file)
        setFrameImage(image)
        setLogos((current) => recomputeAutoScales(current, { width: image.width, height: image.height }))
        resetHistory()
        notify('success', `Image « ${image.name} » chargée (${humanResolution(image.width, image.height)}).`)
        window.setTimeout(() => editorRef.current?.centerGroup('both'), 60)
      } catch (error) {
        notify('error', error instanceof Error ? error.message : 'Impossible de charger cette image.')
      }
    },
    [notify, recomputeAutoScales, resetHistory],
  )

  /* --------------------------- import: logos ------------------------- */
  const handleLogoFiles = useCallback(
    async (files: File[]) => {
      const currentFrame = frameRef.current
      if (!currentFrame) {
        notify('error', 'Importez d’abord votre photo ou votre cadre.')
        return
      }

      const room = MAX_LOGOS - logos.length
      if (room <= 0) {
        notify('error', `Vous ne pouvez pas dépasser ${MAX_LOGOS} logos.`)
        return
      }
      if (files.length > room) {
        notify('info', `Seuls ${room} logo${room > 1 ? 's ont été ajoutés' : ' a été ajouté'} (limite : ${MAX_LOGOS}).`)
      }

      const accepted = files.slice(0, room)
      const loaded: LogoItem[] = []

      for (const file of accepted) {
        const check = validateFile(file, 'logo', logos.length + loaded.length)
        if (!check.ok) {
          if (check.error) notify('error', check.error)
          continue
        }
        try {
          const { image } = await loadImageFile(file)
          loaded.push({
            ...image,
            naturalWidth: image.width,
            naturalHeight: image.height,
            autoScale: 1,
            sizePct: 100,
            scale: 1,
            width: image.width,
            height: image.height,
            left: 0,
            top: 0,
          })
        } catch (error) {
          notify('error', error instanceof Error ? error.message : 'Impossible de charger ce logo.')
        }
      }

      if (loaded.length === 0) return

      setLogos((current) => {
        const next = recomputeAutoScales([...current, ...loaded], currentFrame)
        // Place the new logos with the current mode as soon as they exist.
        const laid = layoutGroup(
          next.map((logo) => ({ id: logo.id, left: logo.left, top: logo.top, width: logo.width, height: logo.height })),
          spacing,
          currentFrame,
          centerMode,
        )
        return next.map((logo) => {
          const placed = laid.find((item) => item.id === logo.id)
          return placed ? { ...logo, left: placed.left, top: placed.top } : logo
        })
      })
      resetHistory()
      setActiveId(loaded[loaded.length - 1].id)
      window.setTimeout(() => editorRef.current?.centerGroup(centerMode), 80)
      notify('success', `${loaded.length} logo${loaded.length > 1 ? 's ajoutés' : ' ajouté'}.`)
    },
    [centerMode, logos.length, notify, recomputeAutoScales, resetHistory, spacing],
  )

  const removeLogo = useCallback(
    (id: string) => {
      const currentFrame = frameRef.current
      if (logos.length > 1) pushHistory()
      setLogos((current) => {
        const next = current.filter((logo) => logo.id !== id)
        if (next.length === 0) return next
        if (!currentFrame) return next
        const withScales = recomputeAutoScales(next, currentFrame)
        const laid = layoutGroup(
          withScales.map((logo) => ({ id: logo.id, left: logo.left, top: logo.top, width: logo.width, height: logo.height })),
          spacing,
          currentFrame,
          centerMode,
        )
        return withScales.map((logo) => {
          const placed = laid.find((item) => item.id === logo.id)
          return placed ? { ...logo, left: placed.left, top: placed.top } : logo
        })
      })
      setActiveId((current) => (current === id ? null : current))
      window.setTimeout(() => editorRef.current?.centerGroup(centerMode), 60)
    },
    [centerMode, logos.length, pushHistory, recomputeAutoScales, spacing],
  )

  const clearLogos = useCallback(() => {
    setLogos([])
    setActiveId(null)
    resetHistory()
    editorRef.current?.selectLogo(null)
    notify('info', 'Tous les logos ont été supprimés.')
  }, [notify, resetHistory])

  const reorderLogo = useCallback(
    (id: string, direction: -1 | 1) => {
      setLogos((current) => {
        const index = current.findIndex((logo) => logo.id === id)
        const target = index + direction
        if (index === -1 || target < 0 || target >= current.length) return current
        const next = [...current]
        const [moved] = next.splice(index, 1)
        next.splice(target, 0, moved)
        return next
      })
      const currentFrame = frameRef.current
      if (currentFrame) {
        window.setTimeout(() => {
          const api = editorRef.current
          if (!api) return
          api.centerGroup(centerMode)
        }, 60)
      }
    },
    [centerMode],
  )

  /* ------------------------------ sizing ----------------------------- */
  /**
   * Resizes the group and lays it out again.
   *
   * The new dimensions are always computed from the *natural* size of each logo
   * and its own sizePct, so no ratio is ever altered and the scale never
   * compounds. The group is then re-laid out with the current mode, which both
   * re-establishes the requested spacing and keeps the group centred: growing a
   * logo from a fixed left edge would otherwise make it collide with its
   * neighbour and push the group off-centre.
   */
  const resizeGroup = useCallback(
    (pctFor: (logo: LogoItem) => number) => {
      const currentFrame = frameRef.current
      setLogos((current) => {
        if (current.length === 0) return current
        const resized = current.map((logo) => {
          const value = clampPct(pctFor(logo))
          const factor = (logo.autoScale * value) / 100
          return {
            ...logo,
            sizePct: value,
            scale: factor,
            width: logo.naturalWidth * factor,
            height: logo.naturalHeight * factor,
          }
        })
        if (!currentFrame) return resized
        const placed = layoutGroup(
          resized.map((logo) => ({
            id: logo.id,
            left: logo.left,
            top: logo.top,
            width: logo.width,
            height: logo.height,
          })),
          spacing,
          currentFrame,
          centerMode,
        )
        return resized.map((logo) => {
          const box = placed.find((item) => item.id === logo.id)
          return box ? { ...logo, left: box.left, top: box.top } : logo
        })
      })
    },
    [centerMode, spacing],
  )

  const handleGlobalSize = useCallback(
    (pct: number) => {
      pushHistory()
      resizeGroup(() => pct)
    },
    [pushHistory, resizeGroup],
  )

  const handleLogoSize = useCallback(
    (pct: number) => {
      if (!activeId) return
      pushHistory()
      resizeGroup((logo) => (logo.id === activeId ? pct : logo.sizePct))
    },
    [activeId, pushHistory, resizeGroup],
  )

  /* ----------------------------- spacing ----------------------------- */
  const handleSpacing = useCallback(
    (value: number) => {
      const gap = Math.max(0, Math.round(value))
      if (gap === spacing) return
      pushHistory()
      setSpacing(gap)
      window.setTimeout(() => editorRef.current?.applySpacing(centerMode), 0)
    },
    [centerMode, pushHistory, spacing],
  )

  const handleCenterMode = useCallback(
    (mode: CenterMode) => {
      if (mode === centerMode) return
      pushHistory()
      setCenterMode(mode)
      window.setTimeout(() => editorRef.current?.centerGroup(mode), 0)
    },
    [centerMode, pushHistory],
  )

  const centerNow = useCallback(() => {
    const api = editorRef.current
    if (!api || logos.length === 0) {
      notify('error', 'Ajoutez au moins un logo avant de centrer.')
      return
    }
    // Snapshot first: once the canvas has been re-laid out, the old geometry is
    // gone for good.
    pushHistory()
    api.centerGroup(centerMode)
    const bounds = detectOverflow(
      logos.map((logo) => ({ id: logo.id, left: logo.left, top: logo.top, width: logo.width, height: logo.height })),
      frame ?? { width: 1, height: 1 },
    )
    if (bounds.overflows) {
      notify('error', 'Le groupe dépasse du cadre : réduisez la taille ou l’espacement.')
    } else {
      notify('success', 'Logos centrés automatiquement.')
    }
  }, [centerMode, frame, logos, notify, pushHistory])

  const nudge = useCallback(
    (dx: number, dy: number) => {
      const api = editorRef.current
      if (!api || !activeId) return
      const boxesNow = api.getBoxes()
      if (!boxesNow.some((box) => box.id === activeId)) return
      pushHistory()
      api.applySnapshot({
        spacing,
        logos: boxesNow.map((box) => ({
          ...box,
          sizePct: logos.find((logo) => logo.id === box.id)?.sizePct ?? 100,
          ...(box.id === activeId ? { left: box.left + dx, top: box.top + dy } : {}),
        })),
      })
    },
    [activeId, logos, pushHistory, spacing],
  )

  /* ------------------------------ export ----------------------------- */
  const handleExport = useCallback(
    async (
      format: ExportFormat,
      quality: number,
      requestedWidth?: number,
    ): Promise<ExportResult | null> => {
      const api = editorRef.current
      const frame = frameImage
      if (!api || !frame) {
        notify('error', 'Importez une image avant d’exporter.')
        return null
      }
      if (logos.length === 0) {
        notify('error', 'Ajoutez au moins un logo avant d’exporter.')
        return null
      }
      // Geometry comes from the live canvas (authoritative after a drag);
      // the original sources come from the state, which is what guarantees the
      // export never falls back to a thumbnail.
      const boxes = api.getBoxes()
      const byId = new Map(logos.map((logo) => [logo.id, logo]))
      const payload: ExportLogo[] = []
      for (const box of boxes) {
        const logo = byId.get(box.id)
        if (!logo) continue
        payload.push({
          id: logo.id,
          url: logo.url,
          naturalWidth: logo.naturalWidth,
          naturalHeight: logo.naturalHeight,
          box,
        })
      }
      if (payload.length === 0) {
        notify('error', 'Aucun logo positionné sur le canvas.')
        return null
      }
      try {
        const result = await renderComposition({
          frame: { url: frame.url, width: frame.width, height: frame.height },
          logos: payload,
          format,
          quality,
          requestedWidth,
          baseName: frame.name,
        })
        return result
      } catch (error) {
        notify('error', error instanceof Error ? error.message : 'Export impossible.')
        return null
      }
    },
    [frameImage, logos, notify],
  )

  /* --------------------------- keyboard shortcuts -------------------- */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!activeId) return
        event.preventDefault()
        removeLogo(activeId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeId, redo, removeLogo, undo])

  /* -------------------------------- render --------------------------- */
  return (
    <div className="flex min-h-full flex-col">
      {/* ------------------------------ header ------------------------- */}
      <header className="sticky top-0 z-30 border-b border-ink-100 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-3 sm:px-6">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/25">
            <Sparkles size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold leading-tight text-ink-900 sm:text-lg">
              Logo Center — Centrez vos logos facilement
            </h1>
            <p className="hidden truncate text-xs text-ink-500 sm:block">
              Importez votre cadre ou votre photo, ajoutez vos logos et positionnez-les automatiquement au centre.
            </p>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 lg:flex">
            <Lock size={13} />
            100 % local, rien n’est envoyé sur un serveur
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5 sm:px-6 sm:py-6">
        {!frameImage ? (
          <Intro onPick={handleFrameFiles} />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[19rem_minmax(0,1fr)_20rem] xl:grid-cols-[21rem_minmax(0,1fr)_22rem]">
            {/* ------------------------- left column ------------------- */}
            <aside className="lc-animate-in flex flex-col gap-4">
              <Panel title="Image principale">
                <ImageUploader
                  fileName={frameImage.name}
                  resolution={humanResolution(frameImage.width, frameImage.height)}
                  fileSize={frameImage.fileSize}
                  onFiles={handleFrameFiles}
                />
              </Panel>

              <Panel title="Vos logos">
                <div className="space-y-3">
                  <LogoUploader count={logos.length} onFiles={handleLogoFiles} />
                  <LogoList
                    items={logos.map((logo) => ({
                      id: logo.id,
                      name: logo.name,
                      url: logo.url,
                      fileSize: logo.fileSize,
                      width: logo.width,
                      height: logo.height,
                      sizePct: logo.sizePct,
                      active: logo.id === activeId,
                    }))}
                    onSelect={(id) => {
                      setActiveId(id)
                      editorRef.current?.selectLogo(id)
                    }}
                    onRemove={removeLogo}
                    onReorder={reorderLogo}
                    onClearAll={clearLogos}
                  />
                </div>
              </Panel>
            </aside>

            {/* ------------------------- center column ----------------- */}
            <section className="flex min-w-0 flex-col gap-3">
              <Toolbar
                canUndo={history.length > 0}
                canRedo={future.length > 0}
                canDelete={!!activeId}
                hasMultiple={logos.length > 1}
                hasFrame={!!frameImage}
                hasLogos={logos.length > 0}
                showGuides={showGuides}
                showGrid={showGrid}
                snapEnabled={snapEnabled}
                zoom={zoom}
                onCenterAll={centerNow}
                onCenterH={() => {
                  pushHistory()
                  editorRef.current?.centerH()
                }}
                onCenterV={() => {
                  pushHistory()
                  editorRef.current?.centerV()
                }}
                onDistribute={() => {
                  pushHistory()
                  editorRef.current?.distributeH()
                }}
                onAlignEdge={(edge) => {
                  pushHistory()
                  editorRef.current?.alignEdge(edge)
                }}
                onReset={() => {
                  pushHistory()
                  editorRef.current?.resetLogos()
                }}
                onUndo={undo}
                onRedo={redo}
                onDelete={() => activeId && removeLogo(activeId)}
                onZoomIn={() => editorRef.current?.zoomIn()}
                onZoomOut={() => editorRef.current?.zoomOut()}
                onFit={() => editorRef.current?.fitToScreen()}
                onToggleGuides={() => setShowGuides((value) => !value)}
                onToggleGrid={() => setShowGrid((value) => !value)}
                onToggleSnap={() => setSnapEnabled((value) => !value)}
              />

              <div className="relative min-h-[22rem] flex-1 overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-sm lg:min-h-[28rem]">
                <CanvasEditor
                  ref={editorRef}
                  frame={frame}
                  logos={logos}
                  spacing={spacing}
                  centerMode={centerMode}
                  showGuides={showGuides}
                  showGrid={showGrid}
                  snapEnabled={snapEnabled}
                  activeId={activeId}
                  onSelect={setActiveId}
                  onGeometryChange={handleGeometryChange}
                  onCommit={handleCommit}
                  onZoomChange={setZoom}
                  onGroupStatsChange={setGroupStats}
                />
                <StatusBar frame={frame} stats={groupStats} logos={logos.length} overflow={overflow} />
              </div>
            </section>

            {/* -------------------------- right column ------------------ */}
            <aside className="lc-animate-in flex flex-col gap-4">
              <Panel title="Centrage & options">
                <LogoControls
                  selectedName={selectedLogo?.name ?? null}
                  selectedSizePct={selectedLogo?.sizePct ?? 100}
                  globalSizePct={globalSizePct}
                  spacing={spacing}
                  centerMode={centerMode}
                  frame={frame}
                  hasLogos={logos.length > 0}
                  overflow={overflow}
                  onSizePct={handleLogoSize}
                  onGlobalSizePct={handleGlobalSize}
                  onSpacing={handleSpacing}
                  onCenterMode={handleCenterMode}
                  onCenterNow={centerNow}
                  onNudge={nudge}
                />
              </Panel>

              <Panel title="Télécharger">
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    {(['png', 'jpeg'] as ExportFormat[]).map((format) => (
                      <button
                        key={format}
                        type="button"
                        onClick={() => setExportFormat(format)}
                        className={`rounded-lg border px-3 py-2 text-xs font-bold uppercase tracking-wide transition ${
                          exportFormat === format
                            ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                            : 'border-ink-100 bg-white text-ink-500 hover:border-ink-300'
                        }`}
                      >
                        {format === 'png' ? 'PNG' : 'JPG'}
                      </button>
                    ))}
                  </div>
                  {exportFormat === 'jpeg' && (
                    <div>
                      <div className="flex items-baseline justify-between">
                        <label htmlFor="quality" className="text-xs font-semibold text-ink-600">
                          Qualité JPG
                        </label>
                        <span className="text-xs font-bold tabular-nums text-emerald-600">
                          {Math.round(exportQuality * 100)} %
                        </span>
                      </div>
                      <input
                        id="quality"
                        type="range"
                        min={0.6}
                        max={1}
                        step={0.05}
                        value={exportQuality}
                        onChange={(event) => setExportQuality(Number(event.target.value))}
                        className="mt-1"
                      />
                    </div>
                  )}
                  <ExportButton
                    disabled={!frameImage || logos.length === 0}
                    format={exportFormat}
                    quality={exportQuality}
                    frameSize={frame ? { width: frame.width, height: frame.height } : null}
                    onBuild={handleExport}
                    onError={(message) => notify('error', message)}
                  />
                </div>
              </Panel>
            </aside>
          </div>
        )}
      </main>

      <footer className="border-t border-ink-100 bg-white/60 px-4 py-4 text-center text-[11px] text-ink-400 sm:px-6">
        Logo Center · traitement 100 % dans votre navigateur · vos fichiers ne quittent jamais votre appareil.
      </footer>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*                                 Sub-views                                  */
/* -------------------------------------------------------------------------- */

function clampPct(value: number): number {
  return Math.min(MAX_SIZE_PCT, Math.max(MIN_SIZE_PCT, Math.round(value)))
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-ink-400">{title}</h2>
      {children}
    </section>
  )
}

function StatusBar({
  frame,
  stats,
  logos,
  overflow,
}: {
  frame: { width: number; height: number } | null
  stats: GroupStats | null
  logos: number
  overflow: boolean
}) {
  const centeredX = frame && stats ? Math.abs(stats.centerX - frame.width / 2) < 1 : false
  const centeredY = frame && stats ? Math.abs(stats.centerY - frame.height / 2) < 1 : false

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/10 bg-ink-900/80 px-3 py-1.5 text-[11px] font-medium text-ink-300 backdrop-blur-sm">
      <span className="flex items-center gap-1.5">
        <FileImage size={12} />
        {frame ? `${frame.width} × ${frame.height} px` : '—'}
      </span>
      <span className="text-ink-600">|</span>
      <span>
        {logos} logo{logos > 1 ? 's' : ''}
      </span>
      {stats && (
        <>
          <span className="text-ink-600">|</span>
          <span className={centeredX ? 'text-emerald-400' : ''}>Centre H {centeredX ? '✓' : '✗'}</span>
          <span className={centeredY ? 'text-emerald-400' : ''}>Centre V {centeredY ? '✓' : '✗'}</span>
        </>
      )}
      {overflow && <span className="font-semibold text-amber-400">Débordement</span>}
    </div>
  )
}

function Intro({ onPick }: { onPick: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  return (
    <div className="lc-animate-in mx-auto max-w-4xl">
      <div className="rounded-3xl border border-ink-100 bg-white p-6 shadow-sm sm:p-10">
        <div className="text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-xl shadow-indigo-500/30">
            <Sparkles size={26} />
          </div>
          <h2 className="mt-4 text-xl font-bold text-ink-900 sm:text-2xl">Commencez par votre image</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-ink-500">
            Importez votre cadre ou votre photo, puis ajoutez 2 ou 3 logos. Le groupe sera placé automatiquement au
            centre, parfaitement aligné et espacé.
          </p>
        </div>

        <div className="mt-7">
          <ImageUploader
            fileName={null}
            resolution={null}
            fileSize={null}
            onFiles={(files) => {
              onPick(files)
              if (inputRef.current) inputRef.current.value = ''
            }}
          />
        </div>

        <ol className="mt-7 grid gap-3 sm:grid-cols-3">
          {[
            { icon: ImageIcon, title: '1. Importez', text: 'Déposez votre photo, votre cadre ou un fond.' },
            { icon: Boxes, title: '2. Ajoutez', text: 'Jusqu’à 3 logos PNG, JPG, WEBP ou SVG.' },
            { icon: CheckCircle2, title: '3. Téléchargez', text: 'Centrez, ajustez, puis exportez en PNG ou JPG.' },
          ].map((step) => (
            <li key={step.title} className="rounded-xl border border-ink-100 bg-ink-50/50 p-4">
              <step.icon size={18} className="text-indigo-600" />
              <p className="mt-2 text-sm font-bold text-ink-800">{step.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{step.text}</p>
            </li>
          ))}
        </ol>

        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-ink-400">
          <MousePointerClick size={14} />
          Astuce : molette pour zoomer, glisser-déposer pour déplacer, poignée pour redimensionner.
        </p>
      </div>
    </div>
  )
}
