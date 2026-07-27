import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import NotificationsPage from '../pages/NotificationsPage'
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/notifications'

const unreadState = vi.hoisted(() => ({ count: 2, set: vi.fn() }))

vi.mock('../api/notifications', () => ({
  fetchNotifications: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
}))

vi.mock('../hooks/useUnreadCount', () => ({
  useUnreadCount: () => ({ unreadCount: unreadState.count, setUnreadCount: unreadState.set }),
}))

const notifications = [
  {
    id: 1,
    user_id: 9,
    type: 'mention',
    title: '林然在评论中提到了你',
    body: '请确认移动端验收结果',
    link: '/project/7/board?task=31&comment=8',
    is_read: false,
    created_at: new Date().toISOString(),
  },
  {
    id: 2,
    user_id: 9,
    type: 'task_assigned',
    title: '你被分配了新任务',
    body: '完善通知中心的视觉层次',
    link: '/project/7/board?task=32',
    is_read: false,
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
  },
]

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/notifications']}>
      <Routes>
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/project/:projectId/board" element={<p>任务详情入口</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('NotificationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    unreadState.count = 2
    vi.mocked(fetchNotifications).mockResolvedValue({
      items: notifications,
      unread_count: 2,
      total: 2,
      page: 1,
      page_size: 30,
    })
    vi.mocked(markNotificationRead).mockResolvedValue({ ...notifications[0], is_read: true })
    vi.mocked(markAllNotificationsRead).mockResolvedValue()
  })

  it('groups notifications by day and exposes unread context', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: '今天' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '昨天' })).toBeInTheDocument()
    expect(screen.getByLabelText('2 条未读通知')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /林然在评论中提到了你/ })).toBeInTheDocument()
  })

  it('marks an unread notification and follows its deep link', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /林然在评论中提到了你/ }))

    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith(1))
    expect(unreadState.set).toHaveBeenCalled()
    expect(screen.getByText('任务详情入口')).toBeInTheDocument()
  })
})
