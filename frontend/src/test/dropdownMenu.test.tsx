import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DropdownMenu, DropdownMenuItem } from '../components/ui/DropdownMenu'

function stubRect(el: HTMLElement, rect: { top: number; left: number; width: number; height: number }) {
  el.getBoundingClientRect = () => ({
    ...rect,
    bottom: rect.top + rect.height,
    right: rect.left + rect.width,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  })
}

describe('DropdownMenu positioning', () => {
  const origH = window.innerHeight
  const origW = window.innerWidth

  it('positions the menu below the trigger', async () => {
    Object.defineProperty(window, 'innerHeight', { value: 800, writable: true })
    Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true })

    render(
      <div>
        <DropdownMenu
          trigger={<button type="button">触发</button>}
        >
          <DropdownMenuItem onClick={() => {}}>项目一</DropdownMenuItem>
        </DropdownMenu>
      </div>,
    )
    const trigger = document.querySelector('button')!
    stubRect(trigger, { top: 200, left: 100, width: 80, height: 28 })

    fireEvent.click(trigger)
    await act(async () => {})
    // Measure runs on rAF; flush it.
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))) })

    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeTruthy())
    const menu = document.querySelector('[role="menu"]') as HTMLElement
    // Trigger bottom 228 + 8 gap = 236; left aligns to 100.
    expect(parseFloat(menu.style.top)).toBe(236)
    expect(parseFloat(menu.style.left)).toBe(100)

    Object.defineProperty(window, 'innerHeight', { value: origH, writable: true })
    Object.defineProperty(window, 'innerWidth', { value: origW, writable: true })
  })

  it('compensates an ancestor transform so the menu lands near the trigger', async () => {
    Object.defineProperty(window, 'innerHeight', { value: 800, writable: true })
    Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true })

    // A transformed ancestor (like a framer-motion card/dialog) creates a
    // containing block for fixed descendants; the menu must offset by its
    // viewport position.
    render(
      <div style={{ transform: 'translateY(50px)' }}>
        <div style={{ position: 'absolute', top: 0, left: 0 }}>
          <DropdownMenu trigger={<button type="button">触发</button>}>
            <DropdownMenuItem onClick={() => {}}>项目一</DropdownMenuItem>
          </DropdownMenu>
        </div>
      </div>,
    )
    // Walk to the transform ancestor and give it a real viewport offset.
    const trigger = document.querySelector('button')!
    let transformed: HTMLElement | null = trigger.parentElement
    while (transformed) {
      if (window.getComputedStyle(transformed).transform !== 'none') break
      transformed = transformed.parentElement
    }
    expect(transformed).not.toBeNull()
    stubRect(transformed!, { top: 50, left: 0, width: 500, height: 400 })
    // Trigger sits inside the transformed container at an inner offset.
    stubRect(trigger, { top: 120, left: 60, width: 80, height: 28 })

    fireEvent.click(trigger)
    await act(async () => {})
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))) })

    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeTruthy())
    const menu = document.querySelector('[role="menu"]') as HTMLElement
    // Without compensation: bottom 148 + 8 = 156 (fixed relative to the
    // transform container, which itself is at viewport top 50). With
    // compensation the viewport target is 156 - 50 = 106.
    expect(parseFloat(menu.style.top)).toBe(156 - 50)

    Object.defineProperty(window, 'innerHeight', { value: origH, writable: true })
    Object.defineProperty(window, 'innerWidth', { value: origW, writable: true })
  })
})
