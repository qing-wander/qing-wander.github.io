/* ──────────────────────────────────────────────────────────────────────
   自动投递邮件内容生成（纯函数，便于测试）
   ──────────────────────────────────────────────────────────────────────
   设计取舍：
   · 邮件客户端不执行 JS，真正的「点击展开 / 收起」做不到。这里用
     <details>/<summary> 做渐进增强：Apple Mail / 网页版支持折叠，
     不支持的客户端（部分 Gmail / Outlook）会退化成完整展开，信息不丢。
   · 简历提炼信息从 functions/lib/site-data.js 读取（同源单一真相源），
     不另写一份死的自我介绍，改简历数据后邮件内容自动跟着变。
   · 所有用户填写项都 esc() 后进场，防 HTML 注入。
   ────────────────────────────────────────────────────────────────────── */

import SITE_DATA from './site-data.js';

export const RESUME_PRIMARY = 'https://qingfin.cn/resume.html';
export const RESUME_BACKUP = 'https://qing-wander.pages.dev/resume.html';
export const HOMEPAGE = 'https://qingfin.cn';

/* 勾选框 → 附件元信息。文件未提供时 fetch 会 404，后端跳过并在正文标注「待补充」。 */
export const CERT_SLOTS = {
  idCard: { label: '身份证复印件', filename: '身份证复印件.pdf', path: '/assets/resume/certificates/id-card.pdf' },
  diploma: { label: '学历证书', filename: '学历证书.pdf', path: '/assets/resume/certificates/diploma.pdf' },
  degree: { label: '学位证书', filename: '学位证书.pdf', path: '/assets/resume/certificates/degree.pdf' },
  other: { label: '其他相关资质证书', filename: '其他相关资质证书.pdf', path: '/assets/resume/certificates/other-qualifications.pdf' },
};
export const RESUME_PDF_PATH = '/assets/resume/li-qing-resume-2026.pdf';
export const RESUME_PDF_NAME = '李清-简历-2026.pdf';

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plain(s) {
  return String(s == null ? '' : s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/* JD 保留换行分段：先逐行净化，再拼回换行（plain 会把换行压成空格） */
function plainLines(s, max) {
  return String(s == null ? '' : s)
    .split(/\r?\n/)
    .map((line) => plain(line))
    .filter((line, i, arr) => line || (i > 0 && i < arr.length - 1))
    .join('\n')
    .slice(0, max);
}

/* 简历提炼：姓名 / 岗位 / 一句话总结 / 核心能力 / 代表项目，全部取自数据源 */
export function resumeDigest() {
  const r = (SITE_DATA && SITE_DATA.resume) || {};
  const basics = r.basics || {};
  const summary = plain(r.summary && r.summary.html).slice(0, 220);
  const skills = (r.skills || []).map((s) => plain(s.name)).filter(Boolean).slice(0, 5);
  const projects = (r.projects || []).map((p) => ({
    name: plain(p.name),
    subtitle: plain(p.subtitle || p.lead || '').slice(0, 70),
  })).filter((p) => p.name).slice(0, 2);
  return {
    name: plain(basics.name) || '李清',
    role: plain(basics.role) || 'AI Agent 工程师',
    summary,
    skills,
    projects,
  };
}

/* 压缩包默认命名：年份_岗位名_应聘材料_姓名.zip；无岗位则省略岗位段。
   「应聘材料」比「个人资料」更贴合招聘场景，也更不容易被误解成隐私信息。 */
function cleanZipPart(s, max) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '')
    .slice(0, max);
}

export function roleFromJd(jd) {
  const text = String(jd == null ? '' : jd);
  const first = text.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || '';
  let m = first.match(/^(?:岗位名称|职位名称|招聘岗位|应聘岗位|岗位|职位)\s*[:：]\s*(.+)$/);
  if (!m) m = text.match(/(?:岗位名称|职位名称|招聘岗位|应聘岗位|岗位|职位)\s*[:：]\s*([^\r\n]{1,60})/);
  return m ? cleanZipPart(m[1], 24) : '';
}

export function defaultZipName(jd, personName) {
  const who = cleanZipPart(personName, 24) || resumeDigest().name;
  /* 与前端统一用北京时间取年份，避免跨年时区边界差一年 */
  const year = new Date(Date.now() + 8 * 3600 * 1000).getUTCFullYear();
  const parts = [String(year), roleFromJd(jd), '应聘材料', who];
  return parts.filter(Boolean).join('_') + '.zip';
}

/* 称呼：填写了投递对象就带上，否则泛化问候「您好」 */
export function greetingOf(recipient) {
  const who = plain(recipient).slice(0, 40);
  return who ? esc(who) + '，您好' : '您好';
}

/* 主题写法与真人投递一致：应聘 <岗位> · 姓名（致 收件人）。
   刻意不出现「自动投递 / 系统发送」之类字样，收件人看到的是一封普通求职邮件。 */
