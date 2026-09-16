import type { ReactElement } from 'react';
import { Alert, Empty, Space, Tag, Typography } from 'antd';
import type { IdentifiedFinding } from '@ai-review/shared/api';

type DiffViewerProps = {
  diffText: string | null;
  findings: IdentifiedFinding[];
};

type DiffRow = {
  key: string;
  text: string;
  oldLine: number | undefined;
  newLine: number | undefined;
  kind: 'add' | 'remove' | 'context' | 'meta';
  path: string | undefined;
};

function normalizePath(value: string): string {
  return value.replace(/^a\//, '').replace(/^b\//, '');
}

function parseDiff(diffText: string): DiffRow[] {
  let oldLine: number | undefined;
  let newLine: number | undefined;
  let path: string | undefined;
  return diffText.split(/\r?\n/).map((text, index) => {
    if (text.startsWith('+++ ')) {
      path = normalizePath(text.slice(4).trim());
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk !== null) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return { key: String(index), text, oldLine, newLine, kind: 'meta', path };
    }
    if (text.startsWith('+') && !text.startsWith('+++')) {
      const row = { key: String(index), text, oldLine, newLine, kind: 'add' as const, path };
      if (newLine !== undefined) newLine += 1;
      return row;
    }
    if (text.startsWith('-') && !text.startsWith('---')) {
      const row = { key: String(index), text, oldLine, newLine, kind: 'remove' as const, path };
      if (oldLine !== undefined) oldLine += 1;
      return row;
    }
    if (text.startsWith(' ')) {
      const row = { key: String(index), text, oldLine, newLine, kind: 'context' as const, path };
      if (oldLine !== undefined) oldLine += 1;
      if (newLine !== undefined) newLine += 1;
      return row;
    }
    return { key: String(index), text, oldLine, newLine, kind: 'meta' as const, path };
  });
}

/** 单列 unified diff：每行只显示一个行号（新增/上下文为新文件行号，删除为旧文件行号，元行为空） */
function rowLineNumber(row: DiffRow): number | undefined {
  switch (row.kind) {
    case 'remove':
      return row.oldLine;
    case 'add':
    case 'context':
      return row.newLine;
    default:
      return undefined;
  }
}

function rowMatchesFinding(row: DiffRow, findings: IdentifiedFinding[]): boolean {
  if (row.path === undefined || row.newLine === undefined) return false;
  const path = normalizePath(row.path);
  return findings.some(
    (finding) =>
      normalizePath(finding.filePath) === path &&
      row.newLine !== undefined &&
      row.newLine >= finding.lineStart &&
      row.newLine <= finding.lineEnd,
  );
}

export function DiffViewer(props: DiffViewerProps): ReactElement {
  if (props.diffText === null || props.diffText.trim() === '') {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="暂无可用的 Diff（存量记录可能未持久化原始变更）"
      />
    );
  }
  const rows = parseDiff(props.diffText);
  return (
    <div className="diff-viewer" role="region" aria-label="代码变更 Diff">
      <div className="diff-toolbar">
        <Space size={8} wrap>
          <Typography.Text type="secondary">
            共 {rows.filter((row) => row.kind !== 'meta').length} 行变更
          </Typography.Text>
          <Tag color="success">新增</Tag>
          <Tag color="error">删除</Tag>
          {props.findings.length > 0 ? <Tag color="warning">标记问题位置</Tag> : null}
        </Space>
      </div>
      <div className="diff-code">
        {rows.map((row) => {
          const finding = rowMatchesFinding(row, props.findings);
          return (
            <div
              key={row.key}
              className={`diff-row diff-row-${row.kind}${finding ? ' diff-row-finding' : ''}`}
            >
              <span className="diff-line-number">{rowLineNumber(row) ?? ''}</span>
              <code className="diff-line-text">{row.text || ' '}</code>
            </div>
          );
        })}
      </div>
      {props.findings.length > 0 ? (
        <Alert
          className="diff-hint"
          type="info"
          showIcon
          message="Diff 中的黄色标记对应报告中的发现位置"
        />
      ) : null}
    </div>
  );
}
