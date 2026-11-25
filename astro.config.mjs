// Astro 6 配置 —— React 化重构（docs/react-refactor-plan.md §5.1 / §5.2 / §5.4）
//
// 关键决策：
//  · output: 'static'     —— 全站 SSG；交互能力由岛水合提供（§5.4 水合策略表）
//  · outDir: 'dist-react' —— 不占用 pages-build.sh 的总产物目录 dist/；
//                            混排机制见 scripts/pages-build.sh 的 REACT_MIGRATED_PAGES
//  · build.format: 'file' —— 输出 /resume.html、/jd.html 等带扩展名文件，逐字保留旧 URL（N3）
//  · React 19 + TypeScript，Vite 由 Astro 内置
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  integrations: [react()],
  output: 'static',
  srcDir: 'src',
  outDir: 'dist-react',
  build: {
    format: 'file',
  },
  vite: {
    resolve: {
      alias: {
        '@': '/src',
        '@data': '/data', // 仓库根 JSON 真相源（N6：不引入 Content Collections，直接 import）
      },
    },
    // 产物加内容 hash 由 Rollup/Vite 默认提供 —— 替代旧 ?v=20261125x 手工 bump 机制
    build: {
      // 25MiB 单文件上限警示（pages 构建红线），实际触发就说明资源本身该治理
      chunkSizeWarningLimit: 2048,
    },
  },
});
