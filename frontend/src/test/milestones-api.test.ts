import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createMilestone,
  deleteMilestone,
  listMilestones,
  updateMilestone,
} from '../api/milestones'
import api from '../utils/api'

vi.mock('../utils/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

const input = {
  title: '公开测试',
  description: '交付公开测试版本',
  target_date: '2026-08-15',
  owner_id: 7,
  task_ids: [11, 12],
}

describe('milestones api', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists project milestones', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [{ id: 1 }] })
    await expect(listMilestones(4)).resolves.toEqual([{ id: 1 }])
    expect(api.get).toHaveBeenCalledWith('/projects/4/milestones')
  })

  it('creates and updates milestones with multiple task links', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 3, ...input } })
    vi.mocked(api.put).mockResolvedValue({ data: { id: 3, ...input, status: 'completed' } })

    await createMilestone(4, input)
    await updateMilestone(4, 3, { status: 'completed', task_ids: [11, 12] })

    expect(api.post).toHaveBeenCalledWith('/projects/4/milestones', input)
    expect(api.put).toHaveBeenCalledWith('/projects/4/milestones/3', {
      status: 'completed',
      task_ids: [11, 12],
    })
  })

  it('deletes a milestone without a task deletion request', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: { message: 'ok' } })
    await deleteMilestone(4, 3)
    expect(api.delete).toHaveBeenCalledWith('/projects/4/milestones/3')
  })
})
