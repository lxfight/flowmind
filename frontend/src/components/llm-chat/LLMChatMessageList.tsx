import { useEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import { LLMChatMessage } from './LLMChatMessage'
import type { ChatMessage, MemberOption } from '../../types'

interface Props {
  messages: ChatMessage[]
  streaming?: boolean
  /** 项目成员，用于用户消息中的 @mention 高亮 */
  members?: MemberOption[]
  /** 跨项目助手（我的项目页）：换用跨项目示例文案 */
  crossProject?: boolean
  onExampleClick?: (prompt: string) => void
  /** Send a quick-reply option from a pending-question card */
  onAnswerQuestion?: (answer: string) => void
  /** Undo an agent action batch */
  onUndoBatch?: (batchId: string) => void
}

const EXAMPLE_PROMPTS = [
  '这个项目有哪些任务？',
  '帮我创建一个任务：整理本周迭代计划',
  '总结一下当前项目进度',
]

const CROSS_PROJECT_PROMPTS = [
  '我所有项目里有哪些任务快到期了？',
  '汇总一下各个项目的进度',
  '我在所有项目里还有哪些待办任务？',
]

export function LLMChatMessageList({ messages, streaming, members, crossProject, onExampleClick, onAnswerQuestion, onUndoBatch }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const examplePrompts = crossProject ? CROSS_PROJECT_PROMPTS : EXAMPLE_PROMPTS

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: streaming ? 'auto' : 'smooth', block: 'end' })
  }, [messages, streaming])

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 scrollbar-thin">
      {messages.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">你好，我是 FlowMind 智能助手</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {crossProject ? '可以跨项目查询任务、汇总进度' : '可以帮你查询任务、创建任务、总结项目进度'}
          </p>
          <div className="mt-4 flex w-full max-w-[320px] flex-col gap-2">
            {examplePrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => onExampleClick?.(prompt)}
                className="rounded-xl border border-border bg-background px-3 py-2 text-left text-xs text-muted-foreground transition-colors duration-150 hover:border-foreground/20 hover:text-foreground"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          {messages.map((msg, idx) => {
            const prev = messages[idx - 1]
            // ~36px between a user group and an assistant group, ~8px within
            const sameSpeaker = prev && prev.role === msg.role
            // A pending question stays answerable only while it is the latest
            // message and no stream is in flight.
            const questionActive =
              Boolean(msg.pending_question) && idx === messages.length - 1 && !streaming
            return (
              <div key={msg.id ?? idx} className={idx === 0 ? '' : sameSpeaker ? 'mt-2' : 'mt-9'}>
                <LLMChatMessage
                  message={msg}
                  questionActive={questionActive}
                  members={members}
                  onAnswerQuestion={onAnswerQuestion}
                  onUndoBatch={onUndoBatch}
                />
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  )
}
