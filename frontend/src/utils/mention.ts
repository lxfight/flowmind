import type { MemberOption } from '../types'

/**
 * @mention 输入辅助（LLM 对话与评论共用的纯函数）。
 * 约定与后端一致：提及格式为 @username（[A-Za-z0-9_.-]），@ 前必须是
 * 行首或空白字符，避免把邮箱等文本误判为提及。
 */

/** caret 前紧邻的 @query 片段（无则 null）。 */
export function getMentionQuery(value: string, caret: number): string | null {
  const before = value.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at === -1 || (at > 0 && !/\s/.test(before[at - 1]))) return null
  const q = before.slice(at + 1)
  return /^[A-Za-z0-9_.-]*$/.test(q) ? q : null
}

/** 把 caret 前的 @query 替换为 @username 并加空格，返回新文本与新 caret。 */
export function insertMention(
  value: string,
  caret: number,
  username: string
): { text: string; caret: number } {
  const before = value.slice(0, caret)
  const at = before.lastIndexOf('@')
  const head = at === -1 ? before : before.slice(0, at)
  const inserted = `@${username} `
  return { text: head + inserted + value.slice(caret), caret: head.length + inserted.length }
}

/** 按 username / display_name 模糊过滤候选成员。 */
export function filterMentionCandidates(
  members: MemberOption[],
  query: string,
  limit = 6
): MemberOption[] {
  const q = query.toLowerCase()
  return members
    .filter(
      (m) =>
        !q ||
        m.username.toLowerCase().includes(q) ||
        m.display_name.toLowerCase().includes(q)
    )
    .slice(0, limit)
}
