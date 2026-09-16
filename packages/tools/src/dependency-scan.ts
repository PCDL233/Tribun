import type { Finding, FileContext } from '@ai-review/shared';

type Advisory = {
  packageName: string;
  fixedVersion: [number, number, number];
  cveId: string;
  severity: 'BLOCKER' | 'WARNING';
  summary: string;
};

/**
 * 小型离线 advisory 表：审查不能依赖网络服务，先覆盖最常见且影响明确的依赖风险。
 * 版本库可在后续替换为定期同步的 OSV/NVD 快照，工具输出契约保持不变。
 */
const ADVISORIES: readonly Advisory[] = [
  {
    packageName: 'lodash',
    fixedVersion: [4, 17, 21],
    cveId: 'CVE-2021-23337',
    severity: 'BLOCKER',
    summary: 'lodash 旧版本存在命令注入风险',
  },
  {
    packageName: 'minimist',
    fixedVersion: [1, 2, 6],
    cveId: 'CVE-2021-44906',
    severity: 'WARNING',
    summary: 'minimist 旧版本存在原型污染风险',
  },
  {
    packageName: 'axios',
    fixedVersion: [1, 6, 0],
    cveId: 'CVE-2023-45857',
    severity: 'WARNING',
    summary: 'axios 旧版本存在 CSRF/凭据泄露风险',
  },
  {
    packageName: 'jsonwebtoken',
    fixedVersion: [9, 0, 0],
    cveId: 'CVE-2022-23529',
    severity: 'BLOCKER',
    summary: 'jsonwebtoken 旧版本存在远程代码执行风险',
  },
];

function parseVersion(value: string): [number, number, number] | null {
  const match = /(?:^|\s|[~^<>=])v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(value);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function isOlder(version: readonly number[], fixed: readonly number[]): boolean {
  for (let index = 0; index < fixed.length; index += 1) {
    if ((version[index] ?? 0) !== (fixed[index] ?? 0))
      return (version[index] ?? 0) < (fixed[index] ?? 0);
  }
  return false;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lineForDependency(
  file: FileContext,
  packageName: string,
): { line: number; snippet?: string } | null {
  const pattern = new RegExp(`[\"']${escapeRegex(packageName)}[\"']\\s*:`);
  const match = file.diff.changedLines.find(
    (line) => line.newLineNo !== null && pattern.test(line.content),
  );
  return match?.newLineNo === null || match === undefined
    ? null
    : { line: match.newLineNo, snippet: match.content };
}

/** 对变更中的 package.json 执行离线依赖风险检查。 */
export function dependencyFindings(files: readonly FileContext[]): Finding[] {
  return files.flatMap((file) => {
    if (!/(^|\/)package\.json$/i.test(file.diff.path)) return [];
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(file.stagedContent) as Record<string, unknown>;
    } catch {
      return [];
    }

    const sections = [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ];
    const dependencies = new Map<string, string>();
    for (const section of sections) {
      const values = manifest[section];
      if (values === null || typeof values !== 'object' || Array.isArray(values)) continue;
      for (const [name, version] of Object.entries(values)) {
        if (typeof version === 'string') dependencies.set(name, version);
      }
    }

    return ADVISORIES.flatMap((advisory): Finding[] => {
      const requested = dependencies.get(advisory.packageName);
      if (requested === undefined || /^(workspace:|npm:|file:|git\+)/.test(requested)) return [];
      const version = parseVersion(requested);
      if (
        version === null ||
        /^[*><=]/.test(requested.trim()) ||
        !isOlder(version, advisory.fixedVersion)
      )
        return [];
      const location = lineForDependency(file, advisory.packageName);
      if (location === null) return [];
      return [
        {
          agent: 'static',
          severity: advisory.severity,
          confidence: 0.98,
          filePath: file.diff.path,
          lineStart: location.line,
          lineEnd: location.line,
          title: `Vulnerable dependency: ${advisory.packageName} ${requested}`,
          description: `${advisory.summary}（${advisory.cveId}），建议升级到 ${advisory.fixedVersion.join('.')} 或更高版本。`,
          suggestion: `Upgrade ${advisory.packageName} to >=${advisory.fixedVersion.join('.')} and regenerate the lockfile.`,
          codeSnippet: location.snippet,
          cweId: advisory.cveId,
          isFalsePositive: false,
        } satisfies Finding,
      ];
    });
  });
}

/** MCP/外部调用使用的 manifest 便捷入口：将整个文件视为待审查变更。 */
export function scanDependencyManifest(source: string, filePath = 'package.json'): Finding[] {
  const lines = source.split(/\r?\n/);
  const file: FileContext = {
    diff: {
      path: filePath,
      oldPath: null,
      binary: false,
      additions: lines.length,
      deletions: 0,
      hunks: [],
      changedLines: lines.map((content, index) => ({
        type: 'added' as const,
        oldLineNo: null,
        newLineNo: index + 1,
        content,
      })),
      removedLines: [],
      summary: 'package manifest',
    },
    stagedContent: source,
    snippet: source,
    signature: null,
    ragHits: [],
    changeType: 'feature',
  };
  return dependencyFindings([file]);
}
