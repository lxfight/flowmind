import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MilestonePicker } from '../components/milestones/MilestonePicker'
import type { Milestone } from '../types'

function milestone(id: number, title: string): Milestone {
  return {
    id,
    project_id: 1,
    title,
    description: '',
    target_date: '2026-08-01',
    owner_id: null,
    owner: null,
    status: 'open',
    health: 'on_track',
    task_ids: [],
    task_total: 0,
    task_completed: 0,
    progress: 0,
    completed_at: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
  }
}

describe('MilestonePicker', () => {
  it('replaces the current milestone instead of accumulating selections', () => {
    const onChange = vi.fn()
    render(
      <MilestonePicker
        milestones={[milestone(1, '内测'), milestone(2, '发布')]}
        value={[1]}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '发布' }))

    expect(onChange).toHaveBeenCalledWith([2])
  })

  it('clears the selected milestone when it is clicked again', () => {
    const onChange = vi.fn()
    render(
      <MilestonePicker milestones={[milestone(1, '内测')]} value={[1]} onChange={onChange} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '内测' }))

    expect(onChange).toHaveBeenCalledWith([])
  })
})
