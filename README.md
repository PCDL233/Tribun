# AI Code Review Agent

基于 Vibe Coding 工作流的 Git 提交 AI 审查与风险分析系统。在开发者执行 `git commit` 时，系统自动读取暂存区变更，结合确定性静态分析与 LLM Agent，从正确性、安全性、性能和可维护性等维度生成结构化报告，并在代码进入仓库之前完成第一轮质量把关。

项目采用全栈 TypeScript 单语言实现（pnpm Monorepo + Turborepo）。`packages/shared` 中的 Zod schema 是配置、API 契约、数据库行类型和前端表单的单一事实源，尽量让契约漂移在编译期被发现。

## 功能总览

- **多 Agent 并行审查**：正确性 / 安全 / 性能三个维度经 LangGraph.js fan-out 并行审查，交叉验证抑制幻觉；低置信度 BLOCKER 支持自愈回退，最多 3 轮。
- **确定性优先**：密钥扫描（CWE-798/321）、圈复杂度和 AST 解析等工具先行，能由确定性工具判断的问题不重复交给 LLM。
- **多语言上下文提取**：JS/TS 使用 ts-morph，Python/Go/Java 使用 Tree-sitter 官方语法包，按函数边界裁剪上下文；解析失败时降级为行级窗口，不阻塞流水线。
- **用户自定义审查规则**：管理员可在后台定义正则规则（名称/严重度/文件过滤/匹配范围），在 static 阶段以确定性工具 `custom_rule_check` 执行，支持在线试跑；保存后下一次审查即生效（服务端热重读配置，无需重启）。
- **风险规划分流**：按 0–100 风险评分选择深度审查、快速审查或仅静态分析；全流程有 token 硬预算，预算耗尽时自动降级并在报告中标注。
- **审查缓存**：按 agent、prompt 版本和代码内容计算哈希，相同代码块可跨审查复用发现，避免重复消耗 LLM。
- **RAG 知识库**：按 AST/文档边界切块，使用 LanceDB 向量检索与 MiniSearch BM25，经 RRF 融合后注入审查上下文；索引按块级内容哈希增量更新。
- **fast / full 双模式**：`fast` 用于 pre-commit，目标耗时 ≤15 秒；`full` 用于 CI 和手动深度审查，目标耗时 ≤60 秒。
- **Web Dashboard**：登录后查看审查历史、五段式报告、diff、行级发现、误报标记、SSE 实时进度和 ECharts 统计分析。
- **团队权限管理**：首个注册用户自动成为管理员；管理员可以查看全量审查数据、管理用户、编辑配置、维护知识库并查看 Prometheus 指标。
- **MCP 工具开放**：通过 stdio MCP Server 暴露静态分析工具，可供 Claude Code 等外部 Agent 复用。
- **可观测性**：提供 `/metrics` Prometheus 指标和 `/api/stats` 统计聚合接口。

## 系统架构

```text
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
│ 数据层：SQLite/Drizzle (users/sessions/reviews/findings/cache)   │
│         LanceDB 向量索引 │ 报告文件 │ Prometheus 指标              │
└─────────────────────────────────────────────────────────────────┘
```

一次审查的业务链路：

1. `git commit` 触发 `.husky/pre-commit`，调用 `ai-review run --staged`。
2. Git Reader 读取 index 快照，而不是工作区未暂存内容；diff 按文件和函数边界构建上下文。
3. 风险规划器按文件评分，选择深度审查、快速审查或仅静态分析。
4. 正确性、安全、性能 Agent 并行执行，并受 token 预算和取消信号约束。
5. 交叉验证阶段重分类严重度、计算置信度、去重并排序；低置信度 BLOCKER 进入自愈重审。
6. 生成 Markdown、HTML 或 JSON 报告，按 `blockOn` 阈值决定退出码。
7. 结果写入 SQLite，审查缓存复用已有发现，Dashboard 通过 SSE 接收进度。

模式差异：

