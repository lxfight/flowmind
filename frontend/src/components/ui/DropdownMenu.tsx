import {
  useState,
  useRef,
  useEffect,
  createContext,
  useContext,
  isValidElement,
  cloneElement,
  type ReactNode,
  type KeyboardEvent,
  type Ref,
  type ReactElement,
} from 'react'
import { cn } from '../../utils/cn'

export interface DropdownMenuProps {
  trigger: ReactNode
  children: ReactNode
  align?: 'start' | 'end'
}

interface DropdownMenuContextValue {
  close: () => void
}

const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(null)

export function useDropdownMenu() {
  return useContext(DropdownMenuContext)
}

export function DropdownMenu({ trigger, children, align = 'start' }: DropdownMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (open && menuRef.current) {
      const first = menuRef.current.querySelector('[role="menuitem"]') as HTMLElement | null
      first?.focus()
    }
  }, [open])

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const handleTriggerClick = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation()
    setOpen((prev) => !prev)
  }

  const handleTriggerKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  const handleMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!menuRef.current) return
    const items = Array.from(menuRef.current.querySelectorAll('[role="menuitem"]')) as HTMLElement[]
    const idx = items.indexOf(document.activeElement as HTMLElement)

    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = items[(idx + 1) % items.length]
      next?.focus()
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = items[(idx - 1 + items.length) % items.length]
      next?.focus()
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      items[0]?.focus()
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      items[items.length - 1]?.focus()
      return
    }
  }

  let triggerNode = trigger
  if (isValidElement(trigger)) {
    const typedTrigger = trigger as ReactElement<any>
    const originalOnClick = typedTrigger.props.onClick as
      | ((e: React.MouseEvent<HTMLElement>) => void)
      | undefined
    const originalOnKeyDown = typedTrigger.props.onKeyDown as
      | ((e: React.KeyboardEvent<HTMLElement>) => void)
      | undefined
    triggerNode = cloneElement(typedTrigger, {
      'aria-haspopup': 'menu',
      'aria-expanded': open,
      ref: ((node: HTMLElement | null) => {
        triggerRef.current = node
      }) as Ref<unknown>,
      onClick: (e: React.MouseEvent<HTMLElement>) => {
        originalOnClick?.(e)
        handleTriggerClick(e)
      },
      onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
        originalOnKeyDown?.(e)
        handleTriggerKeyDown(e)
      },
    })
  }

  return (
    <DropdownMenuContext.Provider value={{ close }}>
      <div ref={ref} className="relative inline-block">
        {triggerNode}
        {open && (
          <div
            ref={menuRef}
            role="menu"
            aria-orientation="vertical"
            onKeyDown={handleMenuKeyDown}
            className={cn(
              'absolute z-50 mt-1 min-w-[160px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md',
              align === 'start' ? 'left-0' : 'right-0'
            )}
          >
            {children}
          </div>
        )}
      </div>
    </DropdownMenuContext.Provider>
  )
}

export interface DropdownMenuItemProps {
  children: ReactNode
  onClick?: () => void
  className?: string
  disabled?: boolean
}

export function DropdownMenuItem({ children, onClick, className, disabled }: DropdownMenuItemProps) {
  const ctx = useDropdownMenu()
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={() => {
        onClick?.()
        ctx?.close()
      }}
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
  return <div className={cn('-mx-1 my-1 h-px bg-muted', className)} role="separator" aria-hidden="true" />
}
