/* GET /api/voice —— 公开站读取「当前音色」
   ──────────────────────────────────────────────────────────────
   后台在 /admin「AI 语音」里选定音色后写进 D1（admin_config.key = 'ai_voice'），
   这里读出来交给 js/ai-voice-cloud.js，合成时带上 voice 字段。

   为什么值得单独一个接口：音色是运营参数，改完要立刻生效；写进静态 JSON
   就得重新构建 + 等 CDN。这里只回一个整数，60 秒缓存，成本可以忽略。
   读不到 / 没配 / 值非法 → 一律回落默认音色，前端不需要处理异常分支。
   ────────────────────────────────────────────────────────────── */
import { corsHeaders, allowedOrigins } from '../lib/guard.js';
import { DEFAULT_VOICE, isKnownVoice, voiceMeta } from '../lib/tts.js';

function reply(data, request, status) {
  const origin = request && request.headers.get('Origin');
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      /* 音色改了最多 1 分钟生效，没必要让每个访客都打一次数据库 */
      'Cache-Control': 'public, max-age=60',
    }, corsHeaders(origin, allowedOrigins()), { 'Access-Control-Allow-Methods': 'GET, OPTIONS' }),
  });
}

export async function onRequestGet({ request, env }) {
  let voice = DEFAULT_VOICE;
  if (env && env.DB) {
    try {
      const row = await env.DB.prepare("SELECT value FROM admin_config WHERE key = 'ai_voice'").first();
      const saved = row ? JSON.parse(row.value) : null;
      if (saved && isKnownVoice(saved.voice)) voice = Number(saved.voice);
    } catch (e) { /* 库挂了就回默认，不把语音功能拖死 */ }
  }
  const meta = voiceMeta(voice);
  return reply({ ok: true, voice, name: meta ? meta.name : '', note: meta ? meta.note : '' }, request);
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get('Origin'), allowedOrigins()) });
}
