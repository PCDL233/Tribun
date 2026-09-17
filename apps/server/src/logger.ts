import { appendFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 审计日志输出器（参照大厂日志规范：结构化字段 + 按日滚动归档）。
 * - 控制台：单行可读文本（含时间/类型/状态/操作者/IP 等），便于人工排查与管道采集
 * - 文件：JSON Lines（每行一个完整事件对象），按自然日滚动到 <dir>/ai-review-<kind>-YYYY-MM-DD.log，
 *   超过保留天数（maxDays）的旧文件在滚动时自动清理
 * 写入采用追加模式（appendFileSync），审计事件低频，无需流缓存；目录不存在时自动创建。
 */

export type AuditLogKind = 'login' | 'operation';

/** 统一的审计事件字段（登录/操作日志共用，参照云审计事件规范） */
export type AuditLogEntry = {
  kind: AuditLogKind;
  level: 'info' | 'warn';
  /** 操作者用户 id；匿名（如登录失败）为 null */
  userId: string | null;
  username: string;
  action: string;
  /** 资源类型（user/role/config/rules/review/finding/knowledge/auth） */
  resource: string;
  resourceId: string;
  /** 操作摘要 JSON；不记录密码/令牌等敏感信息 */
  detail: string;
  status: 'success' | 'failed';
  reason: string | null;
  ip: string;
  userAgent: string;
  createdAt: string;
};

export interface LoggerOptions {
  /** 是否输出控制台 */
  console?: boolean;
  /** 是否写文件归档 */
  file?: boolean;
  /** 日志文件目录 */
  dir?: string;
  /** 文件保留天数 */
  maxDays?: number;
}

/** 日志文件名：ai-review-<kind>-<YYYY-MM-DD>.log */
const FILE_PATTERN = /^ai-review-(login|operation)-(\d{4}-\d{2}-\d{2})\.log$/;

export class Logger {
  private readonly consoleOut: boolean;
  private readonly fileOut: boolean;
  private readonly dir: string;
  private readonly maxDays: number;
  /** 已执行过清理的日期（YYYY-MM-DD，按 UTC）；同一天只清理一次 */
  private lastCleanupDate = '';

  constructor(options: LoggerOptions = {}) {
    this.consoleOut = options.console ?? true;
    this.fileOut = options.file ?? true;
    this.dir = options.dir ?? 'logs';
    this.maxDays = options.maxDays ?? 30;
  }

  /** 输出一条审计日志（按配置写控制台与/或归档文件） */
  public write(entry: AuditLogEntry): void {
    if (this.consoleOut) {
      console.log(formatConsoleLine(entry));
    }
    if (this.fileOut) {
      this.writeFile(entry);
    }
  }

  private writeFile(entry: AuditLogEntry): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    // createdAt 为 ISO 字符串，前 10 位即 UTC 自然日，作为滚动文件名
    const date = entry.createdAt.slice(0, 10);
    const file = join(this.dir, `ai-review-${entry.kind}-${date}.log`);
    appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
    this.cleanupIfDue(date);
  }

  /** 每天首次写入时清理超过保留天数的旧日志文件（文件名为日期，直接字典序比较） */
  private cleanupIfDue(today: string): void {
    if (this.lastCleanupDate === today || !existsSync(this.dir)) return;
    this.lastCleanupDate = today;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.maxDays);
    const cutoffDate = toDateKey(cutoff);
    for (const name of readdirSync(this.dir)) {
      const match = FILE_PATTERN.exec(name);
      if (match === null) continue;
      const fileDate = match[2];
      if (fileDate !== undefined && fileDate < cutoffDate) {
        try {
          unlinkSync(join(this.dir, name));
        } catch {
          // 并发清理竞态可忽略
        }
      }
    }
  }
}

/** 本地日期键 YYYY-MM-DD（清理阈值用） */
function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 控制台单行可读格式：`[ai-review] <iso> [<kind>:<status>] username=... action=... ip=...` */
function formatConsoleLine(entry: AuditLogEntry): string {
  const parts = ['[ai-review]', entry.createdAt, `[${entry.kind}:${entry.status}]`];
  parts.push(`username=${entry.username}`, `action=${entry.action}`);
  if (entry.resource !== '') parts.push(`resource=${entry.resource}`);
  if (entry.resourceId !== '') parts.push(`resourceId=${entry.resourceId}`);
  parts.push(`ip=${entry.ip}`);
  if (entry.reason !== null) parts.push(`reason=${entry.reason}`);
  if (entry.userAgent !== '') parts.push(`ua=${entry.userAgent}`);
  return parts.join(' ');
}
