import api from '../utils/api'

export interface VersionInfo {
  version: string
  git_sha: string
  build_time: string
}

export interface ReleaseInfo {
  version: string
  tag_name: string
  name: string
  body: string
  published_at: string | null
  html_url: string | null
  prerelease: boolean
}

export interface UpdaterStatus {
  available: boolean
  status: string
  operation?: 'update' | 'rollback' | null
  request_id?: string | null
  previous_version?: string | null
  target_version?: string | null
  step?: string
  progress?: number
  message?: string
  error?: string | null
  backup_path?: string | null
  rollback_available?: boolean
  started_at?: string | null
  finished_at?: string | null
  logs?: string[]
}

export interface UpdateOverview {
  current: VersionInfo
  latest: ReleaseInfo | null
  update_available: boolean
  checked_at: string | null
  check_error: string | null
  updater: UpdaterStatus
}

export interface ReleaseListResponse {
  items: ReleaseInfo[]
  checked_at: string | null
  error: string | null
}

export interface UpdateRun {
  id: number
  request_id: string
  actor_id: number
  actor_name: string | null
  previous_version: string
  target_version: string
  status: string
  step: string
  progress: number
  message: string
  error: string | null
  backup_path: string | null
  created_at: string
  updated_at: string
  finished_at: string | null
}

export async function fetchUpdateStatus(): Promise<UpdateOverview> {
  return (await api.get('/admin/update/status')).data
}

export async function checkForUpdates(): Promise<UpdateOverview> {
  return (await api.post('/admin/update/check')).data
}

export async function fetchReleases(limit = 20): Promise<ReleaseListResponse> {
  return (await api.get('/admin/update/releases', { params: { limit } })).data
}

export async function applyUpdate(version: string, requestId: string): Promise<void> {
  await api.post('/admin/update/apply', { version, request_id: requestId })
}

export async function rollbackUpdate(version: string, requestId: string): Promise<void> {
  await api.post('/admin/update/rollback', { version, request_id: requestId })
}

export async function fetchUpdateHistory(): Promise<UpdateRun[]> {
  return (await api.get('/admin/update/history')).data.items
}
