import { useEffect, useRef } from 'react'
import { LLMChatMessage } from './LLMChatMessage'
import type { ChatMessage } from '../../types'

interface Props {
  messages: ChatMessage[]
}

export function LLMChatMessageList({ messages }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      {messages.length === 0 && (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          发送消息开始对话
        </div>
      )}
      {messages.map((msg, idx) => (
        <LLMChatMessage key={idx} message={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
