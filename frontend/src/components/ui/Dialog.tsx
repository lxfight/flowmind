import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '../../utils/cn'
import { isTopModalLayer, registerModalLayer } from './modalStack'

export interface DialogProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  ariaLabel?: string
}

function getFirstFocusable(root: HTMLElement): HTMLElement | null {
  const selector =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  return root.querySelector(selector)
}

interface DialogContextValue {
  titleId: string
  descId: string
}

const DialogContext = createContext<DialogContextValue | null>(null)

function useDialogContext() {
  return useContext(DialogContext)
}

export function Dialog({ open, onClose, children, className, ariaLabel }: DialogProps) {
  const titleId = useId()
  const descId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const originalOverflow = useRef('')
  const layer = useRef(Symbol('dialog'))
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // ESC to close
  useEffect(() => {
    if (!open) return
    const unregister = registerModalLayer(layer.current)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopModalLayer(layer.current)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      unregister()
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  // Lock body scroll + focus management
  useEffect(() => {
    if (!open) {
      document.body.style.overflow = originalOverflow.current
      previousFocus.current?.focus?.()
      return
    }
    originalOverflow.current = document.body.style.overflow
    previousFocus.current = document.activeElement as HTMLElement
    document.body.style.overflow = 'hidden'
    const timer = setTimeout(() => {
      const first = panelRef.current ? getFirstFocusable(panelRef.current) : null
      first?.focus()
    }, 0)
    return () => {
      clearTimeout(timer)
      document.body.style.overflow = originalOverflow.current
      previousFocus.current?.focus?.()
    }
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className="absolute inset-0 bg-black/45 backdrop-blur-[3px] dark:bg-black/70"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descId}
            aria-label={ariaLabel}
            tabIndex={-1}
            className={cn(
              'relative z-10 w-full max-w-lg rounded-[8px] border border-border/90 bg-card/95 p-0 text-card-foreground shadow-[0_28px_90px_-32px_rgba(0,0,0,0.65)] outline-none backdrop-blur-xl',
              className
            )}
            initial={{ opacity: 0, scale: 0.975, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }}
            onClick={(e) => e.stopPropagation()}
          >
            <DialogContext.Provider value={{ titleId, descId }}>
              {children}
            </DialogContext.Provider>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export interface DialogHeaderProps {
  children: ReactNode
  className?: string
}

export function DialogHeader({ children, className }: DialogHeaderProps) {
  return (
    <div className={cn('flex flex-col space-y-1.5 border-b border-border bg-muted/[0.16] px-6 pb-5 pt-6', className)}>
      {children}
    </div>
  )
}

export interface DialogFooterProps {
  children: ReactNode
  className?: string
}

export function DialogFooter({ children, className }: DialogFooterProps) {
  return (
    <div className={cn('flex flex-col-reverse gap-2 border-t border-border bg-card/95 px-6 pb-6 pt-4 sm:flex-row sm:justify-end', className)}>
      {children}
    </div>
  )
}

export interface DialogTitleProps {
  children: ReactNode
  className?: string
  showClose?: boolean
  onClose?: () => void
}

export function DialogTitle({ children, className, showClose = false, onClose }: DialogTitleProps) {
  const ctx = useDialogContext()
  return (
    <div className="flex items-start justify-between gap-4">
      <h2
        id={ctx?.titleId}
        className={cn('text-lg font-semibold leading-none tracking-tight', className)}
      >
        {children}
      </h2>
      {showClose && onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-[8px] text-muted-foreground transition-[color,background-color,transform] hover:bg-accent hover:text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

export function DialogDescription({ children, className }: { children: ReactNode; className?: string }) {
  const ctx = useDialogContext()
  return (
    <p id={ctx?.descId} className={cn('text-sm leading-6 text-muted-foreground', className)}>
      {children}
    </p>
  )
}
