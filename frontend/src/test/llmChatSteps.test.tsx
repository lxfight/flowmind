import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { LLMChatMessage } from '../components/llm-chat/LLMChatMessage'
import type { ChatMessage } from '../types'

describe('LLMChatMessage process steps', () => {
  it('renders thinking and tool calls as separate disclosures', async () => {
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
    expect(screen.getByTestId('thinking-steps')).toBeInTheDocument()
    expect(screen.getByTestId('tool-steps')).toBeInTheDocument()
    expect(screen.getByText('思考中')).toBeInTheDocument()
    expect(screen.getByText('工具调用 · 正在创建任务')).toBeInTheDocument()
    expect(screen.queryByText('先查项目信息…')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('思考中'))
    expect(screen.getByText('先查项目信息…')).toBeInTheDocument()
    expect(screen.queryByText('查看项目信息')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('工具调用 · 正在创建任务'))
    expect(screen.getByText('查看项目信息')).toBeInTheDocument()
    expect(screen.getByText('创建任务')).toBeInTheDocument()
    expect(screen.getAllByTestId('tool-call-item')).toHaveLength(2)
    expect(screen.queryByText('项目概览')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('查看项目信息'))
    expect(screen.getByText('执行结果')).toBeInTheDocument()
    expect(screen.getByText('项目概览')).toBeInTheDocument()
    expect(screen.queryByText('任务A')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('创建任务'))
    expect(screen.getByText('调用参数')).toBeInTheDocument()
    expect(screen.getByText('title')).toBeInTheDocument()
    expect(screen.getByText('任务A')).toBeInTheDocument()
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
    expect(screen.getByText('工具调用 · 1')).toBeInTheDocument()
  })

  it('expands a finished tool step to show its output', async () => {
    const message: ChatMessage = {
      role: 'assistant',
      content: '',
      steps: [{ kind: 'tool', id: 'r1', tool: 'search_knowledge', status: 'done', output: '检索到 3 条结果' }],
    }
    render(<LLMChatMessage message={message} />)

    expect(screen.queryByText(/检索到 3 条结果/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('工具调用 · 1'))
    expect(screen.queryByText(/检索到 3 条结果/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('检索知识库'))
    expect(screen.getByText(/检索到 3 条结果/)).toBeInTheDocument()
  })

  it('renders JSON tool output as labeled fields', async () => {
    const message: ChatMessage = {
      role: 'assistant',
      content: '',
      steps: [{
        kind: 'tool',
        id: 'r1',
        tool: 'create_task',
        status: 'done',
        output: JSON.stringify({ ok: true, message: '已创建任务', task_id: 12 }),
      }],
    }
    render(<LLMChatMessage message={message} />)

    await userEvent.click(screen.getByText('工具调用 · 1'))
    await userEvent.click(screen.getByText('创建任务'))

    expect(screen.getByText('执行结果')).toBeInTheDocument()
    expect(screen.getByText('ok')).toBeInTheDocument()
    expect(screen.getByText('message')).toBeInTheDocument()
    expect(screen.getByText('task_id')).toBeInTheDocument()
    expect(screen.getByText('已创建任务')).toBeInTheDocument()
  })

  it('expands a thinking step to reveal the reasoning text', async () => {
    const message: ChatMessage = {
      role: 'assistant',
      content: '',
      steps: [{ kind: 'thinking', text: '需要先确认状态列，再创建任务。' }],
    }
    render(<LLMChatMessage message={message} />)

    expect(screen.queryByText('需要先确认状态列，再创建任务。')).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('思考内容'))
    expect(screen.getByText('需要先确认状态列，再创建任务。')).toBeInTheDocument()
  })

  it('renders nothing process-related when there are no steps', () => {
    const message: ChatMessage = { role: 'assistant', content: '普通回复', created_at: new Date().toISOString() }
    render(<LLMChatMessage message={message} />)
    expect(screen.queryByTestId('process-steps')).not.toBeInTheDocument()
  })
})
