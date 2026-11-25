/* ──────────────────────────────────────────────────────────────────────
   学历核验 · 邮件审批页（/api/verify-access-approve）
   ──────────────────────────────────────────────────────────────────────
   GET  ?id=…&exp=…&sig=…  校验签名后展示申请详情 + 批准/拒绝按钮。
                            只读，不因邮件客户端预读链接而误批。
   POST 同 URL + decision=approve|reject   真正写入 D1 状态。

   批准后访客页面轮询 /api/verify-access?id=… 即可实时解锁，无需刷新。
   签名规则见 functions/lib/verify-access-token.js。
   ────────────────────────────────────────────────────────────────────── */

import { escapeHtml, formatBeijing } from '../lib/wall-notify.js';
import { verifyApproval } from '../lib/verify-access-token.js';

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function page(title, body) {
  return new Response('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + escapeHtml(title) + '</title><style>' +
    '*{box-sizing:border-box}body{margin:0;padding:28px 16px;background:#f4f1e8;color:#141311;' +
    "font:14px/1.7 'PingFang SC','Microsoft YaHei',sans-serif}" +
    '.card{max-width:620px;margin:0 auto;background:#fffdf7;border:3px solid #141311;box-shadow:8px 8px 0 #141311;padding:24px}' +
    '.kicker{font:bold 11px/1.5 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.12em;color:#C4112C}' +
    'h1{font-size:21px;margin:6px 0 14px}.note{font-size:12px;color:#6b675e;margin:0 0 16px}' +
    'table{border-collapse:collapse;width:100%;margin:10px 0 16px}' +
    'td{padding:7px 10px;border-bottom:1px solid #ddd7c8;vertical-align:top;word-break:break-all}' +
    'td.k{width:112px;white-space:nowrap;color:#6b675e;font-size:12px}' +
    '.reason{white-space:pre-wrap;border:2px dashed #141311;padding:12px;background:#fff;margin:6px 0 18px}' +
    '.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}' +
    'button{font:bold 14px/1.4 inherit;padding:12px 18px;border:3px solid #141311;cursor:pointer}' +
    '.yes{background:#141311;color:#fff}.no{background:#fffdf7;color:#141311}' +
    '.yes:hover,.no:hover{transform:translate(-2px,-2px)}' +
    '.done{border-left:8px solid #FF5A1E;padding:10px 14px;background:#fff;margin:16px 0}' +
    '</style></head><body><div class="card">' + body + '</div></body></html>', {
    status: 200, headers: HEADERS,
  });
}

function detailTable(row) {
  const pairs = [
    ['申请人', row.name],
    ['当前身份', row.identity],
    ['公司 / 机构', row.org || '—'],
    ['联系方式', row.contact || '—'],
    ['查看用途', row.purpose],
    ['申请时间', formatBeijing(row.created_at)],
    ['来源页面', (() => { try { return JSON.parse(row.meta || '{}').origin || '—'; } catch (e) { return '—'; } })()],
    ['申请设备', (() => {
      try {
        const v = String(JSON.parse(row.meta || '{}').deviceId || '');
        return v ? v.slice(0, 8) + '…（批准后仅此设备可查看）' : '—';
      } catch (e) { return '—'; }
    })()],
    ['IP 哈希', (() => { try { return JSON.parse(row.meta || '{}').ipHash || '—'; } catch (e) { return '—'; } })()],
  ];
  return '<table>' + pairs.map(([k, v]) =>
    '<tr><td class="k">' + escapeHtml(k) + '</td><td>' + escapeHtml(String(v == null ? '' : v)) + '</td></tr>'
  ).join('') + '</table>' +
    '<div class="kicker">REASON / 查看理由</div><div class="reason">' + escapeHtml(row.reason || '') + '</div>';
}

