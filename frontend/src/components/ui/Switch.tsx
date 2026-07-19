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
          'relative inline-flex items-center cursor-pointer',
          disabled && 'cursor-not-allowed opacity-60',
          className
        )}
      >
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
            'h-6 w-11 rounded-full border-2 border-transparent transition-colors overflow-hidden',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
            checked ? 'bg-primary' : 'bg-input'
          )}
        />
        <div
          className={cn(
            'pointer-events-none absolute left-0.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-background shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0'
          )}
        />
      </label>
    )
  }
)

Switch.displayName = 'Switch'

export { Switch }
