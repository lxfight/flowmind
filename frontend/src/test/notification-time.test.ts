import { describe, expect, it } from 'vitest'
import { formatNotificationTime } from '../components/layout/notificationDisplay'

describe('formatNotificationTime', () => {
  it('returns 刚刚 for under a minute', () => {
    expect(formatNotificationTime(new Date().toISOString())).toBe('刚刚')
  })

  it('returns minutes for under an hour', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString()
    expect(formatNotificationTime(fiveMinAgo)).toBe('5 分钟前')
  })

  it('returns hours for under a day', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString()
    expect(formatNotificationTime(threeHoursAgo)).toBe('3 小时前')
  })

  it('returns days for under a week', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString()
    expect(formatNotificationTime(twoDaysAgo)).toBe('2 天前')
  })
})
