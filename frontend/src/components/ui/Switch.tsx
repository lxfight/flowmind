import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../utils/cn'

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' > {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, checked, onCheckedChange, disabled, ...props }, ref) => {
    return (
      <label
        className={cn(
          'inline-flex items-center gap-2 cursor-pointer',
          disabled && 'cursor-not-allowed opacity-60',
          className
        )}
      >
        <div className="relative">
          <input
            ref={ref}
            type="checkbox"
            className="peer sr-only"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onCheckedChange?.(e.target.checked)}
            {...props}
          />
          <div
            className={cn(
              'h-5 w-9 rounded-full border-2 border-transparent transition-colors',
              'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
              checked ? 'bg-primary' : 'bg-input'
            )}
          />
          <div
            className={cn(
              'pointer-events-none absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-background shadow-sm transition-transform',
              checked && 'translate-x-4'
            )}
          />
        </div>
      </label>
    )
  }
)

Switch.displayName = 'Switch'

export { Switch }
