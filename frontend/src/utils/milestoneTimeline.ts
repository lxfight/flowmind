import { differenceInCalendarDays, parseISO } from 'date-fns'

import type { Milestone } from '../types'

export const TIMELINE_DAY_WIDTH = 18
export const TIMELINE_ORIGIN_PADDING = 40
export const TIMELINE_END_PADDING = 216
export const TIMELINE_CARD_WIDTH = 192
export const TIMELINE_CURVE_CENTER_Y = 208
export const TIMELINE_CURVE_AMPLITUDE = 48
export const TIMELINE_CANVAS_HEIGHT = 436

export interface MilestoneTimelineLayoutItem {
  milestone: Milestone
  x: number
  y: number
  cardLeft: number
  lane: number
}

export interface MilestoneTimelineLayout {
  items: MilestoneTimelineLayoutItem[]
  todayX: number
  todayY: number
  axisStart: number
  axisEnd: number
  curvePath: string
  width: number
}

export function milestoneCurveY(targetDate: string, anchorDate: string) {
  const days = differenceInCalendarDays(parseISO(targetDate), parseISO(anchorDate))
  return TIMELINE_CURVE_CENTER_Y + Math.sin(days * 0.1) * TIMELINE_CURVE_AMPLITUDE
}

function buildCurvePath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return ''
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index]
    const handle = (point.x - previous.x) * 0.42
    return `${path} C ${previous.x + handle} ${previous.y}, ${point.x - handle} ${point.y}, ${point.x} ${point.y}`
  }, `M ${points[0].x} ${points[0].y}`)
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
  const todayY = milestoneCurveY(anchorDate, anchorDate)
  const laneRightEdges = [-Infinity, -Infinity, -Infinity, -Infinity]

  const items = sorted.map((milestone, index) => {
    const x = axisStart
      + differenceInCalendarDays(parseISO(milestone.target_date), parseISO(earliestDate)) * TIMELINE_DAY_WIDTH
    const y = milestoneCurveY(milestone.target_date, anchorDate)
    const cardLeft = Math.max(4, x - 16)
    const preferredLanes = index % 2 === 0 ? [1, 2, 0, 3] : [2, 1, 3, 0]
    const lane = preferredLanes.find(
      (candidate) => laneRightEdges[candidate] + 14 <= cardLeft,
    ) ?? preferredLanes.reduce(
      (best, candidate) => laneRightEdges[candidate] < laneRightEdges[best] ? candidate : best,
      preferredLanes[0],
    )
    laneRightEdges[lane] = cardLeft + TIMELINE_CARD_WIDTH
    return { milestone, x, y, cardLeft, lane }
  })

  const lastX = items.at(-1)?.x ?? todayX
  const axisEnd = Math.max(todayX, lastX)
  const curvePoints = [{ date: anchorDate, x: todayX, y: todayY }]
  items.forEach(({ milestone, x, y }) => {
    if (!curvePoints.some((point) => point.date === milestone.target_date)) {
      curvePoints.push({ date: milestone.target_date, x, y })
    }
  })
  curvePoints.sort((left, right) => left.x - right.x)
  return {
    items,
    todayX,
    todayY,
    axisStart,
    axisEnd,
    curvePath: buildCurvePath(curvePoints),
    width: axisEnd + TIMELINE_END_PADDING,
  }
}
