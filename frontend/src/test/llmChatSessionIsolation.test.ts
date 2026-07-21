import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  detailToText: (d: unknown, fb: string) => (typeof d === 'string' && d ? d : fb),
}))

import api from '../utils/api'
import { useLLMChatStore } from '../stores/llmChatStore'
import { useAuthStore } from '../stores/authStore'
import type { ChatSession } from '../types'

const mockGet = vi.mocked(api.get)

function session(id: number, projectId: number): ChatSession {
  return {
    id,
    project_id: projectId,
    title: `会话${id}`,
    awaiting_input: false,
    created_at: '2026-07-21T00:00:00Z',
    updated_at: '2026-07-21T00:00:00Z',
  }
}

describe('llmChatStore session isolation', () => {
  beforeEach(() => {
    useLLMChatStore.getState().reset()
    vi.clearAllMocks()
  })

  it('switching projects clears the previous project list and selection', async () => {
    mockGet.mockResolvedValueOnce({ data: [session(1, 1)] })
    await useLLMChatStore.getState().loadSessions(1)
    useLLMChatStore.getState().selectSession(1)
    expect(useLLMChatStore.getState().currentSessionId).toBe(1)

    mockGet.mockResolvedValueOnce({ data: [session(2, 2)] })
    await useLLMChatStore.getState().loadSessions(2)

    const state = useLLMChatStore.getState()
    expect(state.sessionsProjectId).toBe(2)
    expect(state.sessions.map((s) => s.id)).toEqual([2])
    expect(state.currentSessionId).toBeNull()
    expect(state.messages).toEqual([])
  })

  it('drops a stale selection that is no longer in the fetched list', async () => {
    mockGet.mockResolvedValueOnce({ data: [session(1, 1)] })
    await useLLMChatStore.getState().loadSessions(1)
    useLLMChatStore.getState().selectSession(1)

    mockGet.mockResolvedValueOnce({ data: [] })
    await useLLMChatStore.getState().loadSessions(1)

    expect(useLLMChatStore.getState().currentSessionId).toBeNull()
  })

  it('resets chat state when the auth token changes (user switch / logout)', async () => {
    mockGet.mockResolvedValueOnce({ data: [session(1, 1)] })
    await useLLMChatStore.getState().loadSessions(1)
    useLLMChatStore.getState().selectSession(1)

    useAuthStore.setState({ token: 'token-a' }) // login
    useAuthStore.setState({ token: null }) // logout

    const state = useLLMChatStore.getState()
    expect(state.sessions).toEqual([])
    expect(state.currentSessionId).toBeNull()
    expect(state.messages).toEqual([])
    expect(state.sessionsProjectId).toBeNull()
  })
})