| 环节             | `fast`（pre-commit 默认） | `full`（CI / 手动）            |
| ---------------- | ------------------------- | ------------------------------ |
| 目标             | 尽快反馈，不拖慢提交      | 更完整的上下文和审查覆盖       |
| 风险较低文件     | 优先静态分析              | 仍可进入 LLM 审查              |
| RAG / 历史上下文 | 按配置使用，控制上下文    | 按配置使用，允许更充分的上下文 |
| 适用场景         | 本地提交前门禁            | PR、发布前或手动专项审查       |

## 技术栈

| 层次       | 技术                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------- |
| 运行时     | Node.js ≥22、TypeScript 6、ESM                                                            |
| Monorepo   | pnpm 10.24.0、Turborepo                                                                   |
| CLI        | Commander、@clack/prompts                                                                 |
| Agent 编排 | LangGraph.js、AI SDK 5                                                                    |
| 模型       | Anthropic、OpenAI、国内主流（DeepSeek/智谱/Moonshot/通义千问/豆包/MiniMax）、Ollama、mock |
| 静态分析   | ts-morph、Tree-sitter、确定性 secret/complexity 工具                                      |
| RAG        | LanceDB、MiniSearch、RRF                                                                  |
| 服务端     | Hono 4、REST、SSE、Prometheus                                                             |
| 数据库     | Drizzle ORM、better-sqlite3、SQLite                                                       |
| 前端       | React 19、Vite 8、TanStack Router/Query、Ant Design 6、ECharts                            |
| 部署       | Docker multi-stage、`node:22-alpine`                                                      |

第三方依赖版本集中声明在 `pnpm-workspace.yaml` 的 `catalog`，各 workspace 包使用 `catalog:` 引用。

## Monorepo 结构

```text
apps/
  cli/       @ai-review/cli     —— Git Hook 与命令行入口
  server/    @ai-review/server  —— Hono API、SSE、/metrics、静态文件托管
  web/       @ai-review/web     —— React 19 Dashboard（Vite + Ant Design + ECharts）
packages/
  shared/    配置、API、Finding、退出码等 Zod schema 单一事实源
  diff/      unified diff、index/HEAD 内容读取、上下文提取
  core/      LangGraph 流水线、风险规划、交叉验证、审查缓存接口
  agents/    ReAct 审查 Agent
  tools/     静态分析工具总线与 MCP stdio Server
  rag/       LanceDB + MiniSearch RAG 索引与检索
  llm/       Provider 封装、mock/录制回放、token 预算器
  db/        Drizzle ORM + SQLite（用户、会话、审查和缓存）
  report/    Markdown / HTML / JSON 报告渲染

tooling/
  eslint-config/ —— 全仓 ESLint 配置
  tsconfig/      —— 共享 TypeScript 配置
```

## 快速开始

### 1. 安装依赖

前置要求：Node.js `>=22`。根 `package.json` 固定使用 pnpm `10.24.0`，推荐通过 Corepack 激活：

```bash
corepack enable
pnpm install
pnpm build
```

如果只需要执行测试或检查，也可以使用：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

### 2. 初始化配置

在项目根目录运行交互式向导：

```bash
pnpm exec ai-review init
```

该命令根据 `AiReviewConfigSchema` 生成 `.ai-review.yml`。密钥字段支持 `${ENV_NAME}` 引用，请不要把明文 API Key 提交到 Git。

最小的云端模型配置示例：

```bash
# PowerShell
$env:AI_REVIEW_API_KEY = "your-api-key"

# bash/zsh
export AI_REVIEW_API_KEY="your-api-key"
```

默认 provider 是 `anthropic`。也可以把 `llm.provider` 改为 `openai`、`deepseek`、`zhipu`、`moonshot`、`dashscope`、`volcengine`、`minimax`、`ollama` 或 `mock`。其中 `mock` 不访问网络，适合离线验证流水线和运行确定性测试。

### 3. 本地运行 Dashboard

开发环境使用 `pnpm dev` 同时启动 API Server 和 Vite：

```bash
pnpm dev
```

