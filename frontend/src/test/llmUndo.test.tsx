import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { LLMChatMessage } from '../components/llm-chat/LLMChatMessage'
import type { ChatMessage } from '../types'

const undoableMessage: ChatMessage = {
  role: 'assistant',
  content: '已完成两项操作。',
  actions: [
    { type: 'create_task', task_id: 1, title: '任务A' },
    { type: 'move_task', task_id: 2, title: '任务B' },
  ],
  action_batch_id: 'batch-123',
  created_at: new Date().toISOString(),
}

describe('LLMChatMessage undo batch', () => {
  it('renders the undo button on actionable assistant messages', () => {
    render(<LLMChatMessage message={undoableMessage} onUndoBatch={vi.fn()} />)
    expect(screen.getByRole('button', { name: /撤销本轮操作/ })).toBeInTheDocument()
  })

  it('asks for confirmation and then calls onUndoBatch with the batch id', async () => {
    const onUndo = vi.fn()
    render(<LLMChatMessage message={undoableMessage} onUndoBatch={onUndo} />)

    await userEvent.click(screen.getByRole('button', { name: /撤销本轮操作/ }))
    expect(screen.getByText(/将撤销助手本轮执行的 2 项操作/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '确认撤销' }))
    expect(onUndo).toHaveBeenCalledWith('batch-123')
  })

  it('cancel closes the dialog without undoing', async () => {
    const onUndo = vi.fn()
    render(<LLMChatMessage message={undoableMessage} onUndoBatch={onUndo} />)

    await userEvent.click(screen.getByRole('button', { name: /撤销本轮操作/ }))
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('shows a muted 已撤销 label instead of the button once undone', () => {
    const undone: ChatMessage = {
      ...undoableMessage,
      undone_at: new Date().toISOString(),
    }
    render(<LLMChatMessage message={undone} onUndoBatch={vi.fn()} />)

    expect(screen.getByTestId('batch-undone-label')).toHaveTextContent('已撤销')
    expect(screen.queryByRole('button', { name: /撤销本轮操作/ })).not.toBeInTheDocument()
  })

  it('renders no undo affordance without a batch id', () => {
    const { action_batch_id, ...rest } = undoableMessage
    render(<LLMChatMessage message={rest} onUndoBatch={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /撤销本轮操作/ })).not.toBeInTheDocument()
  })
})
