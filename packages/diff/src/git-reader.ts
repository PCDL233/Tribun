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
   * 读取 base...HEAD 区间的 unified diff（CI 模式，方案 3.11 `run --base <ref>`）。
   * 三点语法取 merge-base 起算的变更，PR 分支上对 base 的最新提交不产生噪音 diff。
   * @param base 起始引用（分支名 / SHA）
   * @returns 区间 diff 文本
   */
  public readRangeDiff(base: string): Promise<string> {
    return this.git('diff', '--unified=50', `${base}...HEAD`);
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
   * 读取文件在 HEAD 提交中的完整内容（区间模式的"新侧"内容源——
   * 区间审查没有 index 语义，HEAD 即待审内容）。
   * @param path 仓库内相对路径
   * @returns HEAD blob 内容；文件不存在（被删除）时返回空串
   */
  public async readHeadFile(path: string): Promise<string> {
    try {
      return await this.git('show', `HEAD:${path}`);
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
