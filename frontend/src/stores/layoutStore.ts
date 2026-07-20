import { create } from 'zustand'

interface LayoutState {
  mobileSidebarOpen: boolean
  openMobileSidebar: () => void
  closeMobileSidebar: () => void
}

export const useLayoutStore = create<LayoutState>((set) => ({
  mobileSidebarOpen: false,
  openMobileSidebar: () => set({ mobileSidebarOpen: true }),
  closeMobileSidebar: () => set({ mobileSidebarOpen: false }),
}))
