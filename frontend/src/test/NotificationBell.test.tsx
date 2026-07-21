import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../utils/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

import api from '../utils/api'
import { NotificationBell } from '../components/layout/NotificationBell'
import type { AppNotification } from '../api/notifications'

const mockedApi = api as unknown as { get: Mock; post: Mock }

const sampleNotification: AppNotification = {
  id: 11,
  user_id: 1,
  type: 'comment',
  title: '新评论',
  body: '有人评论了你的任务',
  link: '/projects/1',
  is_read: false,
  created_at: new Date().toISOString(),
}

function renderBell() {
  return render(
    <MemoryRouter>
      <NotificationBell />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('NotificationBell', () => {
  it('shows the unread badge and lists notifications on open', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/notifications/unread-count') {
        return Promise.resolve({ data: { unread_count: 3 } })
      }
      return Promise.resolve({
        data: { items: [sampleNotification], unread_count: 3, total: 1, page: 1, page_size: 50 },
      })
    })

    renderBell()
    expect(await screen.findByText('3')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '通知' }))
    expect(await screen.findByText('新评论')).toBeInTheDocument()
    expect(screen.getByText('有人评论了你的任务')).toBeInTheDocument()
  })

  it('hides the badge when there are no unread notifications', async () => {
    mockedApi.get.mockResolvedValue({ data: { unread_count: 0 } })
    renderBell()
    await waitFor(() => expect(mockedApi.get).toHaveBeenCalled())
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('mark-all-read clears the badge and marks items read', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url === '/notifications/unread-count') {
        return Promise.resolve({ data: { unread_count: 1 } })
      }
      return Promise.resolve({
        data: { items: [sampleNotification], unread_count: 1, total: 1, page: 1, page_size: 50 },
      })
    })
    mockedApi.post.mockResolvedValue({ data: {} })

    renderBell()
    await screen.findByText('1')
    await userEvent.click(screen.getByRole('button', { name: '通知' }))
    await userEvent.click(await screen.findByText('全部已读'))

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith('/notifications/read-all')
    )
    await waitFor(() => expect(screen.queryByText('1')).not.toBeInTheDocument())
  })
})