- Web Dashboard：<http://localhost:5173>
- API Server：<http://localhost:8080>
- 开发期 Vite 将 `/api` 代理到 `http://localhost:8080`。
- `pnpm dev` 会按 Turbo 依赖图先构建所需 workspace；如果手动直接运行 `apps/server`，请先执行 `pnpm build` 生成 `dist`。

### 4. 执行第一次审查

```bash
# 审查当前暂存区，默认 fast 模式
pnpm exec ai-review run --staged

# 本地执行 full 模式
pnpm exec ai-review run --staged --mode full

# 安装 pre-commit hook（先确保项目已启用 husky v9）
pnpm exec husky init
pnpm exec ai-review install-hook
```

`install-hook` 会写入 `.husky/pre-commit`。Hook 只审查暂存区，发现达到 `BLOCKER` 阻断阈值时退出码为 1。

### 5. 首次启动团队版

启动 API 和 Dashboard 同端口服务：

```bash
pnpm exec ai-review server --port 8080 --web-dist apps/web/dist
```

首次打开 <http://localhost:8080> 时注册第一个账号。第一个注册账号自动获得 `admin` 角色，建议部署后立即完成注册并安全保存凭据；项目不提供固定的默认管理员密码。之后注册的账号默认是普通用户。

## CLI 使用指南

CLI 二进制名为 `ai-review`。在当前 Monorepo 中可以使用 `pnpm exec ai-review`，构建并将包加入 PATH 后可直接使用 `ai-review`。

### `ai-review run` —— 执行审查

| 选项                    | 说明                                                    |
| ----------------------- | ------------------------------------------------------- |
| `--staged`              | 审查暂存区 diff；默认开启                               |
| `--base <ref>`          | CI 模式：审查 `<ref>...HEAD` 区间变更                   |
| `--config <file>`       | 配置文件路径，默认 `.ai-review.yml`                     |
| `--mode <mode>`         | `fast` 或 `full`；未传时读取配置                        |
| `--block-on <severity>` | 阻断阈值：`BLOCKER`、`WARNING` 或 `NIT`；未传时读取配置 |
| `--json`                | 输出 JSON，便于 CI 或脚本消费                           |

常用示例：

```bash
# pre-commit / 本地增量审查
pnpm exec ai-review run --staged

# CI 审查 base 与 HEAD 之间的变更
pnpm exec ai-review run --base origin/main --mode full --block-on BLOCKER --json > .ai-review-reports/latest.json
```

稳定退出码：

| 退出码 | 含义                                                     |
| ------ | -------------------------------------------------------- |
| `0`    | 没有发现达到阻断阈值的 Finding                           |
| `1`    | 存在达到 `blockOn` 级别的发现，阻断提交或 CI 步骤        |
| `2`    | 配置或环境错误，例如配置校验失败、Git 仓库无效或参数缺失 |
| `3`    | 审查超时或被取消；默认不作为缺陷阻断提交                 |

### `ai-review init` —— 初始化配置

交互式生成 `.ai-review.yml`。文件已存在时会先询问是否覆盖；取消操作会保留原文件。

### `ai-review install-hook` —— 安装 Git Hook

写入 `.husky/pre-commit`，使用 fast 模式和 `BLOCKER` 阻断阈值。前提是仓库已经通过 `pnpm exec husky init` 激活 husky v9 的 `core.hooksPath`。

### `ai-review index` —— 构建 RAG 知识库索引

| 选项                 | 说明                                                       |
| -------------------- | ---------------------------------------------------------- |
| `--paths <paths...>` | 必填；纳入索引的文件或目录，目录递归扫描并跳过常见生成目录 |
| `--model <model>`    | 嵌入模型 ID；默认本地 Ollama `nomic-embed-text`            |
| `--base-url <url>`   | OpenAI-compatible 嵌入端点                                 |
| `--config <file>`    | 配置文件路径，默认 `.ai-review.yml`                        |

默认端点为 `http://127.0.0.1:11434/v1`。执行索引前，请确保 Ollama 已启动并已准备对应 embedding 模型，或通过 `--base-url` 指向可用的 OpenAI-compatible embedding 服务：

```bash
pnpm exec ai-review index --paths docs/ CLAUDE.md src/
```

