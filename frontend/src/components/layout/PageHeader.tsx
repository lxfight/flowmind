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
    <header className={cn('relative mb-8 border-b border-border px-1 pb-6', className)}>
      <span className="absolute -bottom-px left-1 h-px w-16 bg-primary" aria-hidden="true" />
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {breadcrumbs && breadcrumbs.length > 0 && (
            <nav className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
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
          <h1 className="text-3xl font-semibold leading-tight text-foreground sm:text-4xl">{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-none items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}
