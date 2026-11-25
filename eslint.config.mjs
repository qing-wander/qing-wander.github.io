// ESLint 9 flat config —— React 迁移工程规约（docs/react-refactor-plan.md §5.1 / §10-D 决策）
//
// 核心规则：**可移植边界** —— src/components、src/features、src/lib 禁止 import
// 任何 astro 模块（astro:content / astro:env 等）。这层 React 代码必须保证
// 在「纯 Vite SPA 备选方案」（方案文档 §4.4）下 100% 无改动可用。
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import astro from 'eslint-plugin-astro';
import reactHooks from 'eslint-plugin-react-hooks';

const PORTABLE_DIRS = 'src/{components,features,lib}/**/*.{ts,tsx,js,jsx}';

// lint 范围：React 迁移工程（src/ + 根配置）；
// tests/*.test.mjs 是后端 node:test 体系（零改动原则，不纳入新 lint）；
// functions/ worker/ scripts/ admin/ 同理（N2）。
const REACT_SOURCES = [
  'src/**/*.{js,mjs,ts,tsx,jsx}',
  'eslint.config.mjs',
  'astro.config.mjs',
  'vitest.config.ts',
];

export default tseslint.config(
  { ignores: ['dist/**', 'dist-react/**', 'node_modules/**', '.astro/**', 'assets/**', 'admin/**', 'functions/**', 'worker/**', 'scripts/**', 'tools/**', 'miniprogram/**', 'tests/**', 'templates/**', 'variants/**', 'work/**', '_*.html', '*.html'] },
  {
    files: REACT_SOURCES,
    ...eslint.configs.recommended,
  },
  // tseslint.configs.recommended 是数组 —— 逐项施加 files 限定（不可对象平铺）
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: REACT_SOURCES })),
  ...astro.configs['flat/recommended'],
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React 19 Compiler 逐步接管 memo 化，hooks 规则保持最严格
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // ── 可移植边界（硬约束）──
    files: [PORTABLE_DIRS],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['astro', 'astro:*', 'astro/**'],
            message: '可移植层禁止依赖 Astro：这层代码须能在纯 Vite SPA 方案下无改动复用（react-refactor-plan §5.1）。',
          },
        ],
      }],
    },
  },
  {
    // .astro 壳层纪律：业务逻辑禁止在 frontmatter 外超过 20 行（react-refactor-plan §8.2）
    files: ['src/pages/**/*.astro', 'src/layouts/**/*.astro'],
    rules: {
      'astro/no-unused-css-selector': 'off',
    },
  },
);