索引按块级内容哈希增量更新，重复执行不会重复处理未变化内容。

### `ai-review server` —— 启动团队版服务

| 选项               | 说明                                                  |
| ------------------ | ----------------------------------------------------- |
| `--port <port>`    | 监听端口，默认 `8080`                                 |
| `--db <file>`      | SQLite 数据库路径，默认 `.ai-review-cache/reviews.db` |
| `--web-dist <dir>` | Dashboard 静态产物目录；传入后由同一端口托管前端      |
| `--config <file>`  | 配置文件路径，默认 `.ai-review.yml`                   |

生产形态建议先构建前端，再运行：

```bash
pnpm --filter @ai-review/web build
pnpm exec ai-review server --port 8080 --web-dist apps/web/dist
```

#### 服务端环境变量

| 变量                         | 默认值       | 说明                                                                                                  |
| ---------------------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| `AI_REVIEW_ALLOWED_ROOTS`    | `cwd`        | 允许发起审查的仓库根目录白名单，多个用路径分隔符分隔（Windows `;` / POSIX `:`）；越界路径一律 400     |
| `AI_REVIEW_MAX_CONCURRENT`   | `3`          | 并行审查任务上限（信号量排队，防压垮 LLM 配额）                                                       |
| `AI_REVIEW_COOKIE_SECURE`    | 关           | `true` 时强制会话 Cookie 携带 `Secure`（NODE_ENV=production 下自动开启）                               |
| `AI_REVIEW_ALLOW_REGISTER`   | 关           | `true` 时放开开放注册；缺省仅在无任何用户时允许（首个管理员引导后自动关闭）                            |
| `AI_REVIEW_TRUST_PROXY`      | 关           | 反向代理（nginx 等）部署时开启：限流改用 `X-Forwarded-For` 末值识别真实客户端 IP，避免全员共享代理 IP 的限流桶 |
| `AI_REVIEW_API_KEY`          | 无           | 模型 API Key，配合配置文件的 `${AI_REVIEW_API_KEY}` 引用；切勿写入仓库                                 |

Docker 镜像默认 `NODE_ENV=production`，会话 Cookie 自动启用 `Secure`；若在 http 反向代理后部署，请同时设置 `AI_REVIEW_COOKIE_SECURE=false` 并配合 `AI_REVIEW_TRUST_PROXY=true`。

### `ai-review mcp` —— 对外开放工具

以 stdio MCP Server 暴露静态分析工具。客户端配置示例：

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

当前工具：

| 工具               | 入参                      | 输出                                  |
| ------------------ | ------------------------- | ------------------------------------- |
| `complexity_check` | `file_path`、`threshold?` | 超过阈值的函数名称、行号和复杂度      |
| `secret_scan`      | `diff_text`               | 疑似密钥/凭证、严重度、CWE 和修复建议 |

## 配置文件（`.ai-review.yml`）

所有字段都可以省略，省略时使用 schema 默认值。`loadConfig` 会递归解析 `${ENV_NAME}`，配置校验失败会给出字段级错误，CLI 使用退出码 `2`。示例：

