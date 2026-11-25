/* GET /api/greeting —— 公开站读取「打招呼文案」
   ──────────────────────────────────────────────────────────────
   后台在 /admin「AI 语音」里改文案后写进 D1（admin_config.key='ai_greeting'），
   这里读出来交给首页：面板欢迎语 + 语音招呼语都用它，改完不用重新构建。

   和 /api/theme、/api/voice 同构：跨域可读（github.io 主站 → pages.dev 函数），
   60 秒缓存（低频配置，不必每个访客都打一次 D1）。
   读不到 / 没配 / 值非法 → 一律回默认文案，前端不需要处理异常分支。
   ────────────────────────────────────────────────────────────── */
import { corsHeaders, allowedOrigins } from '../lib/guard.js';
import { readGreeting, DEFAULT_GREETING } from '../lib/greeting.js';

function reply(data, request) {
  const origin = request && request.headers.get('Origin');
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    }, corsHeaders(origin, allowedOrigins(), 'GET, OPTIONS')),
  });
}

export async function onRequestGet({ request, env }) {
  const g = await readGreeting(env);
  return reply({ ok: true, text: g.text, is_default: g.is_default }, request);
}

export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get('Origin'), allowedOrigins(), 'GET, OPTIONS'),
  });
}
