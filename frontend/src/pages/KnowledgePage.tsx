import { useParams } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'

export default function KnowledgePage() {
  const { projectId } = useParams()

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold">知识库</h3>
        <div className="flex items-center gap-2">
          <button className="btn-secondary flex items-center gap-1.5">
            <Search size={16} />
            问答查询
          </button>
          <button className="btn-primary flex items-center gap-1.5">
            <Plus size={16} />
            添加文档
          </button>
        </div>
      </div>

      <div className="card p-12 text-center">
        <BookOpen size={48} className="mx-auto text-gray-300 mb-4" />
        <h3 className="text-lg font-medium text-gray-600 mb-2">知识库为空</h3>
        <p className="text-gray-400 mb-4">上传项目文档，LLM 将基于这些内容回答问题</p>
        <button className="btn-primary">上传文档</button>
      </div>
    </div>
  )
}

function BookOpen(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  )
}
