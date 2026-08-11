import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Bot, Grip, GripVertical, History, MessageSquarePlus, Radio, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { LLMChatSessionList } from './LLMChatSessionList'
import { LLMChatMessageList } from './LLMChatMessageList'
import { LLMChatInput } from './LLMChatInput'
import { useLLMChatStore } from '../../stores/llmChatStore'
import type { ActionSummary, MemberOption } from '../../types'
import { cn } from '../../utils/cn'
import {
  clampPosition,
  clampSize,
  loadGeometry,
  saveGeometry,
  type Rect,
  type Viewport,
} from './floatingGeometry'

/** Floating-window curve: 225ms ease-out, scale + fade. */
const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)'
const ANIM_MS = 225

function viewportOf(): Viewport {
  return { w: window.innerWidth, h: window.innerHeight }
}

interface Props {
  /** null = 跨项目助手（我的项目页），聚合用户参与的所有项目 */
  projectId: number | null
  open: boolean
  onClose: () => void
  onActions?: (actions: ActionSummary[]) => void
  /** 项目成员，用于输入框 @ 补全与消息 mention 高亮。
   *  跨项目模式下不传（成员跨多项目，@ 补全禁用） */
  members?: MemberOption[]
}

export function LLMChatPanel({ projectId, open, onClose, onActions, members }: Props) {
  const {
    sessions,
    currentSessionId,
    messages,
    streaming,
    loading,
    error,
    loadSessions,
    createSession,
    selectSession,
    renameSession,
    deleteSession,
    loadMessages,
    sendMessage,
    stopStreaming,
    undoBatch,
    setDraft,
    clearError,
  } = useLLMChatStore()

  const [rect, setRect] = useState<Rect>(() => loadGeometry(viewportOf()))
  const [interacting, setInteracting] = useState<'drag' | 'resize' | null>(null)
  const [showSessions, setShowSessions] = useState(false)
  const [visible, setVisible] = useState(open)
  const [entered, setEntered] = useState(open)
  const [sendBlocked, setSendBlocked] = useState(false)
  const compactViewport = typeof window !== 'undefined' && window.innerWidth <= 640
  const rectRef = useRef(rect)
  useEffect(() => {
    rectRef.current = rect
  }, [rect])

  // Keep mounted during the exit transition so the scale/fade-out is visible
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- keep panel mounted for the enter/exit transition
      setVisible(true)
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)))
      return () => cancelAnimationFrame(raf)
    }
    setEntered(false)
    const t = setTimeout(() => setVisible(false), ANIM_MS + 30)
    return () => clearTimeout(t)
  }, [open])

  // Re-clamp to the viewport on browser resize
  useEffect(() => {
    const onResize = () => {
      const vp = viewportOf()
      setRect((r) => {
        const size = clampSize({ w: r.w, h: r.h }, vp)
        const pos = clampPosition(r.x, r.y, size, vp)
        return { ...size, ...pos }
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    clearError()
    void loadSessions(projectId)
  }, [projectId, loadSessions, clearError])

  useEffect(() => {
    if (currentSessionId) {
      void loadMessages(currentSessionId)
    }
  }, [currentSessionId, loadMessages])

  // Clear the "waiting for generation" hint once the stream finishes.
  useEffect(() => {
    if (!streaming) setSendBlocked(false)
  }, [streaming])

  const handleSend = async (content: string) => {
    clearError()
    const { actions, blocked, failed } = await sendMessage(projectId, currentSessionId, content)
    if (blocked) {
      // Keep the user's draft and tell them why the message didn't go out.
      setSendBlocked(true)
      return false
    }
    if (failed) {
      // Message didn't reach the model — keep the draft so nothing is lost.
      return false
    }
    setSendBlocked(false)
    if (actions.length > 0 && onActions) {
      onActions(actions)
    }
    return true
  }

  const handleCreateSession = () => {
    setShowSessions(false)
    void createSession(projectId)
  }

  const handleUndoBatch = async (batchId: string) => {
    if (!currentSessionId) return
    const result = await undoBatch(currentSessionId, batchId)
    if (!result) {
      toast.error('撤销失败，请稍后重试')
      return
    }
    if (result.skipped.length > 0) {
      toast(`已撤销 ${result.undone.length} 项，${result.skipped.length} 项因数据已变化而跳过`)
    } else {
      toast.success('已撤销本轮操作')
    }
  }

  // --- Drag by header (buttons excluded) ------------------------------------
  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (compactViewport) return
    if (e.button !== 0) return
    // Keep header buttons clickable — never start a drag from them
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const header = e.currentTarget
    header.setPointerCapture(e.pointerId)
    const start = { px: e.clientX, py: e.clientY, x: rectRef.current.x, y: rectRef.current.y }
    setInteracting('drag')

    const onMove = (ev: PointerEvent) => {
      const { w, h } = rectRef.current
      const pos = clampPosition(
        start.x + (ev.clientX - start.px),
        start.y + (ev.clientY - start.py),
        { w, h },
        viewportOf()
      )
      const next = { ...rectRef.current, ...pos }
      rectRef.current = next
      setRect(next)
    }
    const onUp = () => {
      header.removeEventListener('pointermove', onMove)
      header.removeEventListener('pointerup', onUp)
      header.removeEventListener('pointercancel', onUp)
      setInteracting(null)
      saveGeometry(rectRef.current)
    }
    header.addEventListener('pointermove', onMove)
    header.addEventListener('pointerup', onUp)
    header.addEventListener('pointercancel', onUp)
  }

  // --- Resize from the bottom-right corner -----------------------------------
  const onResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const start = { px: e.clientX, py: e.clientY, w: rectRef.current.w, h: rectRef.current.h }
    setInteracting('resize')

    const onMove = (ev: PointerEvent) => {
      const size = clampSize(
        { w: start.w + (ev.clientX - start.px), h: start.h + (ev.clientY - start.py) },
        viewportOf()
      )
      const next = { ...rectRef.current, ...size }
      rectRef.current = next
      setRect(next)
    }
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      setInteracting(null)
      saveGeometry(rectRef.current)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  const currentTitle = sessions.find((s) => s.id === currentSessionId)?.title || '新会话'

  // The assistant is waiting for an answer when the latest message carries a
  // pending question and no stream is running.
  const lastMessage = messages[messages.length - 1]
  const awaitingInput = Boolean(lastMessage?.pending_question) && !streaming

  if (!visible) return null

  return (
    <div
      role="dialog"
      aria-label="LLM 助手面板"
      aria-hidden={!open}
      className={cn(
        'fixed z-40 flex flex-col overflow-hidden bg-card/95 text-card-foreground backdrop-blur-xl',
        compactViewport
          ? 'border-0'
          : 'rounded-[8px] border border-primary/20 shadow-[0_30px_100px_-30px_rgba(0,0,0,0.68)]',
        interacting && 'select-none'
      )}
      style={{
        left: compactViewport ? 0 : rect.x,
        top: compactViewport ? 0 : rect.y,
        width: compactViewport ? '100vw' : rect.w,
        height: compactViewport ? '100dvh' : rect.h,
        transform: entered ? 'scale(1)' : 'scale(0.95)',
        opacity: entered ? 1 : 0,
        transformOrigin: 'bottom right',
        // Direct manipulation must be instant — no transition while dragging/resizing
        transition: interacting
          ? 'none'
          : `transform ${ANIM_MS}ms ${EASE}, opacity ${ANIM_MS}ms ${EASE}`,
      }}
    >
      {/* Header — drag zone (buttons stay clickable) */}
      <div
        onPointerDown={onHeaderPointerDown}
        className={cn(
          'relative flex h-16 shrink-0 items-center gap-2 border-b border-border bg-muted/[0.18] px-3 sm:px-4',
          compactViewport ? 'cursor-default' : interacting === 'drag' ? 'cursor-grabbing' : 'cursor-grab'
        )}
        style={{ touchAction: 'none' }}
      >
        <span className="absolute inset-y-0 left-0 w-1 bg-primary" aria-hidden="true" />
        {!compactViewport && <GripVertical className="h-4 w-4 flex-none text-muted-foreground/55" aria-hidden="true" />}
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[8px] bg-primary text-primary-foreground shadow-sm">
          <Bot className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">FlowMind 助手</span>
            {projectId === null && (
              <span className="shrink-0 border-l border-primary/30 pl-2 text-[10px] font-semibold text-primary">跨项目</span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{currentTitle}</span>
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={() => setShowSessions(!showSessions)}
          aria-label="会话列表"
          aria-expanded={showSessions}
          title="会话列表"
        >
          <History className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={handleCreateSession}
          aria-label="新建会话"
          title="新建会话"
        >
          <MessageSquarePlus className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={onClose}
          aria-label="关闭助手面板"
          title="关闭"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Body */}
      <div className="relative flex flex-1 min-h-0 flex-col">
        {showSessions && (
          <>
            <div
              className="absolute inset-0 z-10"
              onClick={() => setShowSessions(false)}
              aria-hidden="true"
            />
            <div className="absolute left-3 right-3 top-3 z-20 max-h-[60%] overflow-hidden rounded-[8px] border border-border bg-popover/95 shadow-[0_24px_70px_-26px_rgba(0,0,0,0.7)] backdrop-blur-xl">
              <LLMChatSessionList
                sessions={sessions}
                currentSessionId={currentSessionId}
                onSelect={(id) => {
                  selectSession(id)
                  setShowSessions(false)
                }}
                onCreate={handleCreateSession}
                onRename={renameSession}
                onDelete={deleteSession}
                className="w-full border-r-0 bg-popover"
              />
            </div>
          </>
        )}

        {error && !streaming && (
          <div className="mx-3 mt-3 border-y border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        <LLMChatMessageList
          messages={messages}
          streaming={streaming}
          loading={loading}
          members={members}
          crossProject={projectId === null}
          onExampleClick={setDraft}
          onAnswerQuestion={handleSend}
          onUndoBatch={handleUndoBatch}
        />
        {awaitingInput && (
          <div className="mx-3 mb-1 flex items-center gap-1.5 border-y border-border bg-muted/40 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            <Radio className="h-3 w-3 text-primary" aria-hidden="true" />
            助手正在等待你的回答
          </div>
        )}
        <LLMChatInput
          onSend={handleSend}
          onStop={stopStreaming}
          streaming={streaming}
          sessionTitle={currentSessionId ? currentTitle : undefined}
          members={members}
          blockedHint={sendBlocked}
        />
      </div>

      {/* Resize handle — bottom-right corner */}
      {!compactViewport && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="调整窗口大小"
          onPointerDown={onResizePointerDown}
          className={cn('absolute bottom-0 right-0 z-10 flex h-7 w-7 cursor-nwse-resize items-end justify-end p-1 text-muted-foreground transition-colors hover:text-primary', interacting === 'resize' && 'text-primary')}
          style={{ touchAction: 'none' }}
        >
          <Grip className="h-3.5 w-3.5 rotate-45" aria-hidden="true" />
        </div>
      )}
    </div>
  )
}
