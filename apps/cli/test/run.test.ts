import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT_CODES } from '@ai-review/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { runReview } from '../src/run.js';

function makeTempRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'ai-review-cli-'));
  const git = (...args: string[]): Buffer =>
    execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git('init', '--initial-branch', 'main');
  git('config', 'user.email', 'review@example.com');
  git('config', 'user.name', 'review');
  git('config', 'commit.gpgsign', 'false');
  return repo;
}

const repos: string[] = [];

afterAll(() => {
  for (const repo of repos) rmSync(repo, { recursive: true, force: true });
});

describe('runReview', () => {
  it('fails clearly when the repository path is invalid', async () => {
    await expect(
      runReview({
        repoPath: 'Z:/missing-ai-review-repository',
        mode: 'fast',
        blockOn: 'BLOCKER',
        json: true,
      }),
    ).rejects.toThrow();
  });

  it('passes with exit code 0 when nothing is staged', async () => {
    const repo = makeTempRepo();
    repos.push(repo);
    await expect(
      runReview({ repoPath: repo, mode: 'fast', blockOn: 'BLOCKER', json: true }),
    ).resolves.toBe(EXIT_CODES.ok);
  });

  it('writes markdown and JSON reports to the configured output directory', async () => {
    const repo = makeTempRepo();
    repos.push(repo);
    await expect(
      runReview({ repoPath: repo, mode: 'fast', blockOn: 'BLOCKER', json: true }),
    ).resolves.toBe(EXIT_CODES.ok);

    const outputDir = join(repo, '.ai-review-reports');
    const files = readdirSync(outputDir).sort();
    expect(files).toHaveLength(2);
    expect(files[0]).toMatch(/^review-\d+\.json$/);
    expect(files[1]).toMatch(/^review-\d+\.md$/);
    const jsonFile = files.find((file) => file.endsWith('.json'));
    if (jsonFile === undefined) throw new Error('expected JSON report');
    const report = JSON.parse(readFileSync(join(outputDir, jsonFile), 'utf8')) as {
      qualityNotes: string[];
      suggestions: string[];
    };
    expect(report.qualityNotes.length).toBeGreaterThan(0);
    expect(report.suggestions).toEqual([]);
  });

  it('blocks on a staged hardcoded secret detected by static analysis', async () => {
    const repo = makeTempRepo();
    repos.push(repo);
    writeFileSync(join(repo, 'config.ts'), "export const awsAccessKey = 'AKIAIOSFODNN7EXAMPLE';\n");
    execFileSync('git', ['add', 'config.ts'], { cwd: repo, stdio: 'pipe' });
    await expect(
      runReview({ repoPath: repo, mode: 'fast', blockOn: 'BLOCKER', json: true }),
    ).resolves.toBe(EXIT_CODES.blocked);
  });

  it('applies a custom review rule and blocks on staged matches even when enabledTools omits it', async () => {
    const repo = makeTempRepo();
    repos.push(repo);
    const configPath = join(repo, '.ai-review.yml');
    writeFileSync(
      configPath,
      [
        'llm:',
        '  provider: mock',
        'review:',
        '  mode: fast',
        '  blockOn: BLOCKER',
        // 显式工具列表不含 custom_rule_check：存在启用规则时应自动并入
        'staticAnalysis:',
        '  enabledTools: [ast_parse, complexity_check, secret_scan, dependency_scan]',
        'customRules:',
        '  - name: no-todo',
        '    description: Forbid leftover TODO markers.',
        '    pattern: TODO',
        '    severity: BLOCKER',
        '    matchScope: [added]',
        '    enabled: true',
        '',
      ].join('\n'),
    );
    writeFileSync(join(repo, 'worker.ts'), '// TODO: implement retry\nexport const ok = 1;\n');
    execFileSync('git', ['add', 'worker.ts'], { cwd: repo, stdio: 'pipe' });
    await expect(
      runReview({ repoPath: repo, mode: 'fast', blockOn: 'BLOCKER', json: true, configPath }),
    ).resolves.toBe(EXIT_CODES.blocked);
  });

  it('does not block when the custom rule is disabled', async () => {
    const repo = makeTempRepo();
    repos.push(repo);
    const configPath = join(repo, '.ai-review.yml');
    writeFileSync(
      configPath,
      [
        'llm:',
        '  provider: mock',
        'review:',
        '  mode: fast',
        '  blockOn: BLOCKER',
        'customRules:',
        '  - name: no-todo',
        '    description: Forbid leftover TODO markers.',
        '    pattern: TODO',
        '    severity: BLOCKER',
        '    matchScope: [added]',
        '    enabled: false',
        '',
      ].join('\n'),
    );
    writeFileSync(join(repo, 'worker.ts'), '// TODO: ignored\nexport const ok = 1;\n');
    execFileSync('git', ['add', 'worker.ts'], { cwd: repo, stdio: 'pipe' });
    await expect(
      runReview({ repoPath: repo, mode: 'fast', blockOn: 'BLOCKER', json: true, configPath }),
    ).resolves.toBe(EXIT_CODES.ok);
  });

  it('reviews the base...HEAD committed range in CI mode (--base)', async () => {
    const repo = makeTempRepo();
    repos.push(repo);
    const git = (...args: string[]): Buffer =>
      execFileSync('git', args, { cwd: repo, stdio: 'pipe' });

    // 干净基线提交；secret 落在其后的 HEAD 提交里，且工作区保持干净（非 staged 路径）
    writeFileSync(join(repo, 'README.md'), '# demo\n');
    git('add', 'README.md');
    git('commit', '-m', 'baseline', '--no-verify');
    writeFileSync(join(repo, 'config.ts'), "export const awsAccessKey = 'AKIAIOSFODNN7EXAMPLE';\n");
    git('add', 'config.ts');
    git('commit', '-m', 'add secret', '--no-verify');

    await expect(
      runReview({
        repoPath: repo,
        mode: 'fast',
        blockOn: 'BLOCKER',
        json: true,
        base: 'HEAD~1',
      }),
    ).resolves.toBe(EXIT_CODES.blocked);
  });
});
