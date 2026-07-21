import { useRef, useEffect } from 'react'
import { Send, Square } from 'lucide-react'
import { cn } from '../../utils/cn'
import { useLLMChatStore } from '../../stores/llmChatStore'

interface Props {
  onSend: (content: string) => void
  onStop: () => void
  streaming?: boolean
  disabled?: boolean
  disabledHint?: string
  placeholder?: string
  sessionTitle?: string
}

export function LLMChatInput({
  onSend,
  onStop,
  streaming = false,
  disabled = false,
  disabledHint,
  placeholder = '输入消息，Enter 发送，Shift+Enter 换行',
  sessionTitle,
}: Props) {
  const { draft, setDraft } = useLLMChatStore()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = () => {
    const trimmed = draft.trim()
    if (!trimmed || streaming || disabled) return
    onSend(trimmed)
    setDraft('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
          'rounded-2xl border border-input bg-background transition-shadow duration-200',
          'focus-within:shadow-[0_2px_12px_-4px_hsl(var(--foreground)/0.12)] focus-within:border-foreground/25',
          disabled && 'opacity-70'
        )}
      >
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="消息内容"
          rows={1}
          disabled={disabled}
          className="block w-full resize-none bg-transparent px-3.5 pt-3 text-sm placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed max-h-[120px]"
        />
        <div className="flex items-center justify-between gap-2 px-2.5 pb-2 pt-1">
          <div className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
            {disabledHint || (sessionTitle ? `当前会话：${sessionTitle}` : 'Enter 发送 · Shift+Enter 换行')}
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
