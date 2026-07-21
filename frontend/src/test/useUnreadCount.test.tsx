import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

vi.mock('../utils/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

import api from '../utils/api'
import { useUnreadCount } from '../hooks/useUnreadCount'

const mockedApi = api as unknown as { get: Mock; post: Mock }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useUnreadCount', () => {
  it('loads the initial unread count on mount', async () => {
    mockedApi.get.mockResolvedValue({ data: { unread_count: 4 } })

    const { result } = renderHook(() => useUnreadCount())

    await waitFor(() => expect(result.current.unreadCount).toBe(4))
    expect(mockedApi.get).toHaveBeenCalledWith('/notifications/unread-count')
  })

  it('keeps the previous count when polling fails', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { unread_count: 2 } })
    const { result } = renderHook(() => useUnreadCount())
    await waitFor(() => expect(result.current.unreadCount).toBe(2))

    mockedApi.get.mockRejectedValueOnce(new Error('network down'))
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.unreadCount).toBe(2)
  })

  it('refresh re-fetches the latest count', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { unread_count: 1 } })
    const { result } = renderHook(() => useUnreadCount())
    await waitFor(() => expect(result.current.unreadCount).toBe(1))

    mockedApi.get.mockResolvedValueOnce({ data: { unread_count: 9 } })
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.unreadCount).toBe(9)
  })
})
