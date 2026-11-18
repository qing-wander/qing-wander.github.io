/* ──────────────────────────────────────────────────────────────────────
   留言板管理 API · Cloudflare Pages Function（路由 /api/admin/wall/*）
   ──────────────────────────────────────────────────────────────────────
   给「独立后台」（shenge-work-admin.pages.dev）用的只读+轻写接口：
     GET  /api/admin/wall/devices?limit=50&offset=0&q=       设备列表（含留言数、状态）
     GET  /api/admin/wall/messages?device_hash=&status=&limit=&offset=
                                                             全量留言（可按设备/状态过滤）
     GET  /api/admin/wall/export                             导出 CSV（设备 + 留言）
     POST /api/admin/wall/messages/<id>/status {status}      隐藏 / 恢复某条留言
     POST /api/admin/wall/devices/<hash>/block  {blocked}    拉黑 / 解封某台设备

   鉴权（过渡方案）：
     X-Admin-Token == WALL_ADMIN_TOKEN。等后台的 GitHub OAuth 会话上线后，
     这里换成 session 校验（只认 shenge-work 账号），token 只留应急删除。

   注意：本接口返回全站数据（含 legacy 旧留言），绝不能挂在公开可读的路径上；
   Pages 的 /api/admin/* 与公开站同域，但只有带 token 的请求才会返回内容。
   ────────────────────────────────────────────────────────────────────── */

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: JSON_HEADERS });
}

