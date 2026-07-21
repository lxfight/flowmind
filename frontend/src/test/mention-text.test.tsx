import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MentionText } from '../components/kanban/MentionText'
import type { MemberOption } from '../types'

const members: MemberOption[] = [
  { id: 1, user_id: 1, username: 'alice', display_name: 'Alice', avatar_url: '' },
  { id: 2, user_id: 2, username: 'bob', display_name: 'Bob', avatar_url: '' },
]

describe('MentionText', () => {
  it('highlights mentions of known members', () => {
    const { container } = render(<MentionText content="请 @alice 看一下，@bob 也关注" members={members} />)
    const highlights = container.querySelectorAll('span.text-primary')
    expect(highlights).toHaveLength(2)
    expect(highlights[0].textContent).toBe('@alice')
    expect(highlights[1].textContent).toBe('@bob')
  })

  it('leaves unknown usernames as plain text', () => {
    const { container } = render(<MentionText content="你好 @stranger" members={members} />)
    expect(container.querySelectorAll('span.text-primary')).toHaveLength(0)
    expect(screen.getByText('你好 @stranger')).toBeTruthy()
  })

  it('renders plain content when there are no mentions', () => {
    const { container } = render(<MentionText content="普通评论" members={members} />)
    expect(container.textContent).toBe('普通评论')
  })
})
