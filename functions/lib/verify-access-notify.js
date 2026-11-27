/* ──────────────────────────────────────────────────────────────────────
   学历核验访问申请通知 · Resend 发信（由 functions/api/verify-access.js 调用）
   ──────────────────────────────────────────────────────────────────────
   为什么要单独放一个 lib：
     · 发信是「写入成功后的旁路」，和接口校验 / 限流彻底解耦；
     · buildAccessNotice 是纯函数，notifyAccessRequest 是唯一副作用口，
       测试时 mock fetch 即可，不依赖 Cloudflare 运行时。

   收件人：默认 hi@qingfin.cn（简历本人），可用 VERIFY_ACCESS_TO 覆盖。
   发件人：访问验证专用 access@qingfin.cn（VERIFY_ACCESS_FROM 可覆盖）；
   与简历投递 / 后台验证码 / 留言通知各自独立，避免互相污染信誉。
   回复：申请人留了邮箱时设 reply_to，本人可直接回邮件核验身份 / 决定解锁。
   失败策略：任何异常只记日志并返回 {ok:false}，不 throw 给接口调用方。

   隐私：IP 只以 HMAC 哈希形式进入邮件；设备信息来自浏览器公开环境
   （平台 / 屏幕 / 语言 / 时区 / 硬件并发数），不采集个人身份数据。
   ────────────────────────────────────────────────────────────────────── */

import { escapeHtml, formatBeijing } from './wall-notify.js';

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_TO = 'hi@qingfin.cn';
const DEFAULT_FROM = '作品集访问验证 <access@qingfin.cn>';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function safeMeta(value, max) {
  return String(value == null ? '' : value).replace(/[\r\n<>]/g, ' ').trim().slice(0, max);
}

/* 生成邮件三件套。
   item = { name, identity, org, contact, purpose, reason, created_at }
   meta = { origin, ipCountry, ipHash, userAgent, device, deviceId }
   approval = { url, expiresAt }  签名审批链接；点开后由本人确认，不是点开即批 */
/* opts.label / opts.resourceTitle：通用加密材料流程传入的资源可读名。
   不传时逐字保持原「学历核验」文案，旧链路行为完全不变。 */
