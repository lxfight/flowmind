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

  it('only mounts a small visible window for a long timeline', async () => {
    const activities = Array.from({ length: 1000 }, (_, index) => ({
      id: index + 1,
      action: 'update',
      target_type: 'task',
      target_id: index + 1,
      summary: `动态 ${index + 1}`,
      user_name: '系统',
      created_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    }))
    vi.mocked(api.get).mockImplementation(async (_url, config) => ({
      data: {
        items: config?.params?.page === 1 ? activities : [],
        total: activities.length,
      },
    }))

    render(<ActivityFeed projectId={7} />)

    await waitFor(() => {
      expect(screen.getByLabelText('第 1000 条，共 1000 条动态')).toBeInTheDocument()
    })
    expect(screen.getAllByTestId('activity-event').length).toBeLessThanOrEqual(8)
    expect(screen.getByText('动态 1000')).toBeInTheDocument()
  })

  it('keeps the successfully loaded pages when one middle page fails', async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: { items: [newest], total: 201 } })
      .mockRejectedValueOnce(new Error('page 2 timeout')) // middle page fails
      .mockResolvedValueOnce({ data: { items: [oldest], total: 201 } })

    render(<ActivityFeed projectId={7} />)

    // Both first and third pages load; the failed second page is skipped.
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThanOrEqual(3))
    await waitFor(() => {
      expect(screen.getByLabelText('第 2 条，共 2 条动态')).toBeInTheDocument()
    })
    // The timeline still renders both surviving events (no full-page error).
    expect(screen.queryByText('加载项目动态失败')).not.toBeInTheDocument()
    expect(screen.getByText('创建了项目')).toBeInTheDocument()
    expect(screen.getByText('更新了最新任务')).toBeInTheDocument()
  })
})
