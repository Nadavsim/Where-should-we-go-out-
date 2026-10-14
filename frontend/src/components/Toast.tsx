import { useEffect } from 'react'

export interface ToastState {
  message: string
  action?: { label: string; run: () => void }
}

const TOAST_MS = 6000

export function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [toast, onClose])

  return (
    <div className="toast" role="status">
      <span>{toast.message}</span>
      {toast.action && (
        <button
          className="link-button"
          onClick={() => {
            toast.action!.run()
            onClose()
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}
