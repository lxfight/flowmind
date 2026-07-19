import { useState, useRef, useEffect, type ReactNode } from 'react'
import { cn } from '../../utils/cn'

export interface DropdownMenuProps {
  trigger: ReactNode
  children: ReactNode
  align?: 'start' | 'end'
}

export function DropdownMenu({ trigger, children, align = 'start' }: DropdownMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={ref} className="relative inline-block">
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && (
        <div
          className={cn(
            'absolute z-50 mt-1 min-w-[160px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md',
            align === 'start' ? 'left-0' : 'right-0'
          )}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export interface DropdownMenuItemProps {
  children: ReactNode
  onClick?: () => void
  className?: string
  disabled?: boolean
}

export function DropdownMenuItem({ children, onClick, className, disabled }: DropdownMenuItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50',
        className
      )}
    >
      {children}
    </button>
  )
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div className={cn('-mx-1 my-1 h-px bg-muted', className)} />
}
