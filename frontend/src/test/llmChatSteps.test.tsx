import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { LLMChatMessage } from '../components/llm-chat/LLMChatMessage'
import type { ChatMessage } from '../types'

describe('LLMChatMessage process steps', () => {
  it('renders one collapsed process disclosure with the current running state', async () => {
    const message: ChatMessage = {
      role: 'assistant',
      content: '',
      streaming: true,
      steps: [
        { kind: 'thinking', text: '先查项目信息…' },
        { kind: 'tool', id: 'r1', tool: 'get_project_info', args: {}, status: 'done', output: '项目概览' },
        { kind: 'tool', id: 'r2', tool: 'create_task', args: { title: '任务A' }, status: 'running' },
      ],
    }
    render(<LLMChatMessage message={message} />)

    expect(screen.getByTestId('process-steps')).toBeInTheDocument()
    expect(screen.getByText('正在创建任务')).toBeInTheDocument()
    expect(screen.queryByText('先查项目信息…')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('正在创建任务'))
    expect(screen.getByText('先查项目信息…')).toBeInTheDocument()
    expect(screen.getByText('查看项目信息')).toBeInTheDocument()
    expect(screen.getByText('创建任务')).toBeInTheDocument()
  })

  it('keeps steps visible after streaming completes', () => {
    const message: ChatMessage = {
      role: 'assistant',
      content: '已创建任务。',
      streaming: false,
      steps: [{ kind: 'tool', id: 'r1', tool: 'create_task', status: 'done', output: '已创建任务 [1]' }],
      created_at: new Date().toISOString(),
    }
    render(<LLMChatMessage message={message} />)

    expect(screen.getByTestId('process-steps')).toBeInTheDocument()
    expect(screen.getByText('使用了 1 个工具')).toBeInTheDocument()
  })

  it('expands a finished tool step to show its output', async () => {
    const message: ChatMessage = {
      role: 'assistant',
      content: '',
      steps: [{ kind: 'tool', id: 'r1', tool: 'search_knowledge', status: 'done', output: '检索到 3 条结果' }],
    }
    render(<LLMChatMessage message={message} />)

    expect(screen.queryByText(/检索到 3 条结果/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('使用了 1 个工具'))
    expect(screen.getByText(/检索到 3 条结果/)).toBeInTheDocument()
  })

  it('expands a thinking step to reveal the reasoning text', async () => {
    const message: ChatMessage = {
      role: 'assistant',
      content: '',
      steps: [{ kind: 'thinking', text: '需要先确认状态列，再创建任务。' }],
    }
    render(<LLMChatMessage message={message} />)

    expect(screen.queryByText('需要先确认状态列，再创建任务。')).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('已思考'))
    expect(screen.getByText('需要先确认状态列，再创建任务。')).toBeInTheDocument()
  })

  it('renders nothing process-related when there are no steps', () => {
    const message: ChatMessage = { role: 'assistant', content: '普通回复', created_at: new Date().toISOString() }
    render(<LLMChatMessage message={message} />)
    expect(screen.queryByTestId('process-steps')).not.toBeInTheDocument()
  })
})