```yaml
llm:
  provider: anthropic # anthropic | openai | deepseek | zhipu | moonshot | dashscope | volcengine | minimax | ollama | mock
  model: claude-sonnet-5
  apiKey: ${AI_REVIEW_API_KEY}
  maxTokensPerReview: 50000
  temperature: 0.1
  mockFixturesDir: .ai-review-cache/llm-fixtures

review:
  mode: fast # fast | full
  dimensions: [correctness, security, performance, maintainability]
  blockOn: BLOCKER # BLOCKER | WARNING | NIT
  ignorePatterns: ['*.lock', 'pnpm-lock.yaml', 'dist/**', '*.min.js']

rag:
  enabled: true
  knowledgeBasePaths: ['docs/']
  indexDir: .ai-review-cache/vectors
  topK: 5

staticAnalysis:
  enabledTools: [ast_parse, complexity_check, secret_scan, dependency_scan, custom_rule_check]
  complexityThreshold: 15

# 用户自定义审查规则（管理员在后台维护，随配置生效；匹配范围：added 新增行 / staged 文件全文 / snippet 函数片段）
# 保存后下一次审查立即生效（服务端热重读，无需重启）；存在启用规则时 custom_rule_check 自动参与，无需在 enabledTools 单独开启。
# pattern 为正则源码（≤1024 字符），非法表达式在保存/试跑时即被拒绝；规则在审查路径逐行执行，请避免灾难性回溯的正则。
customRules:
  - name: no-todo
    description: 禁止提交遗留的 TODO/FIXME 标记
    pattern: '\b(TODO|FIXME)\b'
    flags: i
    severity: WARNING
    message: 检测到遗留的 TODO 标记
    suggestion: 清理注释或创建跟踪任务后删除
    filePatterns: ['src/**']
    matchScope: [added]
    enabled: true

report:
  format: markdown # markdown | html | json
  outputDir: .ai-review-reports
  includePraise: true
```

LLM Provider 端点：

| Provider  | 默认端点                                            | 可选环境变量                    |
| --------- | --------------------------------------------------- | ------------------------------- |
| Anthropic | `https://api.anthropic.com/v1`                      | `AI_REVIEW_ANTHROPIC_BASE_URL`  |
| OpenAI    | `https://api.openai.com/v1`                         | `AI_REVIEW_OPENAI_BASE_URL`     |
| DeepSeek  | `https://api.deepseek.com/v1`                       | `AI_REVIEW_DEEPSEEK_BASE_URL`   |
| 智谱 GLM  | `https://open.bigmodel.cn/api/paas/v4`              | `AI_REVIEW_ZHIPU_BASE_URL`      |
| Moonshot  | `https://api.moonshot.cn/v1`                        | `AI_REVIEW_MOONSHOT_BASE_URL`   |
| 通义千问  | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `AI_REVIEW_DASHSCOPE_BASE_URL`  |
| 豆包      | `https://ark.cn-beijing.volces.com/api/v3`          | `AI_REVIEW_VOLCENGINE_BASE_URL` |
| MiniMax   | `https://api.minimax.chat/v1`                       | `AI_REVIEW_MINIMAX_BASE_URL`    |
| Ollama    | `http://127.0.0.1:11434/v1`                         | `AI_REVIEW_OLLAMA_BASE_URL`     |

Ollama 的默认模型回退为 `qwen3-coder:30b`，可用 `AI_REVIEW_OLLAMA_MODEL` 覆盖。云端 provider 未配置真实 Key 时，系统会尝试本地 Ollama；若仍不可用，则保留确定性静态分析和 mock fallback。生产环境仍应显式配置可用的模型服务。

严重度分级：`BLOCKER`（阻断级缺陷）/ `WARNING`（应修复）/ `NIT`（建议）/ `PRAISE`（正面反馈）。

## 认证与权限

服务端使用 SQLite 保存用户和会话，登录态通过 HttpOnly Cookie `ai_review_session` 传递，默认有效期为 7 天。SSE 使用同一 Cookie 认证，因此浏览器 Dashboard 无需额外维护 Authorization Header。

- `/api/auth/register` 和 `/api/auth/login` 可匿名访问，其余 `/api` 接口默认要求登录。
- 首个注册用户自动成为 `admin`；后续注册用户为 `user`。
- 普通用户只能查看、重新执行、取消、导出和删除自己发起的审查，并只能修改自己审查中的误报标记。
- 管理员可以查看全量审查数据、修改用户角色和状态、重置密码、删除其他用户、编辑项目配置、重建 RAG 知识库和查看系统指标。
- 管理员不能通过后台删除自己或将自己降级/禁用，避免锁死最后的管理入口。
- 后台重置密码会生成一次性随机密码并立即吊销目标用户的旧会话；请通过安全渠道交付新密码。

首次部署建议：

1. 先限制服务访问范围或放在可信网络内。
2. 使用浏览器注册第一个管理员账号，并立即保存账号信息。
3. 在管理后台配置模型、审查规则和知识库路径。
4. 根据团队需要注册普通用户，再由管理员分配角色或禁用账号。