export function buildSubject(d) {
  const who = plain(d.recipient).slice(0, 40);
  const g = resumeDigest();
  const role = String(g.role).split('/')[0].trim() || 'AI Agent 工程师';
  return '应聘 ' + role + ' · ' + g.name + (who ? '（致 ' + who + '）' : '');
}

function row(k, v) {
  return '<tr>' +
    '<td style="padding:6px 14px 6px 0;font:bold 12px/1.5 \'Courier New\',monospace;color:#4A463F;white-space:nowrap;vertical-align:top;">' + k + '</td>' +
    '<td style="padding:6px 0;font:13.5px/1.6 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#141311;vertical-align:top;">' + v + '</td>' +
    '</tr>';
}

export function buildDeliveryEmail(d) {
  const digest = resumeDigest();
  const time = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const greeting = greetingOf(d.recipient);

  /* JD 区块：无 JD 完全不渲染；有则用 details 折叠（不支持的客户端退化为展开） */
  const jd = plainLines(d.jd, 4000);
  const jdBlock = jd
    ? '<tr><td style="padding:14px 0 0;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:3px solid #141311;background:#FFFDF7;">' +
      '<tr><td style="padding:11px 16px;background:#2B4BE0;color:#FFFCF4;font:bold 11px/1 \'Courier New\',monospace;letter-spacing:.12em;">TARGET JD / 应聘岗位</td></tr>' +
      '<tr><td style="padding:14px 16px;">' +
      '<details>' +
      '<summary style="cursor:pointer;font:bold 13px/1.6 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#2B4BE0;">▸ 展开 / 收起岗位 JD（完整描述）</summary>' +
      '<div style="margin-top:10px;padding:12px 14px;background:#F3EEE2;border-left:4px solid #2B4BE0;font:13px/1.8 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#141311;white-space:normal;">' +
      esc(jd).replace(/\n/g, '<br>') +
      '</div></details>' +
      '<p style="margin:10px 0 0;font:11px/1.6 \'Courier New\',monospace;color:#4A463F;">部分邮件客户端不支持折叠，会自动显示完整 JD；网页版入口见下方「岗位匹配」。</p>' +
      '</td></tr></table></td></tr>'
    : '';

  /* 附言同样保留换行：plain() 会把换行压成空格，分段就没了 */
  const note = plainLines(d.note, 500);
  const noteBlock = note
    ? '<tr><td style="padding:14px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
      '<tr><td colspan="2" style="padding:14px 16px;background:#FFFCF4;border:3px solid #141311;font:14px/1.8 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#141311;">' +
      '<div style="font:bold 11px/1 \'Courier New\',monospace;letter-spacing:.12em;color:#FF5A1E;margin-bottom:10px;">NOTE / 投递附言</div>' +
      esc(note).replace(/\n/g, '<br>') + '</td></tr></table></td></tr>'
    : '';

  /* 附件提示行：正文明确告知随信附件有哪些，缺文件的占位项标注「待补充」。
     打包时只显示 ZIP 名 + 内含清单（文件名已按用户重命名 / 排序）。 */
  const attached = (d.attachedLabels || []).filter(Boolean);
  const pending = (d.pendingLabels || []).filter(Boolean);
  const zipName = plain(d.zipName);
  const zipEntries = (d.zipEntries || []).filter(Boolean);
  const attachmentText = zipName
    ? zipName + (zipEntries.length ? '（内含：' + zipEntries.join('、') + '）' : '')
    : RESUME_PDF_NAME + (attached.length ? '、' + attached.join('、') : '');
  const attachmentLine =
    '<tr><td style="padding:14px 16px;background:#FFF4E5;border:3px solid #141311;border-top:none;font:12.5px/1.8 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#141311;">' +
      '<b>附件清单：</b>' + esc(attachmentText) +
      (pending.length ? '（另申请：' + esc(pending.join('、')) + '，文件待补充，本次未随信附上）' : '') +
      '</td></tr>';

  const skillTags = digest.skills.map((s) =>
    '<span style="display:inline-block;margin:3px 6px 3px 0;padding:4px 9px;background:#141311;color:#FFFCF4;font:12px/1.4 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;">' + esc(s) + '</span>'
  ).join('');
  const projectLines = digest.projects.map((p) =>
    '<div style="margin:4px 0;font:12.5px/1.7 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#141311;">· <b>' + esc(p.name) + '</b>' + (p.subtitle ? ' — ' + esc(p.subtitle) : '') + '</div>'
  ).join('');

  const senderRows =
    (plain(d.name) ? row('投递人', esc(plain(d.name).slice(0, 24))) : '') +
    (plain(d.email) ? row('回复地址', '<a href="mailto:' + esc(plain(d.email).slice(0, 120)) + '" style="color:#2B4BE0;text-decoration:none;font-weight:bold;">' + esc(plain(d.email).slice(0, 120)) + '</a>') : '') +
    row('收件人', esc((d.to || []).join('、')));

  const html = '' +
'<!DOCTYPE html><html><body style="margin:0;padding:0;background:#F3EEE2;">' +
'<div style="display:none;max-height:0;overflow:hidden;">' + esc(digest.name) + '应聘 ' + esc(String(digest.role).split('/')[0].trim()) + '：5 年研发，附 PDF 简历与在线简历。' + '</div>' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3EEE2;padding:28px 12px;"><tr><td align="center">' +
'<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">' +

'<tr><td style="background:#141311;color:#FFFCF4;padding:16px 18px;border:4px solid #141311;">' +
'<span style="font:bold 11px/1 \'Courier New\',monospace;letter-spacing:.18em;color:#FF5A1E;">APPLICATION&nbsp;/&nbsp;求职申请</span>' +
'<div style="font:900 22px/1.2 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;margin-top:7px;">' + esc(digest.name) + ' · ' + esc(digest.role) + '</div>' +
'<div style="font:13px/1.6 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#CFC7B6;margin-top:4px;">5 年研发 · Agent 开发 / AI 工程化 / 企业 AI 基建</div>' +
'</td></tr>' +

'<tr><td style="border:4px solid #141311;border-top:none;background:#FFFCF4;padding:20px 22px 12px;">' +
'<p style="margin:0 0 14px;font:14px/1.9 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#141311;"><b>' + greeting + '：</b><br>感谢您抽出时间阅读我的简历。下面是我与这个岗位相关的要点，完整内容可以看在线简历，也可以打开随信 PDF。</p>' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + senderRows + '</table>' +
'</td></tr>' +

'<tr><td style="padding:14px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:3px solid #141311;background:#FFFCF4;">' +
'<tr><td style="padding:11px 16px;background:#FF5A1E;color:#FFFCF4;font:bold 11px/1 \'Courier New\',monospace;letter-spacing:.12em;">PROFILE / 简历提炼</td></tr>' +
'<tr><td style="padding:14px 16px;">' +
'<div style="font:13.5px/1.8 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#141311;">' + (digest.summary ? esc(digest.summary) + '。' : '') + '</div>' +
'<div style="margin-top:10px;">' + skillTags + '</div>' +
(projectLines ? '<div style="margin-top:10px;padding-top:8px;border-top:1px dashed #AAA;">' + projectLines + '</div>' : '') +
'</td></tr></table></td></tr>' +

jdBlock + noteBlock +

'<tr><td style="padding:14px 0 0;border:4px solid #141311;background:#FF5A1E;">' +
'<div style="padding:16px 18px 0;font:bold 11px/1 \'Courier New\',monospace;letter-spacing:.12em;color:#FFFCF4;">RESUME / 在线简历主页入口</div>' +
'<div style="padding:10px 18px 16px;">' +
'<a href="' + RESUME_PRIMARY + '" style="display:inline-block;background:#141311;color:#FFFCF4;text-decoration:none;font:bold 15px/1 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;padding:12px 20px;border:3px solid #141311;">查看在线简历 ▶</a>' +
'&nbsp;&nbsp;<a href="' + HOMEPAGE + '/jd.html" style="display:inline-block;background:#FFFCF4;color:#141311;text-decoration:none;font:bold 13px/1 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;padding:12px 14px;border:3px solid #141311;">岗位匹配 ↗</a>' +
'<div style="font:12px/1.6 \'Courier New\',monospace;color:#FFFCF4;margin-top:11px;word-break:break-all;">' + RESUME_PRIMARY + ' · 备用 ' + RESUME_BACKUP + '</div>' +
'</div></td></tr>' +

attachmentLine +

'<tr><td style="border:4px solid #141311;border-top:none;background:#FFFCF4;padding:12px 22px;">' +
'<span style="font:bold 12px/1.6 \'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#141311;">简历作者邮箱：hi@qingfin.cn' + (plain(d.email) ? ' · 回复本邮件可直接联系投递人' : '') + '</span>' +
'</td></tr>' +

'<tr><td style="padding:16px 4px 0;text-align:center;">' +
'<span style="font:11px/1.6 \'Courier New\',monospace;color:#4A463F;">' + esc(digest.name) + ' · qingfin.cn · ' + time + '</span>' +
'</td></tr>' +

'</table></td></tr></table></body></html>';

  const textLines = [
    greeting + '：',
    '感谢您抽出时间阅读我的简历。',
    '',
    digest.name + ' · ' + digest.role,
    digest.summary,
    '核心能力：' + digest.skills.join(' / '),
    '',
    '在线简历：' + RESUME_PRIMARY,
    '岗位匹配：' + HOMEPAGE + '/jd.html',
    '',
  ];
  if (jd) textLines.push('岗位 JD：', jd, '', '（网页版可展开 / 收起查看）', '');
  if (note) textLines.push('投递附言：', note, '');
  if (attached.length || pending.length || zipName) {
    textLines.push('附件：' + attachmentText, '');
    if (pending.length) textLines.push('另申请：' + pending.join('、') + '（文件待补充，本次未附上）', '');
  }
  textLines.push('简历作者邮箱：hi@qingfin.cn');

  return { html, text: textLines.join('\n') };
}
