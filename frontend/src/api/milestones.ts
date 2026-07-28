import type { Milestone, MilestoneInput, MilestoneTimelinePage } from '../types'
import api from '../utils/api'

export async function listMilestones(projectId: number): Promise<Milestone[]> {
  const response = await api.get(`/projects/${projectId}/milestones`)
  return Array.isArray(response.data) ? response.data : []
}

export interface MilestoneTimelineParams {
  anchorDate: string
  direction?: 'forward' | 'backward'
  limit?: number
  status?: 'open' | 'archived'
  cursorDate?: string | null
  cursorId?: number | null
}

export async function listMilestoneTimeline(
  projectId: number,
  params: MilestoneTimelineParams,
): Promise<MilestoneTimelinePage> {
  const response = await api.get(`/projects/${projectId}/milestones/timeline`, {
    params: {
      anchor_date: params.anchorDate,
      direction: params.direction ?? 'forward',
      limit: params.limit ?? 12,
      ...(params.status ? { status: params.status } : {}),
      ...(params.cursorDate && params.cursorId
        ? { cursor_date: params.cursorDate, cursor_id: params.cursorId }
        : {}),
    },
  })
  return response.data
}

export async function createMilestone(
  projectId: number,
  input: MilestoneInput,
): Promise<Milestone> {
  const response = await api.post(`/projects/${projectId}/milestones`, input)
  return response.data
}

export async function updateMilestone(
  projectId: number,
  milestoneId: number,
  input: Partial<MilestoneInput>,
): Promise<Milestone> {
  const response = await api.put(
    `/projects/${projectId}/milestones/${milestoneId}`,
    input,
  )
  return response.data
}

export async function deleteMilestone(
  projectId: number,
  milestoneId: number,
): Promise<void> {
  await api.delete(`/projects/${projectId}/milestones/${milestoneId}`)
}
