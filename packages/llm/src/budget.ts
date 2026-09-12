/**
 * 流水线共享的 token 硬预算器（方案 3.3）。
 * 全流水线共享一个实例；预算耗尽时未审查的低优先级文件自动降级为 staticOnly，
 * 并在报告中标注"预算受限，已降级"，保证审查成本有硬上限。
 */
export class TokenBudget {
  private used = 0;
  /** 尚未由真实 usage 抵扣的预留估算，保证并行/多文件审查不会突破上限。 */
  private reserved = 0;

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
    if (estimate < 0 || this.used + this.reserved + estimate > this.max) {
      this.onExhausted?.();
      return false;
    }
    this.reserved += estimate;
    return true;
  }

  /**
   * 按真实用量记账（AI SDK usage 统计）。真实用量会优先抵扣未结算的估算预留。
   * @param usage 模型返回的 usage
   */
  public account(usage: { totalTokens: number }): void {
    if (usage.totalTokens < 0) return;
    this.used += usage.totalTokens;
    this.reserved = Math.max(0, this.reserved - usage.totalTokens);
  }

  /** 已消耗/已预留比例（0-1），供报告与 Dashboard 展示 */
  public get usageRatio(): number {
    return Math.min(1, (this.used + this.reserved) / this.max);
  }
}
