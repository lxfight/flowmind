import { useEffect } from 'react'
import { useNotificationStore } from '../stores/notificationStore'

const POLL_INTERVAL_MS = 30_000

// One shared poller for all subscribers (TopBar bell, Sidebar badge, …).
let subscribers = 0
let timer: ReturnType<typeof setInterval> | null = null

/**
 * Shared unread-notification count backed by a single Zustand store with one
 * 30s polling interval, started on first subscriber and stopped when the last
 * unsubscribes.
 */
export function useUnreadCount() {
  const unreadCount = useNotificationStore((s) => s.unreadCount)
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount)
  const refresh = useNotificationStore((s) => s.refresh)

  useEffect(() => {
    subscribers += 1
    if (subscribers === 1) {
      void refresh()
      timer = setInterval(() => void refresh(), POLL_INTERVAL_MS)
    }
    return () => {
      subscribers -= 1
      if (subscribers === 0 && timer) {
        clearInterval(timer)
        timer = null
      }
    }
  }, [refresh])

  return { unreadCount, setUnreadCount, refresh }
}
