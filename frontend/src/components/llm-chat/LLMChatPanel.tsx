import { useState } from 'react'
import { X, Send } from 'lucide-react'
import api from '../../utils/api'

interface Props {
  projectId: number
  onClose: () => void
  onCreateTasks: (instruction: string) => void
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export function LLMChatPanel({ projectId, onClose, onCreateTasks }: Props) {
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
    <div className="flex flex-col h-full dark:bg-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b dark:border-gray-700">
        <h3 className="font-semibold text-sm dark:text-gray-100">LLM 助手</h3>
        <button onClick={onClose} className="btn-ghost p-1">
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 dark:bg-gray-700 rounded-xl px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
              <span className="animate-pulse">思考中...</span>
            </div>
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="px-4 py-2 border-t dark:border-gray-700">
        <div className="flex flex-wrap gap-1.5 mb-2">
          <button
            className="text-xs px-2 py-1 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full hover:bg-primary-100 dark:hover:bg-primary-900/50"
            onClick={() => setInput('帮我创建本周迭代的任务')}
          >
            📋 创建本周任务
          </button>
          <button
            className="text-xs px-2 py-1 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-full hover:bg-primary-100 dark:hover:bg-primary-900/50"
            onClick={() => setInput('这个项目的进度怎么样？')}
          >
            📊 项目进度
          </button>
        </div>
      </div>

      {/* Input */}
      <div className="p-3 border-t dark:border-gray-700">
        <div className="flex gap-2">
          <input
            className="input-field flex-1 text-sm"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="输入消息..."
          />
          <button
            className="btn-primary p-2"
            onClick={handleSend}
            disabled={loading || !input.trim()}
          >
            <Send size={16} />
          </button>
        </div>
        {!loading && (
          <p className="text-xs text-gray-400 mt-1">
            Enter 发送，Shift+Enter 换行
          </p>
        )}
      </div>
    </div>
  )
}
