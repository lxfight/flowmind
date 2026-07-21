import { useCallback, useRef, useState } from 'react'

interface Options {
  storageKey: string
  defaultWidth: number
  min: number
  max: number
}

/**
 * Pointer-drag resizable width persisted to localStorage.
 * `startResize` stops propagation so it never triggers dnd-kit or other
 * parent pointer handlers.
 */
export function useResizableWidth({ storageKey, defaultWidth, min, max }: Options) {
  const [width, setWidth] = useState(() => {
    const raw = Number(localStorage.getItem(storageKey))
    return Number.isFinite(raw) && raw > 0 ? Math.min(max, Math.max(min, raw)) : defaultWidth
  })
  const widthRef = useRef(width)

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const startWidth = widthRef.current
      const onMove = (ev: PointerEvent) => {
        const next = Math.min(max, Math.max(min, startWidth + ev.clientX - startX))
        widthRef.current = next
        setWidth(next)
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        localStorage.setItem(storageKey, String(widthRef.current))
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [min, max, storageKey]
  )

  return { width, startResize }
}
