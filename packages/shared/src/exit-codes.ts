/**
 * CLI 退出码契约（方案 3.11）：脚本与 CI 依赖的稳定接口。
 * 禁止新增退出码或改变语义；任何变更属于破坏性契约变更（规范 §7.6）。
 */
export const EXIT_CODES = {
  /** 审查通过（或无发现超过阻断阈值） */
  ok: 0,
  /** 存在 ≥ blockOn 级别的发现，阻断提交 */
  blocked: 1,
  /** 配置/环境错误（配置校验失败、git 仓库无效等） */
  configError: 2,
  /** 审查超时或被取消（不阻断提交） */
  cancelled: 3,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
