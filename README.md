# AI Code Review Agent

基于 Vibe Coding 工作流的 Git 提交 AI 审查与风险分析系统——在开发者执行 `git commit` 时自动对暂存区变更做多维度审查，识别缺陷、安全风险与性能问题，生成结构化报告并在代码进入仓库之前完成第一轮质量把关。

全栈 TypeScript 单语言实现（pnpm Monorepo + Turborepo），以 `packages/shared` 的 zod schema 为单一事实源，贯通**配置校验 → API 契约 → 数据库行类型 → 前端表单**四条链路，契约漂移在编译期即被发现。

## 功能总览

- **多 Agent 并行审查**：正确性 / 安全 / 性能三个维度经 LangGraph.js fan-out 并行审查，交叉验证抑制幻觉，BLOCKER 低置信度自愈回退（最多 3 轮）。
- **确定性优先**：密钥扫描（CWE-798/321）、圈复杂度（阈值 15）等确定性工具先行，能用确定性工具判定的问题不交给 LLM，减少 token 浪费与不确定性。
- **多语言上下文提取**：JS/TS 走 ts-morph，Python/Go/Java 走 Tree-sitter 官方语法包，按函数边界裁剪上下文；解析失败自动降级为行级窗口，不阻塞流水线。
- **风险规划分流**：0-100 风险评分，≥60 深度审查 / 40~60 快速审查 / <40 仅静态分析；token 预算硬上限，预算耗尽自动降级为静态分析并在报告中标注。
- **审查缓存**：内容哈希（agent + prompt 版本 + 代码内容）去重，相同代码块跨审查复用发现，不重复消耗 LLM。
- **RAG 知识库**：AST/文档边界切块，LanceDB 向量检索与 MiniSearch BM25 经 RRF 融合，块级内容哈希增量索引。
- **fast / full 双模式**：`fast`（pre-commit 默认，目标 ≤15s）/ `full`（CI 与手动，目标 ≤60s）。
- **Web Dashboard**：审查历史、五段式报告详情（diff + 行级发现 + 误报标记）、SSE 实时进度、统计分析（ECharts）。
- **MCP 工具开放**：静态分析能力经 MCP stdio 对外暴露，Claude Code 等外部 Agent 即插即用。
- **可观测性**：Prometheus 指标（`/metrics`）、统计聚合接口（`/api/stats`）。

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│ 交互层：Git Hook CLI (commander) │ Web Dashboard (React 19)      │
│        API Server (Hono 4, REST + SSE + 静态托管)                │
├─────────────────────────────────────────────────────────────────┤
│ Agent 编排层：LangGraph.js StateGraph                            │
│   parse → riskPlan → [correctness│security│performance] (并行)   │
│         → validate → (heal 自愈回退) → report                    │
├─────────────────────────────────────────────────────────────────┤
│ 分析引擎层：LLM Agent (AI SDK 5) │ 静态分析 (ts-morph/Tree-sitter)│
│             RAG (LanceDB + MiniSearch) │ 工具总线 (进程内 + MCP)  │
├─────────────────────────────────────────────────────────────────┤
│ 数据层：SQLite/Drizzle (reviews/findings/review_cache)           │
│         LanceDB 向量索引 │ 报告文件 │ Prometheus 指标              │
└─────────────────────────────────────────────────────────────────┘
```

一次审查的完整业务链路：

1. **触发**：`git commit` → pre-commit hook 调用 `ai-review run --staged`（默认 fast 模式）。
2. **Diff 解析**：读取暂存区（index）快照而非工作区——只有 index 内容才与本次提交一致；按函数边界构建上下文包。
3. **风险规划**：逐文件评分分流（≥60 深度 / 40~60 快速 / <40 仅静态分析）。
4. **并行审查**：三维度 Agent 经 LangGraph fan-out 并行执行，全程受 token 预算与取消信号约束。
5. **交叉验证**：严重度重分类 → 置信度评分 → 去重排序，抑制 LLM 幻觉。
6. **自愈回退**：BLOCKER 置信度 < 0.6 时携带上下文重审，最多 3 轮、逐轮收窄。
7. **报告与决策**：五段式 Markdown/JSON 报告，按 `block_on` 阈值决定退出码（0 放行 / 1 阻断）。
8. **落库与推送**：内容哈希缓存去重后写入 SQLite，SSE 实时推送 Dashboard。

fast / full 模式差异：

| 环节 | fast（pre-commit 默认） | full（CI / 手动） |
|------|------------------------|-------------------|
| 静态分析 | 全部执行 | 全部执行 |
| LLM 深度审查 | 仅风险分 ≥60 的文件 | 所有 deep + quick 文件 |
| 交叉验证 | 去重 + 置信度过滤 | 完整 5 阶段 + 自愈回退 |
| 目标耗时 | ≤ 15s（500 行变更） | ≤ 60s（500 行变更） |

## 技术栈

| 层次 | 选型 | 版本 | 说明 |
|------|------|------|------|
| 语言 / 运行时 | TypeScript + Node.js | TS 6.x (strict) / Node 22 LTS | 前后端单语言，端到端类型安全 |
| 包管理 / 编排 | pnpm workspaces + Turborepo | pnpm 10 / turbo 2 | `catalog:` 统一锁定依赖版本，任务图调度 |
| API 服务 | Hono | 4.x | Web 标准优先、原生 SSE、zod 中间件 |
| 前端框架 | React | 19.x | React Compiler 自动 memoization（全仓禁手写 useMemo/useCallback） |
| 前端构建 | Vite（Rolldown 内核） | 8.x | dev/build 统一内核；大依赖 `advancedChunks` 分包 |
| 前端路由/状态 | TanStack Query | v5 | 服务端状态缓存；SSE 经自定义 hook 接入 |
| UI / 图表 | Ant Design / Apache ECharts | 6.x / 6.x | ECharts 经 `echarts/core` 按需注册控制体积 |
| Agent 编排 | LangGraph.js | 1.x | 条件边、fan-out/fan-in、节点级流式事件直通 SSE |
| LLM 接入 | Vercel AI SDK | 5.x | Provider 抽象（anthropic/openai/ollama/mock）、流式、usage 统计 |
| AST / 静态分析 | ts-morph + Tree-sitter 语法包 | — | JS/TS 深度分析；Python/Go/Java 多语言覆盖 |
| 向量检索 | LanceDB（嵌入式） | 0.20 | 零服务依赖，随项目目录持久化 |
| 关键词检索 | MiniSearch | 7.x | 内存 BM25，与向量召回做 RRF 融合 |
| 工具协议 | MCP TypeScript SDK | 1.x | 静态分析工具对内进程内调用、对外 stdio MCP |
| ORM / 存储 | Drizzle ORM + better-sqlite3 | — | reviews / findings / review_cache 三表 |
| 校验 | zod | 4.x | 配置 / API / 缓存读回统一校验 |
| 测试 | Vitest | 5.x | 与 Vite 共享 transform 管线；录制/回放替换真实 LLM |
| 指标 | prom-client | 15.x | 独立 Registry，`/metrics` 文本格式 |
| 部署 | Docker multi-stage (node:22-alpine) | — | 单容器同时提供 API 与 Dashboard |

依赖版本只声明在 `pnpm-workspace.yaml` 的 `catalog`，各包以 `catalog:` 协议引用；新增包/任务需同步 `turbo.json` 任务图。

## Monorepo 结构

```
apps/
  cli/       @ai-review/cli     —— Git Hook 与命令行入口（commander + @clack/prompts）
  server/    @ai-review/server  —— Hono 4 API：REST + SSE + /metrics + 托管 Dashboard 静态产物
  web/       @ai-review/web     —— React 19 Dashboard（Vite 8 + Ant Design 6 + ECharts）
