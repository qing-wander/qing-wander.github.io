/* 数字分身「打招呼文案」· 后端共享默认值与读写
   ──────────────────────────────────────────────────────────────
   一处配置，三处生效：面板欢迎语（js/main.js）、语音招呼语（js/ai-voice.js）、
   后台试听默认文本（functions/api/admin/voice/preview.js）。

   存 admin_config.key = 'ai_greeting'，与主题（theme）、音色（ai_voice）
   同一张表：改完立即对公开站生效，不用重新构建静态文件。

   为什么默认值写在代码里：新部署 / 新库没灌种子也能直接跑。
   为什么服务端拒绝尖括号：文案是纯文本，前端按 esc + 换行转 <br> 渲染，
   允许 HTML 只会让「配置」变成「注入」，没有收益。
   ────────────────────────────────────────────────────────────── */

export const GREETING_KEY = 'ai_greeting';
export const DEFAULT_GREETING = '你好，我是陈培胜的数字分身。他的项目经历、技术栈和协作方式，都可以直接问我。';
/* 与 TTS 的 MAX_TTS_CHARS 对齐：文案要能被云端一口气播完，别到前端才截断 */
export const MAX_GREETING_CHARS = 150;

/** 归一化 + 校验：返回 { text } 或 { error } */
export function normalizeGreeting(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return { error: 'empty_text' };
  if (Array.from(text).length > MAX_GREETING_CHARS) return { error: 'text_too_long' };
  if (/[<>]/.test(text)) return { error: 'html_not_allowed' };
  return { text };
}

/** 读当前生效文案；任何异常都回默认值，不让配置拖垮公开站 */
export async function readGreeting(env) {
  const fallback = { text: DEFAULT_GREETING, is_default: true, updated_at: 0 };
  if (!env || !env.DB) return fallback;
  try {
    const row = await env.DB.prepare('SELECT value, updated_at FROM admin_config WHERE key = ?')
      .bind(GREETING_KEY).first();
    if (!row) return fallback;
    const saved = JSON.parse(row.value || '{}');
    const check = normalizeGreeting(saved.text);
    if (check.error) return fallback;
    return { text: check.text, is_default: false, updated_at: Number(row.updated_at) || 0 };
  } catch (e) {
    return fallback;
  }
}
