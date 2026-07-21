import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { LLMChatMessage } from '../components/llm-chat/LLMChatMessage'
import type { ChatMessage } from '../types'

const baseMessage: ChatMessage = {
  role: 'assistant',
  content: '我需要先确认一下。',
  pending_question: {
    question: '这个任务要指派给谁？',
    options: ['张三', '李四'],
  },
  created_at: new Date().toISOString(),
}

describe('LLMChatMessage pending question', () => {
  it('renders the question card with clickable options when active', async () => {
    const onAnswer = vi.fn()
    render(
      <LLMChatMessage message={baseMessage} questionActive onAnswerQuestion={onAnswer} />
    )

    expect(screen.getByTestId('pending-question-card')).toBeInTheDocument()
    expect(screen.getByText('待回答')).toBeInTheDocument()
    expect(screen.getByText('这个任务要指派给谁？')).toBeInTheDocument()

    const chip = screen.getByRole('button', { name: '张三' })
    expect(chip).toBeEnabled()
    await userEvent.click(chip)
    expect(onAnswer).toHaveBeenCalledWith('张三')
  })

  it('disables option chips after the question is answered (inactive)', async () => {
    const onAnswer = vi.fn()
    render(
      <LLMChatMessage message={baseMessage} questionActive={false} onAnswerQuestion={onAnswer} />
    )

    const chip = screen.getByRole('button', { name: '李四' })
    expect(chip).toBeDisabled()
    await userEvent.click(chip)
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('renders the card without chips when no options are given', () => {
    const message: ChatMessage = {
      ...baseMessage,
      pending_question: { question: '截止日期是哪天？', options: null },
    }
    render(<LLMChatMessage message={message} questionActive />)

    expect(screen.getByText('截止日期是哪天？')).toBeInTheDocument()
    expect(
      screen.getByTestId('pending-question-card').querySelectorAll('button')
    ).toHaveLength(0)
  })
})
