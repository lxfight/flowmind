import { differenceInCalendarDays, parseISO } from 'date-fns'

import type { Milestone } from '../types'

export const TIMELINE_DAY_WIDTH = 18
export const TIMELINE_ORIGIN_PADDING = 40
export const TIMELINE_END_PADDING = 216
export const TIMELINE_CARD_WIDTH = 192

export interface MilestoneTimelineLayoutItem {
  milestone: Milestone
  x: number
  cardLeft: number
  lane: number
}

export interface MilestoneTimelineLayout {
  items: MilestoneTimelineLayoutItem[]
  todayX: number
  axisStart: number
  axisEnd: number
  width: number
}

export function buildMilestoneTimelineLayout(
  milestones: Milestone[],
  anchorDate: string,
): MilestoneTimelineLayout {
  const sorted = [...milestones].sort((left, right) =>
    left.target_date.localeCompare(right.target_date) || left.id - right.id,
  )
  const earliestDate = sorted[0]?.target_date && sorted[0].target_date < anchorDate
    ? sorted[0].target_date
    : anchorDate
  const axisStart = TIMELINE_ORIGIN_PADDING
  const todayX = axisStart
    + differenceInCalendarDays(parseISO(anchorDate), parseISO(earliestDate)) * TIMELINE_DAY_WIDTH
  const laneRightEdges = [-Infinity, -Infinity, -Infinity, -Infinity]

  const items = sorted.map((milestone, index) => {
    const x = axisStart
      + differenceInCalendarDays(parseISO(milestone.target_date), parseISO(earliestDate)) * TIMELINE_DAY_WIDTH
    const cardLeft = Math.max(4, x - 16)
    const preferredLanes = index % 2 === 0 ? [1, 2, 0, 3] : [2, 1, 3, 0]
    const lane = preferredLanes.find(
      (candidate) => laneRightEdges[candidate] + 14 <= cardLeft,
    ) ?? preferredLanes.reduce(
      (best, candidate) => laneRightEdges[candidate] < laneRightEdges[best] ? candidate : best,
      preferredLanes[0],
    )
    laneRightEdges[lane] = cardLeft + TIMELINE_CARD_WIDTH
    return { milestone, x, cardLeft, lane }
  })

  const lastX = items.at(-1)?.x ?? todayX
  const axisEnd = Math.max(todayX, lastX)
  return {
    items,
    todayX,
    axisStart,
    axisEnd,
    width: axisEnd + TIMELINE_END_PADDING,
  }
}
