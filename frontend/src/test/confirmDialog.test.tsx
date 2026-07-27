import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { ConfirmDialogHost } from '../components/ui/ConfirmDialog'
import { confirmAction } from '../components/ui/confirmAction'
import { Dialog, DialogTitle } from '../components/ui/Dialog'

function NestedDialogHarness() {
  const [open, setOpen] = useState(true)

  return (
    <>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>任务详情</DialogTitle>
        <button
          type="button"
          onClick={() => void confirmAction({ title: '删除任务', description: '任务将被永久删除。' })}
        >
          打开确认
        </button>
      </Dialog>
      <ConfirmDialogHost />
    </>
  )
}

describe('ConfirmDialogHost', () => {
  it('resolves true after confirming a dangerous action', async () => {
    render(<ConfirmDialogHost />)

    let result!: Promise<boolean>
    act(() => {
      result = confirmAction({
        title: '删除任务',
        description: '任务将被永久删除。',
        confirmLabel: '删除任务',
        tone: 'danger',
      })
    })

    expect(screen.getByRole('dialog', { name: '删除任务' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '删除任务' }))
    await expect(result).resolves.toBe(true)
  })

  it('resolves false after cancelling', async () => {
    render(<ConfirmDialogHost />)

    let result!: Promise<boolean>
    act(() => {
      result = confirmAction({
        title: '恢复默认配置',
        description: '数据库覆盖值将被清除。',
        tone: 'warning',
      })
    })

    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    await expect(result).resolves.toBe(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('queues confirmation requests without leaving promises unresolved', async () => {
    render(<ConfirmDialogHost />)

    let first!: Promise<boolean>
    let second!: Promise<boolean>
    act(() => {
      first = confirmAction({ title: '第一项', description: '确认第一项。' })
      second = confirmAction({ title: '第二项', description: '确认第二项。' })
    })

    await userEvent.click(screen.getByRole('button', { name: '确认' }))
    expect(await screen.findByRole('dialog', { name: '第二项' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '取消' }))

    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(false)
  })

  it('closes only the top dialog when Escape is pressed', async () => {
    render(<NestedDialogHarness />)

    await userEvent.click(screen.getByRole('button', { name: '打开确认' }))
    expect(screen.getByRole('dialog', { name: '删除任务' })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: '删除任务' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '任务详情' })).toBeInTheDocument()
  })
})
