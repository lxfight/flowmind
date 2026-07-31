import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { MarkdownContent } from '../components/ui/MarkdownContent'

describe('MarkdownContent', () => {
  it('renders common Markdown syntax as formatted content', () => {
    render(
      <MarkdownContent
        content={'## 实施步骤\n\n- 创建任务\n- **确认负责人**\n\n[查看文档](https://example.com)'}
      />,
    )

    expect(screen.getByRole('heading', { name: '实施步骤', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getByText('确认负责人').tagName).toBe('STRONG')
    expect(screen.getByRole('link', { name: '查看文档' })).toHaveAttribute('target', '_blank')
  })

  it('links known task references but leaves code examples untouched', () => {
    render(
      <MemoryRouter>
        <MarkdownContent
          content={'关联 #42\n\n`示例 #42`'}
          taskReferences={[{
            id: 42,
            project_id: 7,
            parent_task_id: null,
            title: '发布检查',
            status_id: 1,
            status_name: '进行中',
            status_color: '#336699',
            is_completed: false,
          }]}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: '#42 · 发布检查' })).toHaveAttribute(
      'href',
      '/project/7/board?task=42',
    )
    expect(screen.getByText('示例 #42').tagName).toBe('CODE')
  })
})
