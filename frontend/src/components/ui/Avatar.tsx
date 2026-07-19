import { cn } from '../../utils/cn'

export interface AvatarProps {
  name: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizes = {
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-11 h-11 text-base',
}

export function Avatar({ name, size = 'md', className }: AvatarProps) {
  const initial = name?.charAt(0)?.toUpperCase() || '?'

  // Generate a consistent hue based on name
  const hue = name
    ? name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360
    : 0

  return (
    <div
      className={cn(
        'inline-flex items-center justify-center rounded-full font-medium shrink-0',
        sizes[size],
        className
      )}
      style={{
        backgroundColor: `hsl(${hue}, 70%, 90%)`,
        color: `hsl(${hue}, 70%, 35%)`,
      }}
      title={name}
    >
      {initial}
    </div>
  )
}
