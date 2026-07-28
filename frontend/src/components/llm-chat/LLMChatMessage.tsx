import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  LoaderCircle,
  Undo2,
  Wrench,
} from 'lucide-react'
import { cn } from '../../utils/cn'
import { toolLabel } from '../../stores/llmChatStore'
import { Button } from '../ui/Button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/Dialog'
import { MentionText } from '../kanban/MentionText'
import type { ChatMessage, MemberOption, ProcessStep } from '../../types'

interface Props {
  message: ChatMessage
  /** True while the question is unanswered and latest — chips are clickable */
  questionActive?: boolean
  /** 项目成员，用于用户消息中的 @mention 高亮 */
  members?: MemberOption[]
  onAnswerQuestion?: (answer: string) => void
  /** Undo the agent action batch attached to this message */
  onUndoBatch?: (batchId: string) => void
}

const ACTION_LABELS: Record<string, string> = {
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
  create_milestone: '创建里程碑',
  update_milestone: '更新里程碑',
  delete_milestone: '删除里程碑',
}

function ActionCard({ action }: { action: { type: string; title?: string; detail?: string } }) {
  return (
    <div className="mt-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-xs">
      <span className="font-medium text-primary">{ACTION_LABELS[action.type] || action.type}</span>
      {action.title && <span className="ml-1.5 text-foreground">{action.title}</span>}
      {action.detail && <span className="ml-1.5 text-muted-foreground">{action.detail}</span>}
    </div>
  )
}

function Timestamp({ value }: { value?: string }) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  const label = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return <span className="mt-1 block text-[10px] text-muted-foreground/70">{label}</span>
}

/** Compact history rendering for tool calls/results — no raw JSON. */
function ToolStatusMessage({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false)
  const results = message.tool_results || []
  const first = results[0]
  const label = first ? toolLabel(first.tool) : '工具调用'

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Wrench className="h-3 w-3" />
        <span>调用了 {label}</span>
      </button>
      {expanded && first && (
        <div className="mt-1.5 rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap break-words max-h-48 overflow-y-auto scrollbar-thin">
          {first.message}
        </div>
      )}
    </div>
  )
}

