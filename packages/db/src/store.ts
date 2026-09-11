import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import { FindingSchema } from '@ai-review/shared';
import type {
  IdentifiedFinding,
  ReviewListItem,
  ReviewReport,
  ReviewReportDetail,
} from '@ai-review/shared';
import { findings, reviews } from './schema.js';

// API 契约类型以 shared 为单一事实源，此处转出口供既有调用方使用
export type { IdentifiedFinding, ReviewListItem, ReviewReportDetail } from '@ai-review/shared';

/** 报告 JSON 中非规范化段落的结构校验（规范 §5.5：读回的运行时数据必须经 zod 校验） */
const StoredReportSchema = z.object({
  summary: z.string(),
  qualityNotes: z.array(z.string()),
  suggestions: z.array(z.string()),
  assessment: z.string(),
  degradedToStatic: z.array(z.string()),
});

/** 持久层错误（行损坏、目标不存在等） */
export class StoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StoreError';
  }
}

/**
 * 审查结果存储（SQLite，Drizzle ORM 访问）。
 * 建表语句与 schema.ts 的列定义一一对应；不引入 drizzle-kit 迁移链路——
 * 当前为单机嵌入式库，CREATE TABLE IF NOT EXISTS 的幂等初始化已满足需求（迁移工具属团队版后续任务）。
 */
export class ReviewStore {
  private readonly db: BetterSQLite3Database;

