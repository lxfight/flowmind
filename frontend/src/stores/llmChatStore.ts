import { create } from 'zustand'
import api from '../utils/api'
import type { ChatSession, ChatMessage, ActionSummary } from '../types'

interface LLMChatState {
  sessions: ChatSession[]
  currentSessionId: number | null
  messages: ChatMessage[]
  loading: boolean
  error: string | null

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
  clearError: () => void
}

export const useLLMChatStore = create<LLMChatState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  loading: false,
  error: null,

  loadSessions: async (projectId) => {
    const res = await api.get('/llm/sessions', { params: { project_id: projectId } })
    set({ sessions: res.data as ChatSession[] })
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
    if (!trimmed) return { message: '', actions: [] }

    // Optimistically append user message
    const userMsg: ChatMessage = { role: 'user', content: trimmed }
    set((state) => ({
      messages: [...state.messages, userMsg, { role: 'assistant', content: '', loading: true }],
      loading: true,
      error: null,
    }))

    try {
      const res = await api.post('/llm/agent-chat', {
        project_id: projectId,
        session_id: sessionId,
        message: trimmed,
      })
      const { session_id, message, actions } = res.data as {
        session_id: number
        message: string
        actions: ActionSummary[]
      }

      set((state) => {
        const nextMessages = state.messages.filter((m) => !m.loading)
        nextMessages.push({ role: 'assistant', content: message, actions: actions || [] })
        return {
          messages: nextMessages,
          currentSessionId: session_id,
          loading: false,
          sessions: state.sessions.some((s) => s.id === session_id)
            ? state.sessions.map((s) =>
                s.id === session_id ? { ...s, updated_at: new Date().toISOString() } : s
              )
            : [
                {
                  id: session_id,
                  project_id: projectId,
                  title: trimmed.slice(0, 20) || '新会话',
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                },
                ...state.sessions,
              ],
        }
      })

      return { message, actions: actions || [] }
    } catch (err: any) {
      set((state) => ({
        messages: state.messages.filter((m) => !m.loading),
        loading: false,
        error: err.response?.data?.detail || '请求失败，请检查 LLM 配置',
      }))
      return { message: '', actions: [] }
    }
  },

  clearError: () => set({ error: null }),
}))
