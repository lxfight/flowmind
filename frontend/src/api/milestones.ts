import type { Milestone, MilestoneInput } from '../types'
import api from '../utils/api'

export async function listMilestones(projectId: number): Promise<Milestone[]> {
  const response = await api.get(`/projects/${projectId}/milestones`)
  return Array.isArray(response.data) ? response.data : []
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