项目不提供默认管理员用户名或默认密码，也不会在日志或 API 响应中返回密码哈希。

## Web Dashboard

开发环境访问 <http://localhost:5173>，生产环境访问服务端托管地址 <http://localhost:8080>。页面按登录状态和角色分为两组：

### 用户端

1. **登录 / 注册**：建立 7 天 HttpOnly Cookie 会话。
2. **审查工作区**：发起审查、查看运行状态和取消任务。
3. **审查历史**：按状态和分页查看当前用户可见的审查记录。
4. **报告详情**：查看五段式报告、完整 diff、行级 Findings，支持标记误报、重新执行和导出。
5. **统计分析**：查看审查数量、发现数量、误报数量、平均风险分、平均耗时、Token 消耗、按日趋势、严重度分布和 Top 高风险文件。
6. **个人资料**：查看当前账号并修改密码；修改密码会吊销旧会话。

### 管理后台（仅 admin）

1. **系统概览**：查看用户数、管理员数、审查数、发现数、Token 消耗、缓存摘要和最近失败记录。
2. **用户管理**：查看用户列表，修改角色/状态，重置密码或删除其他用户。
3. **配置管理**：读取并保存 `.ai-review.yml`；API Key 在页面中以 `********` 掩码显示，提交掩码值会保留原密钥。
4. **自定义规则**：查看、新增、编辑、删除和启停自定义审查规则，并可粘贴示例 diff / 源码在线试跑验证正则命中。
5. **知识库管理**：查看索引状态并异步触发 RAG 增量重建。

## HTTP API

所有非 `/api/auth/*` 的 `/api` 路由都需要有效登录会话；管理员路由额外需要 `admin` 角色。除特别说明外，响应形状由 `@ai-review/shared` 的 Zod schema 定义。

### 认证

| 路由                        | 方法 | 说明                                     |
| --------------------------- | ---- | ---------------------------------------- |
| `/api/auth/register`        | POST | 注册；首个用户自动成为 admin，并建立会话 |
| `/api/auth/login`           | POST | 登录并建立 Cookie 会话                   |
| `/api/auth/logout`          | POST | 登出并清理当前会话                       |
| `/api/auth/me`              | GET  | 获取当前登录用户                         |
| `/api/auth/change-password` | POST | 修改当前用户密码并吊销旧会话             |

### 审查与统计

| 路由                                                  | 方法   | 说明                                                 |
| ----------------------------------------------------- | ------ | ---------------------------------------------------- |
| `/api/reviews`                                        | POST   | 发起审查，返回 `202 + { reviewId }`                  |
| `/api/reviews`                                        | GET    | 审查历史列表；普通用户仅返回本人记录，支持查询和分页 |
| `/api/reviews/:id`                                    | GET    | 五段式报告详情与行级 findings                        |
| `/api/reviews/:id/diff`                               | GET    | 获取审查使用的 diff                                  |
| `/api/reviews/:id/events`                             | GET    | 审查进度 SSE                                         |
| `/api/reviews/:id/rerun`                              | POST   | 重新执行可访问的审查，返回 `202 + { reviewId }`      |
| `/api/reviews/:id/cancel`                             | POST   | 取消正在运行的审查                                   |
| `/api/reviews/:id/export?format=markdown\|html\|json` | GET    | 导出报告，默认 Markdown                              |
| `/api/reviews/:id`                                    | DELETE | 删除可访问的审查记录                                 |
| `/api/findings/:id`                                   | PATCH  | 更新误报标记，请求体 `{ "isFalsePositive": true }`   |
| `/api/stats`                                          | GET    | 统计聚合；普通用户仅统计本人数据                     |

### 管理与运维（仅 admin）

