/**
 * AI 数字分身客户端（M3-B）—— 自 js/main.js 第 11 节逐字平移的数据 / 请求 / 文案层。
 *
 * 桥接契约（外围脚本零改动协作，docs/react-refactor-plan.md §2.3）：
 * - ai-skins.js / ai-voice.js / ai-voice-cloud.js / ai-stage-link.js /
 *   ai-panel-ux.js / gender-switch.js 继续观察固定 DOM id 与 window 全局；
 * - window.CP_AI_ENDPOINT 由 index.astro 的 main.js 守卫分支（同步时序）兜底设置，
 *   岛水合后这里再设一份（双保险）；window.CP_GREETING_TEXT / cpai:greeting 事件
 *   与旧版一致（ai-voice.js 招呼语联动）。
 */

import { aiEndpoint } from '../../lib/api/endpoints';

/* ── 配置（AI_CONFIG 平移；旧版 js/main.js 982-1011 行） ── */

export const AI = {
  /** 问答超时：云函数执行超时 30s，前端留余量 */
  timeout: 20000,
  /** 与后端 MAX_QUESTION_CHARS 对齐 */
  maxChars: 200,
  /** 欢迎语先放默认值；后台在 /admin「AI 语音」改的招呼文案异步覆盖下来 */
  welcome: '你好，我是李清的数字分身。<br>你可以把我当成「在线的他」：关于他的项目、技术栈和工作经历，都能直接问我。我会依据他的真实简历资料作答，并标注出处。<br>想了解什么，尽管开口。',
  quickQuestions: ['你主导过哪些 0→1 系统？', '你的 Agent 架构经验？', '技术栈与方向？', '怎么联系你？'],
  jd: {
    minChars: 30,
    maxChars: 1500,
    samples: [
      { key: 'agent', label: 'Agent 岗' },
      { key: 'backend', label: '后端岗' },
      { key: 'solution', label: '售前岗' },
    ],
  },
} as const;

/* ── 问答响应（functions/api/chat.js 契约 { question } → { ok, answer, sources[], fallback }） ── */

export interface AiSource {
  id?: string;
  title?: string;
  excerpt?: string;
  text?: string;
}

export interface ChatData {
  ok: true;
  answer?: string;
  sources?: AiSource[];
  fallback?: boolean;
}

/* ── HTML 转义（与旧版 esc() 同口径） ── */

export function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string;
  });
}

/* ── 招呼文案：后台 /api/greeting 一处改，面板欢迎语与语音招呼语同步 ──
   启动即异步拉取，不挡首屏；文案是纯文本，按换行转义成 <br> 后渲染。 */
export function greetingToHtml(text: string): string {
  return esc(text || '').replace(/\r?\n/g, '<br>');
}

/** 拉取 /api/greeting：成功时更新 welcome 并同步语音模块契约；失败静默回退默认文案。 */
export async function fetchGreeting(onLoaded: (html: string) => void): Promise<void> {
  try {
    const base = aiEndpoint().replace(/\/api\/chat$/, '');
    const r = await fetch(base + '/api/greeting', { cache: 'no-store' });
    if (!r.ok) return;
    const j = (await r.json()) as { ok?: boolean; text?: string } | null;
    if (!j || j.ok !== true || !j.text) return;
    /* 交给语音模块：Greet 文本与面板欢迎语保持同一份（事件 + window 双通道，与旧版一致） */
    window.CP_GREETING_TEXT = String(j.text);
    if (window.dispatchEvent && typeof window.CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('cpai:greeting', { detail: { text: String(j.text) } }));
    }
    onLoaded(greetingToHtml(j.text));
  } catch {
    /* 拿不到配置就用默认文案，不影响问答 */
  }
}

/* ── 真实请求：POST /chat，{ question } → { ok, answer, sources[] }（askAI 平移） ── */

export function askAI(question: string): Promise<ChatData> {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const opts: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  };
  if (ctrl) opts.signal = ctrl.signal;

  return new Promise<ChatData>((resolve, reject) => {
    const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch { /* noop */ } }, AI.timeout) : null;
    fetch(aiEndpoint(), opts)
      .then((r) =>
        r.text().then((txt) => {
          let d: unknown;
          try { d = JSON.parse(txt); } catch { d = null; }
          const obj = d as (ChatData & { error?: unknown }) | null;
          if (!obj) { reject(new Error('bad_json')); return; }
          if (!r.ok || obj.ok !== true) {
            reject(new Error(typeof obj.error === 'string' && obj.error ? obj.error : 'http_' + r.status));
            return;
          }
          resolve(obj);
        }),
      )
      .catch(reject)
      .then(() => { if (timer) clearTimeout(timer); });
  });
}

/* ── 错误文案表（aiRenderError 平移，逐字） ── */

export function aiRenderError(err: { message?: string } | null | undefined): string {
  const code = (err && err.message) || '';
  if (code === 'rate_limited') return '▍问得有点急，隔一分钟再问我吧。';
  if (code === 'AbortError') return '▍响应超时了，稍等再试一次。';
  if (code === 'origin_denied' || code === 'bad_request') {
    return '▍通道拒绝了这次请求。可以直接邮件联系：hi@qingfin.cn';
  }
  return '▍通道暂时不可用，请稍后再试，或邮件联系：hi@qingfin.cn';
}

/* ── window 契约（岛水合后设置；main.js 守卫分支已兜底同步时序） ── */

declare global {
  interface Window {
    CP_GREETING_TEXT?: string;
  }
}

export function syncWindowContracts(): void {
  window.CP_AI_ENDPOINT = aiEndpoint();
}