export function buildAccessNotice(item, meta, approval, opts) {
  const i = item || {};
  const m = meta || {};
  const o = opts || {};
  const label = safeMeta(o.label, 40) || '学历核验';
  const resTitle = safeMeta(o.resourceTitle, 80) || label;
  const isSchool = label === '学历核验';
  const target = isSchool ? '学历信息' : (resTitle || label);
  const name = safeMeta(i.name, 40) || '未署名申请人';
  const identity = safeMeta(i.identity, 40) || '未填写';
  const org = safeMeta(i.org, 80) || '—';
  const contact = safeMeta(i.contact, 120) || '—';
  const purpose = safeMeta(i.purpose, 40) || '未填写';
  const reason = String(i.reason || '').slice(0, 600);
  const time = formatBeijing(i.created_at);
  const origin = safeMeta(m.origin, 120) || '—';
  const country = safeMeta(m.ipCountry, 40) || '—';
  const ipHash = safeMeta(m.ipHash, 32) || '—';
  const ua = safeMeta(m.userAgent, 300) || '—';
  const deviceId = safeMeta(m.deviceId, 64) || '—';
  const device = String(m.device || '').slice(0, 800) || '—';
  /* 签名链接整串只做基础清洗，保留 query 里的 & 与 = */
  const approvalUrl = safeMeta(approval && approval.url, 600);
  const expiresAt = safeMeta(approval && approval.expiresAt, 40) || '7 天后';

  const rows = [
    ['申请人', name],
    ['当前身份', identity],
    ['公司 / 机构', org],
    ['联系方式', contact],
    ['查看用途', purpose],
    ['申请时间', time],
    ['来源页面', origin],
    ['IP 国家 / 地区', country],
    ['IP 哈希', ipHash],
  ];
  /* 新资源额外写清「申请的是哪份材料」，方便本人核对；学历核验保持原表不变 */
  if (!isSchool) rows.splice(5, 0, ['申请资源', resTitle]);
  const deviceRows = [
    ['浏览器 UA', ua],
    ['设备指纹', deviceId],
    ['设备环境', device],
  ];

  const subject = '【' + label + '】访问申请 · ' + name + ' · ' + time.slice(5, 16);
  const revealText = isSchool ? '验证码与二维码' : '所申请的材料';
  const signedNote = '材料链接带服务端签名、5 分钟失效并自动续签；旧链接无法继续访问对象存储。';

  const textBody = [
    '【' + label + '】收到一条' + target + '查看权限申请',
    '',
    rows.map(([k, v]) => k + '：' + v).join('\n'),
    '',
    '查看理由：',
    reason,
    '',
    '设备与网络：',
    deviceRows.map(([k, v]) => k + '：' + v).join('\n'),
    '',
    '请核实申请人身份（姓名 + 公司 + 联系方式）后，再决定是否解锁' + revealText + '。',
    '',
    '【批准 / 拒绝解锁】（链接 ' + expiresAt + ' 失效，打开后需再次点按钮确认，邮件客户端预读不会误批）：',
    approvalUrl || '（当前环境未绑定数据库，无法生成审批链接；请改用回复邮件确认）',
    '',
    '批准后，对方页面会在无需刷新的情况下自动显示' + revealText + '。',
    ...(isSchool ? [] : [signedNote]),
    '授权仅对本次申请的设备有效，批准后 24 小时自动过期；到期后对方需重新提交申请。',
    '如需回复申请人：' + (EMAIL_RE.test(contact) ? contact : '（未留邮箱，请从联系方式中判断）'),
  ].join('\n');

  const tableRows = (pairs) => pairs.map(([k, v]) =>
    '<tr><td style="padding:6px 12px 6px 0;font:12px/1.6 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#6b675e;white-space:nowrap;vertical-align:top;">' +
    escapeHtml(k) + '</td><td style="padding:6px 0;font:14px/1.6 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#141311;word-break:break-all;">' +
    escapeHtml(v) + '</td></tr>'
  ).join('');

  const block = (label, body, bg) =>
    '<div style="margin-top:14px;border:2px solid #141311;background:' + bg + ';padding:16px;">' +
    '<div style="margin-bottom:8px;font:bold 12px/1.5 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.1em;color:#6b675e;">' +
    escapeHtml(label) + '</div>' +
    '<div style="white-space:pre-wrap;font:14px/1.8 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#141311;">' +
    escapeHtml(body) + '</div></div>';

  const html = [
    '<div style="background:#f4f1e8;padding:24px;">',
    '<div style="max-width:600px;margin:0 auto;background:#fffdf7;border:2px solid #141311;box-shadow:6px 6px 0 #141311;padding:24px;">',
    '<div style="font:bold 12px/1.5 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.12em;color:#C4112C;">VERIFY / ACCESS REQUEST</div>',
    '<h1 style="margin:8px 0 4px;font:bold 22px/1.4 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#141311;">' +
    escapeHtml(label) + '：有人申请查看' + (isSchool ? '验证码' : '材料') + '</h1>',
    '<p style="margin:0 0 16px;font:12px/1.6 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#6b675e;">请核实申请人身份后再决定是否解锁；邮件中的 IP 仅保留哈希。</p>',
    '<table style="border-collapse:collapse;width:100%;">' + tableRows(rows) + '</table>',
    block('REASON / 查看理由', reason, '#fff'),
    '<div style="margin-top:14px;border:2px solid #141311;background:#f4f1e8;padding:16px;">',
    '<div style="margin-bottom:8px;font:bold 12px/1.5 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.1em;color:#6b675e;">DEVICE &amp; NETWORK / 设备与网络</div>',
    '<table style="border-collapse:collapse;width:100%;">' + tableRows(deviceRows) + '</table>',
    '</div>',
    '<div style="margin-top:18px;padding:12px 14px;border:2px dashed #141311;font:13px/1.7 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#141311;">' +
    '申请人自称「' + escapeHtml(name) + '」' + (org !== '—' ? '，来自 ' + escapeHtml(org) : '') +
    '。请通过留存的联系方式反向确认身份，不要仅凭表单自述解锁。</div>',
    approvalUrl
      ? '<div style="margin-top:18px;border:2px solid #141311;background:#FF5A1E;padding:18px;text-align:center;">' +
        '<div style="margin-bottom:10px;font:bold 12px/1.5 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.1em;color:#141311;">APPROVAL / 审批入口</div>' +
        '<a href="' + escapeHtml(approvalUrl) + '" style="display:inline-block;padding:12px 20px;background:#141311;color:#fff;font:bold 15px/1.4 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;text-decoration:none;border:2px solid #141311;">' +
        '审查并决定是否解锁 →</a>' +
        '<p style="margin:10px 0 0;font:12px/1.6 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#141311;">' +
        '链接 ' + escapeHtml(expiresAt) + ' 失效；打开后需再次点「批准解锁」才生效，邮件预读不会误操作。' +
        '批准后的授权仅对申请人本次使用的设备有效，24 小时后自动过期，到期需重新申请。' +
        (isSchool ? '' : escapeHtml(signedNote)) + '</p>' +
        '<p style="margin:6px 0 0;word-break:break-all;font:11px/1.6 ui-monospace,Menlo,Consolas,monospace;color:#141311;">' +
        escapeHtml(approvalUrl) + '</p></div>'
      : '<p style="margin-top:18px;font:12px/1.6 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#6b675e;">当前环境未绑定数据库，无法生成审批链接；请改用回复邮件确认。</p>',
    '</div></div>',
  ].join('');

  return { subject, text: textBody, html, replyTo: EMAIL_RE.test(contact) ? contact : '' };
}

/* 唯一的副作用口：发不出去只记日志，不把异常抛给接口。 */
async function deliver(env, mail) {
  try {
    const key = String((env && env.RESEND_API_KEY) || '').trim();
    if (!key) {
      console.warn('[verify-access] 未配置 RESEND_API_KEY，跳过邮件通知');
      return { ok: false, reason: 'no_api_key' };
    }
    const to = String((env && env.VERIFY_ACCESS_TO) || DEFAULT_TO).trim();
    if (!EMAIL_RE.test(to)) {
      console.warn('[verify-access] 收件人地址不合法：' + to);
      return { ok: false, reason: 'invalid_recipient' };
    }
    const from = String((env && env.VERIFY_ACCESS_FROM) || DEFAULT_FROM).trim();

    const payload = {
      from,
      to: [to],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    };
    if (mail.replyTo) payload.reply_to = mail.replyTo;

    const resp = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      let detail = '';
      try { detail = (await resp.text()).slice(0, 200); } catch (e) {}
      console.error('[verify-access] Resend 返回 ' + resp.status + '：' + detail);
      return { ok: false, reason: 'resend_error', status: resp.status };
    }

    let id = '';
    try { id = (await resp.json()).id || ''; } catch (e) {}
    console.log('[verify-access] 已发送 ' + id + ' → ' + to);
    return { ok: true, id, to };
  } catch (e) {
    console.error('[verify-access] 发信失败', (e && e.message) || e);
    return { ok: false, reason: 'exception' };
  }
}

export async function notifyAccessRequest(env, item, meta, approval, opts) {
  return deliver(env, buildAccessNotice(item, meta, approval, opts));
}
