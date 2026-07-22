# 部署

## Docker Compose 部署

仓库根目录的 `docker-compose.yml` 编排了全部服务：

```bash
cp .env.example .env
# 编辑 .env：JWT_SECRET、LLM_API_KEY 等

docker compose up -d
docker compose logs backend   # 查看初始管理员密码
```

服务组成：

| 服务 | 说明 |
|------|------|
| `frontend` | Nginx 托管前端静态资源，并反向代理 `/api` |
| `backend` | FastAPI 应用，启动时自动执行数据库迁移 |
| `postgres` | PostgreSQL 17 + pgvector，持久化卷存储 |

## 反向代理与域名

部署到公网时，建议在最外层再加一层网关（Caddy / Nginx / Traefik）：

- 终止 TLS，强制 HTTPS（JWT 在 Header 中传输）
- 将域名流量转发到 `frontend` 容器的 80 端口即可，`/api` 已由前端 Nginx 代理到后端
- SSE 流式接口需要网关**关闭响应缓冲**（如 Nginx 的 `proxy_buffering off;`），否则 AI 回复会"整段弹出"而非逐字流出

## 数据库

- **生产**：使用编排中的 PostgreSQL + pgvector，向量检索与混合检索完整可用
- **开发 / 体验**：可将 `DATABASE_URL` 指向 SQLite（见[快速开始](/guide/getting-started#无-docker-的-sqlite-模式)），向量检索自动降级为关键词检索

数据库结构由 Alembic 迁移管理，后端启动时自动升级到最新版本，无需手工执行。

## 升级

```bash
git pull
docker compose build
docker compose up -d
```

镜像重建后启动时自动应用新的数据库迁移。配置数据（数据库卷）不受影响。

## 文档站部署（GitHub Pages）

本仓库自带 GitHub Actions 工作流（`.github/workflows/deploy-docs.yml`）：`main` 分支上 `docs-site/` 目录或该工作流变更时，自动构建 VitePress 站点并发布到 GitHub Pages。

首次启用需在仓库设置中：**Settings → Pages → Build and deployment → Source 选择 "GitHub Actions"**。
