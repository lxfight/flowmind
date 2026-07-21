import { createContext, useContext } from 'react'

export interface DropdownMenuContextValue {
  close: () => void
}

export const DropdownMenuContext = createContext<DropdownMenuContextValue | null>(null)

export function useDropdownMenu() {
  return useContext(DropdownMenuContext)
}
