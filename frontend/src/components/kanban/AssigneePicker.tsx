import { useState } from 'react'
import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../ui/DropdownMenu'
import { cn } from '../../utils/cn'
import { User, X, Check } from 'lucide-react'
import type { MemberOption } from '../../types'

interface AssigneePickerProps {
  members: MemberOption[]
  value: number[]
  onChange: (userIds: number[]) => void | Promise<void>
  align?: 'start' | 'end'
  size?: 'sm' | 'md'
  disabled?: boolean
  placeholder?: string
}

export function AssigneePicker({
  members,
  value,
  onChange,
  align = 'start',
  size = 'md',
  disabled = false,
  placeholder = '未指派',
}: AssigneePickerProps) {
  const [submitting, setSubmitting] = useState(false)
  const selected = members.filter((m) => value.includes(m.user_id))

  const handleToggle = async (userId: number) => {
    if (submitting || disabled) return
    const next = value.includes(userId)
      ? value.filter((id) => id !== userId)
      : [...value, userId]
    setSubmitting(true)
    try {
      await onChange(next)
    } finally {
      setSubmitting(false)
    }
  }

  const handleClear = async () => {
    if (value.length === 0 || submitting || disabled) return
    setSubmitting(true)
    try {
      await onChange([])
    } finally {
      setSubmitting(false)
    }
  }

  const label =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? selected[0].display_name || selected[0].username
        : `${selected[0].display_name || selected[0].username} +${selected.length - 1}`

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled || submitting}
      className={cn(
        'gap-1.5 h-7 px-1.5 font-normal',
        size === 'sm' && 'h-6 px-1 text-xs'
      )}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {selected.length > 0 ? (
        <div className="flex -space-x-1.5">
          {selected.slice(0, 3).map((m) => (
            <Avatar
              key={m.user_id}
              name={m.display_name || m.username}
              src={m.avatar_url}
              size="sm"
              className="ring-1 ring-background"
            />
          ))}
        </div>
      ) : (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <User className="h-3 w-3" />
        </div>
      )}
      <span className="max-w-[100px] truncate text-foreground">{label}</span>
    </Button>
  )

  return (
    <div
      className="inline-block"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <DropdownMenu trigger={trigger} align={align}>
        <DropdownMenuItem onClick={handleClear}>
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground mr-2">
            <X className="h-3 w-3" />
          </div>
          未指派
          {value.length === 0 && <Check className="ml-auto h-4 w-4 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {members.map((member) => {
          const checked = value.includes(member.user_id)
          return (
            <button
              key={member.user_id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={checked}
              tabIndex={-1}
              onClick={() => handleToggle(member.user_id)}
              className="relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
            >
              <Avatar
                name={member.display_name || member.username}
                src={member.avatar_url}
                size="sm"
                className="mr-2"
              />
              <span className="flex-1 truncate text-left">{member.display_name || member.username}</span>
              {checked && <Check className="ml-2 h-4 w-4 text-primary" />}
            </button>
          )
        })}
      </DropdownMenu>
    </div>
  )
}
