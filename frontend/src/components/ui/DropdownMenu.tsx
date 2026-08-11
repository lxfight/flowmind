import {
  useState,
  useRef,
  useEffect,
  useCallback,
  isValidElement,
  cloneElement,
  type ReactNode,
  type KeyboardEvent,
  type Ref,
  type ReactElement,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../utils/cn'
import { DropdownMenuContext, useDropdownMenu } from './dropdownMenuContext'

export interface DropdownMenuProps {
  trigger: ReactNode
  children: ReactNode
  align?: 'start' | 'end'
}

interface MenuPosition {
  top: number
  left: number
  maxHeight: number
}

/** Space between the menu and the viewport edge. */
const MENU_VIEWPORT_GAP = 8
const MENU_MAX_HEIGHT = 320

/**
 * A dropdown that is rendered into the body via a portal so it can never be
 * clipped by an ancestor's overflow (e.g. a scrollable kanban column). The
 * menu flips upward when there isn't enough room below the trigger and is
 * clamped to the viewport.
 */
export function DropdownMenu({ trigger, children, align = 'start' }: DropdownMenuProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  // Position the menu relative to the trigger, flipping upward when the space
  // below is too small. Runs on open and when the viewport resizes.
  const measure = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const triggerRect = trigger.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth
    const menuWidth = Math.max(160, Math.min(triggerRect.width + 24, 320))
    const spaceBelow = viewportHeight - triggerRect.bottom - MENU_VIEWPORT_GAP
    const spaceAbove = triggerRect.top - MENU_VIEWPORT_GAP
    const openUp = spaceBelow < MENU_MAX_HEIGHT && spaceAbove > spaceBelow
    const maxHeight = openUp ? Math.max(64, spaceAbove) : Math.max(64, spaceBelow)
    const top = openUp ? triggerRect.top - MENU_VIEWPORT_GAP - maxHeight : triggerRect.bottom + MENU_VIEWPORT_GAP
    let left = align === 'end'
      ? triggerRect.right - menuWidth
      : triggerRect.left
    left = Math.max(MENU_VIEWPORT_GAP, Math.min(left, viewportWidth - menuWidth - MENU_VIEWPORT_GAP))
    setPosition({ top, left, maxHeight: Math.min(maxHeight, MENU_MAX_HEIGHT) })
  }, [align])

  useEffect(() => {
    if (!open) return
    measure()
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open, measure])

  useEffect(() => {
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      const target = e.target as Node
      const inTrigger = triggerRef.current?.contains(target)
      const inMenu = menuRef.current?.contains(target)
      if (!inTrigger && !inMenu) setOpen(false)
    }
    const handleScroll = () => setOpen(false)
    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [])

  useEffect(() => {
    if (open && menuRef.current) {
      const first = menuRef.current.querySelector('[role="menuitem"]') as HTMLElement | null
      first?.focus()
    }
  }, [open])

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
    // eslint-disable-next-line react-hooks/refs -- attaching a callback ref to the trigger; it runs on attach, not during render
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
      <div className="inline-block">{triggerNode}</div>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-orientation="vertical"
              onKeyDown={handleMenuKeyDown}
              style={position ? { top: position.top, left: position.left, maxHeight: position.maxHeight } : undefined}
              className={cn(
                'fixed z-[60] w-max max-w-[calc(100vw-16px)] min-w-[160px] overflow-y-auto scrollbar-thin rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md',
                !position && 'invisible'
              )}
            >
              {children}
            </div>,
            document.body
          )
        : null}
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
