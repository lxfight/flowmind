import { cn } from '../../utils/cn'

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info' | 'outline'
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variants = {
    default: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
    primary: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
    secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
    success: 'border-transparent bg-success text-success-foreground hover:bg-success/80',
    warning: 'border-transparent bg-warning text-warning-foreground hover:bg-warning/80',
    danger: 'border-transparent bg-danger text-danger-foreground hover:bg-danger/80',
    info: 'border-transparent bg-info text-info-foreground hover:bg-info/80',
    outline: 'text-foreground border-border hover:bg-accent hover:text-accent-foreground',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        variants[variant],
        className
      )}
      {...props}
    />
  )
}