packages/
  shared/    zod schema 单一事实源：配置 / API 契约 / Finding / 退出码
  diff/      unified diff 解析、index/HEAD 内容读取、Tree-sitter & ts-morph 上下文提取
  core/      LangGraph.js 流水线、风险规划器、交叉验证、审查缓存接口、基准测试
  agents/    ReAct 审查 Agent
  tools/     静态分析工具总线 + MCP stdio Server（complexity_check / secret_scan）
  rag/       RAG 知识库：LanceDB 向量 + MiniSearch BM25 + RRF 融合，块级哈希增量索引
  llm/       Provider 封装（mock / 录制回放）、token 预算器
  db/        Drizzle ORM + SQLite（reviews / findings / review_cache）
  report/    Markdown / JSON 报告渲染
```

## 快速开始

前置要求：Node.js ≥ 22；corepack 按根 `package.json` 的 `packageManager` 字段激活 pnpm 10。

```bash
corepack enable
pnpm install

# 构建 + 质量门禁（lint → typecheck → build → test）
pnpm build
pnpm turbo lint typecheck build test
```

本地开发（server + web 并行）：

```bash
pnpm dev
# apps/server 监听 8080（node --watch dist/main.js）
# apps/web 为 Vite dev server（默认 5173，/api 代理到 8080）
```

## CLI 使用指南

CLI 二进制名为 `ai-review`，Monorepo 内经 `pnpm exec ai-review <command>` 调用，安装后可直接使用 `ai-review`。

### `ai-review run` —— 执行审查

| 选项 | 说明 |
|------|------|
| `--staged` | 审查暂存区 diff（默认，pre-commit 入口） |
| `--base <ref>` | CI 模式：审查 `<ref>...HEAD` 区间变更（取 merge-base，对 base 的最新提交不产生噪音） |
| `--mode <mode>` | `fast`（默认）或 `full` |
| `--block-on <severity>` | 阻断阈值：`BLOCKER`（默认）/ `WARNING` / `NIT` |
| `--json` | 以 JSON 输出（ReviewReport 形状，供 CI/脚本消费） |

```bash
# pre-commit：fast 模式审查暂存区，BLOCKER 阻断
ai-review run --staged

