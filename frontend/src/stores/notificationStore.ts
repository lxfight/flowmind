import { create } from 'zustand'
import { fetchUnreadCount } from '../api/notifications'

interface NotificationState {
  unreadCount: number
  /** Re-fetch the unread count; transient failures keep the previous value */
  refresh: () => Promise<void>
  setUnreadCount: (count: number | ((prev: number) => number)) => void
}

export const useNotificationStore = create<NotificationState>((set) => ({
  unreadCount: 0,

  refresh: async () => {
    try {
      set({ unreadCount: await fetchUnreadCount() })
    } catch {
      // ignore transient errors (e.g. token refresh)
    }
  },

  setUnreadCount: (count) =>
    set((state) => ({
      unreadCount: typeof count === 'function' ? count(state.unreadCount) : count,
    })),
}))
