import { describe, expect, it } from 'vitest'
import { filterMentionCandidates, getMentionQuery, insertMention } from '../utils/mention'
import type { MemberOption } from '../types'

const members: MemberOption[] = [
  { id: 1, user_id: 1, username: 'alice', display_name: '爱丽丝', avatar_url: '' },
  { id: 2, user_id: 2, username: 'bob', display_name: 'Bob Builder', avatar_url: '' },
  { id: 3, user_id: 3, username: 'carol', display_name: '卡罗', avatar_url: '' },
]

describe('getMentionQuery', () => {
  it('returns the fragment after @ at line start', () => {
    expect(getMentionQuery('@ali', 4)).toBe('ali')
  })

  it('returns empty string right after @', () => {
    expect(getMentionQuery('你好 @', 4)).toBe('')
  })

  it('requires whitespace before @ (email is not a mention)', () => {
    expect(getMentionQuery('a@b.com', 7)).toBeNull()
  })

  it('returns null without @', () => {
    expect(getMentionQuery('hello', 5)).toBeNull()
  })

  it('returns null when the fragment contains invalid chars', () => {
    expect(getMentionQuery('@你好', 3)).toBeNull()
  })

  it('respects the caret position', () => {
    expect(getMentionQuery('@ali @bo', 4)).toBe('ali')
  })
})

describe('insertMention', () => {
  it('replaces the active query with @username and a trailing space', () => {
    const r = insertMention('请看 @al 一下', 6, 'alice')
    expect(r.text).toBe('请看 @alice  一下')
    expect(r.text.slice(0, r.caret)).toBe('请看 @alice ')
  })

  it('inserts at end of text', () => {
    const r = insertMention('@bo', 3, 'bob')
    expect(r.text).toBe('@bob ')
    expect(r.caret).toBe(5)
  })
})

describe('filterMentionCandidates', () => {
  it('returns first members up to limit for empty query', () => {
    expect(filterMentionCandidates(members, '')).toHaveLength(3)
    expect(filterMentionCandidates(members, '', 2)).toHaveLength(2)
  })

  it('matches username and display_name case-insensitively', () => {
    expect(filterMentionCandidates(members, 'AL')).toEqual([members[0]])
    expect(filterMentionCandidates(members, '卡罗')).toEqual([members[2]])
  })

  it('returns empty for no match', () => {
    expect(filterMentionCandidates(members, 'zzz')).toHaveLength(0)
  })
})
