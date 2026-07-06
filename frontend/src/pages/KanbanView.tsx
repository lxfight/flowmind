import { useParams } from 'react-router-dom'
import { Plus } from 'lucide-react'

export default function KanbanView() {
  const { projectId } = useParams()

  return (
    <div className="p-6 h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">任务看板</h3>
        <div className="flex items-center gap-2">
          <button className="btn-primary flex items-center gap-1.5">
            <Plus size={16} />
            LLM 创建任务
          </button>
        </div>
      </div>

      {/* Kanban columns placeholder */}
      <div className="flex gap-4 overflow-x-auto pb-4 h-[calc(100%-4rem)]">
        {['待处理', '进行中', '已完成'].map((col, i) => (
          <div key={col} className="flex-shrink-0 w-72 bg-gray-100 rounded-xl p-3">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-medium text-sm text-gray-700">{col}</h4>
              <span className="text-xs text-gray-400 bg-white px-2 py-0.5 rounded-full">
                0
              </span>
            </div>
            <div className="space-y-2 min-h-[100px]">
              {/* Task cards will be rendered here */}
              <div className="text-center text-sm text-gray-400 mt-8">
                暂无任务
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