| 路由                                  | 方法   | 说明                                          |
| ------------------------------------- | ------ | --------------------------------------------- |
| `/api/admin/overview`                 | GET    | 系统概览、缓存摘要和最近失败记录              |
| `/api/admin/users`                    | GET    | 用户列表                                      |
| `/api/admin/users/:id`                | PATCH  | 修改用户角色或 active/disabled 状态           |
| `/api/admin/users/:id/reset-password` | POST   | 重置密码并返回新随机密码；旧会话立即失效      |
| `/api/admin/users/:id`                | DELETE | 删除其他用户及其会话                          |
| `/api/admin/config`                   | GET    | 读取已掩码的项目配置                          |
| `/api/admin/config`                   | PUT    | 更新项目配置；`apiKey: "********"` 保留原密钥 |
| `/api/admin/knowledge`                | GET    | 查看知识库索引状态                            |
| `/api/admin/knowledge/reindex`        | POST   | 异步接受知识库增量重建任务，返回 `202`        |
| `/api/admin/rules`                    | GET    | 自定义审查规则列表                            |
| `/api/admin/rules`                    | PUT    | 整体保存自定义审查规则（随配置持久化）        |
| `/api/admin/rules/test`               | POST   | 试跑规则：`{ rule, sampleDiffText?, sampleSource? }` 返回命中行 |
| `/metrics`                            | GET    | Prometheus 文本格式指标                       |

SSE 事件通过 `event` + JSON `data` 发送：

| event        | 主要字段                                            | 说明                                                                                                        |
| ------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `subscribed` | `reviewId`                                          | 客户端订阅成功                                                                                              |
| `stage`      | `reviewId`, `stage`                                 | 流水线阶段开始：parse / riskPlan / correctness / security / performance / static / validate / heal / report |
| `completed`  | `reviewId`, `riskScore`, `blockerCount`, `blocking` | 审查完成；`blocking` 与 CLI 退出码 1 语义一致                                                               |
| `failed`     | `reviewId`, `message`                               | 审查失败                                                                                                    |
| `cancelled`  | `reviewId`                                          | 审查被取消                                                                                                  |

## Prometheus 指标

`/metrics` 仅管理员可读，输出 Prometheus 文本格式：

| 指标                                | 类型      | 标签                       | 说明                          |
| ----------------------------------- | --------- | -------------------------- | ----------------------------- |
| `ai_review_reviews_total`           | Counter   | `status=completed\|failed` | 审查终态计数                  |
| `ai_review_findings_total`          | Counter   | `severity`                 | 按严重度统计发现              |
| `ai_review_tokens_used_total`       | Counter   | —                          | LLM token 累计消耗            |
| `ai_review_review_duration_seconds` | Histogram | —                          | 端到端审查耗时                |
| 默认进程指标                        | —         | —                          | CPU、GC、事件循环等运行时指标 |

## 审查缓存与 RAG 索引

- **审查缓存**：键包含 agent、prompt 版本和代码内容，与仓库路径无关；相同代码块可以跨审查、跨仓库复用。prompt 或输出契约变化时递增 `REVIEW_PROMPT_VERSION`，缓存自动失效。
- **RAG 索引**：默认持久化到 `.ai-review-cache/vectors`，知识库路径由 `rag.knowledgeBasePaths` 指定。执行 `ai-review index` 后只重新向量化新增或变化的块。
- **运行时降级**：索引或模型服务不可用不会改变确定性静态分析的职责；报告会保留可用结果并标注受限阶段。

## 基准测试与测试策略

`packages/core/test/benchmark.test.ts` 内置 CWE 锚定语料（CWE-798 硬编码凭证、CWE-321 私钥块、CWE-657 复杂度超标），度量静态分析层的 recall / precision / F1，作为回归门禁。当前基线为 recall `1.0`、precision `0.8`、F1 约 `0.89`；唯一已知误报是占位符凭据。

LLM 集成测试使用 `packages/llm` 的录制/回放 Provider：首次真实调用将响应保存为 fixture，后续测试直接回放，保证确定性并避免重复消耗 token。

## Docker 部署

项目提供单容器部署方式：API、Dashboard 和 SQLite 审查库一起运行。

```bash
docker compose up --build
```

启动后访问 <http://localhost:8080>。Compose 会把 `.ai-review-cache` 挂载到名为 `review-data` 的 volume，因此 SQLite、审查缓存和向量索引不会因容器重建而丢失。

