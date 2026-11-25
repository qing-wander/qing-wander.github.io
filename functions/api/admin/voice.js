/* /api/admin/voice —— 后台「AI 语音」音色切换
   ──────────────────────────────────────────────────────────────
   GET  列出可选音色 + 当前生效音色（写过的才算自定义，否则回默认）
   POST { voice } 切换；voice = 0 / null 表示恢复默认（删掉这条记录）

   存 D1 的 admin_config.key = 'ai_voice'，与主题、提示词同一张表：
   改完立即对公开站生效（/api/voice 读这份，60 秒缓存）。
   音色白名单在 lib/tts.js —— 前端、/api/voice、合成接口共用一份，不会漂。
   ────────────────────────────────────────────────────────────── */
import { assertCsrf, fail, json, requireAdmin } from '../../lib/admin-auth.js';
import {
  DEFAULT_VOICE, MAX_TTS_CHARS, VOICES, isKnownVoice, ttsEndpoint, voiceMeta,
} from '../../lib/tts.js';

const KEY = 'ai_voice';

export async function onRequestGet({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  let saved = null;
  let updatedAt = 0;
  try {
    const row = await env.DB.prepare('SELECT value, updated_at FROM admin_config WHERE key = ?').bind(KEY).first();
    if (row) {
      updatedAt = Number(row.updated_at) || 0;
      try { saved = JSON.parse(row.value); } catch (e) { saved = null; }
    }
  } catch (e) {
    return json({ ok: false, error: 'db_error', message: '读不到数据库' }, 500);
  }
  const custom = !!(saved && isKnownVoice(saved.voice));
  const voice = custom ? Number(saved.voice) : DEFAULT_VOICE;
  const meta = voiceMeta(voice);
  return json({
    ok: true,
    voice,
    name: meta ? meta.name : '',
    is_default: !custom,
    updated_at: updatedAt,
    default_voice: DEFAULT_VOICE,
    max_chars: MAX_TTS_CHARS,
    upstream: ttsEndpoint(env),
    voices: VOICES,
  });
}

export async function onRequestPost({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;
  const csrf = assertCsrf(request);
  if (csrf) return csrf;

  let body = {};
  try { body = await request.json(); } catch (e) { return fail('bad_json', '请求体不是 JSON'); }

  const raw = body && body.voice;
  const reset = raw === 0 || raw === '0' || raw === null || raw === '' || raw === undefined;
  const voice = reset ? DEFAULT_VOICE : Number(raw);
  if (!isKnownVoice(voice)) return fail('unknown_voice', '这个音色不在白名单里');

  try {
    if (reset) {
      await env.DB.prepare('DELETE FROM admin_config WHERE key = ?').bind(KEY).run();
    } else {
      const meta = voiceMeta(voice);
      const value = JSON.stringify({ voice, name: meta ? meta.name : '', saved_at: Date.now() });
      await env.DB.prepare(
        `INSERT INTO admin_config (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).bind(KEY, value, Date.now()).run();
    }
  } catch (e) {
    return json({ ok: false, error: 'db_error', message: '写入失败' }, 500);
  }

  const meta = voiceMeta(voice);
  return json({ ok: true, voice, name: meta ? meta.name : '', is_default: reset });
}