  /**
   * @param sqlite better-sqlite3 连接；传 ':memory:' 可获得进程内库（测试用）
   */
  constructor(private readonly sqlite: Database.Database) {
    const file = sqlite.name;
    // WAL 仅对文件库有意义；:memory: 库设置 journal_mode 会被 SQLite 忽略/报错
    if (file !== ':memory:') sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS reviews (
        id              TEXT PRIMARY KEY,
        repo_path       TEXT NOT NULL,
        branch          TEXT NOT NULL,
        commit_hash     TEXT,
        author          TEXT,
        model           TEXT NOT NULL,
        mode            TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'completed',
        risk_score      REAL NOT NULL,
        total_findings  INTEGER NOT NULL DEFAULT 0,
        blocker_count   INTEGER NOT NULL DEFAULT 0,
        warning_count   INTEGER NOT NULL DEFAULT 0,
        nit_count       INTEGER NOT NULL DEFAULT 0,
        token_used      INTEGER NOT NULL DEFAULT 0,
        duration_ms     INTEGER NOT NULL,
        report_json     TEXT NOT NULL,
        created_at      TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS findings (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        review_id          TEXT NOT NULL REFERENCES reviews(id),
        agent              TEXT NOT NULL,
        severity           TEXT NOT NULL,
        confidence         REAL NOT NULL,
        file_path          TEXT NOT NULL,
        line_start         INTEGER NOT NULL,
        line_end           INTEGER NOT NULL,
        title              TEXT NOT NULL,
        description        TEXT NOT NULL,
        suggestion         TEXT,
        code_snippet       TEXT,
        cwe_id             TEXT,
        low_confidence     INTEGER NOT NULL DEFAULT 0,
        is_false_positive  INTEGER NOT NULL DEFAULT 0,
        created_at         TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_findings_review ON findings(review_id);
    `);
    this.db = drizzle(sqlite);
  }

  /**
   * 持久化一份完整审查报告（事务：reviews 主行 + findings 行级明细）。
   * @param report 流水线产出的类型化报告
   * @returns 审查 ID（即 report.meta.reviewId）
   */
  public saveReport(report: ReviewReport): string {
    const reviewId = report.meta.reviewId;
    const count = (severity: string): number =>
      report.findings.filter((finding) => finding.severity === severity).length;

    this.db.transaction(() => {
      this.db
        .insert(reviews)
        .values({
          id: reviewId,
          repoPath: report.meta.repoPath,
          branch: report.meta.branch,
          commitHash: report.meta.commitHash,
          author: report.meta.author,
          model: report.meta.model,
          mode: report.meta.mode,
          riskScore: report.meta.riskScore,
          totalFindings: report.findings.length,
          blockerCount: count('BLOCKER'),
          warningCount: count('WARNING'),
          nitCount: count('NIT'),
          tokenUsed: report.meta.tokenUsed,
          durationMs: report.meta.durationMs,
          reportJson: JSON.stringify({
            summary: report.summary,
            qualityNotes: report.qualityNotes,
            suggestions: report.suggestions,
            assessment: report.assessment,
            degradedToStatic: report.degradedToStatic,
          }),
        })
        .run();
      if (report.findings.length > 0) {
        this.db
          .insert(findings)
          .values(
            report.findings.map((finding) => ({
              reviewId,
              agent: finding.agent,
              severity: finding.severity,
              confidence: finding.confidence,
              filePath: finding.filePath,
              lineStart: finding.lineStart,
              lineEnd: finding.lineEnd,
              title: finding.title,
              description: finding.description,
              suggestion: finding.suggestion,
              codeSnippet: finding.codeSnippet,
              cweId: finding.cweId,
              lowConfidence: finding.lowConfidence ?? false,
              isFalsePositive: finding.isFalsePositive,
            })),
          )
          .run();
      }
    });
    return reviewId;
  }

  /** 审查历史（Dashboard 列表页，按创建时间倒序） */
  public listReviews(limit = 50): ReviewListItem[] {
    const rows = this.db
      .select()
      .from(reviews)
      .orderBy(desc(reviews.createdAt), desc(reviews.id))
      .limit(limit)
      .all();
    return rows.map((row) => ({
      reviewId: row.id,
      repoPath: row.repoPath,
      branch: row.branch,
      model: row.model,
      mode: row.mode,
      riskScore: row.riskScore,
      totalFindings: row.totalFindings,
      blockerCount: row.blockerCount,
      warningCount: row.warningCount,
      nitCount: row.nitCount,
      tokenUsed: row.tokenUsed,
      durationMs: row.durationMs,
      createdAt: row.createdAt,
    }));
  }

  /**
   * 报告详情：非规范化段落取自 report_json（zod 校验），findings 以行级存储为准
   * （isFalsePositive 可能已被 Dashboard 更新，不能回用 JSON 快照中的旧值）。
   * @throws {StoreError} 报告不存在或行损坏
   */
  public getReportDetail(reviewId: string): ReviewReportDetail {
    const row = this.db.select().from(reviews).where(eq(reviews.id, reviewId)).get();
    if (row === undefined) throw new StoreError(`review not found: ${reviewId}`);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(row.reportJson);
    } catch (e) {
      throw new StoreError(`corrupt report_json for review ${reviewId}`, { cause: e });
    }
    const stored = StoredReportSchema.safeParse(parsedJson);
    if (!stored.success) {
      throw new StoreError(`corrupt report_json for review ${reviewId}`, {
        cause: stored.error,
      });
    }

    const findingRows = this.db
      .select()
      .from(findings)
      .where(eq(findings.reviewId, reviewId))
      .orderBy(findings.id)
      .all();
    const mapped: IdentifiedFinding[] = findingRows.map((findingRow) => ({
      // SQLite 列缺省读回 null，而 Finding 契约的 optional 语义是 undefined，先归一化再过 zod
      ...FindingSchema.parse({
        ...findingRow,
        suggestion: findingRow.suggestion ?? undefined,
        codeSnippet: findingRow.codeSnippet ?? undefined,
        cweId: findingRow.cweId ?? undefined,
      }),
      id: findingRow.id,
    }));

    return {
      meta: {
        reviewId: row.id,
        repoPath: row.repoPath,
        branch: row.branch,
        commitHash: row.commitHash ?? undefined,
        author: row.author ?? undefined,
        model: row.model,
        mode: row.mode,
        riskScore: row.riskScore,
        durationMs: row.durationMs,
        tokenUsed: row.tokenUsed,
      },
      summary: stored.data.summary,
      findings: mapped,
      qualityNotes: stored.data.qualityNotes,
      suggestions: stored.data.suggestions,
      assessment: stored.data.assessment,
      degradedToStatic: stored.data.degradedToStatic,
    };
  }

  /**
   * 标记/取消误报（Dashboard 乐观更新后回写，方案 3.10）。
   * @returns 目标发现是否存在
   */
  public setFindingFalsePositive(findingId: number, isFalsePositive: boolean): boolean {
    const result = this.db
      .update(findings)
      .set({ isFalsePositive })
      .where(eq(findings.id, findingId))
      .run();
    return result.changes > 0;
  }

  /** 关闭底层连接（进程退出 / 测试清理） */
  public close(): void {
    this.sqlite.close();
  }
}

/** 创建基于文件路径的存储（随项目目录持久化，如 .ai-review-cache/reviews.db）；父目录不存在时自动创建 */
export function createReviewStore(dbFile: string): ReviewStore {
  const parent = dirname(dbFile);
  if (parent !== '' && parent !== '.' && !existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  return new ReviewStore(new Database(dbFile));
}
