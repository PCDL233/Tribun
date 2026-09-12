import type { FileHistory, GitRunner } from '@ai-review/shared';

/**
 * 基于 git log 的文件热度实现。
 * 按文件缓存查询结果，避免一次审查中风险规划阶段重复启动 git 子进程。
 */
export class GitFileHistory implements FileHistory {
  private readonly cache = new Map<string, number>();

  constructor(private readonly git: GitRunner) {}

  public async changeFrequency(path: string, days: number): Promise<number> {
    const windowDays = Math.max(1, Math.floor(days));
    const key = `${windowDays}:${path}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    try {
      const output = await this.git(
        'log',
        `--since=${windowDays} days ago`,
        '--format=',
        '--name-only',
        '--',
        path,
      );
      const count = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line === path).length;
      this.cache.set(key, count);
      return count;
    } catch {
      // 历史记录属于风险加权的增强信息；仓库无 HEAD 或 git log 失败时不阻塞审查。
      this.cache.set(key, 0);
      return 0;
    }
  }
}

/** 从现有 GitRunner 装配文件热度实现，方便 CLI/server 依赖注入。 */
export function createFileHistory(git: GitRunner): FileHistory {
  return new GitFileHistory(git);
}
