import { useState } from 'react'
import { MoreHorizontal, Pencil, Trash2, Plus } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../ui/DropdownMenu'
import { cn } from '../../utils/cn'
import type { ChatSession } from '../../types'

interface Props {
  sessions: ChatSession[]
  currentSessionId: number | null
  onSelect: (sessionId: number) => void
  onCreate: () => void
  onRename: (sessionId: number, title: string) => void
  onDelete: (sessionId: number) => void
  className?: string
}

export function LLMChatSessionList({
  sessions,
  currentSessionId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  className,
}: Props) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const startRename = (session: ChatSession) => {
    setEditingId(session.id)
    setEditTitle(session.title)
  }

  const finishRename = (sessionId: number) => {
    if (editTitle.trim()) {
      onRename(sessionId, editTitle.trim())
    }
    setEditingId(null)
  }

  return (
    <div className={cn('flex h-full w-44 flex-col border-r border-border bg-muted/30', className)}>
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          会话
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCreate} aria-label="新建会话">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {sessions.length === 0 && (
          <p className="px-2 py-4 text-xs text-muted-foreground text-center">暂无会话</p>
        )}
        {sessions.map((session) => (
          <div
            key={session.id}
            className={cn(
              'group flex items-center gap-1 rounded-lg px-2 py-1.5 cursor-pointer transition-colors',
              currentSessionId === session.id
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-accent text-foreground'
            )}
            onClick={() => onSelect(session.id)}
          >
            {editingId === session.id ? (
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={() => finishRename(session.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') finishRename(session.id)
                  if (e.key === 'Escape') setEditingId(null)
                }}
                onClick={(e) => e.stopPropagation()}
                autoFocus
                className="h-6 text-xs py-0"
              />
            ) : (
              <>
                <span className="flex-1 truncate text-xs font-medium">{session.title}</span>
                <DropdownMenu
                  align="end"
                  trigger={
                    <button
                      onClick={(e) => e.stopPropagation()}
                      aria-label="会话操作"
                      className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  }
                >
                  <DropdownMenuItem onClick={() => startRename(session)}>
                    <Pencil className="mr-2 h-3.5 w-3.5" /> 重命名
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      if (confirm('确定删除该会话？')) onDelete(session.id)
                    }}
                    className="text-danger hover:text-danger"
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" /> 删除
                  </DropdownMenuItem>
                </DropdownMenu>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
