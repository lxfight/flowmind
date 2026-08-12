import { type LucideIcon } from 'lucide-react'
import { cn } from '../../utils/cn'

export interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <section className={cn('relative flex min-h-64 flex-col items-center justify-center overflow-hidden border-y border-dashed border-border bg-gradient-to-b from-transparent to-muted/20 px-6 py-12 text-center', className)}>
      <span className="pointer-events-none absolute left-1/2 top-0 h-12 w-px bg-gradient-to-b from-border to-transparent" aria-hidden="true" />
      {Icon && (
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-muted to-muted/50 text-muted-foreground shadow-sm ring-1 ring-border/50">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </section>
  )
}
