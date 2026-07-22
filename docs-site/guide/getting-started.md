# 快速开始

## Docker Compose（推荐）

一条命令启动全部服务（前端 + 后端 + PostgreSQL/pgvector）：

```bash
# 1. 克隆仓库
git clone https://github.com/lxfight/flowmind.git
cd flowmind

# 2.（可选）配置环境变量
cp .env.example .env   # 编辑 LLM_API_KEY 等

# 3. 启动全部服务
docker compose up -d

# 4. 查看日志获取初始管理员密码
docker compose logs backend
```

访问 **http://localhost** 即可使用。首次启动自动创建管理员账号并完成数据库迁移。

::: tip 没有 LLM Key 也能跑
知识库自动降级为关键词检索，其余功能不受影响。登录后可在 **系统配置** 页在线配置 Key 并测试连通性，详见[配置说明](/guide/configuration)。
:::

## 本地开发

### 后端（Python 3.12+，推荐 uv）

```bash
docker compose up -d postgres   # PostgreSQL + pgvector
cd backend
uv sync && source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

### 前端（Node 20+）

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173
```

前端开发服务器已配置代理，API 请求自动转发到本地 8000 端口。

## 无 Docker 的 SQLite 模式

没有 Docker 时可用 SQLite 快速体验：

```env
# .env 中修改
DATABASE_URL=sqlite+aiosqlite:///./flowmind.db
```

::: warning 功能差异
SQLite 模式下向量检索降级为关键词检索，其余功能不受影响。生产环境请使用 PostgreSQL + pgvector。
:::

## 首次登录

1. 打开 http://localhost ，使用管理员账号 `admin` 登录
2. 初始密码见 `docker compose logs backend` 输出（也可通过 `FLOWMIND_ADMIN_PASSWORD` 预设）
3. 如需 AI 能力：进入 **系统配置** 页填入 LLM API Key，点「连通性测试」确认可用
4. 创建第一个项目，邀请成员，开始使用
