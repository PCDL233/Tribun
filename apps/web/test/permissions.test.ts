import { describe, expect, it } from 'vitest';
import { canAccessPath } from '../src/permissions';

const DEFAULT_USER_PERMISSIONS = ['/', '/run', '/reviews', '/stats', '/profile'];

describe('canAccessPath', () => {
  it('恒允许访问首页 /', () => {
    expect(canAccessPath([], '/')).toBe(true);
    expect(canAccessPath(['/'], '/')).toBe(true);
  });

  it('精确匹配的权限路径允许访问', () => {
    expect(canAccessPath(DEFAULT_USER_PERMISSIONS, '/reviews')).toBe(true);
    expect(canAccessPath(DEFAULT_USER_PERMISSIONS, '/run')).toBe(true);
  });

  it('动态子路径按父级前缀授权（如 /reviews/<id>）', () => {
    expect(canAccessPath(DEFAULT_USER_PERMISSIONS, '/reviews/abc123')).toBe(true);
    expect(canAccessPath(DEFAULT_USER_PERMISSIONS, '/reviews/abc123/')).toBe(true);
    expect(canAccessPath(DEFAULT_USER_PERMISSIONS, '/stats/2026/09')).toBe(true);
  });

  it('未授权路径仍拒绝访问', () => {
    expect(canAccessPath(DEFAULT_USER_PERMISSIONS, '/admin')).toBe(false);
    expect(canAccessPath(DEFAULT_USER_PERMISSIONS, '/admin/users')).toBe(false);
    expect(canAccessPath(DEFAULT_USER_PERMISSIONS, '/admin/rules')).toBe(false);
    expect(canAccessPath(DEFAULT_USER_PERMISSIONS, '/unknown')).toBe(false);
    expect(canAccessPath(['/reviews'], '/reviewsx')).toBe(false);
  });

  it('自定义规则页需显式授权（含动态子路径前缀规则）', () => {
    expect(canAccessPath(['/admin/rules'], '/admin/rules')).toBe(true);
    expect(canAccessPath(['/admin'], '/admin/rules')).toBe(true);
    expect(canAccessPath(['/admin/rules'], '/admin')).toBe(false);
  });

  it('登录日志/操作日志页需各自独立授权', () => {
    expect(canAccessPath(['/admin/login-logs'], '/admin/login-logs')).toBe(true);
    expect(canAccessPath(['/admin/operation-logs'], '/admin/operation-logs')).toBe(true);
    // 仅持有其中一个日志权限时，另一个不可访问
    expect(canAccessPath(['/admin/login-logs'], '/admin/operation-logs')).toBe(false);
    expect(canAccessPath(['/admin/operation-logs'], '/admin/login-logs')).toBe(false);
    // admin 角色（'*'）恒可访问
    expect(canAccessPath(['*'], '/admin/login-logs')).toBe(true);
    expect(canAccessPath(['*'], '/admin/operation-logs')).toBe(true);
  });

  it("'*' 恒允许访问任意路径", () => {
    expect(canAccessPath(['*'], '/reviews/abc123')).toBe(true);
    expect(canAccessPath(['*'], '/admin/users')).toBe(true);
    expect(canAccessPath(['*'], '/does-not-exist')).toBe(true);
  });

  it('仅持有 / 权限时不允许访问其他路径（避免子路径误放行）', () => {
    expect(canAccessPath(['/'], '/reviews/abc123')).toBe(false);
    expect(canAccessPath(['/'], '/reviews')).toBe(false);
  });
});
