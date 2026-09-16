import type { CodeContext, Finding } from '@ai-review/shared';
import { complexityFindings } from './complexity.js';
import { scanSecrets } from './secret-scan.js';
import { dependencyFindings } from './dependency-scan.js';
import { astFindings } from './ast-parse.js';

/**
 * 进程内静态分析工具（方案 3.4 工具总线）。
 * 确定性工具对 CodeContext 产出 Finding，与 LLM 发现共享同一数据结构；
 * 对外经 MCP 暴露时复用同一实现（packages/tools 的 mcp-server，后续里程碑）。
 */
export type StaticTool = {
  readonly name: string;
  readonly description: string;
  run(context: CodeContext): Finding[];
};

/** 工具注册表：Agent 与流水线经注册表调用工具，禁止绕过总线直接 import 实现（规范 §6.5） */
export class ToolRegistry {
  private readonly tools = new Map<string, StaticTool>();

  /** @param tool 注册的工具；同名注册覆盖（幂等装配） */
  public register(tool: StaticTool): void {
    this.tools.set(tool.name, tool);
  }

  /** @returns 已注册工具名的稳定排序列表 */
  public list(): string[] {
    return [...this.tools.keys()].sort();
  }

  /**
   * 依配置顺序运行启用的工具并汇总发现。
   * @param context 审查上下文
   * @param enabledTools 启用的工具名；省略时运行全部
   * @returns 全部静态分析发现
   */
  public runAll(context: CodeContext, enabledTools?: readonly string[]): Finding[] {
    const enabled = enabledTools === undefined ? this.tools.keys() : enabledTools;
    return [...enabled].flatMap((name) => this.tools.get(name)?.run(context) ?? []);
  }
}

/** 默认复杂度阈值，与配置 schema staticAnalysis.complexityThreshold 默认值一致 */
export const DEFAULT_COMPLEXITY_THRESHOLD = 15;

/**
 * 装配默认工具集：AST、复杂度、密钥与离线依赖 advisory 检查。
 * @param options 复杂度阈值等工具参数
 * @returns 含默认工具的注册表
 */
export function buildDefaultRegistry(options?: { complexityThreshold?: number }): ToolRegistry {
  const threshold = options?.complexityThreshold ?? DEFAULT_COMPLEXITY_THRESHOLD;
  const registry = new ToolRegistry();
  registry.register({
    name: 'ast_parse',
    description: 'Parse changed JS/TS files and detect syntax errors or empty catch blocks.',
    run: (context) => astFindings(context.files),
  });
  registry.register({
    name: 'complexity_check',
    description: 'List functions whose cyclomatic complexity exceeds the threshold.',
    run: (context) => complexityFindings(context.files, threshold),
  });
  registry.register({
    name: 'secret_scan',
    description: 'Detect hardcoded secrets and credentials in changed lines.',
    run: (context) => scanSecrets(context.files),
  });
  registry.register({
    name: 'dependency_scan',
    description: 'Check changed package manifests against the bundled offline advisory set.',
    run: (context) => dependencyFindings(context.files),
  });
  return registry;
}
