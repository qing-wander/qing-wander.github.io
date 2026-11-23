/* ──────────────────────────────────────────────────────────────────────
   留言墙新留言通知 · Resend 发信（由 functions/api/wall.js 调用）
   ──────────────────────────────────────────────────────────────────────
   为什么单独放一个 lib：
     · 发信是「写入成功后的旁路」，不应混进留言接口的校验 / 限流逻辑；
     · 纯函数（buildNotice / formatBeijing）+ 单一副作用口（notifyWallMessage），
       测试时不需要真发邮件，也不依赖 Cloudflare 运行时。

   收件人：默认站长本人 hi@chenpeisheng.cn —— Resend 未验证自有域名时，
   onboarding@resend.dev 只能发给注册邮箱；可用 WALL_NOTIFY_TO 覆盖。
   发件人：复用简历转发那套 RESEND_FROM，缺省 onboarding@resend.dev。
   失败策略：任何异常都只记日志并返回 {ok:false}，留言接口照常 201，
   不让第三方发信服务反过来影响访客写留言。

   2026-11-23 起增加「访客评论通知」buildReplyNotice / notifyWallReply：
   访客在原留言下追问时同样发一封给站长，正文带 ?focus= 直达链接，
   后台点开就定位到那条留言的回复面板，不用自己在列表里翻。
   ────────────────────────────────────────────────────────────────────── */

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_TO = 'hi@chenpeisheng.cn';
const DEFAULT_FROM = 'Portfolio Wall <onboarding@resend.dev>';
const ADMIN_URL = 'https://shenge-work-admin.pages.dev';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* 邮件正文是 HTML：访客可控的 name / text 必须转义，正文换行用 pre-wrap 保留 */
export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* 固定按北京时间呈现，不依赖 Workers 是否带完整 ICU 数据 */
export function formatBeijing(ts) {
  const d = new Date((Number(ts) || Date.now()) + 8 * 3600000);
  return d.toISOString().slice(0, 19).replace('T', ' ') + ' (UTC+8)';
}

function safeMeta(value, max) {
  return String(value == null ? '' : value).replace(/[\r\n<>]/g, ' ').trim().slice(0, max);
}

/* 生成邮件三件套。item = {id, name, text, created_at}，meta = {origin, deviceHash} */
export function buildNotice(item, meta) {
  const name = safeMeta(item && item.name, 16) || '匿名访客';
  const text = String((item && item.text) || '').slice(0, 300);
  const time = formatBeijing(item && item.created_at);
  const id = safeMeta(item && item.id, 64);
  const origin = safeMeta(meta && meta.origin, 120);
  const device = safeMeta(meta && meta.deviceHash, 32);

  const snippet = text.replace(/\s+/g, ' ').slice(0, 24);
  const subject = '【留言墙】' + name + ' · ' + time.slice(5, 16) + (snippet ? ' · ' + snippet : '');

  const rows = [
    ['称呼', name],
    ['时间', time],
    ['来源', origin || '—'],
    ['设备指纹', device || '—'],
    ['留言 ID', id || '—'],
  ];
  const textBody = [
    '【留言墙】收到一条新留言',
    '',
    rows.map(([k, v]) => k + '：' + v).join('\n'),
    '',
    '正文：',
    text,
    '',
    '后台查看 / 审核：' + ADMIN_URL,
  ].join('\n');

  const tableRows = rows.map(([k, v]) =>
    '<tr><td style="padding:6px 12px 6px 0;font:12px/1.6 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#6b675e;white-space:nowrap;vertical-align:top;">' +
    escapeHtml(k) + '</td><td style="padding:6px 0;font:14px/1.6 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#141311;word-break:break-all;">' +
    escapeHtml(v) + '</td></tr>'
  ).join('');

  const html = [
    '<div style="background:#f4f1e8;padding:24px;">',
    '<div style="max-width:560px;margin:0 auto;background:#fffdf7;border:2px solid #141311;box-shadow:6px 6px 0 #141311;padding:24px;">',
    '<div style="font:bold 12px/1.5 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.12em;color:#2B4BE0;">WALL / NEW MESSAGE</div>',
    '<h1 style="margin:8px 0 16px;font:bold 22px/1.4 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#141311;">留言墙收到新留言</h1>',
    '<table style="border-collapse:collapse;width:100%;">' + tableRows + '</table>',
    '<div style="margin-top:18px;border:2px solid #141311;background:#fff;padding:16px;">',
    '<div style="margin-bottom:8px;font:bold 12px/1.5 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.1em;color:#6b675e;">TEXT / 正文</div>',
    '<div style="white-space:pre-wrap;font:15px/1.8 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#141311;">' + escapeHtml(text) + '</div>',
    '</div>',
    '<a href="' + ADMIN_URL + '" style="display:inline-block;margin-top:20px;padding:10px 16px;background:#2B4BE0;border:2px solid #141311;color:#fff;text-decoration:none;font:bold 13px/1.4 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;">打开后台查看 / 审核 →</a>',
    '</div></div>',
  ].join('');

  return { subject, text: textBody, html };
}

/* 访客在原留言下追问时发给站长。
   item = { messageId, messageText, name, text, created_at }
   meta = { origin, deviceHash }
   邮件带原留言正文 + ?focus= 直达链接：后台打开后自动定位到这条留言的回复面板。 */
