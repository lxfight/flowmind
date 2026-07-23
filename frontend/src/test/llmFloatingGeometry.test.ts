import { describe, expect, it } from 'vitest'
import {
  clampPosition,
  clampSize,
  defaultGeometry,
  loadGeometry,
  saveGeometry,
  GEO_KEY,
  MIN_SIZE,
  MIN_VISIBLE,
  EDGE_MARGIN,
} from '../components/llm-chat/floatingGeometry'

const VP = { w: 1280, h: 800 }

function memStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
  }
}

describe('clampSize', () => {
  it('enforces the minimum size', () => {
    expect(clampSize({ w: 100, h: 100 }, VP)).toEqual({ w: MIN_SIZE.w, h: MIN_SIZE.h })
  })

  it('enforces the viewport maximum', () => {
    expect(clampSize({ w: 5000, h: 5000 }, VP)).toEqual({ w: VP.w, h: VP.h })
  })

  it('keeps valid sizes unchanged', () => {
    expect(clampSize({ w: 420, h: 600 }, VP)).toEqual({ w: 420, h: 600 })
  })

  it('fits inside the viewport when the viewport is smaller than the minimum', () => {
    expect(clampSize({ w: 100, h: 100 }, { w: 200, h: 200 })).toEqual({ w: 200, h: 200 })
  })
})

describe('clampPosition', () => {
  const size = { w: 420, h: 600 }

  it('keeps an in-viewport position unchanged', () => {
    expect(clampPosition(100, 100, size, VP)).toEqual({ x: 100, y: 100 })
  })

  it('keeps at least MIN_VISIBLE px visible horizontally', () => {
    // Dragged too far right
    expect(clampPosition(5000, 100, size, VP)).toEqual({ x: VP.w - MIN_VISIBLE, y: 100 })
    // Dragged too far left
    expect(clampPosition(-5000, 100, size, VP)).toEqual({ x: MIN_VISIBLE - size.w, y: 100 })
  })

  it('keeps the header grabbable vertically', () => {
    expect(clampPosition(100, -100, size, VP).y).toBe(0)
    expect(clampPosition(100, 5000, size, VP).y).toBe(VP.h - MIN_VISIBLE)
  })
})

describe('defaultGeometry', () => {
  it('places the window bottom-right with the edge margin', () => {
    expect(defaultGeometry(VP)).toEqual({
      w: 420,
      h: 600,
      x: VP.w - 420 - EDGE_MARGIN,
      y: VP.h - 600 - EDGE_MARGIN,
    })
  })

  it('clamps the size on small viewports', () => {
    const geo = defaultGeometry({ w: 300, h: 300 })
    expect(geo.w).toBe(300)
    expect(geo.h).toBe(300)
    expect(geo.x).toBe(0)
    expect(geo.y).toBe(0)
  })
})

describe('loadGeometry / saveGeometry', () => {
  it('round-trips a valid geometry', () => {
    const storage = memStorage()
    const rect = { x: 50, y: 60, w: 500, h: 500 }
    saveGeometry(rect, storage)
    expect(loadGeometry(VP, storage)).toEqual(rect)
  })

  it('clamps stale out-of-viewport values to the current viewport', () => {
    // Saved on a 2560x1440 monitor, restored on a small window
    const storage = memStorage({ [GEO_KEY]: JSON.stringify({ x: 2200, y: 1200, w: 800, h: 900 }) })
    const small = { w: 1024, h: 700 }
    const geo = loadGeometry(small, storage)
    expect(geo.w).toBeLessThanOrEqual(small.w)
    expect(geo.h).toBeLessThanOrEqual(small.h)
    expect(geo.x).toBeLessThanOrEqual(small.w - MIN_VISIBLE)
    expect(geo.y).toBeLessThanOrEqual(small.h - MIN_VISIBLE)
    expect(geo.y).toBeGreaterThanOrEqual(0)
  })

  it('clamps undersized persisted values to the minimum', () => {
    const storage = memStorage({ [GEO_KEY]: JSON.stringify({ x: 10, y: 10, w: 100, h: 100 }) })
    const geo = loadGeometry(VP, storage)
    expect(geo.w).toBe(MIN_SIZE.w)
    expect(geo.h).toBe(MIN_SIZE.h)
  })

  it('falls back to the default on corrupt JSON', () => {
    const storage = memStorage({ [GEO_KEY]: '{not json' })
    expect(loadGeometry(VP, storage)).toEqual(defaultGeometry(VP))
  })

  it('falls back to the default on wrong shape', () => {
    const storage = memStorage({ [GEO_KEY]: JSON.stringify({ foo: 1 }) })
    expect(loadGeometry(VP, storage)).toEqual(defaultGeometry(VP))
  })
})