function safeEqual(a, b) {
  const x = String(a || ''), y = String(b || '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function intParam(v, min, max, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function onRequestGet({ request, env }) {
  const token = env.WALL_ADMIN_TOKEN;
  if (!token) return json({ ok: false, error: 'not_found' }, 404);
  if (!safeEqual(request.headers.get('X-Admin-Token'), token)) return json({ ok: false, error: 'forbidden' }, 403);

  const db = env.DB;
  if (!db) return json({ ok: false, error: 'db_not_bound' }, 503);

  const url = new URL(request.url);
  const rest = url.pathname.replace(/^\/api\/admin\/wall\/?/, '').replace(/\/$/, '');

  try {
    if (rest === 'devices') {
      const limit = intParam(url.searchParams.get('limit'), 1, MAX_LIMIT, DEFAULT_LIMIT);
      const offset = intParam(url.searchParams.get('offset'), 0, 1e6, 0);
      const q = String(url.searchParams.get('q') || '').trim().slice(0, 40);
      const where = q ? 'WHERE d.device_hash LIKE ?' : '';
      const rows = await db.prepare(
        `SELECT d.device_hash, d.first_seen, d.last_seen, d.post_count, d.status, d.note, d.ua,
                (SELECT COUNT(*) FROM wall_messages m WHERE m.device_hash = d.device_hash) AS messages,
                (SELECT MAX(created_at) FROM wall_messages m WHERE m.device_hash = d.device_hash) AS last_message_at
           FROM wall_devices d ${where}
          ORDER BY d.last_seen DESC LIMIT ? OFFSET ?`
      ).bind(...(q ? [q + '%', limit, offset] : [limit, offset])).all();
      const cnt = await db.prepare(
        `SELECT COUNT(*) AS n FROM wall_devices d ${where}`
      ).bind(...(q ? [q + '%'] : [])).first();
      return json({
        ok: true,
        devices: rows.results || [],
        total: cnt ? cnt.n : 0, limit, offset,
      });
    }

    if (rest === 'messages') {
      const limit = intParam(url.searchParams.get('limit'), 1, MAX_LIMIT, DEFAULT_LIMIT);
      const offset = intParam(url.searchParams.get('offset'), 0, 1e6, 0);
      const status = String(url.searchParams.get('status') || '').trim();
      const dh = String(url.searchParams.get('device_hash') || '').trim().slice(0, 40);
      const conds = [];
      const params = [];
      if (dh) { conds.push('device_hash = ?'); params.push(dh); }
      if (status === 'visible' || status === 'hidden') { conds.push('status = ?'); params.push(status); }
      const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
      const rows = await db.prepare(
        `SELECT seq, id, device_hash, name, text, created_at, status, admin_note, updated_at
           FROM wall_messages ${where} ORDER BY seq DESC LIMIT ? OFFSET ?`
      ).bind(...params, limit, offset).all();
      const cnt = await db.prepare(`SELECT COUNT(*) AS n FROM wall_messages ${where}`)
        .bind(...params).first();
      return json({ ok: true, messages: rows.results || [], total: cnt ? cnt.n : 0, limit, offset });
    }

    if (rest === 'export') {
      const rows = await db.prepare(
        `SELECT seq, id, device_hash, name, text, created_at, status, admin_note
           FROM wall_messages ORDER BY seq ASC`
      ).all();
      const devices = await db.prepare(
        `SELECT device_hash, first_seen, last_seen, post_count, status, ua FROM wall_devices ORDER BY last_seen DESC`
      ).all();
      const head = 'seq,id,device_hash,name,text,created_at_iso,status,admin_note\n';
      const body = (rows.results || []).map((m) => [
        m.seq, m.id, m.device_hash, csvCell(m.name), csvCell(m.text),
        new Date(Number(m.created_at)).toISOString(), m.status, csvCell(m.admin_note),
      ].join(',')).join('\n');
      const devHead = '\n\ndevice_hash,first_seen_iso,last_seen_iso,post_count,status,ua\n';
      const devBody = (devices.results || []).map((d) => [
        d.device_hash,
        new Date(Number(d.first_seen)).toISOString(),
        new Date(Number(d.last_seen)).toISOString(),
        d.post_count, d.status, csvCell(d.ua),
      ].join(',')).join('\n');
      return new Response(head + body + devHead + devBody, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="wall-export.csv"',
          'Cache-Control': 'no-store',
        },
      });
    }

    return json({ ok: false, error: 'not_found' }, 404);
  } catch (e) {
    return json({ ok: false, error: 'db_error' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const token = env.WALL_ADMIN_TOKEN;
  if (!token) return json({ ok: false, error: 'not_found' }, 404);
  if (!safeEqual(request.headers.get('X-Admin-Token'), token)) return json({ ok: false, error: 'forbidden' }, 403);

  const db = env.DB;
  if (!db) return json({ ok: false, error: 'db_not_bound' }, 503);

  let body = {};
  try { body = await request.json(); } catch (e) { body = {}; }

  const url = new URL(request.url);
  const rest = url.pathname.replace(/^\/api\/admin\/wall\/?/, '').replace(/\/$/, '');
  const now = Date.now();

  try {
    /* /messages/<id>/status  —— 隐藏 / 恢复 */
    const m = rest.match(/^messages\/([^/]+)\/status$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const status = String(body.status || '');
      if (status !== 'visible' && status !== 'hidden') {
        return json({ ok: false, error: 'bad_request', message: 'status 只能是 visible / hidden' }, 400);
      }
      const note = String(body.note || '').slice(0, 200) || null;
      const r = await db.prepare(
        'UPDATE wall_messages SET status = ?, admin_note = ?, updated_at = ? WHERE id = ?'
      ).bind(status, note, now, id).run();
      if (!r || !r.meta || r.meta.changes === 0) return json({ ok: false, error: 'not_found' }, 404);
      return json({ ok: true, id, status });
    }

    /* /devices/<hash>/block  —— 拉黑 / 解封 */
    const b = rest.match(/^devices\/([^/]+)\/block$/);
    if (b) {
      const dh = decodeURIComponent(b[1]).slice(0, 40);
      const blocked = !!body.blocked;
      const note = String(body.note || '').slice(0, 200) || null;
      const r = await db.prepare(
        'UPDATE wall_devices SET status = ?, note = ? WHERE device_hash = ?'
      ).bind(blocked ? 'blocked' : 'active', note, dh).run();
      if (!r || !r.meta || r.meta.changes === 0) return json({ ok: false, error: 'not_found' }, 404);
      return json({ ok: true, device_hash: dh, status: blocked ? 'blocked' : 'active' });
    }

    return json({ ok: false, error: 'not_found' }, 404);
  } catch (e) {
    return json({ ok: false, error: 'db_error' }, 500);
  }
}