实现细节：

- build 阶段使用 `corepack pnpm install --frozen-lockfile` 和 `pnpm turbo build --filter=@ai-review/server... --filter=@ai-review/web...`。
- 运行阶段基于 `node:22-alpine`，并复制 server/web 与 workspace 包的构建产物。
- `better-sqlite3` 没有可用预编译包时，构建阶段会使用预装的 `python3`、`make`、`g++` 编译。
- Compose 当前不自动注入模型 API Key；需要通过配置文件、环境变量或管理后台配置可用的 provider。
- PostgreSQL / Redis 不是当前单容器部署的必需依赖，属于团队版多机部署扩展方向。

## CI/CD 集成

- `.github/workflows/ci.yml`：push / PR 执行 lint、typecheck、build 和 test 全量门禁。
- `.github/workflows/ai-review.yml`：PR 触发 `ai-review run --base origin/<base> --mode full --json`，将风险评分、BLOCKER 数和发现明细回帖到 PR。
- 当审查发现达到阻断阈值时 CLI 返回退出码 1；工作流应将该结果作为审查结论处理，而不是误判为基础设施故障。

## 开发指南

```bash
pnpm dev         # Turbo 并行启动 server 与 web
pnpm build       # 按依赖图构建所有 workspace
pnpm lint        # ESLint flat config
pnpm typecheck   # Turbo typecheck
pnpm test        # Turbo test
pnpm format      # Prettier --write（会修改文件）
```

代码约定（详见[代码编写规范](docs/代码编写规范.md)）：

- 依赖版本只声明在 `pnpm-workspace.yaml` 的 `catalog`，包内以 `catalog:` 引用。
- 禁止 `any`、`as` 断言和 `@ts-ignore`；导出函数显式声明返回类型；类型从 Zod schema 推导。
- 提交信息遵循 Conventional Commits：`<type>(<scope>): <subject>`，scope 使用包短名。
- 新增 Turbo 任务或 workspace 包时同步更新任务依赖图与文档。

## 故障排查

| 现象                                    | 处理方式                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Cannot find .../dist` 或服务启动即退出 | 先运行 `pnpm build`；`pnpm dev` 会自动按 Turbo 依赖图构建，但直接运行 server 不会                           |
| 8080/5173 已被占用                      | 使用 `ai-review server --port <port>` 修改 API 端口；开发期 Vite 代理也要同步调整 `apps/web/vite.config.ts` |
| `better-sqlite3` 安装失败               | 使用 Node.js 22，并重新执行 `pnpm install`；Linux/alpine 构建需有 `python3`、`make`、`g++`                  |
| 云端 provider 报 API Key 错误           | 确认 `AI_REVIEW_API_KEY` 已导出，且 `.ai-review.yml` 使用 `${AI_REVIEW_API_KEY}`；不要把 Key 写进仓库       |
| 选择 Ollama 但连接失败                  | 启动 Ollama，确认默认 `http://127.0.0.1:11434/v1` 可访问，并准备模型；也可设置 `AI_REVIEW_OLLAMA_BASE_URL`  |
| `ai-review index` 失败                  | 确认 embedding 服务可用、`--paths` 不为空，并检查 `--base-url` 与 embedding 模型是否匹配                    |
| Dashboard 请求 401/403                  | 先登录；普通用户不能访问 `/api/admin/*` 或 `/metrics`，被禁用用户需要管理员恢复状态                         |
| 前端打开但 API 请求失败                 | 开发环境确认 server 在 8080；生产环境使用 `--web-dist apps/web/dist`，不要把 Vite 开发代理配置当作生产代理  |
| Docker 重建后数据看似丢失               | 确认使用 `docker compose up`，不要删除 `review-data` volume；检查 `/app/.ai-review-cache` 挂载状态          |

## 文档

- [项目实现方案](docs/项目实现方案.md) —— 系统架构、核心模块设计与选型论证
- [代码编写规范](docs/代码编写规范.md) —— 全仓编码约束与工具链落地