function statusPage(status) {
  if (status === 'approved') {
    return page('已批准 · 学历核验', '<div class="kicker">VERIFY / APPROVED</div><h1>已批准解锁</h1>' +
      '<div class="done">申请人的页面会在几秒内自动显示验证码与二维码，无需刷新。授权仅对本次申请的设备有效，' +
      '批准后 24 小时自动过期，到期后对方需重新申请。此链接已失效，不能重复操作。</div>');
  }
  if (status === 'rejected') {
    return page('已拒绝 · 学历核验', '<div class="kicker">VERIFY / REJECTED</div><h1>已拒绝申请</h1>' +
      '<div class="done">申请人会看到「未获批准」。此链接已失效，不能重复操作。</div>');
  }
  return page('链接已失效 · 学历核验', '<div class="kicker">VERIFY / EXPIRED</div><h1>链接无效或已过期</h1>' +
    '<p class="note">邮件中的审批链接 7 天后失效，且只能在有效期内操作一次。请让申请人重新提交申请。</p>');
}

async function readParams(request) {
  const u = new URL(request.url);
  let p = u.searchParams;
  if (request.method === 'POST') {
    let text = await request.text();
    if ((request.headers.get('Content-Type') || '').indexOf('application/json') >= 0) {
      try { const o = JSON.parse(text || '{}'); p = new URLSearchParams(); Object.keys(o).forEach(k => p.set(k, String(o[k]))); }
      catch (e) { p = new URLSearchParams(); }
    } else {
      p = new URLSearchParams(text);
    }
  }
  return {
    id: String(p.get('id') || '').trim(),
    exp: String(p.get('exp') || '').trim(),
    sig: String(p.get('sig') || '').trim(),
    decision: String(p.get('decision') || '').trim(),
  };
}

async function loadRequest(env, id) {
  if (!env.DB) return null;
  try {
    return await env.DB.prepare('SELECT * FROM verify_access_requests WHERE id = ?').bind(id).first();
  } catch (e) {
    console.warn('[verify-approve] 读取申请失败', (e && e.message) || e);
    return null;
  }
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { id, exp, sig } = await readParams(request);
  if (!(await verifyApproval(id, exp, sig, env))) return statusPage('expired');
  const row = await loadRequest(env, id);
  if (!row) return statusPage('expired');
  if (row.status !== 'pending') return statusPage(row.status);

  const action = new URL(request.url).pathname;
  const body =
    '<div class="kicker">VERIFY / APPROVAL REQUEST</div><h1>学历核验 · 访问审批</h1>' +
    '<p class="note">请核对下面信息与申请人自述是否一致，再决定是否解锁。批准会实时作用于对方打开的页面。</p>' +
    detailTable(row) +
    '<form method="post" action="' + escapeHtml(action) + '">' +
      '<input type="hidden" name="id" value="' + escapeHtml(id) + '">' +
      '<input type="hidden" name="exp" value="' + escapeHtml(exp) + '">' +
      '<input type="hidden" name="sig" value="' + escapeHtml(sig) + '">' +
      '<div class="row"><button class="yes" type="submit" name="decision" value="approve">✓ 核实无误，批准解锁</button>' +
      '<button class="no" type="submit" name="decision" value="reject">× 信息存疑，拒绝</button></div>' +
    '</form>';
  return page('学历核验审批', body);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const { id, exp, sig, decision } = await readParams(request);
  if (!(await verifyApproval(id, exp, sig, env))) return statusPage('expired');
  const row = await loadRequest(env, id);
  if (!row) return statusPage('expired');
  if (row.status !== 'pending') return statusPage(row.status);

  const approve = decision === 'approve';
  if (!approve && decision !== 'reject') return statusPage('expired');
  try {
    await env.DB.prepare(
      'UPDATE verify_access_requests SET status = ?, approved_at = ? WHERE id = ? AND status = \'pending\''
    ).bind(approve ? 'approved' : 'rejected', approve ? Date.now() : null, id).run();
    console.log('[verify-approve] ' + id.slice(0, 8) + ' → ' + (approve ? 'approved' : 'rejected'));
  } catch (e) {
    console.error('[verify-approve] 写入审批结果失败', (e && e.message) || e);
    return page('写入失败', '<div class="kicker">VERIFY / ERROR</div><h1>写入失败</h1>' +
      '<p class="note">数据库暂时不可用，请稍后重新打开邮件中的链接再试。</p>');
  }
  return statusPage(approve ? 'approved' : 'rejected');
}
