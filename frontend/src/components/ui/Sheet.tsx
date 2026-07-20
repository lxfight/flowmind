import { useEffect, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '../../utils/cn'

export interface SheetProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  side?: 'left' | 'right' | 'bottom'
  className?: string
}

export function Sheet({ open, onClose, children, side = 'right', className }: SheetProps) {
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

  // Lock body scroll
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

  const isBottom = side === 'bottom'

  const panelVariants = {
    left: {
      hidden: { x: '-100%' },
      visible: { x: 0 },
      exit: { x: '-100%' },
    },
    right: {
      hidden: { x: '100%' },
      visible: { x: 0 },
      exit: { x: '100%' },
    },
    bottom: {
      hidden: { y: '100%' },
      visible: { y: 0 },
      exit: { y: '100%' },
    },
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
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
              'absolute bg-card text-card-foreground shadow-2xl',
              isBottom
                ? 'bottom-0 left-0 right-0 max-h-[92vh] rounded-t-2xl'
                : 'top-0 h-full w-full sm:w-96',
              side === 'left' ? 'left-0' : side === 'right' ? 'right-0' : '',
              className
            )}
            variants={panelVariants[side]}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
          >
            {isBottom && (
              <div className="flex justify-center pt-3 pb-1">
                <div className="h-1.5 w-10 rounded-full bg-border" />
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export interface SheetHeaderProps {
  children: ReactNode
  className?: string
}

export function SheetHeader({ children, className }: SheetHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between px-5 py-4 border-b border-border', className)}>
      {children}
    </div>
  )
}

export interface SheetTitleProps {
  children: ReactNode
  className?: string
}

export function SheetTitle({ children, className }: SheetTitleProps) {
  return (
    <h2 className={cn('text-lg font-semibold tracking-tight', className)}>
      {children}
    </h2>
  )
}

export interface SheetCloseProps {
  onClose: () => void
  label?: string
}

export function SheetClose({ onClose, label = '关闭' }: SheetCloseProps) {
  return (
    <button
      onClick={onClose}
      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <X className="h-4 w-4" />
      {label}
    </button>
  )
}

export interface SheetContentProps {
  children: ReactNode
  className?: string
}

export function SheetContent({ children, className }: SheetContentProps) {
  return (
    <div className={cn('overflow-y-auto', className)}>
      {children}
    </div>
  )
}

export interface SheetFooterProps {
  children: ReactNode
  className?: string
}

export function SheetFooter({ children, className }: SheetFooterProps) {
  return (
    <div className={cn('border-t border-border p-4', className)}>
      {children}
    </div>
  )
}
