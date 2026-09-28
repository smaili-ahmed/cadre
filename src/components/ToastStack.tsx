import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useEffect } from 'react'

export type ToastKind = 'info' | 'success' | 'error'

export interface ToastMessage {
  id: number
  kind: ToastKind
  text: string
}

const STYLES: Record<ToastKind, { icon: typeof Info; ring: string; iconColor: string }> = {
  info: { icon: Info, ring: 'border-ink-200 bg-white', iconColor: 'text-ink-500' },
  success: { icon: CheckCircle2, ring: 'border-emerald-200 bg-emerald-50', iconColor: 'text-emerald-600' },
  error: { icon: AlertCircle, ring: 'border-rose-200 bg-rose-50', iconColor: 'text-rose-600' },
}

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.kind === 'error' ? 7000 : 4000)
    return () => window.clearTimeout(timer)
  }, [onDismiss, toast.id, toast.kind])

  const style = STYLES[toast.kind]
  const Icon = style.icon

  return (
    <div
      role="status"
      className={`lc-toast-in pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-lg shadow-ink-900/5 ${style.ring}`}
    >
      <Icon size={17} className={`mt-0.5 shrink-0 ${style.iconColor}`} />
      <p className="flex-1 text-[13px] font-medium leading-snug text-ink-700">{toast.text}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Fermer la notification"
        className="-mr-1 shrink-0 rounded p-0.5 text-ink-300 transition hover:text-ink-600"
      >
        <X size={14} />
      </button>
    </div>
  )
}

export function ToastStack({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:left-auto sm:right-6 sm:items-end sm:px-0">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

export default ToastStack
