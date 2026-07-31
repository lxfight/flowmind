import type { TaskReferenceTask } from '../types'

interface MarkdownNode {
  type: string
  value?: string
  url?: string
  children?: MarkdownNode[]
}

const TASK_REFERENCE_RE = /(?<![\p{L}\p{N}_#])#([1-9]\d*)\b/gu
const SKIPPED_PARENTS = new Set(['code', 'inlineCode', 'link', 'linkReference'])

/** Remark plugin that turns known #task ids in text nodes into internal links. */
export function markdownTaskReferences(tasks: TaskReferenceTask[]) {
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  return () => (tree: MarkdownNode) => {
    const transform = (node: MarkdownNode) => {
      if (!node.children || SKIPPED_PARENTS.has(node.type)) return
      const nextChildren: MarkdownNode[] = []
      for (const child of node.children) {
        if (child.type !== 'text' || !child.value) {
          transform(child)
          nextChildren.push(child)
          continue
        }
        let last = 0
        for (const match of child.value.matchAll(TASK_REFERENCE_RE)) {
          const task = taskById.get(Number(match[1]))
          if (!task || match.index === undefined) continue
          if (match.index > last) {
            nextChildren.push({ type: 'text', value: child.value.slice(last, match.index) })
          }
          nextChildren.push({
            type: 'link',
            url: `/project/${task.project_id}/board?task=${task.id}`,
            children: [{ type: 'text', value: `#${task.id} · ${task.title}` }],
          })
          last = match.index + match[0].length
        }
        if (last === 0) {
          nextChildren.push(child)
        } else if (last < child.value.length) {
          nextChildren.push({ type: 'text', value: child.value.slice(last) })
        }
      }
      node.children = nextChildren
    }
    transform(tree)
  }
}
