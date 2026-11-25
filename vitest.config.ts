import { defineConfig } from 'vitest/config';

// React 组件单测（M0 起）：node:test 保留给后端纯函数层（tests/*.test.mjs），两层互不替代
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/vitest.setup.ts'],
    css: false,
  },
});
