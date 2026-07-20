import { Bot, User, Wrench } from 'lucide-react'
import { cn } from '../../utils/cn'
import type { ChatMessage } from '../../types'

interface Props {
  message: ChatMessage
}

function ActionCard({ action }: { action: { type: string; title?: string; detail?: string } }) {
  const labels: Record<string, string> = {
    create_task: '创建任务',
    update_task: '更新任务',
    move_task: '移动任务',
    delete_task: '删除任务',
    add_comment: '添加评论',
    add_subtask: '添加子任务',
    update_subtask: '更新子任务',
    create_status: '创建状态列',
    update_status: '更新状态列',
    delete_status: '删除状态列',
  }
  return (
    <div className="mt-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-xs">
      <span className="font-medium text-primary">{labels[action.type] || action.type}</span>
      {action.title && <span className="ml-1.5 text-foreground">{action.title}</span>}
      {action.detail && <span className="ml-1.5 text-muted-foreground">{action.detail}</span>}
    </div>
  )
}

export function LLMChatMessage({ message }: Props) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'

  return (
    <div
      className={cn(
        'flex w-full',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      <div
        className={cn(
          'flex max-w-[90%] gap-2',
          isUser ? 'flex-row-reverse' : 'flex-row'
        )}
      >
        <div
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
            isUser
              ? 'bg-primary text-primary-foreground'
              : isTool
              ? 'bg-muted text-muted-foreground'
              : 'bg-primary/10 text-primary'
          )}
        >
          {isUser ? (
            <User className="h-4 w-4" />
          ) : isTool ? (
            <Wrench className="h-4 w-4" />
          ) : (
            <Bot className="h-4 w-4" />
          )}
        </div>

        <div
          className={cn(
            'rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-foreground'
          )}
        >
          {message.loading ? (
            <span className="animate-pulse">思考中...</span>
          ) : (
            <div className="whitespace-pre-wrap">{message.content}</div>
          )}

          {!isUser && !isTool && message.actions && message.actions.length > 0 && (
            <div className="mt-2 space-y-1">
              {message.actions.map((action, idx) => (
                <ActionCard key={idx} action={action} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
