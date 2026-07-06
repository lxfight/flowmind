import { create } from 'zustand'

export interface Project {
  id: number
  name: string
  description: string
  color: string
  owner_id: number
  is_archived: boolean
  created_at: string
  member_count: number
}

interface ProjectState {
  projects: Project[]
  currentProject: Project | null
  setProjects: (projects: Project[]) => void
  setCurrentProject: (project: Project | null) => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  currentProject: null,
  setProjects: (projects) => set({ projects }),
  setCurrentProject: (project) => set({ currentProject: project }),
}))
