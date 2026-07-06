# FlowMind

LLM 驱动的智能任务管理看板系统，集成 RAG 知识库，支持多项目和用户权限管理。

## 功能

- **看板**: 拖拽式任务管理，支持排序持久化
- **知识库**: 文档管理 + RAG（检索增强生成），基于知识库内容的 LLM 问答
- **LLM 助手**: 对话式任务管理和项目分析
- **项目周报**: LLM 自动生成项目进度报告
- **用户管理**: 注册 / 登录 / JWT 鉴权 / 项目成员管理
- **多项目**: 项目隔离，成员权限控制

## 技术栈

### 后端
- Python 3.11+ / FastAPI / SQLAlchemy (async) / Pydantic v2
- PostgreSQL + pgvector (生产) / SQLite (开发)
- JWT 鉴权 (python-jose) + bcrypt
- OpenAI 兼容 API 集成

### 前端
- React 19 / TypeScript / Vite 6
- TailwindCSS 3 / dnd-kit (拖拽)
- Zustand (状态管理) / TanStack Query / react-router-dom
- Lucide React (图标) / react-hot-toast

## 快速开始

### 环境要求
- Python 3.11+
- Node.js 18+
- [uv](https://docs.astral.sh/uv/) (推荐)
- Docker (运行 PostgreSQL)

### 1. 启动 PostgreSQL

```bash
docker compose up -d
```

这将启动一个包含 pgvector 插件的 PostgreSQL 17 容器（端口 5432）。

### 2. 配置环境变量

```bash
cp .env.example backend/.env
```

默认已配置 PostgreSQL 连接。如果你没有 Docker，想用 SQLite 开发，编辑 `backend/.env`，将 `DATABASE_URL` 注释掉，取消 SQLite 那行的注释。

### 3. 启动后端

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

API 文档访问 http://localhost:8000/docs

### 4. 启动前端

```bash
cd frontend
npm install
npm run dev
```

访问 http://localhost:5173

### 从 SQLite 迁移到 PostgreSQL（已有数据时）

如果你之前使用 SQLite 并已经存有数据，可以按以下步骤迁移：

```bash
# 1. 确保环境变量指向 SQLite，导出数据
cd backend
DATABASE_URL=sqlite+aiosqlite:///./flowmind.db python scripts/migrate.py export data.json

# 2. 启动 PostgreSQL
docker compose up -d

# 3. 切换环境变量为 PostgreSQL，导入数据
DATABASE_URL=postgresql+asyncpg://flowmind:flowmind_secret@localhost:5432/flowmind python scripts/migrate.py import data.json

# 4. 启动后端（此时使用 PostgreSQL）
uv run uvicorn app.main:app --reload --port 8000
```

### 直接使用 SQLite 开发（无 Docker）

如果你不想安装 Docker，可以修改 `backend/.env`：

```env
# 注释 PostgreSQL，取消注释 SQLite
# DATABASE_URL=postgresql+asyncpg://flowmind:flowmind_secret@localhost:5432/flowmind
DATABASE_URL=sqlite+aiosqlite:///./flowmind.db
```

SQLite 模式下，RAG 知识库的向量搜索会降级为随机检索，不影响其他功能。

## 项目结构

```
FlowMind/
├── docker-compose.yml        # PostgreSQL + pgvector 容器
├── backend/
│   ├── scripts/
│   │   └── migrate.py        # SQLite → PostgreSQL 数据迁移脚本
│   └── app/
│       ├── api/              # API 路由
│       ├── core/             # 配置 / 数据库 / 安全
│       ├── models/           # SQLAlchemy 模型
│       ├── schemas/          # Pydantic 模型
│       └── services/         # LLM / RAG 服务
├── frontend/
│   └── src/
│       ├── components/       # UI 组件
│       ├── pages/            # 页面
│       ├── stores/           # Zustand 状态
│       └── utils/            # 工具函数
└── .env.example
```

## API 概览

| 端点 | 说明 |
|---|---|
| `POST /api/auth/register` | 用户注册 |
| `POST /api/auth/login` | 用户登录 (获取 JWT) |
| `GET /api/auth/me` | 当前用户信息 |
| `GET/POST /api/projects` | 项目列表 / 创建 |
| `GET/POST /api/projects/{id}/members` | 成员管理 |
| `GET /api/projects/users/search` | 搜索用户 |
| `GET/POST /api/projects/{id}/tasks` | 任务 CRUD |
| `PATCH /api/projects/{id}/tasks/{tid}/move` | 拖拽移动任务 |
| `GET/POST /api/projects/{id}/knowledge` | 知识库管理 |
| `POST /api/llm/report` | 生成项目报告 |
| `POST /api/llm/chat` | LLM 对话 |
| `POST /api/llm/generate-tasks` | LLM 生成任务 |
