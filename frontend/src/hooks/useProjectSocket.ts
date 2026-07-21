import { useEffect, useRef } from 'react'
import { useAuthStore } from '../stores/authStore'

export interface ProjectSocketEvent {
  type: string
  project_id: number
  payload: Record<string, unknown>
  actor_id?: number | null
}

/**
 * Subscribe to real-time project events over WebSocket.
 *
 * Connects with the stored JWT (query param — browsers cannot set headers
 * on WebSocket handshakes), auto-reconnects with exponential backoff, and
 * degrades gracefully: if the socket never connects, callers simply keep
 * working with manual refreshes.
 */
export function useProjectSocket(
  projectId: number | undefined,
  onEvent: (event: ProjectSocketEvent) => void,
) {
  const token = useAuthStore((s) => s.token)
  const handlerRef = useRef(onEvent)
  useEffect(() => {
    handlerRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    if (!projectId || !token) return
    let ws: WebSocket | null = null
    let stopped = false
    let attempt = 0
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (stopped) return
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(
        `${proto}://${window.location.host}/ws/projects/${projectId}?token=${encodeURIComponent(token)}`,
      )
      ws.onopen = () => {
        attempt = 0
      }
      ws.onmessage = (msg) => {
        try {
          handlerRef.current(JSON.parse(msg.data as string) as ProjectSocketEvent)
        } catch {
          // ignore malformed events
        }
      }
      ws.onclose = () => {
        if (stopped) return
        const delay = Math.min(1000 * 2 ** attempt, 15000)
        attempt += 1
        reconnectTimer = setTimeout(connect, delay)
      }
    }

    connect()
    return () => {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [projectId, token])
}
