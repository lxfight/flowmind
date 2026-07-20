import { Link, useLocation } from 'react-router-dom'
import { cn } from '../../utils/cn'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface NavItemProps {
  to: string
  label: string
  icon?: LucideIcon
  startDecorator?: ReactNode
  active?: boolean
  onClick?: () => void
  className?: string
}

export function NavItem({ to, label, icon: Icon, startDecorator, active, onClick, className }: NavItemProps) {
  const location = useLocation()
  const isActive = active ?? (location.pathname === to || location.pathname.startsWith(`${to}/`))

  return (
    <Link
      to={to}
      onClick={onClick}
      className={cn(
        'group flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
        isActive
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        className
      )}
    >
      {startDecorator}
      {Icon && (
        <Icon className={cn('h-4 w-4 transition-colors', isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
      )}
      <span className="truncate">{label}</span>
    </Link>
  )
}
