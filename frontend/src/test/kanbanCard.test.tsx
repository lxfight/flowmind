import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { KanbanCard } from '../components/kanban/KanbanCard'
import type { TaskCard, MemberOption } from '../types'

const members: MemberOption[] = [
  { id: 1, user_id: 1, display_name: '张三', username: 'zhangsan', avatar_url: '' },
  { id: 2, user_id: 2, display_name: '李四', username: 'lisi', avatar_url: '' },
]

function task(overrides: Partial<TaskCard> = {}): TaskCard {
  return {
    id: 10,
    title: '测试任务',
    priority: 1,
    assignees: [
      { id: 1, display_name: '张三', avatar_url: '' },
      { id: 2, display_name: '李四', avatar_url: '' },
    ],
    due_date: null,
    is_completed: false,
    subtask_count: 0,
    subtask_done: 0,
    comment_count: 0,
    milestone_ids: [],
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

describe('KanbanCard assignee click-to-filter', () => {
  it('calls onAssigneeClick when an avatar is clicked in read-only mode', async () => {
    const onAssigneeClick = vi.fn()
    render(
      <KanbanCard
        task={task()}
        members={members}
        milestones={[]}
        readOnly
        onAssigneeClick={onAssigneeClick}
      />,
    )

    // Click the first assignee avatar (张三).
    await userEvent.click(screen.getByRole('button', { name: '查看 张三 的任务' }))
    expect(onAssigneeClick).toHaveBeenCalledWith(1)
  })

  it('calls onAssigneeClick with the first assignee when the name is clicked', async () => {
    const onAssigneeClick = vi.fn()
    render(
      <KanbanCard
        task={task()}
        members={members}
        milestones={[]}
        readOnly
        onAssigneeClick={onAssigneeClick}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /张三.*\+1/ }))
    expect(onAssigneeClick).toHaveBeenCalledWith(1)
  })
})
