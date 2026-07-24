import { describe, expect, it } from 'vitest'

import { filterAndSortTasks } from '../components/kanban/taskView'
import type { TaskSummary } from '../types'

function task(overrides: Partial<TaskSummary> & Pick<TaskSummary, 'id' | 'title'>): TaskSummary {
  return {
    description: '',
    status_id: 1,
    priority: 0,
    order: overrides.id,
    due_date: null,
    is_completed: false,
    assignees: [],
    comment_count: 0,
    subtask_count: 0,
    subtask_done: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('filterAndSortTasks', () => {
  it('keeps combined filters active while sorting the matching tasks', () => {
    const tasks = [
      task({ id: 1, title: '发布前检查', priority: 3, updated_at: '2026-01-02T00:00:00Z', assignees: [{ id: 7, display_name: 'A', avatar_url: '' }] }),
      task({ id: 2, title: '发布文档', priority: 3, updated_at: '2026-01-03T00:00:00Z', assignees: [{ id: 7, display_name: 'A', avatar_url: '' }] }),
      task({ id: 3, title: '发布回归', priority: 1, order: 20, assignees: [{ id: 7, display_name: 'A', avatar_url: '' }] }),
      task({ id: 4, title: '发布公告', priority: 3, order: 40, assignees: [{ id: 8, display_name: 'B', avatar_url: '' }] }),
    ]

    const result = filterAndSortTasks(tasks, {
      searchQuery: '发布',
      assigneeId: 7,
      priority: 3,
      sortKey: 'updated_at',
      sortDirection: 'desc',
    })

    expect(result.map((item) => item.id)).toEqual([2, 1])
  })

  it('sorts filtered priorities without reintroducing excluded tasks', () => {
    const tasks = [
      task({ id: 1, title: 'A', priority: 4 }),
      task({ id: 2, title: 'B', priority: 2 }),
      task({ id: 3, title: 'C', priority: 4 }),
    ]

    const result = filterAndSortTasks(tasks, {
      searchQuery: '',
      assigneeId: null,
      priority: 4,
      sortKey: 'priority',
      sortDirection: 'desc',
    })

    expect(result.map((item) => item.id)).toEqual([1, 3])
  })

  it('keeps tasks without due dates last in both directions', () => {
    const tasks = [
      task({ id: 1, title: 'No date' }),
      task({ id: 2, title: 'Later', due_date: '2026-03-01T00:00:00Z' }),
      task({ id: 3, title: 'Sooner', due_date: '2026-02-01T00:00:00Z' }),
    ]

    const result = filterAndSortTasks(tasks, {
      searchQuery: '',
      assigneeId: null,
      priority: null,
      sortKey: 'due_date',
      sortDirection: 'desc',
    })

    expect(result.map((item) => item.id)).toEqual([2, 3, 1])
  })
})
