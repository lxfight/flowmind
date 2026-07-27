export type ConfirmTone = 'default' | 'warning' | 'danger'
export type ConfirmIcon = 'question' | 'warning' | 'delete' | 'reset'

export interface ConfirmOptions {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmTone
  icon?: ConfirmIcon
}

export interface ConfirmRequest {
  options: ConfirmOptions
  resolve: (confirmed: boolean) => void
}

const listeners = new Set<(request: ConfirmRequest) => void>()

export function subscribeConfirm(listener: (request: ConfirmRequest) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const listener = listeners.values().next().value
    if (!listener) {
      resolve(false)
      return
    }
    listener({ options, resolve })
  })
}
