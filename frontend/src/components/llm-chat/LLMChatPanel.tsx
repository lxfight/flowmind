import { useState } from 'react'
import { X, Send, ListTodo, BarChart3, Loader2 } from 'lucide-react'
import api from '../../utils/api'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../ui/Sheet'
import { Button } from '../ui/Button'

interface Props {
  projectId: number
  onClose: () => void
  onCreateTasks: (instruction: string) => void
  generating?: boolean
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export function LLMChatPanel({ projectId, onClose, onCreateTasks, generating = false }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        '你好！我是 FlowMind 智能助手。你可以问我关于项目的问题，或者让我帮你创建任务。',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSend = async () => {
    if (!input.trim() || loading) return

    const userMsg: Message = { role: 'user', content: input.trim() }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await api.post('/llm/chat', {
        project_id: projectId,
        messages: [...messages, userMsg].map((m) => ({
          role: m.role,
          content: m.content,
        })),
      })

      const assistantMsg: Message = {
        role: 'assistant',
        content: res.data.message,
      }
      setMessages((prev) => [...prev, assistantMsg])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: '抱歉，请求失败。请检查 LLM 配置是否正确。',
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <Sheet open onClose={onClose} side="right" className="flex flex-col">
      <SheetHeader>
        <SheetTitle>LLM 助手</SheetTitle>
        <SheetClose onClose={onClose} />
      </SheetHeader>

      <SheetContent className="flex-1 flex flex-col">
        {/* Messages */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'
                } break-words`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-xl px-3 py-2 text-sm text-muted-foreground">
                <span className="animate-pulse">思考中...</span>
              </div>
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="px-4 py-2 border-t border-border">
          <div className="flex flex-wrap gap-1.5 mb-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onCreateTasks('帮我创建本周迭代的任务')}
              disabled={generating}
              className="gap-1.5"
            >
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListTodo className="h-3.5 w-3.5" />}
              创建本周任务
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setInput('这个项目的进度怎么样？')}
              className="gap-1.5"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              项目进度
            </Button>
          </div>
        </div>

        {/* Input */}
        <SheetFooter className="flex-shrink-0">
          <div className="flex gap-2 w-full">
            <input
              className="flex-1 min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              placeholder="输入消息..."
            />
            <Button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              size="icon"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          {!loading && (
            <p className="text-xs text-muted-foreground mt-1.5 text-center">
              Enter 发送，Shift+Enter 换行
            </p>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
