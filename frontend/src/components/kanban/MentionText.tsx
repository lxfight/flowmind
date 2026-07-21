import type { ReactNode } from 'react'
import type { MemberOption } from '../../types'

const MENTION_RE = /@([A-Za-z0-9_.-]+)/g

/** Render comment text with @mentions of known project members highlighted. */
export function MentionText({ content, members }: { content: string; members: MemberOption[] }) {
  const usernames = new Set(members.map((m) => m.username))
  const parts: ReactNode[] = []
  let last = 0
  let key = 0
  for (const match of content.matchAll(MENTION_RE)) {
    const idx = match.index
    if (!usernames.has(match[1])) continue
    if (idx > last) parts.push(content.slice(last, idx))
    parts.push(
      <span key={key++} className="rounded bg-primary/10 px-0.5 font-medium text-primary">
        @{match[1]}
      </span>
    )
    last = idx + match[0].length
  }
  if (parts.length === 0) return <>{content}</>
  parts.push(content.slice(last))
  return <>{parts}</>
}
