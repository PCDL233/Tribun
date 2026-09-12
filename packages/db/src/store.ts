import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import { FindingSchema } from '@ai-review/shared';
import type {
  Finding,
  IdentifiedFinding,
  ReviewListItem,
  ReviewReport,
  ReviewReportDetail,
  ReviewStats,
  SeverityCount,
} from '@ai-review/shared';
import { findings, reviewCache, reviews } from './schema.js';

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
      CREATE TABLE IF NOT EXISTS review_cache (
        cache_key      TEXT PRIMARY KEY,
        review_id      TEXT,
        findings_json  TEXT NOT NULL,
        token_saved    INTEGER NOT NULL DEFAULT 0,
        created_at     TEXT NOT NULL
      );
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

  /**
   * 读取审查缓存（方案 3.0 步骤 8：内容哈希去重，供 core 的 ReviewCache 接口调用）。
   * @returns 命中时返回该键的全部发现；未命中或条目损坏（JSON/zod 校验失败）返回 undefined——
   *          缓存损坏按"未命中"降级重审，属规范 §7.7 的可降级错误，不阻断流水线
   */
  public getCachedFindings(cacheKey: string): Finding[] | undefined {
    const row = this.db
      .select()
      .from(reviewCache)
      .where(eq(reviewCache.cacheKey, cacheKey))
      .get();
    if (row === undefined) return undefined;

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(row.findingsJson);
    } catch {
      return undefined;
    }
    if (!Array.isArray(parsedJson)) return undefined;
    const result = z.array(FindingSchema).safeParse(parsedJson);
    return result.success ? result.data : undefined;
  }

  /**
   * 写入审查缓存（insert or replace：相同键以最新审查口径为准）。
   * @param reviewId 产出该条目的审查（供追溯，可空——缓存由内容哈希寻址，与审查弱关联）
   * @param entries 键为 core 生成的内容哈希
   */
  public saveCacheEntries(
    reviewId: string | undefined,
    entries: ReadonlyArray<{ cacheKey: string; findings: Finding[]; tokenSaved: number }>,
  ): void {
    if (entries.length === 0) return;
    this.db.transaction(() => {
      for (const entry of entries) {
        this.db
          .insert(reviewCache)
          .values({
            cacheKey: entry.cacheKey,
            reviewId: reviewId ?? null,
            findingsJson: JSON.stringify(entry.findings),
            tokenSaved: entry.tokenSaved,
          })
          .onConflictDoUpdate({
            target: reviewCache.cacheKey,
            set: { reviewId, findingsJson: JSON.stringify(entry.findings), tokenSaved: entry.tokenSaved },
          })
          .run();
      }
    });
  }

  /** 缓存表规模与累计节省 token（成本观测，方案 §七 成本估算的落地数据） */
  public getCacheSummary(): { entries: number; tokenSaved: number } {
    const rows = this.db
      .select({ tokenSaved: reviewCache.tokenSaved })
      .from(reviewCache)
      .all();
    return {
      entries: rows.length,
      tokenSaved: rows.reduce((sum, row) => sum + row.tokenSaved, 0),
    };
  }

  /**
   * 统计聚合（Dashboard 统计分析页的数据源，方案 3.10 页面 4）。
   * 数据量为单机审查历史量级（数千行），全表读出后在 JS 侧聚合，
   * 避免 SQLite 字符串日期聚合的方言耦合。
   */
  public getStats(): ReviewStats {
    const reviewRows = this.db.select().from(reviews).all();
    const findingRows = this.db
      .select({
        filePath: findings.filePath,
        severity: findings.severity,
        isFalsePositive: findings.isFalsePositive,
      })
      .from(findings)
      .all();

    const severityCounts = new Map<string, number>();
    const fileCounts = new Map<string, { findingCount: number; blockerCount: number }>();
    let falsePositiveCount = 0;
    for (const row of findingRows) {
      // is_false_positive 列为 drizzle boolean 模式，读回即 true/false
      if (row.isFalsePositive) falsePositiveCount += 1;
      severityCounts.set(row.severity, (severityCounts.get(row.severity) ?? 0) + 1);
      const file = fileCounts.get(row.filePath) ?? { findingCount: 0, blockerCount: 0 };
      file.findingCount += 1;
      if (row.severity === 'BLOCKER') file.blockerCount += 1;
      fileCounts.set(row.filePath, file);
    }

    // 字面量元组标注：避免数组字面量拓宽为 string 后无法满足 SeverityCount
    const severityLiterals = ['BLOCKER', 'WARNING', 'NIT', 'PRAISE'] as const;
    const severityDistribution: SeverityCount[] = severityLiterals.map((severity) => ({
      severity,
      count: severityCounts.get(severity) ?? 0,
    }));

    // 风险分趋势按自然日聚合（created_at 为 ISO 字符串，前 10 位即日期）
    const dayBuckets = new Map<string, { riskScoreSum: number; reviews: number }>();
    for (const row of reviewRows) {
      const date = row.createdAt.slice(0, 10);
      const bucket = dayBuckets.get(date) ?? { riskScoreSum: 0, reviews: 0 };
      bucket.riskScoreSum += row.riskScore;
      bucket.reviews += 1;
      dayBuckets.set(date, bucket);
    }
    const riskTrend = [...dayBuckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, bucket]) => ({
        date,
        reviews: bucket.reviews,
        avgRiskScore: bucket.riskScoreSum / bucket.reviews,
      }));

    const totalReviews = reviewRows.length;
    const avgRiskScore =
      totalReviews === 0
        ? 0
        : reviewRows.reduce((sum, row) => sum + row.riskScore, 0) / totalReviews;

    return {
      totalReviews,
      totalFindings: findingRows.length,
      falsePositiveCount,
      avgRiskScore,
      avgDurationMs:
        totalReviews === 0
          ? 0
          : reviewRows.reduce((sum, row) => sum + row.durationMs, 0) / totalReviews,
      totalTokenUsed: reviewRows.reduce((sum, row) => sum + row.tokenUsed, 0),
      severityDistribution,
      riskTrend,
      topRiskyFiles: [...fileCounts.entries()]
        .map(([filePath, file]) => ({ filePath, ...file }))
        .sort((a, b) => b.findingCount - a.findingCount)
        .slice(0, 10),
    };
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
