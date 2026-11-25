/* GET /api/gender —— 公开站展示套装（后台可改）
   ──────────────────────────────────────────────────────────────
   后台在 admin_config 写 { gender: 'male' | 'female' }，这里读出来交给前端。
   留空（null）= 跟随站点数据 hero.gender，前端再回落男版。
   缓存 60s：低频配置，没必要每个访客都打一次 D1。
   与 /api/theme 同构：跨域可读（github.io 主站 → pages.dev 函数）。
   ────────────────────────────────────────────────────────────── */
const GENDERS = ['male', 'female'];

export async function onRequestGet({ env }) {
  /* 公开只读配置：主站 github.io 与接口站 pages.dev 不同域，必须允许跨域读取，
     否则后台设置的套装在主站永远拿不到（只能静默退回站点数据默认）。 */
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=60',
    'Access-Control-Allow-Origin': '*',
  };
  try {
    if (!env.DB) return new Response(JSON.stringify({ ok: false, gender: null }), { headers });
    const row = await env.DB.prepare("SELECT value FROM admin_config WHERE key = 'gender'").first();
    const saved = row ? JSON.parse(row.value) : null;
    const gender = saved && GENDERS.includes(saved.gender) ? saved.gender : null;
    return new Response(JSON.stringify({ ok: true, gender }), { headers });
  } catch (e) {
    /* 配置表不存在 / 读失败都回退"跟随站点数据默认"，不影响访问 */
    return new Response(JSON.stringify({ ok: false, gender: null }), { headers });
  }
}