function ThinkingDisclosure({ steps, streaming }: { steps: ProcessStep[]; streaming?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const label = streaming ? '思考中' : '思考内容'

  return (
    <div className="w-full" data-testid="thinking-steps">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="group flex min-h-7 items-center gap-1.5 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        <Brain className="h-3.5 w-3.5" />
        <span>{label}</span>
        {streaming && (
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary/70" />
        )}
        <ChevronDown
          className={cn('h-3 w-3 transition-transform duration-150', expanded && 'rotate-180')}
        />
      </button>
      {expanded && (
        <div className="mt-1.5 max-h-64 space-y-2 overflow-y-auto border-l border-border pl-3 text-xs text-muted-foreground scrollbar-thin">
          {steps.map((step, index) => (
            <div key={`thinking-${index}`} className="whitespace-pre-wrap break-words leading-relaxed">
              {step.text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function toolValueText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null) return 'null'
  if (value === undefined) return ''
  return JSON.stringify(value, null, 2)
}

function StructuredToolData({ value }: { value: Record<string, unknown> }) {
  return (
    <dl className="divide-y divide-border/70">
      {Object.entries(value).map(([key, item]) => (
        <div key={key} className="grid grid-cols-[minmax(5rem,auto)_1fr] gap-3 py-1.5 first:pt-0 last:pb-0">
          <dt className="font-mono text-[11px] text-muted-foreground">{key}</dt>
          <dd className="min-w-0 whitespace-pre-wrap break-words text-foreground/75">
            {toolValueText(item)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function parsedToolOutput(output: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(output)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function ToolCallItem({ step, index }: { step: ProcessStep; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const args = step.args && Object.keys(step.args).length > 0 ? step.args : null
  const structuredOutput = step.output ? parsedToolOutput(step.output) : null

  return (
    <div className="border-b border-border/70 pb-1.5 last:border-b-0 last:pb-0" data-testid="tool-call-item">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex min-h-7 w-full items-center gap-2 text-left text-xs text-foreground/80 transition-colors duration-150 hover:text-foreground"
      >
        <span className="w-5 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
          {String(index + 1).padStart(2, '0')}
        </span>
        <Wrench className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{toolLabel(step.tool || '')}</span>
        {step.status === 'running' ? (
          <LoaderCircle className="h-3 w-3 shrink-0 animate-spin text-primary" aria-label="执行中" />
        ) : (
          <CheckCircle2 className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="已完成" />
        )}
        <ChevronRight
          className={cn('h-3 w-3 shrink-0 transition-transform duration-150', expanded && 'rotate-90')}
        />
      </button>

      {expanded && (
        <div className="ml-7 mt-1.5 space-y-3 border-l border-border pl-3 text-xs text-muted-foreground">
          {args && (
            <section aria-label="调用参数">
              <div className="mb-1.5 font-medium text-foreground/70">调用参数</div>
              <StructuredToolData value={args} />
            </section>
          )}
          {step.output && (
            <section aria-label="执行结果">
              <div className="mb-1.5 font-medium text-foreground/70">执行结果</div>
              {structuredOutput ? (
                <StructuredToolData value={structuredOutput} />
              ) : (
                <div className="whitespace-pre-wrap break-words leading-relaxed">{step.output}</div>
              )}
            </section>
          )}
          {!args && !step.output && (
            <div>{step.status === 'running' ? '等待工具返回结果' : '无调用参数或返回内容'}</div>
          )}
        </div>
      )}
    </div>
  )
}

function ToolCallsDisclosure({ steps }: { steps: ProcessStep[] }) {
  const [expanded, setExpanded] = useState(false)
  const toolSteps = steps.filter((step) => step.kind === 'tool')
  const runningTool = [...toolSteps].reverse().find((step) => step.status === 'running')
  const label = runningTool
    ? `工具调用 · 正在${toolLabel(runningTool.tool || '')}`
    : `工具调用 · ${toolSteps.length}`

  return (
    <div className="w-full" data-testid="tool-steps">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="group flex min-h-7 items-center gap-1.5 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        <Wrench className="h-3.5 w-3.5" />
        <span>{label}</span>
        {runningTool && (
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary/70" />
        )}
        <ChevronDown
          className={cn('h-3 w-3 transition-transform duration-150', expanded && 'rotate-180')}
        />
      </button>
      {expanded && (
        <div className="mt-1.5 max-h-64 overflow-y-auto border-l border-border pl-3 text-xs text-muted-foreground scrollbar-thin">
          <div className="space-y-1.5">
            {toolSteps.map((step, index) => (
              <ToolCallItem key={step.id || `${step.tool}-${index}`} step={step} index={index} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Reasoning and tool calls are persisted together but disclosed independently. */
function ProcessDisclosures({ steps, streaming }: { steps: ProcessStep[]; streaming?: boolean }) {
  const thinkingSteps = steps.filter((step) => step.kind === 'thinking' && step.text)
  const toolSteps = steps.filter((step) => step.kind === 'tool')

  return (
    <div className="w-full space-y-0.5" data-testid="process-steps">
      {thinkingSteps.length > 0 && (
        <ThinkingDisclosure steps={thinkingSteps} streaming={streaming} />
      )}
      {toolSteps.length > 0 && <ToolCallsDisclosure steps={toolSteps} />}
    </div>
  )
}

/** Distinct card for a clarifying question the assistant is waiting on. */
function PendingQuestionCard({
  question,
  options,
  active,
  onAnswer,
}: {
  question: string
  options?: string[] | null
  active: boolean
  onAnswer?: (answer: string) => void
}) {
  return (
    <div
      className="mt-2 rounded-lg border-l-2 border-primary/50 bg-muted/50 px-3 py-2.5"
      data-testid="pending-question-card"
    >
      <div className="flex items-start gap-2">
        <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            待回答
          </div>
          <div className="mt-0.5 text-sm font-medium text-foreground">{question}</div>
        </div>
      </div>
      {options && options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              disabled={!active}
              onClick={() => onAnswer?.(option)}
              className={cn(
                'rounded-full border border-border bg-background px-2.5 py-1 text-xs',
                'transition-colors duration-150',
                active
                  ? 'text-foreground hover:border-primary/50 hover:text-primary'
                  : 'cursor-not-allowed text-muted-foreground opacity-60'
              )}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Ghost undo button + confirmation dialog for an undoable action batch. */
function UndoBatchControl({
  message,
  onUndoBatch,
}: {
  message: ChatMessage
  onUndoBatch?: (batchId: string) => void
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  if (!message.action_batch_id || !onUndoBatch) return null

  if (message.undone_at) {
    return (
      <div className="mt-2 text-xs text-muted-foreground" data-testid="batch-undone-label">
        已撤销
      </div>
    )
  }

  const count = message.actions?.length ?? 0
  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="mt-2 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:border-foreground/20 hover:text-foreground"
      >
        <Undo2 className="h-3 w-3" />
        撤销本轮操作
      </button>
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} className="max-w-md overflow-hidden" ariaLabel="撤销本轮操作">
        <DialogHeader className="relative overflow-hidden px-6 pb-6 pt-6">
          <span className="absolute inset-y-0 left-0 w-1 bg-warning" aria-hidden="true" />
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[8px] bg-warning/10 text-warning">
              <Undo2 className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="mb-1 text-[10px] font-semibold text-muted-foreground">确认操作</p>
              <DialogTitle className="text-xl leading-tight">撤销本轮操作</DialogTitle>
              <DialogDescription className="mt-2">
                将撤销助手本轮执行的 {count} 项操作，恢复或删除相应任务、评论与状态列。此操作不可再次撤销。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setConfirmOpen(false)}>取消</Button>
          <Button onClick={() => { setConfirmOpen(false); onUndoBatch(message.action_batch_id!) }}>
            <Undo2 className="h-4 w-4" />
            确认撤销
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  )
}

export function LLMChatMessage({ message, questionActive = false, members, onAnswerQuestion, onUndoBatch }: Props) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'

  if (isTool) return <ToolStatusMessage message={message} />

  if (isUser) {
    return (
      <div className="flex w-full justify-end">
        <div className="max-w-[80%]">
          <div className="rounded-[8px] bg-muted px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
            <div className="whitespace-pre-wrap">
              {members && members.length > 0 ? (
                <MentionText content={message.content} members={members} />
              ) : (
                message.content
              )}
            </div>
          </div>
          <div className="text-right">
            <Timestamp value={message.created_at} />
          </div>
        </div>
      </div>
    )
  }

  // Assistant: full-width plain flow, markdown rendered
  return (
    <div className="w-full text-sm leading-relaxed text-foreground">
      {message.steps && message.steps.length > 0 && (
        <div className="mb-2">
          <ProcessDisclosures steps={message.steps} streaming={message.streaming} />
        </div>
      )}

      {message.toolStatus && (!message.steps || message.steps.length === 0) && (
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
          {message.toolStatus}
        </div>
      )}

      {message.streaming && !message.content && !message.toolStatus && (
        <span className="text-muted-foreground animate-pulse">思考中…</span>
      )}

      {message.content && (
        <div className="llm-markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const isBlock = /language-/.test(className || '')
                if (isBlock) {
                  return (
                    <code className={cn('font-mono text-[13px]', className)} {...props}>
                      {children}
                    </code>
                  )
                }
                return (
                  <code
                    className="rounded bg-muted px-1 py-0.5 font-mono text-[13px]"
                    {...props}
                  >
                    {children}
                  </code>
                )
              },
              pre({ children }) {
                return (
                  <pre className="my-2 overflow-x-auto rounded-lg bg-muted p-3 scrollbar-thin">
                    {children}
                  </pre>
                )
              },
              p({ children }) {
                return <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>
              },
              ul({ children }) {
                return <ul className="my-1.5 list-disc pl-5 space-y-0.5">{children}</ul>
              },
              ol({ children }) {
                return <ol className="my-1.5 list-decimal pl-5 space-y-0.5">{children}</ol>
              },
              a({ children, href }) {
                return (
                  <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
                    {children}
                  </a>
                )
              },
              table({ children }) {
                return (
                  <div className="my-2 overflow-x-auto">
                    <table className="w-full border-collapse text-xs">{children}</table>
                  </div>
                )
              },
              th({ children }) {
                return <th className="border border-border bg-muted px-2 py-1 text-left font-medium">{children}</th>
              },
              td({ children }) {
                return <td className="border border-border px-2 py-1">{children}</td>
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      )}

      {message.actions && message.actions.length > 0 && (
        <div className="mt-2 space-y-1">
          {message.actions.map((action, idx) => (
            <ActionCard key={idx} action={action} />
          ))}
          {!message.streaming && (
            <UndoBatchControl message={message} onUndoBatch={onUndoBatch} />
          )}
        </div>
      )}

      {message.pending_question && (
        <PendingQuestionCard
          question={message.pending_question.question}
          options={message.pending_question.options}
          active={questionActive}
          onAnswer={onAnswerQuestion}
        />
      )}

      {message.stopped && (
        <div className="mt-1.5 text-xs text-muted-foreground">已停止</div>
      )}
      {message.error && (
        <div className="mt-1.5 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {message.error}
        </div>
      )}

      {!message.streaming && <Timestamp value={message.created_at} />}
    </div>
  )
}
