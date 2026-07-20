import { useEffect } from 'react'
import { useLayoutStore, type PageHeaderState } from '../stores/layoutStore'

export function usePageHeader(header: PageHeaderState | null, deps: React.DependencyList = []) {
  const setPageHeader = useLayoutStore((s) => s.setPageHeader)

  useEffect(() => {
    setPageHeader(header)
    return () => {
      setPageHeader(null)
    }
  }, deps)
}

export function setPageHeader(header: PageHeaderState | null) {
  useLayoutStore.getState().setPageHeader(header)
}
