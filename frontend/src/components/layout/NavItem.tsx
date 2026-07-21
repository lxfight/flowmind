import { Link, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { cn } from '../../utils/cn'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface NavItemProps {
  to: string
  label: string
  icon?: LucideIcon
  startDecorator?: ReactNode
  endDecorator?: ReactNode
  active?: boolean
  onClick?: () => void
  className?: string
}

export function NavItem({ to, label, icon: Icon, startDecorator, endDecorator, active, onClick, className }: NavItemProps) {
  const location = useLocation()
  const isActive = active ?? (location.pathname === to || location.pathname.startsWith(`${to}/`))

  return (
    <Link
      to={to}
      onClick={onClick}
      className={cn(
        'group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        isActive
          ? 'text-primary'
          : 'text-muted-foreground hover:text-foreground',
        className
      )}
    >
      {isActive && (
        <motion.span
          layoutId="nav-active"
          className="absolute inset-0 rounded-lg bg-primary/10"
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          aria-hidden="true"
        />
      )}
      <span className="relative z-10 flex items-center gap-2.5 min-w-0 transition-transform duration-200 ease-out group-hover:translate-x-0.5">
        {startDecorator}
        {Icon && (
          <Icon className={cn('h-4 w-4 shrink-0 transition-colors', isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
        )}
        <span className="truncate">{label}</span>
        {endDecorator && <span className="ml-auto shrink-0">{endDecorator}</span>}
      </span>
    </Link>
  )
}
