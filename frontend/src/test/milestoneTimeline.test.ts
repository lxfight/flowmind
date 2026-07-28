import { describe, expect, it } from 'vitest'

import type { Milestone } from '../types'
import {
  buildMilestoneTimelineLayout,
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

  it('keeps a visible vertical sweep across a two-week interval', () => {
    const layout = buildMilestoneTimelineLayout([
      milestone(1, '2026-08-11'),
    ], '2026-07-28')

    expect(Math.abs(layout.items[0].y - layout.todayY)).toBeGreaterThan(45)
  })

  it('uses separate lanes for nearby milestones', () => {
    const layout = buildMilestoneTimelineLayout([
      milestone(1, '2026-07-30'),
      milestone(2, '2026-07-31'),
      milestone(3, '2026-08-01'),
    ], '2026-07-28')

    expect(new Set(layout.items.map((item) => item.lane)).size).toBe(3)
  })
})
