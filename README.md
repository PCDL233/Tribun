# AI Code Review Agent

基于 Vibe Coding 工作流的 Git 提交 AI 审查与风险分析系统——在代码进入仓库之前完成第一轮质量把关。全栈 TypeScript 单语言实现（pnpm Monorepo + Turborepo），以 `packages/shared` 的 zod schema 为单一事实源贯通配置、API、数据库与前端。

## 功能总览

- **多 Agent 并行审查**：正确性 / 安全 / 性能三个维度经 LangGraph.js fan-out 并行审查，交叉验证抑制幻觉，BLOCKER 低置信度自愈回退（最多 3 轮）。
- **确定性静态分析**：密钥扫描（CWE-798/321）、圈复杂度（阈值 15）等确定性工具先行，不确定的问题才交给 LLM。
- **多语言上下文提取**：JS/TS 走 ts-morph，Python/Go/Java 走 Tree-sitter 官方语法包，按函数边界裁剪上下文；解析失败自动降级为行级窗口。
- **风险规划分流**：0-100 风险评分，≥60 深度审查 / 40~60 快速审查 / <40 仅静态分析，token 预算硬上限。
- **审查缓存**：内容哈希（agent + prompt 版本 + 代码内容）去重，相同代码块跨审查复用发现，不重复消耗 LLM。
- **RAG 知识库**：AST/文档边界切块，LanceDB 向量检索与 MiniSearch BM25 经 RRF 融合，块级内容哈希增量索引。
- **双模式**：`fast`（pre-commit，≤15s）/ `full`（CI 与手动，≤60s）。
- **Web Dashboard**：审查历史、五段式报告详情（diff + 行级发现 + 误报标记）、SSE 实时进度、统计分析（ECharts）。
- **可观测性**：Prometheus 指标（`/metrics`）、统计聚合接口（`/api/stats`）。

## Monorepo 结构

```
apps/
  cli/       @ai-review/cli     —— Git Hook 与命令行入口（commander）
  server/    @ai-review/server  —— Hono 4 API：REST + SSE + /metrics + 托管 Dashboard 静态产物
  web/       @ai-review/web     —— React 19 Dashboard（Vite 8 / Rolldown + Ant Design 6 + ECharts）
packages/
  shared/    zod schema 单一事实源：配置 / API 契约 / Finding / 退出码
  diff/      unified diff 解析、index/HEAD 内容读取、Tree-sitter & ts-morph 上下文提取
  core/      LangGraph.js 流水线、风险规划器、交叉验证、审查缓存接口、基准测试
  agents/    ReAct 审查 Agent
  tools/     静态分析工具总线 + MCP stdio Server（secret_scan / complexity_check）
  rag/       RAG 知识库：LanceDB 向量 + MiniSearch BM25 + RRF 融合，块级哈希增量索引
  llm/       Provider 封装（含 mock provider）、token 预算器
  db/        Drizzle ORM + SQLite（reviews / findings / review_cache）
  report/    Markdown / JSON 报告渲染
```

## 快速开始

前置要求：Node.js ≥ 22，corepack 激活 pnpm 10。

```bash
corepack enable
pnpm install

# 质量门禁（lint → typecheck → build → test）
pnpm turbo lint typecheck build test

# 审查暂存区（pre-commit 默认入口，fast 模式）
pnpm exec ai-review run --staged

# CI 模式：审查 base...HEAD 区间（full 模式）
pnpm exec ai-review run --base origin/main --mode full --block-on BLOCKER --json

# 生成配置骨架（AiReviewConfigSchema 默认值）
pnpm exec ai-review init

# 安装 .husky/pre-commit 钩子
pnpm exec ai-review install-hook

# 构建/增量更新 RAG 索引（默认本地 Ollama nomic-embed-text，OpenAI 兼容端点）
pnpm exec ai-review index --paths docs/ src/

# 以 stdio MCP 服务器暴露静态分析工具（供 Claude Code 等外部 Agent 复用）
pnpm exec ai-review mcp

# 启动团队版服务（API + Dashboard 同端口）
pnpm turbo dev
# 或生产形态：node apps/server/dist/main.js --port 8080 --web-dist apps/web/dist
```

Dashboard 打开 `http://localhost:8080`：发起审查（SSE 实时进度）→ 查看历史与报告详情 → 标记误报 → 统计分析。

## CLI 退出码契约

| 退出码 | 含义 |
|--------|------|
| 0 | 审查通过（无发现超过阻断阈值） |
| 1 | 存在 ≥ block_on 级别的发现，阻断提交 |
| 2 | 配置/环境错误 |
| 3 | 审查超时或被取消（不阻断提交） |

## API 一览

| 路由 | 说明 |
|------|------|
| `POST /api/reviews` | 触发审查（202 + reviewId，后台执行） |
| `GET /api/reviews` | 审查历史列表 |
| `GET /api/reviews/:id` | 报告详情（五段式 + 行级 findings） |
| `GET /api/reviews/:id/events` | 审查进度 SSE（stage / completed / failed） |
| `PATCH /api/findings/:id` | 误报标记回写 |
| `GET /api/stats` | 统计聚合（趋势 / 严重度分布 / Top 文件） |
| `GET /metrics` | Prometheus 指标（审查数 / 发现数 / token / 耗时） |

全部响应形状由 `@ai-review/shared` 的 zod schema 定义，前端零手工类型。

## 基准测试

`packages/core/test/benchmark.test.ts` 内置 CWE 锚定的确定性语料（CWE-798 硬编码凭证、CWE-321 私钥块、CWE-657 复杂度超标），度量静态分析层的召回率 / 精确率 / F1 并作为回归门禁。当前基线：recall 1.0、precision 0.8（含 1 条占位符凭据已知误报，由交叉验证阶段过滤）、F1 ≈ 0.89。LLM 层的召回率评估依赖真实模型，属录制/回放集成测试与线上评估范畴。

## Docker 部署

```bash
docker compose up --build
# http://localhost:8080 —— 单容器同时提供 API 与 Dashboard
```

SQLite 审查记录落在 `review-data` 卷中；PostgreSQL/Redis 为团队版多机部署扩展项。

## CI/CD

- `.github/workflows/ci.yml`：push/PR 跑 lint + typecheck + build + test。
- `.github/workflows/ai-review.yml`：PR 触发 full 模式审查 `base...HEAD` 区间，报告以 PR 评论回帖。

## 文档

- [项目实现方案](docs/项目实现方案.md) —— 架构、模块设计与选型论证
- [代码编写规范](docs/代码编写规范.md) —— 全仓编码约束与工具链落地
