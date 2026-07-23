import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

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
})
