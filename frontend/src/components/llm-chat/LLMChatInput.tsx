import { useRef, useEffect, useState } from 'react'
import { Send, Square } from 'lucide-react'
import { cn } from '../../utils/cn'
import { useLLMChatStore } from '../../stores/llmChatStore'
import { filterMentionCandidates, getMentionQuery, insertMention } from '../../utils/mention'
import { Avatar } from '../ui/Avatar'
import type { MemberOption } from '../../types'

interface Props {
  onSend: (content: string) => void
  onStop: () => void
  streaming?: boolean
  disabled?: boolean
  disabledHint?: string
  placeholder?: string
  sessionTitle?: string
  /** 项目成员，用于 @ 补全；缺省则不启用补全 */
  members?: MemberOption[]
}

export function LLMChatInput({
  onSend,
  onStop,
  streaming = false,
  disabled = false,
  disabledHint,
  placeholder = '输入消息，Enter 发送，Shift+Enter 换行，@ 提及成员',
  sessionTitle,
  members,
}: Props) {
  const { draft, setDraft } = useLLMChatStore()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const mentionCandidates =
    members && mentionQuery !== null ? filterMentionCandidates(members, mentionQuery) : []
  const mentionOpen = mentionCandidates.length > 0

  const handleSend = () => {
    const trimmed = draft.trim()
    if (!trimmed || streaming || disabled) return
    onSend(trimmed)
    setDraft('')
    setMentionQuery(null)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const chooseMention = (username: string) => {
    const el = textareaRef.current
    const caret = el?.selectionStart ?? draft.length
    const { text, caret: nextCaret } = insertMention(draft, caret, username)
    setDraft(text)
    setMentionQuery(null)
    setActiveIndex(0)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(nextCaret, nextCaret)
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => (i + 1) % mentionCandidates.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        chooseMention(mentionCandidates[Math.min(activeIndex, mentionCandidates.length - 1)].username)
        return
      }
      if (e.key === 'Escape') {
        setMentionQuery(null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [draft])

  return (
    <div className="shrink-0 px-3 pb-3 pt-2">
      <div
        className={cn(
          'relative rounded-2xl border border-input bg-background transition-shadow duration-200',
          'focus-within:shadow-[0_2px_12px_-4px_hsl(var(--foreground)/0.12)] focus-within:border-foreground/25',
          disabled && 'opacity-70'
        )}
      >
        {mentionOpen && (
          <div
            role="listbox"
            aria-label="提及成员"
            className="absolute bottom-full left-0 z-10 mb-1 w-64 overflow-hidden rounded-lg border border-border bg-popover shadow-md"
          >
            {mentionCandidates.map((m, idx) => (
              <button
                key={m.user_id}
                type="button"
                role="option"
                aria-selected={idx === activeIndex}
                onMouseDown={(e) => {
                  e.preventDefault()
                  chooseMention(m.username)
                }}
                onMouseEnter={() => setActiveIndex(idx)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                  idx === activeIndex ? 'bg-accent' : ''
                )}
              >
                <Avatar name={m.display_name || m.username} src={m.avatar_url} size="sm" />
                <span className="font-medium text-foreground">{m.display_name || m.username}</span>
                <span className="truncate text-xs text-muted-foreground">@{m.username}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setMentionQuery(getMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length))
            setActiveIndex(0)
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="消息内容"
          rows={1}
          disabled={disabled}
          className="block w-full resize-none bg-transparent px-3.5 pt-3 text-sm placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed max-h-[120px]"
        />
        <div className="flex items-center justify-between gap-2 px-2.5 pb-2 pt-1">
          <div className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
            {disabledHint || (sessionTitle ? `当前会话：${sessionTitle}` : 'Enter 发送 · Shift+Enter 换行 · @ 提及成员')}
          </div>
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="停止生成"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity duration-150 hover:opacity-85"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={disabled || !draft.trim()}
              aria-label="发送消息"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
