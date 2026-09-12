import { describe, expect, it, vi } from 'vitest';
import { TokenBudget } from '../src/budget.js';

describe('TokenBudget', () => {
  it('reserves estimates so multiple files cannot exceed the hard limit', () => {
    const exhausted = vi.fn();
    const budget = new TokenBudget(100, exhausted);
    expect(budget.tryReserve(60)).toBe(true);
    expect(budget.tryReserve(50)).toBe(false);
    expect(exhausted).toHaveBeenCalledOnce();
    expect(budget.usageRatio).toBe(0.6);
  });

  it('settles reservations with actual usage', () => {
    const budget = new TokenBudget(100);
    expect(budget.tryReserve(60)).toBe(true);
    budget.account({ totalTokens: 40 });
    expect(budget.usageRatio).toBe(0.6);
    expect(budget.tryReserve(40)).toBe(true);
  });
});
