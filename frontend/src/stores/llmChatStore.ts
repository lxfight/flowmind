import { create } from 'zustand'
import api from '../utils/api'
import { useAuthStore } from './authStore'
import type { ChatSession, ChatMessage, ActionSummary, UndoResult } from '../types'

/** Human-friendly labels for agent tool calls (streaming status + history). */
export const TOOL_LABELS: Record<string, string> = {
  get_project_info: '查看项目信息',
  list_tasks: '列出任务',
  search_tasks: '搜索任务',
  get_task: '查看任务详情',
  get_members: '查看成员列表',
  create_task: '创建任务',
  update_task: '更新任务',
  move_task: '移动任务',
  add_comment: '添加评论',
  add_subtask: '添加子任务',
  update_subtask: '更新子任务',
  create_status: '创建状态列',
  update_status: '更新状态列',
  delete_status: '删除状态列',
  search_knowledge: '检索知识库',
  list_knowledge_docs: '查看知识库文档',
  get_doc_content: '阅读文档',
  ask_user: '向你提问',
}

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] || name
}

interface LLMChatState {
  sessions: ChatSession[]
  currentSessionId: number | null
  messages: ChatMessage[]
  loading: boolean
  /** True while an SSE stream is in flight */
  streaming: boolean
  error: string | null
  /** Draft input text (example prompts can prefill it) */
  draft: string

  loadSessions: (projectId: number) => Promise<void>
  createSession: (projectId: number, title?: string) => Promise<number>
  renameSession: (sessionId: number, title: string) => Promise<void>
  deleteSession: (sessionId: number) => Promise<void>
  selectSession: (sessionId: number | null) => void
  loadMessages: (sessionId: number) => Promise<void>
  sendMessage: (
    projectId: number,
    sessionId: number | null,
    content: string
  ) => Promise<{ message: string; actions: ActionSummary[] }>
  stopStreaming: () => void
  /** Undo the given agent action batch; returns null when the request failed */
  undoBatch: (sessionId: number, batchId: string) => Promise<UndoResult | null>
  setDraft: (draft: string) => void
  clearError: () => void
}

let abortController: AbortController | null = null

/** Parse SSE frames from a fetch Response body. */
async function readSSE(
  res: Response,
  onEvent: (event: string, data: any) => void,
  signal: AbortSignal
): Promise<void> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    if (signal.aborted) {
      try { await reader.cancel() } catch { /* ignore */ }
      return
    }
    const { done, value } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    // SSE frames are separated by a blank line
    let idx
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      if (!frame.trim() || frame.startsWith(':')) continue // comments / pings
      let event = 'message'
      const dataLines: string[] = []
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
      }
      if (dataLines.length === 0) continue
      try {
        onEvent(event, JSON.parse(dataLines.join('\n')))
      } catch { /* ignore malformed frame */ }
    }
  }
}

