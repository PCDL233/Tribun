import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HOOK_LINES = [
  '# ai-review pre-commit hook (husky v9, Windows/macOS/Linux universal)',
  '# fast mode target <= 15s; BLOCKER findings block the commit',
  'ai-review run --staged --mode fast --block-on BLOCKER',
  '',
];

/** 安装 pre-commit hook（方案 3.11 `ai-review install-hook`） */
export function installHook(): void {
  mkdirSync('.husky', { recursive: true });
  const hookPath = join('.husky', 'pre-commit');
  writeFileSync(hookPath, HOOK_LINES.join('\n'));
  console.log(`written ${hookPath}`);
  console.log('prerequisite: husky v9 installed and activated in this repository');
  console.log('activate once via: pnpm exec husky init');
}
