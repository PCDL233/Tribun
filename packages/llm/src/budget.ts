/**
 * 流水线共享的 token 硬预算器（方案 3.3）。
 * 全流水线共享一个实例；预算耗尽时未审查的低优先级文件自动降级为 staticOnly，
 * 并在报告中标注"预算受限，已降级"，保证审查成本有硬上限。
 */
export class TokenBudget {
  private used = 0;

  constructor(
    private readonly max: number,
    private readonly onExhausted?: () => void,
  ) {}

  /**
   * 预留估算额度；余额不足时触发 onExhausted 回调并拒绝。
   * @param estimate 本次调用的预估 token 消耗
   * @returns 是否允许消耗
   */
  public tryReserve(estimate: number): boolean {
    if (this.used + estimate > this.max) {
      this.onExhausted?.();
      return false;
    }
    return true;
  }

  /**
   * 按真实用量记账（AI SDK usage 统计）。
   * @param usage 模型返回的 usage
   */
  public account(usage: { totalTokens: number }): void {
    this.used += usage.totalTokens;
  }

  /** 已消耗比例（0-1），供报告与 Dashboard 展示 */
  public get usageRatio(): number {
    return this.used / this.max;
  }
}
