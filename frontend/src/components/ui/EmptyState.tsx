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
    <section className={cn('relative flex min-h-52 flex-col items-center justify-center overflow-hidden border-y border-dashed border-border px-6 py-10 text-center', className)}>
      <span className="pointer-events-none absolute left-1/2 top-0 h-10 w-px bg-border" aria-hidden="true" />
      {Icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-[8px] bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </section>
  )
}
