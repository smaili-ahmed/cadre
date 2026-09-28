import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignHorizontalDistributeCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  Grid3x3,
  Magnet,
  Maximize,
  Redo2,
  RotateCcw,
  ScanLine,
  Trash2,
  Undo2,
} from 'lucide-react'
import type { ComponentType } from 'react'

export interface ToolbarProps {
  canUndo: boolean
  canRedo: boolean
  canDelete: boolean
  hasMultiple: boolean
  hasFrame: boolean
  hasLogos: boolean
  showGuides: boolean
  showGrid: boolean
  snapEnabled: boolean
  onCenterAll: () => void
  onCenterH: () => void
  onCenterV: () => void
  onDistribute: () => void
  onAlignEdge: (edge: 'left' | 'right' | 'top' | 'bottom') => void
  onReset: () => void
  onUndo: () => void
  onRedo: () => void
  onDelete: () => void
  onFit: () => void
  onToggleGuides: () => void
  onToggleGrid: () => void
  onToggleSnap: () => void
}

interface ToolButtonProps {
  label: string
  hint?: string
  icon: ComponentType<{ size?: number | string; className?: string }>
  onClick: () => void
  disabled?: boolean
  active?: boolean
  danger?: boolean
}

function ToolButton({ label, hint, icon: Icon, onClick, disabled, active, danger }: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint ? `${label} — ${hint}` : label}
      aria-label={label}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:border-ink-100 disabled:bg-ink-50 disabled:text-ink-300 ${
        active
          ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
          : danger
            ? 'border-ink-100 bg-white text-ink-600 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600'
            : 'border-ink-100 bg-white text-ink-600 hover:border-ink-300 hover:bg-ink-50 hover:text-ink-900'
      }`}
    >
      <Icon size={15} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

export function Toolbar(props: ToolbarProps) {
  const {
    canUndo,
    canRedo,
    canDelete,
    hasMultiple,
    hasFrame,
    hasLogos,
    showGuides,
    showGrid,
    snapEnabled,
  } = props

  const idle = !hasFrame || !hasLogos

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-ink-100 bg-white/90 p-2 shadow-sm backdrop-blur">
      <span className="px-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-400">Centrage</span>
      <ToolButton
        label="Centrer H"
        hint="centre le groupe horizontalement"
        icon={AlignCenterHorizontal}
        onClick={props.onCenterH}
        disabled={idle}
      />
      <ToolButton
        label="Centrer V"
        hint="centre le groupe verticalement"
        icon={AlignCenterVertical}
        onClick={props.onCenterV}
        disabled={idle}
      />
      <ToolButton
        label="Tout centrer"
        hint="centre le groupe dans les deux axes"
        icon={ScanLine}
        onClick={props.onCenterAll}
        disabled={idle}
      />
      <ToolButton
        label="Distribuer"
        hint="répartit les logos à intervalles réguliers"
        icon={AlignHorizontalDistributeCenter}
        onClick={props.onDistribute}
        disabled={!hasFrame || !hasMultiple}
      />
      <ToolButton
        label="Bord gauche"
        icon={ArrowUpToLine}
        onClick={() => props.onAlignEdge('left')}
        disabled={!hasFrame || !hasMultiple}
      />
      <ToolButton
        label="Bord droit"
        icon={ArrowDownToLine}
        onClick={() => props.onAlignEdge('right')}
        disabled={!hasFrame || !hasMultiple}
      />
      <ToolButton
        label="Haut"
        icon={ArrowUpToLine}
        onClick={() => props.onAlignEdge('top')}
        disabled={!hasFrame || !hasMultiple}
      />
      <ToolButton
        label="Bas"
        icon={ArrowDownToLine}
        onClick={() => props.onAlignEdge('bottom')}
        disabled={!hasFrame || !hasMultiple}
      />
      <ToolButton label="Réinitialiser" hint="retourne au centrage automatique" icon={RotateCcw} onClick={props.onReset} disabled={idle} />

      <span className="mx-1 hidden h-6 w-px bg-ink-100 sm:block" />

      <ToolButton label="Annuler" icon={Undo2} onClick={props.onUndo} disabled={!canUndo} />
      <ToolButton label="Rétablir" icon={Redo2} onClick={props.onRedo} disabled={!canRedo} />
      <ToolButton label="Supprimer" icon={Trash2} onClick={props.onDelete} disabled={!canDelete} danger />

      <span className="mx-1 hidden h-6 w-px bg-ink-100 sm:block" />

      <ToolButton
        label="Aimant"
        hint="accroche le logo ou le groupe sur les lignes de centre"
        icon={Magnet}
        onClick={props.onToggleSnap}
        active={snapEnabled}
        disabled={!hasFrame}
      />
      <ToolButton
        label="Centres"
        hint="lignes verticale et horizontale de centre"
        icon={ScanLine}
        onClick={props.onToggleGuides}
        active={showGuides}
        disabled={!hasFrame}
      />
      <ToolButton label="Grille" icon={Grid3x3} onClick={props.onToggleGrid} active={showGrid} disabled={!hasFrame} />

      <span className="mx-1 hidden h-6 w-px bg-ink-100 sm:block" />

      <div className="ml-auto flex items-center gap-1.5">
        <ToolButton label="Ajuster" hint="ajuste à l’écran" icon={Maximize} onClick={props.onFit} disabled={!hasFrame} />
      </div>
    </div>
  )
}

export default Toolbar
