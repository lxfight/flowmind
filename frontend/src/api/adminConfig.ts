import api from '../utils/api'

export { errDetail } from '../utils/api'

export interface ConfigItem {
  key: string
  label: string
  kind: 'str' | 'int' | 'float'
  secret: boolean
  description: string
  value: string | number
  is_set: boolean
  source: 'db' | 'env'
  /** 为空时回退使用的配置项 key（如 embedding_api_key → llm_api_key） */
  fallback_key: string | null
  /** 实际生效来源：自身 key 或 fallback key（无回退机制的项为 null） */
  effective_source: string | null
  updated_at: string | null
}

export async function fetchConfigs(): Promise<ConfigItem[]> {
  const res = await api.get('/admin/config')
  return res.data.items
}

export async function updateConfig(key: string, value: string | number): Promise<void> {
  await api.put(`/admin/config/${key}`, { value })
}

export async function deleteConfig(key: string): Promise<void> {
  await api.delete(`/admin/config/${key}`)
}
