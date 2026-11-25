/* /api/admin/greeting —— 后台「打招呼文案」
   ──────────────────────────────────────────────────────────────
   GET  读当前文案（未配置 = 代码里的默认值）
   POST { text } 保存；{ reset: true } 恢复默认（删掉这条记录）

   存 admin_config.key = 'ai_greeting'；公开端 /api/greeting 读同一份，
   首页面板欢迎语 + 语音招呼语 + 后台试听框都跟着变。
   白名单之外的 key 进不来：这里只写固定 key，不像 /api/config 那样吃外部 key。
   ────────────────────────────────────────────────────────────── */
import { assertCsrf, fail, json, requireAdmin } from '../../lib/admin-auth.js';
import {
  GREETING_KEY, DEFAULT_GREETING, MAX_GREETING_CHARS, normalizeGreeting, readGreeting,
} from '../../lib/greeting.js';

export async function onRequestGet({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  const g = await readGreeting(env);
  return json({
    ok: true,
    text: g.text,
    is_default: g.is_default,
    updated_at: g.updated_at,
    default_text: DEFAULT_GREETING,
    max_chars: MAX_GREETING_CHARS,
  });
}

export async function onRequestPost({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  const csrf = assertCsrf(request);
  if (csrf) return csrf;

  let body = {};
  try { body = await request.json(); } catch (e) { return fail('bad_json', '请求体不是 JSON'); }

  const reset = !!(body && body.reset);
  let text = '';
  if (!reset) {
    const checked = normalizeGreeting(body && body.text);
    if (checked.error === 'empty_text') return fail('empty_text', '文案不能为空');
    if (checked.error === 'text_too_long') return fail('too_long', `文案超过 ${MAX_GREETING_CHARS} 字`);
    if (checked.error === 'html_not_allowed') return fail('html_not_allowed', '只接受纯文本，不要写 HTML 标签');
    text = checked.text;
  }

  try {
    if (reset) {
      await env.DB.prepare('DELETE FROM admin_config WHERE key = ?').bind(GREETING_KEY).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO admin_config (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).bind(GREETING_KEY, JSON.stringify({ text }), Date.now()).run();
    }
  } catch (e) {
    return json({ ok: false, error: 'db_error', message: '写入失败' }, 500);
  }

  return json({
    ok: true,
    text: reset ? DEFAULT_GREETING : text,
    is_default: reset,
  });
}
