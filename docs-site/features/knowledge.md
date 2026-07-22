# RAG 知识库

把项目文档交给 FlowMind，AI 助手就能基于真实资料回答与执行。

![知识库](/images/05-knowledge.png)

## 文档接入

- 支持 PDF / DOCX / PPTX / Markdown 等常见格式
- 拖拽上传，自动解析、分块、建立索引
- 单文件上限默认 25MB（`KNOWLEDGE_MAX_BYTES` 可调）

## 混合检索

查询同时走两条召回路径，再用 RRF 融合排序：

- **向量语义检索**：pgvector 余弦相似度，理解语义近义
- **关键词检索**：CJK bigram 打分，精确命中术语与编号

两条结果按 RRF（k=60）融合，兼顾语义广度与关键词精度。

::: tip 无命中不编造
检索设有相似度阈值：查不到相关内容时，助手会如实说明，而不是编造答案。
:::

## 通读完整文档

除了片段检索，助手还能**通读整篇文档**——适合"根据这份需求文档拆解详细任务"这类需要全局理解的任务。

## 降级策略

| 场景 | 行为 |
|------|------|
| 未配置 Embedding Key | 自动降级为纯关键词检索，知识库其余功能正常 |
| SQLite 模式 | 向量检索不可用，降级为关键词检索 |
| Embedding 服务异常 | 检索结果按关键词路径兜底 |

## 独立 Embedding 配置

Embedding 可使用与对话模型不同的服务商：配置独立的 `EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL` 即可，留空则回退复用 LLM 配置。详见[配置说明](/guide/configuration#llm-与-embedding-独立配置与回退语义)。
