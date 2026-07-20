// ===== 看板任务 =====

/** KanbanBoard 使用的任务摘要 */
export interface TaskSummary {
  id: number
  title: string
  description: string
  status_id: number
  priority: number
  order: number
  assignee_id: number | null
  due_date: string | null
  is_completed: boolean
  assignee?: { id: number; display_name: string; avatar_url: string } | null
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
  assignee?: { id: number; display_name: string; avatar_url: string } | null
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
  assignee: { id: number; display_name: string; avatar_url: string } | null
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
  content: string
  created_at: string
  user: { id: number; display_name: string }
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

export interface ChatMessage {
  id?: number
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCall[]
  tool_results?: ToolResult[]
  actions?: ActionSummary[]
  loading?: boolean
}
