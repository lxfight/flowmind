# 配置说明

FlowMind 的配置分两层：**环境变量**（部署时设定）与 **系统配置页**（运行时在线修改，免重启即时生效）。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DATABASE_URL` | 数据库连接串 | `postgresql+asyncpg://flowmind:flowmind_secret@localhost:5432/flowmind` |
| `JWT_SECRET` | JWT 签名密钥（生产必设） | 自动生成 |
| `FLOWMIND_ADMIN_PASSWORD` | 初始管理员密码 | 随机生成（见启动日志） |
| `LLM_API_KEY` | LLM 对话 API 密钥 | — |
| `LLM_BASE_URL` | LLM API 地址（OpenAI 兼容） | — |
| `LLM_MODEL` | 对话模型 | `gpt-4o-mini` |
| `EMBEDDING_API_KEY` | Embedding 独立密钥（留空回退 LLM Key） | — |
| `EMBEDDING_BASE_URL` | Embedding 独立地址（留空回退 LLM URL） | — |
| `LLM_EMBEDDING_MODEL` | 向量模型 | `text-embedding-3-small` |
| `LLM_EMBEDDING_DIM` | 向量维度（需与模型输出一致） | `1536` |
| `KNOWLEDGE_MAX_BYTES` | 知识库单文件上限 | `26214400`（25MB） |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Token 有效期 | `1440` |

::: danger 生产环境
`JWT_SECRET` 务必显式设置为强随机值，避免实例重启后旧 Token 失效或密钥泄露。
:::

## 系统配置页（在线配置）

超级管理员登录后进入 **系统配置** 页，可在线调整 LLM / Embedding / 检索参数，保存后**免重启即时生效**（运行时覆盖环境变量）：

![系统配置页](/images/07-admin-config.png)

- **密钥脱敏展示**：已保存的 Key 只显示掩码，不回显明文
- **来源可追溯**：每项配置标注当前值来自环境变量还是运行时覆盖
- **连通性测试**：LLM 与 Embedding 各有独立的测试按钮，API 异常可快速定位

## LLM 与 Embedding 独立配置与回退语义

对话模型与向量模型可以使用**不同的服务商**：

- `EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL` 留空时，自动**回退**使用 LLM 的 Key 与地址
- 单独配置后，Embedding 请求走独立通道，互不干扰
- 系统配置页同样支持两套独立配置，并分别提供连通性测试

::: tip 典型场景
用国内 OpenAI 兼容服务做对话 + 官方 OpenAI Embedding，或反之——两种组合都只需在配置页点几下。
:::
