/**
 * /admin SPA 入口（M1）。
 * 为什么不是 Astro islands：middleware 对 /admin 的 CSP 是
 * script-src 'self'（禁内联），而岛水合需要内联 bootstraps ——
 * 因此后台走「静态壳 + 外链 bundle」的经典 SPA 引导（docs/react-refactor-plan.md §6-M1 决策记录）。
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminApp } from './AdminApp';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 0,          // 切 tab 即取新，与旧 admin 行为一致
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AdminApp />
    </QueryClientProvider>
  </StrictMode>,
);
