import { describe, expect, it } from 'vitest'

import type { Milestone } from '../types'
import {
  buildMilestoneTimelineLayout,
  milestoneCurveY,
  TIMELINE_CANVAS_HEIGHT,
  TIMELINE_DAY_WIDTH,
  TIMELINE_ORIGIN_PADDING,
} from '../utils/milestoneTimeline'

function milestone(id: number, targetDate: string): Milestone {
  return {
    id,
    project_id: 1,
    title: `节点 ${id}`,
    description: '',
    target_date: targetDate,
    owner_id: null,
    owner: null,
    status: 'open',
    health: 'on_track',
    task_ids: [],
    task_total: 0,
    task_completed: 0,
    progress: 0,
    completed_at: null,
    created_at: '',
    updated_at: '',
  }
}

describe('milestone timeline layout', () => {
  it('uses a linear day scale and starts today at the left edge', () => {
    const layout = buildMilestoneTimelineLayout([
      milestone(1, '2026-07-30'),
      milestone(2, '2026-08-04'),
    ], '2026-07-28')

    expect(layout.todayX).toBe(TIMELINE_ORIGIN_PADDING)
    expect(layout.items[0].x - layout.todayX).toBe(2 * TIMELINE_DAY_WIDTH)
    expect(layout.items[1].x - layout.items[0].x).toBe(5 * TIMELINE_DAY_WIDTH)
    expect(layout.axisEnd - layout.todayX).toBe(7 * TIMELINE_DAY_WIDTH)
    expect(layout.curvePath).toContain(' C ')
    expect(layout.items[0].y).not.toBe(layout.todayY)
  })

  it('moves today right by the exact historical interval after history loads', () => {
    const layout = buildMilestoneTimelineLayout([
      milestone(1, '2026-07-18'),
      milestone(2, '2026-07-30'),
    ], '2026-07-28')

    expect(layout.todayX).toBe(TIMELINE_ORIGIN_PADDING + 10 * TIMELINE_DAY_WIDTH)
  })

  it('samples intermediate bends across a two-week interval', () => {
    const anchorDate = '2026-07-28'
    const layout = buildMilestoneTimelineLayout([
      milestone(1, '2026-08-11'),
    ], anchorDate)
    const sampledHeights = [0, 6, 12, 14].map((days) => {
      const date = new Date(`${anchorDate}T00:00:00Z`)
      date.setUTCDate(date.getUTCDate() + days)
      return Math.round(milestoneCurveY(date.toISOString().slice(0, 10), anchorDate))
    })

    expect(layout.curvePath.match(/ C /g)?.length).toBeGreaterThanOrEqual(3)
    expect(new Set(sampledHeights).size).toBeGreaterThan(2)
  })

  it('uses separate lanes for nearby milestones', () => {
    const layout = buildMilestoneTimelineLayout([
      milestone(1, '2026-07-30'),
      milestone(2, '2026-07-31'),
      milestone(3, '2026-08-01'),
    ], '2026-07-28')

    expect(new Set(layout.items.map((item) => item.lane)).size).toBe(3)
  })

  it('keeps long empty intervals visibly curved with noise samples', () => {
    const anchorDate = '2026-07-28'
    const layout = buildMilestoneTimelineLayout([
      milestone(1, '2027-01-24'),
    ], anchorDate)
    const segmentCount = layout.curvePath.match(/ C /g)?.length || 0
    const sampledHeights = [0, 30, 60, 90, 120, 150, 180].map((days) => {
      const date = new Date(`${anchorDate}T00:00:00Z`)
      date.setUTCDate(date.getUTCDate() + days)
      return Math.round(milestoneCurveY(date.toISOString().slice(0, 10), anchorDate))
    })

    expect(segmentCount).toBeGreaterThan(20)
    expect(new Set(sampledHeights).size).toBeGreaterThan(3)
  })

  it('grows the curve amplitude as the timeline span widens', () => {
    const targetDate = '2027-01-24'
    const offsetFromCenter = (anchorDate: string) => {
      const y = milestoneCurveY(targetDate, anchorDate)
      return Math.abs(y - 208)
    }
    const near = offsetFromCenter('2027-01-24')
    const medium = offsetFromCenter('2026-07-28')
    const far = offsetFromCenter('2026-01-24')

    expect(medium).toBeGreaterThan(near * 1.4)
    expect(far).toBeGreaterThan(medium * 1.2)
  })

  it('stays bounded within the canvas for very wide timelines', () => {
    const anchorDate = '2026-07-28'
    const ys = [0, 180, 360, 540, 720].map((days) => {
      const date = new Date(`${anchorDate}T00:00:00Z`)
      date.setUTCDate(date.getUTCDate() + days)
      return milestoneCurveY(date.toISOString().slice(0, 10), anchorDate)
    })
    ys.forEach((y) => {
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(TIMELINE_CANVAS_HEIGHT)
    })
  })
})