export function buildReplyNotice(item, meta) {
  const name = safeMeta(item && item.name, 16) || '匿名访客';
  const messageText = String((item && item.messageText) || '').slice(0, 300);
  const text = String((item && item.text) || '').slice(0, 300);
  const time = formatBeijing(item && item.created_at);
  const id = safeMeta(item && item.messageId, 64);
  const focus = id ? ADMIN_URL + '/?focus=' + encodeURIComponent(id) : ADMIN_URL;
  const origin = safeMeta(meta && meta.origin, 120);
  const device = safeMeta(meta && meta.deviceHash, 32);
  const snippet = text.replace(/\s+/g, ' ').slice(0, 24);

  const subject = '【留言墙】新评论 · ' + name + ' · ' + time.slice(5, 16) +
    (snippet ? ' · ' + snippet : '');

  const rows = [
    ['称呼', name],
    ['时间', time],
    ['来源', origin || '—'],
    ['设备指纹', device || '—'],
    ['留言 ID', id || '—'],
  ];
  const textBody = [
    '【留言墙】访客在原留言下追加了评论',
    '',
    rows.map(([k, v]) => k + '：' + v).join('\n'),
    '',
    '原留言：',
    messageText,
    '',
    '新评论：',
    text,
    '',
    '直接打开并回复：' + focus,
  ].join('\n');

  const tableRows = rows.map(([k, v]) =>
    '<tr><td style="padding:6px 12px 6px 0;font:12px/1.6 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#6b675e;white-space:nowrap;vertical-align:top;">' +
    escapeHtml(k) + '</td><td style="padding:6px 0;font:14px/1.6 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#141311;word-break:break-all;">' +
    escapeHtml(v) + '</td></tr>'
  ).join('');

  const quote = (label, body, bg) =>
    '<div style="margin-top:14px;border:2px solid #141311;background:' + bg + ';padding:16px;">' +
    '<div style="margin-bottom:8px;font:bold 12px/1.5 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.1em;color:#6b675e;">' +
    escapeHtml(label) + '</div>' +
    '<div style="white-space:pre-wrap;font:15px/1.8 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#141311;">' +
    escapeHtml(body) + '</div></div>';

  const html = [
    '<div style="background:#f4f1e8;padding:24px;">',
    '<div style="max-width:560px;margin:0 auto;background:#fffdf7;border:2px solid #141311;box-shadow:6px 6px 0 #141311;padding:24px;">',
    '<div style="font:bold 12px/1.5 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.12em;color:#2B4BE0;">WALL / NEW REPLY</div>',
    '<h1 style="margin:8px 0 16px;font:bold 22px/1.4 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#141311;">留言墙收到一条新评论</h1>',
    '<table style="border-collapse:collapse;width:100%;">' + tableRows + '</table>',
    quote('ORIGINAL / 原留言', messageText, '#f4f1e8'),
    quote('REPLY / 新评论', text, '#fff'),
    '<a href="' + escapeHtml(focus) + '" style="display:inline-block;margin-top:20px;padding:10px 16px;background:#2B4BE0;border:2px solid #141311;color:#fff;text-decoration:none;font:bold 13px/1.4 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;">打开后台直接回复 →</a>',
    '</div></div>',
  ].join('');

  return { subject, text: textBody, html };
}

/* 唯一的副作用口：发不出去就记录并返回失败，绝不 throw 给调用方。
   新留言通知与访客评论通知共用这段投递逻辑，只换邮件内容。 */
async function deliverNotice(env, mail) {
  try {
    const key = String((env && env.RESEND_API_KEY) || '').trim();
    if (!key) {
      console.warn('[wall-notify] 未配置 RESEND_API_KEY，跳过邮件通知');
      return { ok: false, reason: 'no_api_key' };
    }
    const to = String((env && env.WALL_NOTIFY_TO) || DEFAULT_TO).trim();
    if (!EMAIL_RE.test(to)) {
      console.warn('[wall-notify] 收件人地址不合法：' + to);
      return { ok: false, reason: 'invalid_recipient' };
    }
    const from = String(
      (env && env.WALL_NOTIFY_FROM) || (env && env.RESEND_FROM) || DEFAULT_FROM
    ).trim();

    const resp = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
    });

    if (!resp.ok) {
      let detail = '';
      try { detail = (await resp.text()).slice(0, 200); } catch (e) {}
      console.error('[wall-notify] Resend 返回 ' + resp.status + '：' + detail);
      return { ok: false, reason: 'resend_error', status: resp.status };
    }

    let id = '';
    try { id = (await resp.json()).id || ''; } catch (e) {}
    console.log('[wall-notify] 已发送 ' + id + ' → ' + to);
    return { ok: true, id, to };
  } catch (e) {
    console.error('[wall-notify] 发信失败（不影响留言写入）', (e && e.message) || e);
    return { ok: false, reason: 'exception' };
  }
}

export async function notifyWallMessage(env, item, meta) {
  return deliverNotice(env, buildNotice(item, meta));
}

export async function notifyWallReply(env, item, meta) {
  return deliverNotice(env, buildReplyNotice(item, meta));
}
