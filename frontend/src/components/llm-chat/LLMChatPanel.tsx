import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { History, MessageSquarePlus, X } from 'lucide-react'
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

  const handleSend = async (content: string) => {
    clearError()
    const { actions } = await sendMessage(projectId, currentSessionId, content)
    if (actions.length > 0 && onActions) {
      onActions(actions)
    }
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
      toast(`已撤销 ${result.undone.length} 项，${result.skipped.length} 项因数据已变化而跳过`, { icon: '⚠️' })
    } else {
      toast.success('已撤销本轮操作')
    }
  }

  // --- Drag by header (buttons excluded) ------------------------------------
  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
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
        'fixed z-40 flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-lg',
        interacting && 'select-none'
      )}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
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
          'flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-3',
          interacting === 'drag' ? 'cursor-grabbing' : 'cursor-grab'
        )}
        style={{ touchAction: 'none' }}
      >
        <span className="truncate text-sm font-semibold text-foreground">FlowMind 助手</span>
        {projectId === null && (
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            跨项目
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {currentTitle}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setShowSessions(!showSessions)}
          aria-label="会话列表"
          aria-expanded={showSessions}
        >
          <History className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleCreateSession}
          aria-label="新建会话"
        >
          <MessageSquarePlus className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onClose}
          aria-label="关闭助手面板"
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
            <div className="absolute left-2 right-2 top-2 z-20 max-h-[60%] overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
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
          <div className="mx-3 mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        <LLMChatMessageList
          messages={messages}
          streaming={streaming}
          members={members}
          crossProject={projectId === null}
          onExampleClick={setDraft}
          onAnswerQuestion={handleSend}
          onUndoBatch={handleUndoBatch}
        />
        {awaitingInput && (
          <div className="mx-3 mb-1 flex items-center gap-1.5 rounded-lg bg-muted/60 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/70" />
            助手正在等待你的回答
          </div>
        )}
        <LLMChatInput
          onSend={handleSend}
          onStop={stopStreaming}
          streaming={streaming}
          sessionTitle={currentSessionId ? currentTitle : undefined}
          members={members}
        />
      </div>

      {/* Resize handle — bottom-right corner */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="调整窗口大小"
        onPointerDown={onResizePointerDown}
        className={cn(
          'absolute bottom-0 right-0 z-10 h-4 w-4 cursor-nwse-resize',
          'before:absolute before:bottom-1 before:right-1 before:h-2 before:w-2 before:rounded-br-sm',
          'before:border-b-2 before:border-r-2',
          interacting === 'resize' ? 'before:border-primary/60' : 'before:border-muted-foreground/40 hover:before:border-primary/50'
        )}
        style={{ touchAction: 'none' }}
      />
    </div>
  )
}
