import type { ReviewCache } from '@ai-review/core';
import type { Finding } from '@ai-review/shared';
import type { ReviewStore } from '@ai-review/db';

/**
 * SQLite 落地的审查缓存（方案 3.0 步骤 8），实现 core 的 ReviewCache 接口——
 * core 依赖接口而非本类（规范 §4.1 依赖倒置），server 负责装配。
 */
export class StoreReviewCache implements ReviewCache {
  constructor(private readonly store: ReviewStore) {}

  public async get(key: string): Promise<Finding[] | undefined> {
    return this.store.getCachedFindings(key);
  }

  public async set(key: string, findings: Finding[], tokenSaved: number): Promise<void> {
    // 键级 insert or replace 由 store 承担；reviewId 不传——缓存以内容哈希寻址，与单次审查弱关联
    this.store.saveCacheEntries(undefined, [{ cacheKey: key, findings, tokenSaved }]);
  }
}

/** 创建基于审查存储的缓存实例（与 reviews.db 同库，随项目目录持久化） */
export function createStoreReviewCache(store: ReviewStore): StoreReviewCache {
  return new StoreReviewCache(store);
}
