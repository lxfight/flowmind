import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest'

vi.mock('../utils/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

import api from '../utils/api'
import { fetchNotifications, fetchUnreadCount, markAllNotificationsRead } from '../api/notifications'
import { searchTasks } from '../api/tasks'

const mockedApi = api as unknown as { get: Mock; post: Mock }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('notifications api envelope', () => {
  it('fetchNotifications passes page params and returns the {items,total} envelope as-is', async () => {
    const envelope = {
      items: [{ id: 1, title: 'n1' }],
      unread_count: 5,
      total: 42,
      page: 2,
      page_size: 10,
    }
    mockedApi.get.mockResolvedValueOnce({ data: envelope })

    const result = await fetchNotifications(2, 10)

    expect(mockedApi.get).toHaveBeenCalledWith('/notifications', {
      params: { page: 2, page_size: 10 },
    })
    expect(result).toEqual(envelope)
    expect(result.total).toBe(42)
    expect(result.items).toHaveLength(1)
  })

  it('fetchUnreadCount unwraps the unread_count field', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { unread_count: 7 } })
    await expect(fetchUnreadCount()).resolves.toBe(7)
  })

  it('markAllNotificationsRead posts to read-all', async () => {
    mockedApi.post.mockResolvedValueOnce({ data: { updated: 3 } })
    await markAllNotificationsRead()
    expect(mockedApi.post).toHaveBeenCalledWith('/notifications/read-all')
  })
})

describe('searchTasks params', () => {
  it('drops empty/undefined params before sending', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { tasks: [], total: 0 } })

    await searchTasks({ q: '看板', project_id: undefined, assignee_id: 'me', priority: undefined })

    expect(mockedApi.get).toHaveBeenCalledWith('/tasks/search', {
      params: { q: '看板', assignee_id: 'me' },
    })
  })
})
