/**
 * The interactive editor.
 *
 * Coordinates: the fabric scene is expressed in IMAGE SPACE, i.e. the pixels
 * of the imported frame (0,0 = top-left of the frame, units = original
 * pixels). The zoom only lives in the viewport transform, therefore the export
 * is always produced at the original resolution.
 */

import * as fabric from 'fabric'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import {
  alignToEdge,
  boundsOf,
  defaultGapFor,
  distributeHorizontal,
  groupFitFactor,
  layoutGroup,
  type Edge,
} from '../utils/centering'
import { backgroundSize } from '../utils/background'
import type { Background, Box, CenterMode, EditorSnapshot, FrameSize, LogoItem } from '../utils/types'

const BACKGROUND_ID = 'frame-background'
const GUIDE_GRID_ID = 'guide-grid'
const GUIDE_V_ID = 'guide-center-v'
const GUIDE_H_ID = 'guide-center-h'
const MIN_ZOOM = 0.05
const MAX_ZOOM = 8

export interface EditorApi {
  centerGroup: (mode: CenterMode) => void
  centerH: () => void
  centerV: () => void
  distributeH: () => void
  alignEdge: (edge: Edge) => void
  relayout: (mode: CenterMode) => void
  resetLogos: () => void
  deleteSelected: () => void
  selectLogo: (id: string | null) => void
  applySpacing: (mode: CenterMode) => void
  bringForward: () => void
  sendBackward: () => void
  applySnapshot: (snapshot: EditorSnapshot) => void
  captureSnapshot: (spacing: number) => EditorSnapshot
  fitToScreen: () => void
  setZoom: (zoom: number) => void
  getZoom: () => number
  getFrame: () => FrameSize
  getBoxes: () => Box[]
  isReady: () => boolean
}

export interface CanvasEditorProps {
  /**
   * The plate behind the logos: an image or a flat colour. There is always one,
   * so the canvas, the centring maths and the export share a single size.
   */
  background: Background
  logos: LogoItem[]
  spacing: number
  centerMode: CenterMode
  showGuides: boolean
  showGrid: boolean
  snapEnabled: boolean
  activeId: string | null
  className?: string
  onSelect: (id: string | null) => void
  onGeometryChange: (id: string, patch: Partial<Pick<Box, 'left' | 'top' | 'width' | 'height'>>) => void
  onCommit: (reason: CommitReason, previous?: EditorSnapshot) => void
  onGroupStatsChange: (stats: { centerX: number; centerY: number; width: number; height: number } | null) => void
  onFitRequested?: () => void
}

export type CommitReason = 'move' | 'resize' | 'layout' | 'size' | 'spacing' | 'reset' | 'delete' | 'order'

