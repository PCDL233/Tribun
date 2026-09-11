import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitRunner } from '@ai-review/shared';

const execFileAsync = promisify(execFile);

/**
 * 创建限定仓库目录的 Git 命令执行器。
 * @param repoPath Git 仓库路径
 * @returns 使用参数数组执行 Git 命令的函数
 * @throws {Error} Git 命令失败时透传底层错误
 */
export function createGitRunner(repoPath: string): GitRunner {
  return async (...args: string[]): Promise<string> => {
    const result = await execFileAsync('git', args, {
      cwd: repoPath,
      maxBuffer: 64 * 1024 * 1024,
    });
    return result.stdout;
  };
}

/**
 * 读取暂存区 diff 与 index blob。
 * @throws {Error} Git 仓库无效或命令执行失败
 */
export class GitReader {
  constructor(private readonly git: GitRunner) {}

  /**
   * 读取暂存区快照的 unified diff。
   * @returns 暂存区 diff 文本
   */
  public readStagedDiff(): Promise<string> {
    return this.git('diff', '--cached', '--unified=50');
  }

  /**
   * 读取文件在 index 中的完整内容。
   * @param path 仓库内相对路径
   * @returns index blob 内容；删除文件没有 blob 时返回空串
   */
  public async readStagedFile(path: string): Promise<string> {
    try {
      return await this.git('show', `:${path}`);
    } catch {
      return '';
    }
  }

  /**
   * 读取当前分支名称。
   * @returns 当前分支名称
   */
  public readBranch(): Promise<string> {
    return this.git('branch', '--show-current');
  }
}
