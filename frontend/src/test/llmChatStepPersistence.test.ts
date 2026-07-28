import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useLLMChatStore } from '../stores/llmChatStore'
import type { ProcessStep } from '../types'

describe('llmChatStore process step persistence', () => {
  beforeEach(() => {
    useLLMChatStore.getState().reset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the recorded steps returned by the final stream event', async () => {
    const steps: ProcessStep[] = [
      { kind: 'thinking', text: '先分析依赖关系。' },
      {
        kind: 'tool',
        id: 'run-1',
        tool: 'get_project_info',
        args: {},
        output: '项目概览',
        status: 'done',
      },
    ]
    const body = [
      'event: done',
      `data: ${JSON.stringify({
        session_id: 7,
        message: '分析完成。',
        actions: [],
        steps,
      })}`,
      '',
      '',
    ].join('\n')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })))

    await useLLMChatStore.getState().sendMessage(1, 7, '分析项目')

    const assistant = useLLMChatStore.getState().messages.at(-1)
    expect(assistant?.role).toBe('assistant')
    expect(assistant?.content).toBe('分析完成。')
    expect(assistant?.steps).toEqual(steps)
  })
})
