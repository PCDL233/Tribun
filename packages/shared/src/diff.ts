/** unified diff 的行级结构。行号为 null 表示该侧不存在（如新增行无 oldLineNo）。 */
export type DiffLineType = 'added' | 'removed' | 'context';

export type DiffLine = {
  type: DiffLineType;
  oldLineNo: number | null;
  newLineNo: number | null;
  content: string;
};

export type DiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
};

export type FileDiff = {
  path: string;
  /** 重命名前路径；非重命名为 null */
  oldPath: string | null;
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  /** 新文件侧的新增/修改行——AI 审查的聚焦对象（方案 3.1：忽略删除行） */
  changedLines: DiffLine[];
  /** 删除行原文：删除守卫逻辑（错误处理/校验）等确定性信号的来源 */
  removedLines: string[];
  /** 变更摘要：RAG 检索的查询文本（方案 3.1 关键设计决策） */
  summary: string;
};

/** 变更类型分类（方案 3.1 classifyChange），供风险规划器降权与报告概述 */
export type ChangeType = 'feature' | 'bugfix' | 'refactor' | 'test' | 'docs' | 'formatting' | 'chore';
