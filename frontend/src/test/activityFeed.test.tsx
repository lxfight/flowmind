import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ActivityFeed } from '../components/project/ActivityFeed'
import api from '../utils/api'

vi.mock('../utils/api', async () => {
  const actual = await vi.importActual<typeof import('../utils/api')>('../utils/api')
  return { ...actual, default: { get: vi.fn() } }
})

const newest = {
  id: 2,
  action: 'update',
  target_type: 'task',
  target_id: 20,
  summary: '更新了最新任务',
  user_name: '李明',
  created_at: '2026-07-27T10:00:00Z',
}

const oldest = {
  id: 1,
  action: 'create',
  target_type: 'project',
  target_id: 1,
  summary: '创建了项目',
  user_name: '王芳',
  created_at: '2026-07-01T08:00:00Z',
}

describe('ActivityFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads every activity page and lays events out oldest to newest', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: { items: [newest], total: 101 } })
      .mockResolvedValueOnce({ data: { items: [oldest], total: 101 } })

    render(<ActivityFeed projectId={7} />)

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
    const events = await screen.findAllByTestId('activity-event')

    expect(vi.mocked(api.get).mock.calls[0][1]?.params).toEqual({ page: 1, page_size: 100 })
    expect(vi.mocked(api.get).mock.calls[1][1]?.params).toEqual({ page: 2, page_size: 100 })
    expect(events[0]).toHaveTextContent('创建了项目')
    expect(events[1]).toHaveTextContent('更新了最新任务')
    await waitFor(() => {
      expect(screen.getByLabelText('第 2 条，共 2 条动态')).toBeInTheDocument()
    })
  })

  it('shows the empty state when the project has no activity', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { items: [], total: 0 } })

    render(<ActivityFeed projectId={7} />)

    expect(await screen.findByText('暂无活动记录')).toBeInTheDocument()
  })
})
