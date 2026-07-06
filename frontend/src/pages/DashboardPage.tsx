import { useProjectStore } from '../stores/projectStore'
import { Link } from 'react-router-dom'
import { Plus, KanbanSquare } from 'lucide-react'

export default function DashboardPage() {
  const { projects } = useProjectStore()

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">我的项目</h2>
        <button className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          新建项目
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="card p-12 text-center">
          <KanbanSquare size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-600 mb-2">还没有项目</h3>
          <p className="text-gray-400 mb-4">创建第一个项目，开始使用 FlowMind</p>
          <button className="btn-primary">创建项目</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p) => (
            <Link
              key={p.id}
              to={`/project/${p.id}/board`}
              className="card p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center gap-3 mb-3">
                <span
                  className="w-4 h-4 rounded-full"
                  style={{ backgroundColor: p.color }}
                />
                <h3 className="font-semibold text-lg">{p.name}</h3>
              </div>
              <p className="text-sm text-gray-500 line-clamp-2 mb-4">{p.description}</p>
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span>{p.member_count} 位成员</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