# 本地手动完整审查
ai-review run --staged --mode full

# CI：审查 PR 区间，JSON 报告重定向到文件
ai-review run --base origin/main --mode full --block-on BLOCKER --json > .ai-review-reports/latest.json
```

退出码契约（脚本与 CI 依赖的稳定接口）：

| 退出码 | 含义 |
|--------|------|
| 0 | 审查通过（无发现达到阻断阈值） |
| 1 | 存在 ≥ block_on 级别的发现，阻断提交 |
| 2 | 配置/环境错误（配置校验失败、git 仓库无效等） |
| 3 | 审查超时或被取消（不阻断提交） |

### `ai-review init` —— 初始化配置

交互式向导（@clack/prompts），以 `AiReviewConfigSchema` 的默认值生成 `.ai-review.yml` 骨架——配置与校验器同源，永不漂移。

### `ai-review install-hook` —— 安装 Git Hook

写入 `.husky/pre-commit`（fast 模式、BLOCKER 阻断）。前提是仓库已激活 husky v9：`pnpm exec husky init`。husky v9 基于 `core.hooksPath`，Windows/macOS/Linux 通用。

### `ai-review index` —— 构建 RAG 知识库索引

| 选项 | 说明 |
|------|------|
| `--paths <paths...>` | 纳入索引的文件或目录（目录递归，自动跳过 node_modules / dist / .git 等） |
| `--model <model>` | 嵌入模型 id，默认 `nomic-embed-text` |
| `--base-url <url>` | OpenAI 兼容嵌入端点，默认 `http://127.0.0.1:11434/v1`（本地 Ollama） |

```bash
ai-review index --paths docs/ CLAUDE.md src/
```

增量语义：以块级内容哈希去重，仅对新增/变更块重新向量化；重复执行安全。

### `ai-review server` —— 启动团队版服务

| 选项 | 说明 |
|------|------|
| `--port <port>` | 监听端口，默认 8080 |
| `--db <file>` | SQLite 审查库路径，默认 `.ai-review-cache/reviews.db` |
| `--web-dist <dir>` | Dashboard 静态产物目录（提供后同端口托管前端） |

### `ai-review mcp` —— 对外开放工具

