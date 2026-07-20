import { useEffect } from 'react'
import { X, MessageSquarePlus } from 'lucide-react'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from '../ui/Sheet'
import { Button } from '../ui/Button'
import { LLMChatSessionList } from './LLMChatSessionList'
import { LLMChatMessageList } from './LLMChatMessageList'
import { LLMChatInput } from './LLMChatInput'
import { useLLMChatStore } from '../../stores/llmChatStore'
import type { ActionSummary } from '../../types'

interface Props {
  projectId: number
  onClose: () => void
  onActions?: (actions: ActionSummary[]) => void
}

export function LLMChatPanel({ projectId, onClose, onActions }: Props) {
  const {
    sessions,
    currentSessionId,
    messages,
    loading,
    error,
    loadSessions,
    createSession,
    selectSession,
    renameSession,
    deleteSession,
    loadMessages,
    sendMessage,
    clearError,
  } = useLLMChatStore()

  useEffect(() => {
    clearError()
    void loadSessions(projectId)
    return () => {
      selectSession(null)
    }
  }, [projectId, loadSessions, selectSession, clearError])

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
    void createSession(projectId)
  }

  const currentTitle = sessions.find((s) => s.id === currentSessionId)?.title || '新会话'

  return (
    <Sheet open onClose={onClose} side="right" className="!w-full sm:!w-[560px]">
      <div className="flex h-full flex-col">
        <SheetHeader className="shrink-0">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCreateSession}
              className="gap-1.5"
            >
              <MessageSquarePlus className="h-4 w-4" />
              新会话
            </Button>
            <div className="h-4 w-px bg-border" />
            <SheetTitle className="text-base truncate max-w-[280px]">
              {currentTitle}
            </SheetTitle>
          </div>
          <SheetClose onClose={onClose} />
        </SheetHeader>

        <div className="flex flex-1 min-h-0">
          <LLMChatSessionList
            sessions={sessions}
            currentSessionId={currentSessionId}
            onSelect={selectSession}
            onCreate={handleCreateSession}
            onRename={renameSession}
            onDelete={deleteSession}
          />

          <div className="flex flex-1 min-w-0 flex-col">
            {error && (
              <div className="mx-4 mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {error}
              </div>
            )}
            <LLMChatMessageList messages={messages} />
            <LLMChatInput onSend={handleSend} loading={loading} />
          </div>
        </div>
      </div>
    </Sheet>
  )
}
