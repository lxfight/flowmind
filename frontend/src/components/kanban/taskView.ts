import type { TaskSummary } from '../../types'

export type TaskSortKey = 'manual' | 'created_at' | 'updated_at' | 'priority' | 'due_date'
export type TaskSortDirection = 'asc' | 'desc'

interface TaskViewOptions {
  searchQuery: string
  assigneeId: number | null
  priority: number | null
  sortKey: TaskSortKey
  sortDirection: TaskSortDirection
}

export function filterAndSortTasks(
  tasks: TaskSummary[],
  options: TaskViewOptions,
): TaskSummary[] {
  const query = options.searchQuery.trim().toLocaleLowerCase()
  const filtered = tasks.filter((task) => {
    if (
      query
      && !task.title.toLocaleLowerCase().includes(query)
      && !task.description.toLocaleLowerCase().includes(query)
    ) {
      return false
    }
    if (options.assigneeId !== null && !task.assignees.some((item) => item.id === options.assigneeId)) {
      return false
    }
    return options.priority === null || task.priority === options.priority
  })

  const direction = options.sortDirection === 'asc' ? 1 : -1
  return [...filtered].sort((left, right) => {
    let comparison: number
    if (options.sortKey === 'manual') {
      comparison = left.order - right.order
    } else if (options.sortKey === 'priority') {
      comparison = (left.priority - right.priority) * direction
    } else if (options.sortKey === 'due_date') {
      if (!left.due_date && !right.due_date) comparison = 0
      else if (!left.due_date) comparison = 1
      else if (!right.due_date) comparison = -1
      else comparison = (new Date(left.due_date).getTime() - new Date(right.due_date).getTime()) * direction
    } else {
      comparison = (
        new Date(left[options.sortKey]).getTime()
        - new Date(right[options.sortKey]).getTime()
      ) * direction
    }
    return comparison || left.order - right.order || left.id - right.id
  })
}
