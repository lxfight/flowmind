import { useEffect, useState } from 'react'
import { cn } from '../../utils/cn'

export interface AvatarProps {
  name: string
  src?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}

const sizes = {
  xs: 'w-5 h-5 text-[10px]',
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-16 h-16 text-lg',
}

export function Avatar({ name, src, size = 'md', className }: AvatarProps) {
  const [imageError, setImageError] = useState(false)
  const initial = name?.charAt(0)?.toUpperCase() || '?'

  // Reset error state when the image URL changes (e.g. after re-upload)
  useEffect(() => {
    setImageError(false)
  }, [src])

  // Generate a consistent hue based on name
  const hue = name
    ? name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360
    : 0

  const shouldShowImage = src && !imageError

  return (
    <div
      className={cn(
        'inline-flex items-center justify-center rounded-full font-medium shrink-0 overflow-hidden ring-2 ring-background',
        sizes[size],
        className
      )}
      style={
        shouldShowImage
          ? undefined
          : {
              backgroundColor: `hsl(${hue}, 70%, 90%)`,
              color: `hsl(${hue}, 70%, 35%)`,
            }
      }
      title={name}
    >
      {shouldShowImage ? (
        <img
          src={src}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setImageError(true)}
        />
      ) : (
        initial
      )}
    </div>
  )
}
