// ===== 看板任务 =====

/** 任务指派人精简信息 */
export interface AssigneeBrief {
  id: number
  display_name: string
  avatar_url: string
}

/** KanbanBoard 使用的任务摘要 */
export interface TaskSummary {
  id: number
  title: string
  description: string
  status_id: number
  priority: number
  order: number
  due_date: string | null
  is_completed: boolean
  assignees: AssigneeBrief[]
  comment_count: number
  subtask_count: number
  subtask_done: number
  created_at: string
  updated_at: string
}

/** KanbanCard 使用的精简任务信息 */
export interface TaskCard {
  id: number
  title: string
  priority: number
  assignees: AssigneeBrief[]
  due_date: string | null
  is_completed?: boolean
  subtask_count: number
  subtask_done: number
  comment_count: number
  created_at: string
  updated_at: string
}

// ===== 状态列 =====

/** KanbanBoard 使用的完整状态列信息 */
export interface TaskStatus {
  id: number
  project_id: number
  name: string
  order: number
  color: string
  is_done: boolean
  task_count: number
}

/** 状态列精简信息（用于下拉选择） */
export interface StatusOption {
  id: number
  name: string
}

// ===== 任务详情 =====

/** 任务详情（含子任务和评论） */
export interface TaskDetail {
  id: number
  title: string
  description: string
  status_id: number
  priority: number
  assignees: AssigneeBrief[]
  due_date: string | null
  is_completed: boolean
  created_at: string
  updated_at: string
  comment_count: number
  subtask_count: number
  subtask_done: number
  subtasks?: SubTask[]
  comments: TaskComment[]
}

/** 子任务 */
export interface SubTask {
  id: number
  title: string
  is_completed: boolean
}

/** 任务评论 */
export interface TaskComment {
  id: number
  task_id: number
  user_id: number
  content: string
  created_at: string
  updated_at: string
  user: { id: number; display_name: string }
}

export interface TaskAttachment {
  id: number
  task_id: number
  uploader_id: number
  filename: string
  content_type: string
  size: number
  created_at: string
}

// ===== 成员 =====

/** 项目成员（含角色信息） */
export interface ProjectMember {
  id: number
  user_id: number
  role: string
  username: string
  display_name: string
  avatar_url: string
}

/** 成员精简信息（用于指派人选择） */
export interface MemberOption {
  id: number
  user_id: number
  display_name: string
  username: string
  avatar_url: string
  role?: string
}

// ===== 用户搜索 =====

/** 搜索到的用户信息 */
export interface UserInfo {
  id: number
  username: string
  display_name: string
  avatar_url: string
}

// ===== LLM 任务生成 =====

/** LLM 生成的单个任务 */
export interface GeneratedTask {
  title: string
  description: string
  priority: number
}

// ===== LLM 聊天 =====

export interface ChatSession {
  id: number
  project_id: number
  title: string
  /** True while the assistant is waiting for the user to answer a question */
  awaiting_input?: boolean
  created_at: string
  updated_at: string
}

export interface ToolCall {
  id?: string
  tool: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  tool_call_id?: string
  tool: string
  message: string
}

export interface ActionSummary {
  type:
    | 'create_task'
    | 'update_task'
    | 'move_task'
    | 'delete_task'
    | 'add_comment'
    | 'add_subtask'
    | 'update_subtask'
    | 'create_status'
    | 'update_status'
    | 'delete_status'
  task_id?: number
  status_id?: number
  title?: string
  detail?: string
}

export interface UndoResult {
  batch_id: string
  undone: string[]
  skipped: { summary: string; reason: string }[]
}

export interface ChatMessage {
  id?: number
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCall[]
  tool_results?: ToolResult[]
  actions?: ActionSummary[]
  /** Clarifying question the assistant is waiting for the user to answer */
  pending_question?: { question: string; options?: string[] | null } | null
  /** Agent run batch id — present on assistant messages that can be undone */
  action_batch_id?: string | null
  /** Set once this message's action batch has been undone */
  undone_at?: string | null
  created_at?: string
  loading?: boolean
  /** True while the assistant message is streaming token-by-token */
  streaming?: boolean
  /** Compact status line shown while a tool runs (streaming) */
  toolStatus?: string | null
  /** Streaming was aborted by the user — partial content kept */
  stopped?: boolean
  /** Inline error text for a failed assistant message */
  error?: string
}
