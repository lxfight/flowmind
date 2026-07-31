import api from '../utils/api'
import type { TaskReferences, TaskReferenceTask } from '../types'

export interface TaskSearchItem {
  id: number
  project_id: number
  project_name: string
  project_color: string
  status_id: number
  status_name: string
  status_color: string
  title: string
  description: string
  priority: number
  is_completed: boolean
  due_date: string | null
  updated_at: string
  assignees: {
    id: number
    username: string
    display_name: string
    avatar_url: string
  }[]
}

export interface TaskSearchParams {
  q?: string
  project_id?: number
  assignee_id?: number | 'me'
  priority?: number
  status_id?: number
  overdue?: boolean
  due_before?: string
  due_after?: string
  limit?: number
  offset?: number
}

export interface TaskSearchResponse {
  tasks: TaskSearchItem[]
  total: number
}

export async function searchTasks(params: TaskSearchParams): Promise<TaskSearchResponse> {
  const res = await api.get('/tasks/search', {
    params: Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ),
  })
  return res.data
}

export async function suggestTaskReferences(
  projectId: number,
  query: string,
  excludeTaskId?: number,
): Promise<TaskReferenceTask[]> {
  const res = await api.get(`/projects/${projectId}/tasks/reference-suggestions`, {
    params: { q: query, exclude_task_id: excludeTaskId, limit: 8 },
  })
  return res.data
}

export async function getTaskReferences(projectId: number, taskId: number): Promise<TaskReferences> {
  const res = await api.get(`/projects/${projectId}/tasks/${taskId}/references`)
  return res.data
}
