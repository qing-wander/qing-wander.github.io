import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// vitest 默认不开 globals 时，RTL 的自动 cleanup 不会生效 —— 显式挂载
afterEach(() => {
  cleanup();
});
