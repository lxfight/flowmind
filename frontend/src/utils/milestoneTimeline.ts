import { differenceInCalendarDays, parseISO } from 'date-fns'

import type { Milestone } from '../types'

export const TIMELINE_DAY_WIDTH = 18
export const TIMELINE_ORIGIN_PADDING = 40
export const TIMELINE_END_PADDING = 216
export const TIMELINE_CARD_WIDTH = 192
export const TIMELINE_CURVE_CENTER_Y = 208
export const TIMELINE_CURVE_AMPLITUDE = 48
export const TIMELINE_CANVAS_HEIGHT = 436
const TIMELINE_CURVE_SAMPLE_DAYS = 6
const TIMELINE_MAX_CURVE_SEGMENTS = 240
const NOISE_PERIOD_DAYS = 18

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

function noiseValue(index: number) {
  let value = Math.imul(index ^ 0x6d2b79f5, 0x1b873593)
  value = Math.imul(value ^ (value >>> 15), 0x85ebca6b)
  value ^= value >>> 13
  return ((value >>> 0) / 0xffffffff) * 2 - 1
}

function smoothNoise(position: number) {
  const start = Math.floor(position)
  const progress = position - start
  const eased = progress * progress * (3 - 2 * progress)
  return noiseValue(start) + (noiseValue(start + 1) - noiseValue(start)) * eased
}

export function milestoneCurveY(targetDate: string, _anchorDate: string) {
  const [year, month, day] = targetDate.split('-').map(Number)
  const absoluteDay = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
  const primary = smoothNoise(absoluteDay / NOISE_PERIOD_DAYS)
  const detail = smoothNoise(absoluteDay / (NOISE_PERIOD_DAYS / 2) + 31.7)
  const noise = Math.max(-1, Math.min(1, primary * 0.76 + detail * 0.24))
  return TIMELINE_CURVE_CENTER_Y + noise * TIMELINE_CURVE_AMPLITUDE
}

function buildCurvePath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return ''
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index]
    const beforePrevious = points[Math.max(0, index - 1)]
    const afterPoint = points[Math.min(points.length - 1, index + 2)]
    const firstControlX = previous.x + (point.x - beforePrevious.x) / 6
    const firstControlY = previous.y + (point.y - beforePrevious.y) / 6
    const secondControlX = point.x - (afterPoint.x - previous.x) / 6
    const secondControlY = point.y - (afterPoint.y - previous.y) / 6
    return `${path} C ${firstControlX} ${firstControlY}, ${secondControlX} ${secondControlY}, ${point.x} ${point.y}`
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
  const lastMilestoneDate = items.at(-1)?.milestone.target_date
  const curveEndDate = lastMilestoneDate && lastMilestoneDate > anchorDate
    ? lastMilestoneDate
    : anchorDate
  const totalDays = differenceInCalendarDays(parseISO(curveEndDate), parseISO(earliestDate))
  const sampleDays = Math.max(
    TIMELINE_CURVE_SAMPLE_DAYS,
    Math.ceil(Math.max(totalDays, 1) / TIMELINE_MAX_CURVE_SEGMENTS),
  )
  const curvePoints = [] as Array<{ date: string; x: number; y: number }>
  for (let days = 0; days <= totalDays; days += sampleDays) {
    const [year, month, day] = earliestDate.split('-').map(Number)
    const sampleDate = new Date(Date.UTC(year, month - 1, day + days))
    const date = sampleDate.toISOString().slice(0, 10)
    curvePoints.push({
      date,
      x: axisStart + days * TIMELINE_DAY_WIDTH,
      y: milestoneCurveY(date, anchorDate),
    })
  }
  if (!curvePoints.some((point) => point.date === anchorDate)) {
    curvePoints.push({ date: anchorDate, x: todayX, y: todayY })
  }
  items.forEach(({ milestone, x, y }) => {
    if (!curvePoints.some((point) => point.date === milestone.target_date)) {
      curvePoints.push({ date: milestone.target_date, x, y })
    }
  })
  const finalDate = curveEndDate
  if (!curvePoints.some((point) => point.date === finalDate)) {
    curvePoints.push({ date: finalDate, x: axisEnd, y: milestoneCurveY(finalDate, anchorDate) })
  }
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
