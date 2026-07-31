import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { MemberOption, TaskReferenceTask } from '../../types'

const ENTITY_RE = /@([A-Za-z0-9_.-]+)|#([1-9]\d*)/g

/** Render comment/chat text with known @members and #tasks highlighted. */
export function MentionText({
  content,
  members,
  taskReferences = [],
}: {
  content: string
  members: MemberOption[]
  taskReferences?: TaskReferenceTask[]
}) {
  const usernames = new Set(members.map((m) => m.username))
  const taskById = new Map(taskReferences.map((task) => [task.id, task]))
  const parts: ReactNode[] = []
  let last = 0
  let key = 0
  for (const match of content.matchAll(ENTITY_RE)) {
    const idx = match.index
    const username = match[1]
    const task = match[2] ? taskById.get(Number(match[2])) : undefined
    if ((!username || !usernames.has(username)) && !task) continue
    if (idx > last) parts.push(content.slice(last, idx))
    if (task) {
      parts.push(
        <Link
          key={key++}
          to={`/project/${task.project_id}/board?task=${task.id}`}
          className="inline font-medium text-primary hover:underline"
        >
          #{task.id} · {task.title}
        </Link>,
      )
    } else {
      parts.push(
        <span key={key++} className="rounded bg-primary/10 px-0.5 font-medium text-primary">
          @{username}
        </span>,
      )
    }
    last = idx + match[0].length
  }
  if (parts.length === 0) return <>{content}</>
  parts.push(content.slice(last))
  return <>{parts}</>
}
