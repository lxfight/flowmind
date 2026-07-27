import { describe, expect, it } from 'vitest'
import { parseBoardDeepLink, withoutTaskDeepLink } from '../components/kanban/boardDeepLink'

describe('board deep links', () => {
  it('parses a task and its target comment', () => {
    expect(parseBoardDeepLink(new URLSearchParams('task=42&comment=7'))).toEqual({
      taskId: 42,
      commentId: 7,
    })
  })

  it('rejects malformed and orphaned ids', () => {
    expect(parseBoardDeepLink(new URLSearchParams('task=4x&comment=7'))).toEqual({
      taskId: null,
      commentId: null,
    })
    expect(parseBoardDeepLink(new URLSearchParams('comment=7'))).toEqual({
      taskId: null,
      commentId: null,
    })
  })

  it('removes task targeting without discarding unrelated parameters', () => {
    const result = withoutTaskDeepLink(new URLSearchParams('task=42&comment=7&view=compact'))
    expect(result.toString()).toBe('view=compact')
  })
})