以 stdio MCP 服务器暴露静态分析工具，Claude Code 等 MCP 客户端可直接复用。客户端配置示例：

```json
{
  "mcpServers": {
    "ai-review-tools": {
      "command": "ai-review",
      "args": ["mcp"]
    }
  }
}
```

当前开放的工具：

| 工具 | 入参 | 输出 |
|------|------|------|
| `complexity_check` | `file_path`、`threshold?` | 超过阈值的函数列表（名称 / 行号 / 复杂度） |
| `secret_scan` | `diff_text` | 疑似密钥/凭证列表（严重度 / CWE / 建议） |

## 配置文件（.ai-review.yml）

全部字段可省略（省略即默认值）；`${ENV_NAME}` 引用由 `loadConfig` 递归解析，**禁止明文提交密钥**。校验失败给字段级错误提示，CLI 映射退出码 2。

```yaml
llm:
  provider: anthropic        # anthropic | openai | ollama | mock（离线/测试，无 Key 可跑通流水线）
  model: claude-sonnet-4.5
  apiKey: ${AI_REVIEW_API_KEY}
  maxTokensPerReview: 50000
  temperature: 0.1           # 低温度保证审查一致性
  mockFixturesDir: .ai-review-cache/llm-fixtures   # 录制/回放 fixture 目录

review:
  mode: fast                 # fast（hook 默认）| full（CI/手动）
  dimensions: [correctness, security, performance, maintainability]
  blockOn: BLOCKER           # 阻断阈值
  ignorePatterns: ['*.lock', 'pnpm-lock.yaml', 'dist/**', '*.min.js']

rag:
  enabled: true
  knowledgeBasePaths: ['docs/']
  indexDir: .ai-review-cache/vectors
  topK: 5

staticAnalysis:
  enabledTools: [complexity_check, secret_scan, dependency_scan]
  complexityThreshold: 15

report:
  format: markdown           # markdown | html | json
  outputDir: .ai-review-reports
  includePraise: true
```

严重度分级：`BLOCKER`（阻断级缺陷）/ `WARNING`（应修复）/ `NIT`（建议）/ `PRAISE`（正面反馈）。

## Web Dashboard

`pnpm dev` 后访问 `http://localhost:5173`（开发）或服务端托管的 `http://localhost:8080`（生产），四个页签：

1. **审查历史**：列表 + 排序，行内展示风险评分与 BLOCKER/WARNING/NIT 计数，点击进入详情。
2. **报告详情**：五段式报告（变更概述 / 发现的问题 / 质量考量 / 改进建议 / 总体评估），行级发现支持**标记误报**（乐观更新回写数据库，沉淀为置信度模型优化数据）。
3. **发起审查**：输入仓库路径与模式触发审查，SSE 实时展示流水线阶段进度（解析 → 规划 → 并行审查 → 验证 → 报告）。
4. **统计分析**：汇总卡片（审查数 / 发现数 / 误报数 / 平均风险分 / 平均耗时 / Token 消耗）+ 风险分按日趋势（折线）+ 严重度分布 + Top 高风险文件（ECharts）。

