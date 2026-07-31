import { describe, expect, it } from 'vitest'
import { getTaskReferenceQuery, insertTaskReference } from '../utils/taskReference'

describe('task reference input helpers', () => {
  it('finds a #query at a valid text boundary', () => {
    expect(getTaskReferenceQuery('请参考 #发布', 7)).toEqual({ query: '发布', start: 4 })
    expect(getTaskReferenceQuery('版本v#12', 6)).toBeNull()
  })

  it('inserts a stable #task id in place of the active query', () => {
    expect(insertTaskReference('请参考 #发布 后续', 7, 42)).toEqual({
      text: '请参考 #42 后续',
      caret: 7,
    })
  })
})
