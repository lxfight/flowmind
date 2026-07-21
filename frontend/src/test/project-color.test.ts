import { describe, expect, it } from 'vitest'
import { normalizeHex, tintWithWhite } from '../components/project/colorUtils'

describe('normalizeHex', () => {
  it('keeps valid 6-digit hex and lowercases it', () => {
    expect(normalizeHex('#3B82F6')).toBe('#3b82f6')
  })

  it('expands 3-digit shorthand', () => {
    expect(normalizeHex('#abc')).toBe('#aabbcc')
  })

  it('falls back to the default color on invalid input', () => {
    expect(normalizeHex('red')).toBe('#6366f1')
    expect(normalizeHex('')).toBe('#6366f1')
  })
})

describe('tintWithWhite', () => {
  it('returns white for ratio 1', () => {
    expect(tintWithWhite('#3b82f6', 1)).toBe('#ffffff')
  })

  it('returns the original color for ratio 0', () => {
    expect(tintWithWhite('#3b82f6', 0)).toBe('#3b82f6')
  })

  it('lightens the color at the default ratio', () => {
    const tint = tintWithWhite('#000000')
    expect(tint).toMatch(/^#[0-9a-f]{6}$/)
    expect(tint).not.toBe('#000000')
    // 88% white mix of black => #e0e0e0
    expect(tint).toBe('#e0e0e0')
  })
})
