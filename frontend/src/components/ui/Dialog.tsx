import { useEffect, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '../../utils/cn'

export interface DialogProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
}

export function Dialog({ open, onClose, children, className }: DialogProps) {
  // ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
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
            className="absolute inset-0 bg-black/50 dark:bg-black/70"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            className={cn(
              'relative z-10 w-full max-w-lg rounded-xl border border-border bg-card p-0 text-card-foreground shadow-lg',
              className
            )}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
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
    <div className={cn('flex flex-col space-y-1.5 px-6 pt-6 pb-4', className)}>
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
    <div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 px-6 pb-6 pt-2', className)}>
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
  return (
    <div className="flex items-start justify-between gap-4">
      <h2 className={cn('text-lg font-semibold leading-none tracking-tight', className)}>
        {children}
      </h2>
      {showClose && onClose && (
        <button
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

export function DialogDescription({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('text-sm text-muted-foreground', className)}>
      {children}
    </p>
  )
}
