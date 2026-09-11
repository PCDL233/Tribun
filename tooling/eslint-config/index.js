// 共享 ESLint 9+ flat config：落地下发《代码编写规范》第 10 章的关键规则基线。
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/coverage/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'import-x': importX,
    },
    rules: {
      // —— 规范 §5：禁 any / @ts-ignore ——
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // —— 规范 §10：显式返回类型（限导出）——
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowTypedFunctionExpressions: true, allowIIFE: true },
      ],
      // —— 规范 §7：禁静默吞错与悬空 Promise ——
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      // —— 规范 §10：import 排序（node: 内置 → 第三方 → @ai-review/* → 相对路径）——
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          pathGroups: [{ pattern: '@ai-review/**', group: 'internal', position: 'after' }],
          'newlines-between': 'never',
        },
      ],
      // —— 规范 §2：命名基线（UPPER_SNAKE_CASE 常量、禁止随意双下划线）——
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'variable', modifiers: ['global', 'const'], format: ['camelCase', 'UPPER_CASE'] },
      ],
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
