export interface BoardDeepLink {
  taskId: number | null
  commentId: number | null
}

function positiveInteger(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export function parseBoardDeepLink(searchParams: URLSearchParams): BoardDeepLink {
  const taskId = positiveInteger(searchParams.get('task'))
  return {
    taskId,
    commentId: taskId === null ? null : positiveInteger(searchParams.get('comment')),
  }
}

export function withoutTaskDeepLink(searchParams: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(searchParams)
  next.delete('task')
  next.delete('comment')
  return next
}