## HTTP API

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/reviews` | POST | 触发审查，返回 202 + `{ reviewId }`（后台执行） |
| `/api/reviews` | GET | 审查历史列表（近 50 次） |
| `/api/reviews/:id` | GET | 报告详情（五段式 + 带 `id` 的行级 findings，供误报标记） |
| `/api/reviews/:id/events` | GET | 审查进度 SSE |
| `/api/findings/:id` | PATCH | 误报标记回写，请求体 `{ "isFalsePositive": true }` |
| `/api/stats` | GET | 统计聚合（严重度分布 / 按日趋势 / Top 文件） |
| `/metrics` | GET | Prometheus 文本格式指标 |

SSE 事件结构（`event` + JSON `data`）：

| event | 字段 | 说明 |
|-------|------|------|
| `stage` | `reviewId`, `stage` | 流水线节点开始（parse / riskPlan / correctness / security / performance / static / validate / heal / report） |
| `completed` | `reviewId`, `riskScore`, `blockerCount`, `blocking` | 审查完成（blocking 等价于退出码 1 语义） |
| `failed` | `reviewId`, `message` | 审查失败（配置/仓库无效等） |

全部响应形状由 `@ai-review/shared` 的 zod schema 定义，前端零手工类型。

## Prometheus 指标

| 指标 | 类型 | 标签 | 说明 |
|------|------|------|------|
| `ai_review_reviews_total` | Counter | `status=completed\|failed` | 审查终态计数 |
| `ai_review_findings_total` | Counter | `severity` | 发现计数（按严重度） |
| `ai_review_tokens_used_total` | Counter | — | LLM token 消耗累计 |
| `ai_review_review_duration_seconds` | Histogram | — | 端到端耗时（桶位覆盖 fast ≤15s / full ≤60s） |
| （默认进程指标） | — | — | CPU / GC / 事件循环等，供 Grafana 通用面板复用 |

## 审查缓存与 RAG 索引说明

- **审查缓存**：键为 `hash(agent + prompt版本 + 代码内容)`，与仓库路径无关；相同代码块跨审查、跨仓库复用同一份发现。prompt 或输出契约变更时递增 `REVIEW_PROMPT_VERSION`，缓存自动失效。指标可通过 `GET /api/stats` 观察。
- **RAG 索引**：持久化在 `rag.indexDir`（默认 `.ai-review-cache/vectors`，LanceDB 格式）；知识库内容变更后重跑 `ai-review index` 即增量更新。流水线审查时以变更摘要为查询，召回相似实现与项目约定注入上下文。

## 基准测试

`packages/core/test/benchmark.test.ts` 内置 CWE 锚定的确定性语料（CWE-798 硬编码凭证、CWE-321 私钥块、CWE-657 复杂度超标），度量静态分析层的召回率 / 精确率 / F1 并作为回归门禁。当前基线：**recall 1.0、precision 0.8、F1 ≈ 0.89**（唯一误报为占位符凭据，属已知 WARNING 语义，由交叉验证阶段过滤）。

LLM 层的真实调用经**录制/回放 Provider**（`packages/llm` 的 record-replay）替换：首次真实调用持久化响应为 fixture，此后回放，保证集成测试确定性且零 token 消耗。

## Docker 部署

```bash
docker compose up --build
# http://localhost:8080 —— 单容器同时提供 API 与 Dashboard
```

- 多阶段构建：build 阶段 `corepack pnpm install --frozen-lockfile` + `turbo build`（alpine 上回退编译 better-sqlite3，已预置 python3/make/g++）。
- SQLite 审查记录与缓存落在 `review-data` 卷，容器重建不丢历史。
- PostgreSQL / Redis 为团队版多机部署扩展项（db 包预留双方言迁移路径）。

## CI/CD 集成

- `.github/workflows/ci.yml`：push / PR 跑 `pnpm turbo lint typecheck build test` 全量门禁。
- `.github/workflows/ai-review.yml`：PR 触发 `ai-review run --base origin/<base> --mode full --json`，报告以 PR 评论回帖（含风险评分、BLOCKER 数、发现明细表）。退出码 1（存在阻断发现）视为预期结果，不判工作流失败。

## 开发指南

```bash
pnpm build       # turbo build（按依赖图：packages → apps）
pnpm dev         # server --watch + vite dev 并行
pnpm test        # turbo test
pnpm lint        # eslint（flat config）
pnpm format      # prettier --write
```

约定（详见[代码编写规范](docs/代码编写规范.md)）：

- 依赖版本只声明在 `pnpm-workspace.yaml` 的 `catalog`，包内以 `catalog:` 引用。
- 禁止 `any`、`as` 断言、`@ts-ignore`；导出函数显式返回类型；类型从 zod schema 推导。
- 提交信息遵循 Conventional Commits：`<type>(<scope>): <subject>`，scope 取包短名。

## 文档

- [项目实现方案](docs/项目实现方案.md) —— 系统架构、核心模块设计与选型论证
- [代码编写规范](docs/代码编写规范.md) —— 全仓编码约束与工具链落地
