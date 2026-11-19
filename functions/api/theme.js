/* GET /api/theme —— 站点默认主题
   ──────────────────────────────────────────────────────────────
   后台在 admin_config 里写 {theme: 'blueprint'} 这种，这里读出来交给前端引导脚本。
   优先级在页面上决定：?theme= > 访客手动锁定 > 这里的默认 > 按日期轮换。
   缓存 60s：主题是低频配置，没必要每个访客都打一次 D1。
   ────────────────────────────────────────────────────────────── */
const THEMES = ['archive', 'blueprint', 'newsprint', 'noir'];

export async function onRequestGet({ env }) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=60',
  };
  try {
    if (!env.DB) return new Response(JSON.stringify({ ok: false, theme: null }), { headers });
    const row = await env.DB.prepare("SELECT value FROM admin_config WHERE key = 'theme'").first();
    const saved = row ? JSON.parse(row.value) : null;
    const theme = saved && THEMES.includes(saved.theme) ? saved.theme : null;
    return new Response(JSON.stringify({ ok: true, theme }), { headers });
  } catch (e) {
    /* 配置表不存在 / 读失败都退回"前端按日期轮换"，不影响访问 */
    return new Response(JSON.stringify({ ok: false, theme: null }), { headers });
  }
}
