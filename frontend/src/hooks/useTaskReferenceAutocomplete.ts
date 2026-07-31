import { useCallback, useEffect, useState } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import { suggestTaskReferences } from '../api/tasks'
import type { TaskReferenceTask } from '../types'
import { getTaskReferenceQuery, insertTaskReference } from '../utils/taskReference'

type TextControl = HTMLInputElement | HTMLTextAreaElement

interface Options<T extends TextControl> {
  projectId: number
  excludeTaskId?: number
  value: string
  onChange: (value: string) => void
  inputRef: RefObject<T | null>
}

export function useTaskReferenceAutocomplete<T extends TextControl>({
  projectId,
  excludeTaskId,
  value,
  onChange,
  inputRef,
}: Options<T>) {
  const [query, setQuery] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<TaskReferenceTask[]>([])
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    if (query === null) return
    let current = true
    const timer = window.setTimeout(() => {
      void suggestTaskReferences(projectId, query, excludeTaskId)
        .then((items) => {
          if (current) setCandidates(items)
        })
        .catch(() => {
          if (current) setCandidates([])
        })
    }, 160)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [excludeTaskId, projectId, query])

  const updateQuery = useCallback((nextValue: string, caret: number) => {
    const nextQuery = getTaskReferenceQuery(nextValue, caret)?.query ?? null
    setQuery(nextQuery)
    if (nextQuery === null) setCandidates([])
    setActiveIndex(0)
  }, [])

  const close = useCallback(() => {
    setQuery(null)
    setCandidates([])
  }, [])

  const choose = useCallback((task: TaskReferenceTask) => {
    const control = inputRef.current
    const caret = control?.selectionStart ?? value.length
    const next = insertTaskReference(value, caret, task.id)
    onChange(next.text)
    close()
    requestAnimationFrame(() => {
      control?.focus()
      control?.setSelectionRange(next.caret, next.caret)
    })
  }, [close, inputRef, onChange, value])

  const handleKeyDown = useCallback((event: KeyboardEvent<T>): boolean => {
    if (candidates.length === 0) return false
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % candidates.length)
      return true
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index - 1 + candidates.length) % candidates.length)
      return true
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      choose(candidates[Math.min(activeIndex, candidates.length - 1)])
      return true
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return true
    }
    return false
  }, [activeIndex, candidates, choose, close])

  return {
    activeIndex,
    candidates,
    choose,
    close,
    handleKeyDown,
    open: query !== null && candidates.length > 0,
    setActiveIndex,
    updateQuery,
  }
}
