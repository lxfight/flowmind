export interface TaskReferenceQuery {
  query: string
  start: number
}

/** Return the active #query immediately before the caret. */
export function getTaskReferenceQuery(value: string, caret: number): TaskReferenceQuery | null {
  const before = value.slice(0, caret)
  const hash = before.lastIndexOf('#')
  if (hash === -1) return null
  if (hash > 0 && /[\p{L}\p{N}_#]/u.test(before[hash - 1])) return null
  const query = before.slice(hash + 1)
  if (!query || /^[^\s#@]{0,64}$/u.test(query)) return { query, start: hash }
  return null
}

export function insertTaskReference(
  value: string,
  caret: number,
  taskId: number,
): { text: string; caret: number } {
  const active = getTaskReferenceQuery(value, caret)
  if (!active) return { text: value, caret }
  const tail = value.slice(caret)
  const inserted = `#${taskId}${/^\s/.test(tail) ? '' : ' '}`
  return {
    text: value.slice(0, active.start) + inserted + tail,
    caret: active.start + inserted.length,
  }
}
