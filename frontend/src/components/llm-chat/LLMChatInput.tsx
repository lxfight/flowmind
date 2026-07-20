import { useState, useRef, useEffect } from 'react'
import { Send, Loader2, Square } from 'lucide-react'
import { Button } from '../ui/Button'

interface Props {
  onSend: (content: string) => void
  loading?: boolean
  placeholder?: string
}

export function LLMChatInput({ onSend, loading = false, placeholder = '输入消息...' }: Props) {
  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed || loading) return
    onSend(trimmed)
    setInput('')
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
  }, [input])

  return (
    <div className="border-t border-border p-3">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="消息内容"
          rows={1}
          disabled={loading}
          className="flex-1 min-w-0 resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-70 max-h-[120px]"
        />
        <Button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          size="icon"
          aria-label="发送消息"
          className="h-10 w-10 shrink-0 rounded-xl"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
      <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
        Enter 发送，Shift+Enter 换行
      </p>
    </div>
  )
}