function isLogoObject(obj: fabric.FabricObject | undefined): obj is fabric.FabricImage & { logoId: string } {
  return !!obj && (obj as { logoId?: string }).logoId !== undefined
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export const CanvasEditor = forwardRef<EditorApi, CanvasEditorProps>(function CanvasEditor(props, ref) {
  const {
    background,
    logos,
    spacing,
    centerMode,
    showGuides,
    showGrid,
    snapEnabled,
    activeId,
    onSelect,
    onGeometryChange,
    onCommit,
    onGroupStatsChange,
  } = props

  const canvasElRef = useRef<HTMLCanvasElement | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<fabric.Canvas | null>(null)
  const frameRef = useRef<FrameSize | null>(backgroundSize(background))
  const guidesRef = useRef<{ v?: fabric.Line; h?: fabric.Line; grid?: fabric.Group }>({})
  /** Centre of the logo being transformed, so a resize grows around itself. */
  const anchorRef = useRef<{ centerX: number; centerY: number } | null>(null)
  /** State captured when a drag starts, used as the undo step. */
  const undoStepRef = useRef<EditorSnapshot | null>(null)
  const objectsRef = useRef(new Map<string, fabric.FabricImage>())
  const logosRef = useRef(logos)
  const spacingRef = useRef(spacing)
  const centerModeRef = useRef(centerMode)
  const showGuidesRef = useRef(showGuides)
  const showGridRef = useRef(showGrid)
  const snapRef = useRef(snapEnabled)
  const activeIdRef = useRef(activeId)
  const zoomRef = useRef(1)
  const fitZoomRef = useRef(1)
  const syncingFromReact = useRef(false)
  const gestureRef = useRef<{ distance: number; zoom: number } | null>(null)

  // Latest callbacks, kept in refs so that the fabric listeners (registered
  // once) always call the current version without being re-registered.
  const handlers = useRef({ onSelect, onGeometryChange, onCommit, onGroupStatsChange })
  handlers.current = { onSelect, onGeometryChange, onCommit, onGroupStatsChange }

  spacingRef.current = spacing
  logosRef.current = logos
  centerModeRef.current = centerMode
  showGuidesRef.current = showGuides
  showGridRef.current = showGrid
  snapRef.current = snapEnabled
  activeIdRef.current = activeId
  frameRef.current = backgroundSize(background)

  /* ------------------------------------------------------------------ */
  /*                            Scene helpers                            */
  /* ------------------------------------------------------------------ */

  const getLogoObjects = useCallback((): fabric.FabricImage[] => {
    const canvas = canvasRef.current
    if (!canvas) return []
    return canvas
      .getObjects()
      .filter(isLogoObject)
      .sort((a, b) => a.get('stackIndex') - b.get('stackIndex')) as fabric.FabricImage[]
  }, [])

  const readBoxes = useCallback((): Box[] => {
    return getLogoObjects().map((obj) => ({
      id: (obj as fabric.FabricImage & { logoId: string }).logoId,
      left: obj.left,
      top: obj.top,
      width: obj.getScaledWidth(),
      height: obj.getScaledHeight(),
    }))
  }, [getLogoObjects])

  const emitGroupStats = useCallback(() => {
    const currentFrame = frameRef.current
    if (!currentFrame) {
      handlers.current.onGroupStatsChange(null)
      return
    }
    const boxes = readBoxes()
    if (boxes.length === 0) {
      handlers.current.onGroupStatsChange(null)
      return
    }
    const bounds = boundsOf(boxes)
    handlers.current.onGroupStatsChange({
      centerX: bounds.centerX,
      centerY: bounds.centerY,
      width: bounds.width,
      height: bounds.height,
    })
  }, [readBoxes])

  const writeGeometry = useCallback(
    (obj: fabric.FabricImage, notify = true) => {
      const id = (obj as fabric.FabricImage & { logoId: string }).logoId
      if (notify) {
        handlers.current.onGeometryChange(id, {
          left: obj.left,
          top: obj.top,
          width: obj.getScaledWidth(),
          height: obj.getScaledHeight(),
        })
      }
    },
    [],
  )

  const commitAll = useCallback(() => {
    getLogoObjects().forEach((obj) => writeGeometry(obj, true))
  }, [getLogoObjects, writeGeometry])

  /** Applies a box layout to the fabric objects (no re-creation, keeps selection). */
  const applyBoxes = useCallback(
    (boxes: Box[]) => {
      const canvas = canvasRef.current
      if (!canvas) return
      syncingFromReact.current = true
      boxes.forEach((box) => {
        const obj = objectsRef.current.get(box.id)
        if (!obj) return
        const natural = obj.width || box.width
        const scaleX = box.width / natural
        obj.set({
          left: box.left,
          top: box.top,
          scaleX,
          scaleY: scaleX,
          flipX: false,
          flipY: false,
          angle: 0,
        })
        obj.setCoords()
      })
      canvas.requestRenderAll()
      emitGroupStats()
      // Release on the next tick so the React state round-trip is ignored.
      window.setTimeout(() => {
        syncingFromReact.current = false
      }, 0)
    },
    [emitGroupStats],
  )

  const runLayout = useCallback(
    (mode: CenterMode) => {
      const currentFrame = frameRef.current
      if (!currentFrame) return
      const boxes = readBoxes()
      if (boxes.length === 0) return
      applyBoxes(layoutGroup(boxes, spacingRef.current, currentFrame, mode))
    },
    [applyBoxes, readBoxes],
  )

  /* ------------------------------------------------------------------ */
  /*                                Guides                              */
  /* ------------------------------------------------------------------ */

  /**
   * Detaches a scene object from the canvas, then frees it.
   *
   * `dispose()` on its own is NOT enough: the object stays in the canvas object
   * list and is still drawn. A rebuilt plate or guide would therefore be painted
   * *under* its own replacement — which is why changing the background colour
   * had no visible effect while the exported file was correct.
   */
  const dropObject = (object: fabric.FabricObject | null | undefined, target: fabric.Canvas | null = canvasRef.current) => {
    if (!object) return
    target?.remove(object)
    object.dispose()
  }

  const buildGuides = useCallback(() => {
    const canvas = canvasRef.current
    const currentFrame = frameRef.current
    if (!canvas || !currentFrame) return
    const { width, height } = currentFrame

    dropObject(guidesRef.current.v)
    dropObject(guidesRef.current.h)
    dropObject(guidesRef.current.grid)
    guidesRef.current = {}

    if (showGridRef.current) {
      const lines: fabric.Line[] = []
      const stepX = Math.max(1, Math.round(width / 16))
      const stepY = Math.max(1, Math.round(height / 16))
      for (let x = stepX; x < width; x += stepX) {
        lines.push(
          new fabric.Line([x, 0, x, height], {
            stroke: 'rgba(99,102,241,0.16)',
            strokeWidth: 1,
            selectable: false,
            evented: false,
            excludeFromExport: true,
            objectCaching: false,
            hoverCursor: 'default',
          }),
        )
      }
      for (let y = stepY; y < height; y += stepY) {
        lines.push(
          new fabric.Line([0, y, width, y], {
            stroke: 'rgba(99,102,241,0.16)',
            strokeWidth: 1,
            selectable: false,
            evented: false,
            excludeFromExport: true,
            objectCaching: false,
            hoverCursor: 'default',
          }),
        )
      }
      const grid = new fabric.Group(lines, {
        selectable: false,
        evented: false,
        excludeFromExport: true,
        objectCaching: false,
      })
      grid.set({ id: GUIDE_GRID_ID })
      canvas.add(grid)
      guidesRef.current.grid = grid
    }

    if (showGuidesRef.current) {
      const vertical = new fabric.Line([width / 2, 0, width / 2, height], {
        stroke: 'rgba(236,72,153,0.85)',
        strokeWidth: 1.5,
        strokeDashArray: [10, 8],
        selectable: false,
        evented: false,
        excludeFromExport: true,
        objectCaching: false,
        hoverCursor: 'default',
        opacity: 0.75,
      })
      vertical.set({ id: GUIDE_V_ID })
      const horizontal = new fabric.Line([0, height / 2, width, height / 2], {
        stroke: 'rgba(236,72,153,0.85)',
        strokeWidth: 1.5,
        strokeDashArray: [10, 8],
        selectable: false,
        evented: false,
        excludeFromExport: true,
        objectCaching: false,
        hoverCursor: 'default',
        opacity: 0.75,
      })
      horizontal.set({ id: GUIDE_H_ID })
      canvas.add(vertical, horizontal)
      guidesRef.current.v = vertical
      guidesRef.current.h = horizontal
    }

    canvas.requestRenderAll()
  }, [])

  const setGuideActive = useCallback((axis: 'v' | 'h' | null) => {
    const guides = guidesRef.current
    const vOpacity = axis === 'v' ? 1 : 0.75
    const hOpacity = axis === 'h' ? 1 : 0.75
    if (guides.v && guides.v.opacity !== vOpacity) guides.v.set({ opacity: vOpacity })
    if (guides.h && guides.h.opacity !== hOpacity) guides.h.set({ opacity: hOpacity })
    canvasRef.current?.requestRenderAll()
  }, [])

  /* ------------------------------------------------------------------ */
  /*                                Zoom                                */
  /* ------------------------------------------------------------------ */

  const applyZoom = useCallback((next: number) => {
    const canvas = canvasRef.current
    const currentFrame = frameRef.current
    if (!canvas || !currentFrame) return
    const zoom = clamp(next, MIN_ZOOM, MAX_ZOOM)
    canvas.setZoom(zoom)
    canvas.setDimensions({ width: currentFrame.width * zoom, height: currentFrame.height * zoom })
    canvas.requestRenderAll()
    zoomRef.current = zoom
  }, [])

  const computeFitZoom = useCallback((): number => {
    const shell = shellRef.current
    const currentFrame = frameRef.current
    if (!shell || !currentFrame) return 1
    const rect = shell.getBoundingClientRect()
    const padding = 40
    const availableW = Math.max(120, rect.width - padding)
    const availableH = Math.max(120, rect.height - padding)
    const zoom = Math.min(availableW / currentFrame.width, availableH / currentFrame.height)
    return clamp(Number.isFinite(zoom) ? zoom : 1, MIN_ZOOM, MAX_ZOOM)
  }, [])

  const fitToScreen = useCallback(() => {
    const zoom = computeFitZoom()
    fitZoomRef.current = zoom
    applyZoom(zoom)
  }, [applyZoom, computeFitZoom])

  /* ------------------------------------------------------------------ */
  /*                           Scene building                           */
  /* ------------------------------------------------------------------ */

  const backgroundRef = useRef<fabric.FabricObject | null>(null)

  /**
   * Paints the plate: the imported image, or a rectangle filled with the chosen
   * colour. Both are inert (not selectable, always at the back), so they behave
   * identically for the logos layered on top.
   */
  const buildBackground = useCallback(async (plate: Background) => {
    const canvas = canvasRef.current
    if (!canvas) return
    dropObject(backgroundRef.current)
    backgroundRef.current = null

    const shared = {
      left: 0,
      top: 0,
      originX: 'left' as const,
      originY: 'top' as const,
      selectable: false,
      evented: false,
      hoverCursor: 'default',
      strokeWidth: 0,
      lockMovementX: true,
      lockMovementY: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      objectCaching: false,
    }

    let plate_: fabric.FabricObject
    if (plate.kind === 'color') {
      plate_ = new fabric.Rect({
        ...shared,
        width: plate.width,
        height: plate.height,
        fill: plate.color,
      })
    } else {
      const image = await fabric.FabricImage.fromURL(plate.image.url, { crossOrigin: 'anonymous' })
      image.set(shared)
      plate_ = image
    }

    plate_.set({ id: BACKGROUND_ID })
    canvas.add(plate_)
    canvas.sendObjectToBack(plate_)
    backgroundRef.current = plate_
  }, [])

  const createLogoObject = useCallback(async (logo: LogoItem, stackIndex: number) => {
    const image = await fabric.FabricImage.fromURL(logo.url, { crossOrigin: 'anonymous' })
    const scale = logo.naturalWidth > 0 ? logo.width / logo.naturalWidth : 1
    image.set({
      left: logo.left,
      top: logo.top,
      originX: 'left',
      originY: 'top',
      scaleX: scale,
      scaleY: scale,
      selectable: true,
      evented: true,
      lockRotation: true,
      lockScalingFlip: true,
      transparentCorners: false,
      cornerColor: '#ffffff',
      cornerStrokeColor: '#4f46e5',
      cornerStyle: 'circle',
      borderColor: '#4f46e5',
      cornerSize: 11,
      touchCornerSize: 24,
      padding: 2,
      // Must stay 0: fabric adds `strokeWidth` to the bounding box, which
      // would make the geometry drift on every move.
      strokeWidth: 0,
      objectCaching: false,
    })
    image.set({ id: logo.id, logoId: logo.id, stackIndex })
    return image as fabric.FabricImage & { logoId: string }
  }, [])

  const rebuildLogos = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    syncingFromReact.current = true
    getLogoObjects().forEach((obj) => {
      canvas.remove(obj)
      obj.dispose()
    })
    objectsRef.current.clear()

    const created: fabric.FabricImage[] = []
    for (let index = 0; index < logos.length; index += 1) {
      const logo = logos[index]
      try {
        const obj = await createLogoObject(logo, index)
        canvas.add(obj)
        objectsRef.current.set(logo.id, obj)
        created.push(obj)
      } catch {
        // A broken logo simply does not appear; App reports the error.
      }
    }
    canvas.requestRenderAll()
    emitGroupStats()
    if (activeIdRef.current) {
      const target = objectsRef.current.get(activeIdRef.current)
      if (target) canvas.setActiveObject(target)
    }
    window.setTimeout(() => {
      syncingFromReact.current = false
    }, 0)
  }, [createLogoObject, emitGroupStats, getLogoObjects, logos])

  /* ------------------------------------------------------------------ */
  /*                        Fabric event listeners                      */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    const element = canvasElRef.current
    if (!element) return

    const canvas = new fabric.Canvas(element, {
      preserveObjectStacking: true,
      renderOnAddRemove: false,
      selection: true,
      selectionColor: 'rgba(79,70,229,0.08)',
      selectionBorderColor: '#4f46e5',
      selectionLineWidth: 1,
      stopContextMenu: true,
      fireRightClick: false,
      backgroundColor: '#0b0d12',
      enableRetinaScaling: true,
      uniformScaling: true,
    })
    canvasRef.current = canvas

    const handleSelection = () => {
      const active = canvas.getActiveObject()
      const id = isLogoObject(active) ? active.logoId : null
      handlers.current.onSelect(id)
    }

    const handleObjectMoving = () => {
      const target = canvas.getActiveObject()
      const currentFrame = frameRef.current
      if (!isLogoObject(target) || !currentFrame) return
      if (snapRef.current) {
        const toleranceX = Math.max(5 / zoomRef.current, currentFrame.width * 0.006)
        const toleranceY = Math.max(5 / zoomRef.current, currentFrame.height * 0.006)
        const centerX = target.left + target.getScaledWidth() / 2
        const centerY = target.top + target.getScaledHeight() / 2
        let axis: 'v' | 'h' | null = null

        // 1) Snap the dragged logo itself on the centre lines.
        if (Math.abs(centerX - currentFrame.width / 2) <= toleranceX) {
          target.set({ left: target.left + (currentFrame.width / 2 - centerX) })
          axis = 'v'
        }
        if (Math.abs(centerY - currentFrame.height / 2) <= toleranceY) {
          target.set({ top: target.top + (currentFrame.height / 2 - centerY) })
          axis = axis ?? 'h'
        }

        // 2) Otherwise snap the whole GROUP when its bounding box hits a centre line.
        if (axis === null) {
          const boxes = readBoxes()
          if (boxes.length > 1) {
            const bounds = boundsOf(boxes)
            const dx = currentFrame.width / 2 - bounds.centerX
            if (Math.abs(dx) <= toleranceX) {
              boxes.forEach((box) => {
                const obj = objectsRef.current.get(box.id)
                if (obj) obj.set({ left: obj.left + dx })
              })
              axis = 'v'
            }
            const dy = currentFrame.height / 2 - bounds.centerY
            if (Math.abs(dy) <= toleranceY) {
              boxes.forEach((box) => {
                const obj = objectsRef.current.get(box.id)
                if (obj) obj.set({ top: obj.top + dy })
              })
              axis = axis ?? 'h'
            }
            if (axis) {
              boxes.forEach((box) => objectsRef.current.get(box.id)?.setCoords())
            }
          }
        }

        if (axis) {
          target.setCoords()
          setGuideActive(axis)
        }
      }
      canvas.requestRenderAll()
    }

    const handleScaling = () => {
      const target = canvas.getActiveObject()
      if (!isLogoObject(target)) return
      // Hard guarantee: logos are NEVER distorted, whatever the control used.
      const naturalWidth = target.width || 1
      const naturalHeight = target.height || 1
      const ratio = naturalHeight / naturalWidth
      const scaleX = target.scaleX || 1
      const expected = scaleX * ratio
      if (Math.abs(target.scaleY - expected) > 0.0001) {
        target.set({ scaleY: expected })
      }
      // Grow around the centre that was grabbed, so the logo never drifts away
      // from where the user started the gesture.
      const anchor = anchorRef.current
      if (anchor) {
        target.set({
          left: anchor.centerX - target.getScaledWidth() / 2,
          top: anchor.centerY - target.getScaledHeight() / 2,
        })
      }
      target.setCoords()
      canvas.requestRenderAll()
    }

    /** Single commit point: fires for move, scale and any transform end. */
    const handleModified = () => {
      const target = canvas.getActiveObject()
      setGuideActive(null)
      if (!isLogoObject(target)) return
      commitAll()
      emitGroupStats()
      // The undo step must be the state *before* the gesture, captured on
      // mouse-down: by now the geometry has already been changed.
      const previous = undoStepRef.current ?? undefined
      undoStepRef.current = null
      handlers.current.onCommit('move', previous)
    }

    const handleMouseWheel = (opt: fabric.TPointerEventInfo<WheelEvent>) => {
      const event = opt.e
      event.preventDefault()
      event.stopPropagation()
      const delta = event.deltaY
      const factor = 0.999 ** delta
      const next = clamp(zoomRef.current * factor, MIN_ZOOM, MAX_ZOOM)
      const zoom = canvas.getZoom()
      if (zoom === next) return
      canvas.zoomToPoint(new fabric.Point(event.offsetX, event.offsetY), next)
      zoomRef.current = next
      canvas.setDimensions({
        width: (frameRef.current?.width ?? canvas.getWidth() / zoom) * next,
        height: (frameRef.current?.height ?? canvas.getHeight() / zoom) * next,
      })
      canvas.requestRenderAll()
    }

    canvas.on('selection:created', handleSelection)
    canvas.on('selection:updated', handleSelection)
    canvas.on('selection:cleared', handleSelection)
    canvas.on('mouse:down', () => {
      setGuideActive(null)
      const target = canvas.getActiveObject()
      if (!isLogoObject(target)) {
        anchorRef.current = null
        undoStepRef.current = null
        return
      }
      // Remembers the centre of the grabbed logo, used to scale around itself.
      anchorRef.current = {
        centerX: (target.left ?? 0) + target.getScaledWidth() / 2,
        centerY: (target.top ?? 0) + target.getScaledHeight() / 2,
      }
      undoStepRef.current = {
        spacing: spacingRef.current,
        logos: readBoxes().map((box) => {
          const logo = logosRef.current.find((item) => item.id === box.id)
          return { ...box, sizePct: logo?.sizePct ?? 100 }
        }),
      }
    })
    canvas.on('object:moving', handleObjectMoving)
    canvas.on('object:scaling', handleScaling)
    canvas.on('object:modified', handleModified)
    canvas.on('mouse:wheel', handleMouseWheel)

    return () => {
      canvas.off()
      // Snapshot the refs: their `.current` may already have been replaced by
      // the time this cleanup runs.
      const guides = guidesRef.current
      const objects = objectsRef.current
      const background = backgroundRef.current
      dropObject(guides.v, canvas)
      dropObject(guides.h, canvas)
      dropObject(guides.grid, canvas)
      guidesRef.current = {}
      dropObject(background, canvas)
      backgroundRef.current = null
      objects.forEach((obj) => dropObject(obj, canvas))
      objects.clear()
      void canvas.dispose()
      canvasRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ------------------------------------------------------------------ */
  /*                     React state -> fabric scene                    */
  /* ------------------------------------------------------------------ */

  // Background plate: imported image, or solid colour.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    const size = backgroundSize(background)
    if (!size) return
    frameRef.current = size

    const setup = async () => {
      await buildBackground(background)
      if (cancelled) return
      buildGuides()
      fitToScreen()
      emitGroupStats()
    }
    void setup()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [background])

  // Logo list (add / remove / replace) — identity based, not geometry based.
  const logoSignature = logos.map((logo) => `${logo.id}:${logo.url}:${logo.naturalWidth}x${logo.naturalHeight}`).join('|')
  useEffect(() => {
    if (!frameRef.current) return
    syncingFromReact.current = true
    const rebuild = async () => {
      await rebuildLogos()
      runLayout(centerModeRef.current)
    }
    void rebuild()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logoSignature])

  // Geometry coming from React (sliders, spacing, undo/redo, auto-centring).
  const geometrySignature = logos
    .map((logo) => `${logo.id}:${logo.left.toFixed(2)}:${logo.top.toFixed(2)}:${logo.width.toFixed(2)}:${logo.height.toFixed(2)}`)
    .join('|')
  useEffect(() => {
    if (!frameRef.current) return
    if (syncingFromReact.current) return
    const boxes = logos.map((logo) => ({
      id: logo.id,
      left: logo.left,
      top: logo.top,
      width: logo.width,
      height: logo.height,
    }))
    applyBoxes(boxes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometrySignature])

  // Guides / grid visibility.
  useEffect(() => {
    if (!frameRef.current || !canvasRef.current) return
    buildGuides()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGuides, showGrid])

  // Selection highlight driven by the sidebar.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const active = canvas.getActiveObject()
    if (!activeId) {
      if (active) canvas.discardActiveObject()
      canvas.requestRenderAll()
      return
    }
    const target = objectsRef.current.get(activeId)
    if (target && active !== target) {
      canvas.setActiveObject(target)
      canvas.requestRenderAll()
    }
  }, [activeId, geometrySignature])

  // Keep the "fit" zoom in sync with the container size.
  useEffect(() => {
    const shell = shellRef.current
    if (!shell || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const currentFrame = frameRef.current
      if (!currentFrame) return
      const zoom = computeFitZoom()
      fitZoomRef.current = zoom
      // Only re-fit automatically while the user is at the previous fit zoom.
      if (Math.abs(zoomRef.current - fitZoomRef.current) < 0.001 || Math.abs(zoomRef.current - 1) < 0.001) {
        applyZoom(zoom)
      }
    })
    observer.observe(shell)
    return () => observer.disconnect()
  }, [applyZoom, computeFitZoom])

  // Pinch to zoom on touch devices.
  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return

    const getDistance = (touches: TouchList) => {
      const [a, b] = [touches[0], touches[1]]
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return
      gestureRef.current = { distance: getDistance(event.touches), zoom: zoomRef.current }
    }

    const onTouchMove = (event: TouchEvent) => {
      const gesture = gestureRef.current
      if (!gesture || event.touches.length !== 2) return
      event.preventDefault()
      const distance = getDistance(event.touches)
      const next = clamp((gesture.zoom * distance) / gesture.distance, MIN_ZOOM, MAX_ZOOM)
      if (Math.abs(next - zoomRef.current) < 0.0005) return
      applyZoom(next)
    }

    const onTouchEnd = () => {
      gestureRef.current = null
    }

    shell.addEventListener('touchstart', onTouchStart, { passive: true })
    shell.addEventListener('touchmove', onTouchMove, { passive: false })
    shell.addEventListener('touchend', onTouchEnd)
    shell.addEventListener('touchcancel', onTouchEnd)
    return () => {
      shell.removeEventListener('touchstart', onTouchStart)
      shell.removeEventListener('touchmove', onTouchMove)
      shell.removeEventListener('touchend', onTouchEnd)
      shell.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [applyZoom])

  /* ------------------------------------------------------------------ */
  /*                          Imperative API                            */
  /* ------------------------------------------------------------------ */

  useImperativeHandle(
    ref,
    (): EditorApi => ({
      centerGroup: (mode: CenterMode) => {
        runLayout(mode)
        handlers.current.onCommit('layout')
      },
      centerH: () => {
        runLayout('horizontal')
        handlers.current.onCommit('layout')
      },
      centerV: () => {
        runLayout('vertical')
        handlers.current.onCommit('layout')
      },
      distributeH: () => {
        const currentFrame = frameRef.current
        if (!currentFrame) return
        const canvas = canvasRef.current
        if (!canvas) return
        const boxes = readBoxes()
        if (boxes.length < 2) return
        const gap = defaultGapFor(boxes)
        const spread = distributeHorizontal(boxes, gap)
        const bounds = boundsOf(spread)
        const dx = currentFrame.width / 2 - bounds.centerX
        applyBoxes(spread.map((box) => ({ ...box, left: box.left + dx })))
        handlers.current.onCommit('layout')
      },
      alignEdge: (edge: Edge) => {
        const currentFrame = frameRef.current
        if (!currentFrame) return
        const boxes = readBoxes()
        if (boxes.length < 2) return
        const laid = layoutGroup(boxes, spacingRef.current, currentFrame, 'both')
        applyBoxes(alignToEdge(laid, edge, currentFrame))
        handlers.current.onCommit('layout')
      },
      relayout: (mode: CenterMode) => {
        runLayout(mode)
      },
      resetLogos: () => {
        const currentFrame = frameRef.current
        if (!currentFrame) return
        const boxes = readBoxes()
        if (boxes.length === 0) return
        const gap = boxes.length > 1 ? defaultGapFor(boxes) : 0
        const factor = groupFitFactor(boxes, gap, currentFrame)
        const normalized = boxes.map((box) => ({
          ...box,
          width: box.width * factor,
          height: box.height * factor,
        }))
        applyBoxes(layoutGroup(normalized, gap, currentFrame, 'both'))
        handlers.current.onCommit('reset')
      },
      deleteSelected: () => {
        const canvas = canvasRef.current
        if (!canvas) return
        const target = canvas.getActiveObject()
        if (!isLogoObject(target)) return
        const id = target.logoId
        canvas.remove(target)
        target.dispose()
        objectsRef.current.delete(id)
        canvas.discardActiveObject()
        canvas.requestRenderAll()
        emitGroupStats()
        handlers.current.onCommit('delete')
      },
      selectLogo: (id: string | null) => {
        const canvas = canvasRef.current
        if (!canvas) return
        if (!id) {
          canvas.discardActiveObject()
          canvas.requestRenderAll()
          return
        }
        const target = objectsRef.current.get(id)
        if (target) {
          canvas.setActiveObject(target)
          canvas.requestRenderAll()
        }
      },
      applySpacing: (mode: CenterMode) => {
        const currentFrame = frameRef.current
        if (!currentFrame) return
        runLayout(mode)
        handlers.current.onCommit('spacing')
      },
      bringForward: () => {
        const canvas = canvasRef.current
        const target = canvas?.getActiveObject()
        if (!canvas || !isLogoObject(target)) return
        const stack = getLogoObjects()
        const index = stack.findIndex((obj) => obj === target)
        if (index < 0 || index >= stack.length - 1) return
        target.set('stackIndex', index + 1)
        canvas.bringObjectForward(target)
        canvas.requestRenderAll()
        handlers.current.onCommit('order')
      },
      sendBackward: () => {
        const canvas = canvasRef.current
        const target = canvas?.getActiveObject()
        if (!canvas || !isLogoObject(target)) return
        const stack = getLogoObjects()
        const index = stack.findIndex((obj) => obj === target)
        if (index <= 0) return
        target.set('stackIndex', index - 1)
        canvas.sendObjectBackwards(target)
        canvas.requestRenderAll()
        handlers.current.onCommit('order')
      },
      applySnapshot: (snapshot: EditorSnapshot) => {
        const canvas = canvasRef.current
        if (!canvas) return
        syncingFromReact.current = true
        snapshot.logos.forEach((entry) => {
          const obj = objectsRef.current.get(entry.id)
          if (!obj) return
          const naturalWidth = obj.width || entry.width || 1
          const naturalHeight = obj.height || entry.height || 1
          const scaleX = entry.width / naturalWidth
          const scaleY = entry.height / naturalHeight
          obj.set({ left: entry.left, top: entry.top, scaleX, scaleY })
          obj.setCoords()
        })
        canvas.requestRenderAll()
        emitGroupStats()
        window.setTimeout(() => {
          syncingFromReact.current = false
        }, 0)
      },
      captureSnapshot: (gap: number): EditorSnapshot => ({
        spacing: gap,
        logos: readBoxes().map((box) => {
          const logo = logos.find((item) => item.id === box.id)
          return { ...box, sizePct: logo?.sizePct ?? 100 }
        }),
      }),
      fitToScreen,
      setZoom: (zoom: number) => applyZoom(zoom),
      getZoom: () => zoomRef.current,
      getFrame: () => frameRef.current ?? { width: 0, height: 0 },
      getBoxes: () => readBoxes(),
      isReady: () => canvasRef.current !== null,
    }),
    [applyBoxes, applyZoom, emitGroupStats, fitToScreen, getLogoObjects, logos, readBoxes, runLayout],
  )

  return (
    <div
      ref={shellRef}
      className={
        props.className ??
        'relative flex h-full w-full items-center justify-center overflow-auto rounded-2xl bg-ink-900/95 p-5 thin-scroll'
      }
    >
      <canvas ref={canvasElRef} />
    </div>
  )
})

export default CanvasEditor
