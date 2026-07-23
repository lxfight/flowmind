/**
 * Pure geometry helpers for the floating LLM chat window.
 * Extracted so clamping / persistence logic can be unit-tested.
 */

export interface Size {
  w: number
  h: number
}

export interface Rect extends Size {
  x: number
  y: number
}

export interface Viewport {
  w: number
  h: number
}

export const GEO_KEY = 'flowmind.llmChatWindow'
export const OPEN_KEY = 'flowmind.llmChatOpen'

export const DEFAULT_SIZE: Size = { w: 420, h: 600 }
export const MIN_SIZE: Size = { w: 360, h: 400 }
/** Margin from viewport edges for the default bottom-right placement. */
export const EDGE_MARGIN = 24
/** Minimum strip of the window that must stay inside the viewport so the header remains grabbable. */
export const MIN_VISIBLE = 48

/** Clamp a size to [MIN_SIZE, viewport]. */
export function clampSize(size: Size, viewport: Viewport): Size {
  const minW = Math.min(MIN_SIZE.w, viewport.w)
  const minH = Math.min(MIN_SIZE.h, viewport.h)
  return {
    w: Math.min(Math.max(size.w, minW), viewport.w),
    h: Math.min(Math.max(size.h, minH), viewport.h),
  }
}

/**
 * Clamp a window position so it stays reachable:
 * - horizontally: at least MIN_VISIBLE px of the window inside the viewport on either side
 * - vertically: the header (top edge) must stay within [0, viewport.h - MIN_VISIBLE]
 */
export function clampPosition(x: number, y: number, size: Size, viewport: Viewport): { x: number; y: number } {
  const minX = MIN_VISIBLE - size.w
  const maxX = viewport.w - MIN_VISIBLE
  const minY = 0
  const maxY = viewport.h - MIN_VISIBLE
  return {
    x: Math.min(Math.max(x, minX), Math.max(maxX, minX)),
    y: Math.min(Math.max(y, minY), Math.max(maxY, minY)),
  }
}

/** Default placement: bottom-right with EDGE_MARGIN, size clamped to viewport. */
export function defaultGeometry(viewport: Viewport): Rect {
  const size = clampSize(DEFAULT_SIZE, viewport)
  return {
    ...size,
    x: Math.max(0, viewport.w - size.w - EDGE_MARGIN),
    y: Math.max(0, viewport.h - size.h - EDGE_MARGIN),
  }
}

function isValidRect(v: unknown): v is Rect {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(r[k]))
}

/**
 * Restore persisted geometry. Stale / out-of-viewport values are clamped to the
 * current viewport (e.g. after the browser window was resized). Falls back to
 * the default bottom-right placement when nothing usable is stored.
 */
export function loadGeometry(viewport: Viewport, storage: Pick<Storage, 'getItem'> = localStorage): Rect {
  try {
    const raw = storage.getItem(GEO_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (isValidRect(parsed)) {
        const size = clampSize({ w: parsed.w, h: parsed.h }, viewport)
        const pos = clampPosition(parsed.x, parsed.y, size, viewport)
        return { ...size, ...pos }
      }
    }
  } catch { /* ignore corrupt storage */ }
  return defaultGeometry(viewport)
}

export function saveGeometry(rect: Rect, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(GEO_KEY, JSON.stringify(rect))
  } catch { /* ignore */ }
}

export function loadOpenState(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    return storage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}

export function saveOpenState(open: boolean, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(OPEN_KEY, open ? '1' : '0')
  } catch { /* ignore */ }
}
