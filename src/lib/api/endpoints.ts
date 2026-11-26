declare global {
  interface Window {
    /** 旧 js/main.js 写入的 AI 端点（M3 收编前由桥接脚本维护） */
    CP_AI_ENDPOINT?: string;
  }
}

/**
 * API 多线路解析（M2）—— 收编自旧版各页内联的 host 判断
 * （docs/react-refactor-plan.md §2.3：window.CP_AI_ENDPOINT / API_BASES 收进 lib，多线路逻辑逐字保留）。
 *
 * 线路规则：github.io 是纯静态托管（无 Functions）→ 直连 Cloudflare Pages；
 * 本地联调走同源 dev-api-server；生产 chenpeisheng.cn 同源。
 */

/** 与留言墙 / 公司互动 / 学历核验一致的线路表 */
export function apiBases(): string[] {
  const host = location.hostname || '';
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(host)) return [''];
  if (/\.github\.io$/i.test(host)) return ['https://shenge-work.pages.dev'];
  return ['', 'https://shenge-work.pages.dev'];
}

/** AI 问答 / JD 匹配端点（旧版 window.CP_AI_ENDPOINT 逻辑收编；fallback 与 jd-match.js 一致） */
export function aiEndpoint(): string {
  if (typeof window !== 'undefined' && window.CP_AI_ENDPOINT) return window.CP_AI_ENDPOINT;
  const host = typeof location !== 'undefined' ? location.hostname || '' : '';
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(host)) return '/api/chat';
  if (/\.github\.io$/i.test(host)) return 'https://shenge-work.pages.dev/api/chat';
  return '/api/chat';
}

/** 拼接同源或跨线路 URL（旧版 new URL(base + path, location.href).href 的等价封装） */
export function url(base: string, path: string): string {
  return new URL(base + path, location.href).href;
}
