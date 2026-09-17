import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiReviewConfigSchema } from '@ai-review/shared';
import { createLiveConfigReader } from '../src/main.js';

describe('createLiveConfigReader（配置热重读）', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ai-review-live-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns updated config after the file changes (保存后热生效)', () => {
    const configPath = join(dir, '.ai-review.yml');
    const read = createLiveConfigReader(configPath, AiReviewConfigSchema.parse({}));
    expect(read().customRules).toEqual([]);

    writeFileSync(
      configPath,
      'customRules:\n  - name: no-todo\n    description: Forbid TODO.\n    pattern: TODO\n',
    );
    expect(read().customRules).toHaveLength(1);
    expect(read().customRules[0]?.name).toBe('no-todo');
  });

  it('keeps the last valid config when the file becomes invalid', () => {
    const configPath = join(dir, '.ai-review.yml');
    writeFileSync(
      configPath,
      'customRules:\n  - name: no-todo\n    description: Forbid TODO.\n    pattern: TODO\n',
    );
    const read = createLiveConfigReader(configPath, AiReviewConfigSchema.parse({}));
    expect(read().customRules).toHaveLength(1);

    // 覆盖为非法配置（provider 不在枚举内）→ 保留上次有效配置，不阻断后续读取
    writeFileSync(configPath, 'llm:\n  provider: gemini\n');
    expect(read().customRules).toHaveLength(1);
    expect(read().customRules[0]?.name).toBe('no-todo');
  });
});
