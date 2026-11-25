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
  DEFAULT_VOICE, DEFAULT_VOICE_BY_GENDER, MAX_TTS_CHARS, VOICES,
  isGender, isKnownVoice, ttsEndpoint, voiceMeta,
} from '../../lib/tts.js';

const KEY = 'ai_voice';

/* 套装配置：男/女各一个 key，旧的单音色 ai_voice 仍保留兼容。 */
function keyOf(gender) {
  return isGender(gender) ? 'ai_voice_' + gender : KEY;
}

export async function onRequestGet({ request, env }) {
  const deny = await requireAdmin(request, env);
  if (deny) return deny;

  const read = async (key) => {
    try {
      const row = await env.DB.prepare('SELECT value, updated_at FROM admin_config WHERE key = ?').bind(key).first();
      let saved = null;
      if (row) { try { saved = JSON.parse(row.value); } catch (e) { saved = null; } }
      const custom = !!(saved && isKnownVoice(saved.voice));
      return {
        voice: custom ? Number(saved.voice) : DEFAULT_VOICE_BY_GENDER[key.slice('ai_voice_'.length)] || DEFAULT_VOICE,
        isDefault: !custom,
        updatedAt: row ? Number(row.updated_at) || 0 : 0,
      };
    } catch (e) {
      return null;
    }
  };

  const legacy = await read(KEY);
  const female = await read('ai_voice_female');
  const male = await read('ai_voice_male');
  if (!legacy || !female || !male) {
    return json({ ok: false, error: 'db_error', message: '读不到数据库' }, 500);
  }
  const meta = voiceMeta(legacy.voice);
  return json({
    ok: true,
    /* 下面三个兼容旧前端：不带 gender 时仍表示全局音色 */
    voice: legacy.voice,
    name: meta ? meta.name : '',
    is_default: legacy.isDefault,
    updated_at: legacy.updatedAt,
    default_voice: DEFAULT_VOICE,
    /* 套装：后台按性别分别配置 */
    female_voice: female.voice,
    male_voice: male.voice,
    female_is_default: female.isDefault,
    male_is_default: male.isDefault,
    default_female_voice: DEFAULT_VOICE_BY_GENDER.female,
    default_male_voice: DEFAULT_VOICE_BY_GENDER.male,
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
  const gender = isGender(body && body.gender) ? body.gender : '';
  const key = keyOf(gender);
  const reset = raw === 0 || raw === '0' || raw === null || raw === '' || raw === undefined;
  const voice = reset ? (DEFAULT_VOICE_BY_GENDER[gender] || DEFAULT_VOICE) : Number(raw);
  if (!isKnownVoice(voice)) return fail('unknown_voice', '这个音色不在白名单里');

  try {
    if (reset) {
      await env.DB.prepare('DELETE FROM admin_config WHERE key = ?').bind(key).run();
    } else {
      const meta = voiceMeta(voice);
      const value = JSON.stringify({ voice, name: meta ? meta.name : '', gender: gender || 'any', saved_at: Date.now() });
      await env.DB.prepare(
        `INSERT INTO admin_config (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).bind(key, value, Date.now()).run();
    }
  } catch (e) {
    return json({ ok: false, error: 'db_error', message: '写入失败' }, 500);
  }

  const meta = voiceMeta(voice);
  return json({ ok: true, voice, gender: gender || 'any', name: meta ? meta.name : '', is_default: reset });
}
