import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, resolveEnvRefs } from '../src/index';

describe('resolveEnvRefs', () => {
  it('resolves nested env references', () => {
    process.env.AI_REVIEW_TEST_KEY = 'sk-test';
    const input = { llm: { apiKey: '${AI_REVIEW_TEST_KEY}' }, list: ['${AI_REVIEW_TEST_KEY}', 1] };
    expect(resolveEnvRefs(input)).toEqual({
      llm: { apiKey: 'sk-test' },
      list: ['sk-test', 1],
    });
  });

  it('keeps placeholder when env is missing', () => {
    delete process.env.AI_REVIEW_TEST_MISSING;
    expect(resolveEnvRefs('${AI_REVIEW_TEST_MISSING}')).toBe('${AI_REVIEW_TEST_MISSING}');
  });
});

describe('loadConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ai-review-config-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('applies defaults to a minimal config', () => {
    const path = join(dir, '.ai-review.yml');
    writeFileSync(path, 'llm:\n  provider: mock\n');
    const cfg = loadConfig(path);
    expect(cfg.llm.provider).toBe('mock');
    expect(cfg.llm.temperature).toBe(0.1);
    expect(cfg.review.blockOn).toBe('BLOCKER');
    expect(cfg.staticAnalysis.complexityThreshold).toBe(15);
    expect(cfg.report.format).toBe('markdown');
  });

  it('rejects unknown provider with a field-level error (exit code 2 path)', () => {
    const path = join(dir, '.ai-review.yml');
    writeFileSync(path, 'llm:\n  provider: gemini\n');
    expect(() => loadConfig(path)).toThrow(ConfigError);
    expect(() => loadConfig(path)).toThrow(/llm\.provider/);
  });

  it('throws ConfigError for missing file', () => {
    expect(() => loadConfig(join(dir, 'nope.yml'))).toThrow(ConfigError);
  });

  it('resolves ${ENV} refs in apiKey', () => {
    process.env.AI_REVIEW_TEST_KEY = 'sk-live';
    const path = join(dir, '.ai-review.yml');
    writeFileSync(path, 'llm:\n  provider: anthropic\n  apiKey: ${AI_REVIEW_TEST_KEY}\n');
    expect(loadConfig(path).llm.apiKey).toBe('sk-live');
  });
});