export const useLLMChatStore = create<LLMChatState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  loading: false,
  streaming: false,
  error: null,
  draft: '',

  loadSessions: async (projectId) => {
    try {
      const res = await api.get('/llm/sessions', { params: { project_id: projectId } })
      set({ sessions: res.data as ChatSession[] })
    } catch {
      set({ error: '加载会话列表失败' })
    }
  },

  createSession: async (projectId, title) => {
    const res = await api.post('/llm/sessions', { project_id: projectId, title: title || '新会话' })
    const session = res.data as ChatSession
    set((state) => ({
      sessions: [session, ...state.sessions],
      currentSessionId: session.id,
      messages: [],
    }))
    return session.id
  },

  renameSession: async (sessionId, title) => {
    const res = await api.put(`/llm/sessions/${sessionId}`, { title })
    const updated = res.data as ChatSession
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === sessionId ? updated : s)),
    }))
  },

  deleteSession: async (sessionId) => {
    await api.delete(`/llm/sessions/${sessionId}`)
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== sessionId),
      currentSessionId:
        state.currentSessionId === sessionId ? null : state.currentSessionId,
      messages: state.currentSessionId === sessionId ? [] : state.messages,
    }))
  },

  selectSession: (sessionId) => {
    set({ currentSessionId: sessionId, messages: [], error: null })
  },

  loadMessages: async (sessionId) => {
    set({ loading: true })
    try {
      const res = await api.get(`/llm/sessions/${sessionId}`)
      const session = res.data as { messages: ChatMessage[] }
      set({ messages: session.messages, loading: false })
    } catch {
      set({ loading: false, error: '加载聊天记录失败' })
    }
  },

  sendMessage: async (projectId, sessionId, content) => {
    const trimmed = content.trim()
    if (!trimmed || get().streaming) return { message: '', actions: [] }

    const now = new Date().toISOString()
    const userMsg: ChatMessage = { role: 'user', content: trimmed, created_at: now }
    set((state) => ({
      messages: [
        ...state.messages,
        userMsg,
        { role: 'assistant', content: '', streaming: true, toolStatus: null, created_at: now },
      ],
      streaming: true,
      error: null,
      // Sending a reply answers any pending question in this session
      sessions: state.sessions.map((s) =>
        s.id === (sessionId ?? state.currentSessionId) ? { ...s, awaiting_input: false } : s
      ),
    }))

    const controller = new AbortController()
    abortController = controller

    const patchAssistant = (patch: Partial<ChatMessage>) => {
      set((state) => {
        const messages = [...state.messages]
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'assistant') {
            messages[i] = { ...messages[i], ...patch }
            break
          }
        }
        return { messages }
      })
    }

    let finalMessage = ''
    let finalActions: ActionSummary[] = []
    let finalSessionId: number | null = null
    let finalPendingQuestion: ChatMessage['pending_question'] = null
    let finalBatchId: string | null = null
    let sawDone = false

    try {
      const token = useAuthStore.getState().token
      const res = await fetch('/api/llm/agent-chat/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          project_id: projectId,
          session_id: sessionId,
          message: trimmed,
        }),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        let detail = '请求失败，请检查 LLM 配置'
        try {
          const data = await res.json()
          if (data?.detail) detail = data.detail
        } catch { /* non-JSON error */ }
        throw new Error(detail)
      }

      await readSSE(res, (event, data) => {
        if (event === 'token') {
          patchAssistant({ toolStatus: null })
          set((state) => {
            const messages = [...state.messages]
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].role === 'assistant') {
                messages[i] = { ...messages[i], content: messages[i].content + (data.text || '') }
                break
              }
            }
            return { messages }
          })
        } else if (event === 'tool_start') {
          patchAssistant({ toolStatus: `🔧 正在${toolLabel(data.name || '')}…` })
        } else if (event === 'tool_end') {
          patchAssistant({ toolStatus: null })
        } else if (event === 'done') {
          sawDone = true
          finalMessage = data.message || ''
          finalActions = data.actions || []
          finalSessionId = data.session_id ?? null
          finalPendingQuestion = data.pending_question ?? null
          finalBatchId = data.action_batch_id ?? null
          patchAssistant({
            streaming: false,
            toolStatus: null,
            content: finalMessage,
            actions: finalActions,
            pending_question: finalPendingQuestion,
            action_batch_id: finalBatchId,
            created_at: new Date().toISOString(),
          })
        } else if (event === 'error') {
          patchAssistant({ streaming: false, toolStatus: null, error: data.message || '生成失败' })
        }
      }, controller.signal)

      if (controller.signal.aborted) {
        patchAssistant({ streaming: false, toolStatus: null, stopped: true })
        set({ streaming: false })
        return { message: '', actions: [] }
      }

      set((state) => ({
        streaming: false,
        currentSessionId: finalSessionId ?? state.currentSessionId,
        sessions: finalSessionId
          ? state.sessions.some((s) => s.id === finalSessionId)
            ? state.sessions.map((s) =>
                s.id === finalSessionId
                  ? {
                      ...s,
                      updated_at: new Date().toISOString(),
                      awaiting_input: Boolean(finalPendingQuestion),
                    }
                  : s
              )
            : [
                {
                  id: finalSessionId!,
                  project_id: projectId,
                  title: trimmed.slice(0, 20) || '新会话',
                  awaiting_input: Boolean(finalPendingQuestion),
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
                ...state.sessions,
              ]
          : state.sessions,
      }))

      if (!sawDone) {
        // Stream ended without a done frame and without an error frame
        patchAssistant({ streaming: false, toolStatus: null })
      }

      return { message: finalMessage, actions: finalActions }
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === 'AbortError') {
        patchAssistant({ streaming: false, toolStatus: null, stopped: true })
      } else {
        const text = err?.message || '请求失败，请检查 LLM 配置'
        patchAssistant({ streaming: false, toolStatus: null, error: text })
        set({ error: text })
      }
      set({ streaming: false })
      return { message: '', actions: [] }
    } finally {
      if (abortController === controller) abortController = null
    }
  },

  stopStreaming: () => {
    abortController?.abort()
  },

  undoBatch: async (sessionId, batchId) => {
    try {
      const res = await api.post(`/llm/sessions/${sessionId}/undo`)
      const result = res.data as UndoResult
      set((state) => ({
        messages: state.messages.map((m) =>
          m.action_batch_id === batchId
            ? { ...m, undone_at: new Date().toISOString() }
            : m
        ),
      }))
      return result
    } catch {
      return null
    }
  },

  setDraft: (draft) => set({ draft }),

  clearError: () => set({ error: null }),
}))
