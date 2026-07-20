import { create } from 'zustand'
import type { ReactNode } from 'react'

export interface PageHeaderState {
  title: string
  description?: string
  breadcrumbs?: { label: string; to?: string }[]
  actions?: ReactNode
}

interface LayoutState {
  pageHeader: PageHeaderState | null
  mobileSidebarOpen: boolean
  setPageHeader: (header: PageHeaderState | null) => void
  openMobileSidebar: () => void
  closeMobileSidebar: () => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  pageHeader: null,
  mobileSidebarOpen: false,
  setPageHeader: (header) => set({ pageHeader: header }),
  openMobileSidebar: () => set({ mobileSidebarOpen: true }),
  closeMobileSidebar: () => set({ mobileSidebarOpen: false }),
}))
