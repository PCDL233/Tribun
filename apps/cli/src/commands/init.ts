import { existsSync, writeFileSync } from 'node:fs';
import * as prompts from '@clack/prompts';
import YAML from 'yaml';
import { AiReviewConfigSchema } from '@ai-review/shared';

/**
 * 交互式初始化（方案 3.11 `ai-review init`）：
 * 以 AiReviewConfigSchema 的默认值生成 .ai-review.yml 骨架——
 * 配置单一事实源是 shared 的 schema，生成物与校验器永不漂移。
 */
export async function initConfig(): Promise<void> {
  prompts.intro('ai-review init');
  const path = '.ai-review.yml';
  if (existsSync(path)) {
    const overwrite = await prompts.confirm({ message: `${path} already exists. Overwrite?` });
    if (prompts.isCancel(overwrite) || !overwrite) {
      prompts.outro('aborted, existing config kept');
      return;
    }
  }
  // 空对象经 schema 解析即得到全默认值（zod .default() 语义）
  const config = AiReviewConfigSchema.parse({});
  writeFileSync(path, YAML.stringify(config));
  prompts.outro(`written ${path} (edit secrets via ENV refs, never plain text)`);
}
