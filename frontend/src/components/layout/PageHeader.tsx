import { Link } from 'react-router-dom'
import { cn } from '../../utils/cn'
import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  breadcrumbs?: { label: string; to?: string }[]
  actions?: ReactNode
  className?: string
}

export function PageHeader({ title, description, breadcrumbs, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('surface p-5 mb-6', className)}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          {breadcrumbs && breadcrumbs.length > 0 && (
            <nav className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
              {breadcrumbs.map((crumb, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  {idx > 0 && <span className="text-border">/</span>}
                  {crumb.to ? (
                    <Link to={crumb.to} className="hover:text-foreground transition-colors">{crumb.label}</Link>
                  ) : (
                    <span>{crumb.label}</span>
                  )}
                </div>
              ))}
            </nav>
          )}
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  )
}
