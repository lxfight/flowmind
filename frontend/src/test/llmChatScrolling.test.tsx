import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LLMChatMessageList } from '../components/llm-chat/LLMChatMessageList'
import type { ChatMessage } from '../types'

describe('LLMChatMessageList scrolling', () => {
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    scrollIntoView.mockReset()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    })
  })

  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  it('stops following streamed output after the user scrolls away from the bottom', () => {
    const initialMessages: ChatMessage[] = [
      { id: 1, role: 'user', content: '请生成较长的回答' },
      { id: 2, role: 'assistant', content: '第一段', streaming: true },
    ]
    const { rerender } = render(
      <LLMChatMessageList messages={initialMessages} streaming />,
    )
    const list = screen.getByTestId('chat-message-list')
    let scrollTop = 100
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 200 },
      scrollTop: { configurable: true, get: () => scrollTop },
    })

    fireEvent.scroll(list)
    expect(screen.getByRole('button', { name: '滚动到最新消息' })).toBeInTheDocument()
    const callsBeforeUpdate = scrollIntoView.mock.calls.length

    rerender(
      <LLMChatMessageList
        messages={[initialMessages[0], { ...initialMessages[1], content: '第一段\n\n第二段' }]}
        streaming
      />,
    )
    expect(scrollIntoView).toHaveBeenCalledTimes(callsBeforeUpdate)

    scrollTop = 750
    fireEvent.scroll(list)
    expect(screen.queryByRole('button', { name: '滚动到最新消息' })).not.toBeInTheDocument()

    rerender(
      <LLMChatMessageList
        messages={[initialMessages[0], { ...initialMessages[1], content: '第一段\n\n第二段\n\n第三段' }]}
        streaming
      />,
    )
    expect(scrollIntoView).toHaveBeenCalledTimes(callsBeforeUpdate + 1)
  })
})
