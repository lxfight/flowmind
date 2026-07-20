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
  value: number | null
  onChange: (userId: number | null) => void
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
  const selected = members.find((m) => m.user_id === value)

  const handleSelect = async (userId: number | null) => {
    if (userId === value || submitting || disabled) return
    setSubmitting(true)
    try {
      await onChange(userId)
    } finally {
      setSubmitting(false)
    }
  }

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
      {selected ? (
        <Avatar name={selected.display_name || selected.username} src={selected.avatar_url} size="sm" />
      ) : (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <User className="h-3 w-3" />
        </div>
      )}
      <span className="max-w-[100px] truncate text-foreground">{selected ? selected.display_name || selected.username : placeholder}</span>
    </Button>
  )

  return (
    <div
      className="inline-block"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <DropdownMenu trigger={trigger} align={align}>
        <DropdownMenuItem onClick={() => handleSelect(null)}>
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground mr-2">
            <X className="h-3 w-3" />
          </div>
          未指派
          {value === null && <Check className="ml-auto h-4 w-4 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {members.map((member) => (
          <DropdownMenuItem key={member.user_id} onClick={() => handleSelect(member.user_id)}>
            <Avatar
              name={member.display_name || member.username}
              src={member.avatar_url}
              size="sm"
              className="mr-2"
            />
            <span className="flex-1 truncate">{member.display_name || member.username}</span>
            {value === member.user_id && <Check className="ml-2 h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
    </div>
  )
}
