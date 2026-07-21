import { create } from 'zustand'
import api from '../utils/api'

export interface Project {
  id: number
  name: string
  description: string
  color: string
  owner_id: number
  is_archived: boolean
  created_at: string
  member_count: number
  current_user_role?: string
}

interface ProjectState {
  projects: Project[]
  currentProject: Project | null
  /** True while the project list request is in flight */
  loading: boolean
  /** True once the project list request has settled at least once */
  loaded: boolean
  setProjects: (projects: Project[]) => void
  setCurrentProject: (project: Project | null) => void
  /** Fetch (or refetch) the project list; failures are logged, not thrown */
  loadProjects: () => Promise<void>
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  currentProject: null,
  loading: false,
  loaded: false,
  setProjects: (projects) => set({ projects }),
  setCurrentProject: (project) => set({ currentProject: project }),
  loadProjects: async () => {
    set({ loading: true })
    try {
      const res = await api.get('/projects')
      set({ projects: res.data, loading: false, loaded: true })
    } catch (err) {
      // Leave the previous list in place; the shell still renders and pages
      // show their own empty states.
      console.error('加载项目列表失败', err)
      set({ loading: false, loaded: true })
    }
  },
}))
