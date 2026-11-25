/* 简历手机号：仓库里只存占位符，真实号码由云端数据注入
   ──────────────────────────────────────────────────────────────
   为什么不在仓库里放真号码：
     仓库是公开的、会被 fork。`scripts/redact-public-data.mjs` 把生成物里的
     手机号替换成占位串（138 0000 0000），但访客看到的简历必须是真号码。

   做法：
     · /resume 页面由中间件在响应前把占位串换成 D1 site_content 里的真实号码
     · 下载/投递用的 PDF 存在 KV（见 functions/api/resume-pdf.js）
     · 页面缓存 5 分钟，后台改完最多 5 分钟生效

   纯函数单独抽出来，方便单测；读 D1 的部分缺库时返回空串，页面原样输出。
   ────────────────────────────────────────────────────────────── */

/* 占位符（与 scripts/redact-public-data.mjs 的映射保持一致），长的先替换 */
export const PHONE_PLACEHOLDERS = [
  '+86 138 0000 0000',
  '+8613800000000',
  '138 0000 0000',
  '13800000000',
];

/* 从站点数据里取公开电话：contact.cards 里 href 以 tel: 开头的那条。
   返回展示形态（如 "+86 180 2283 4605"），注入时再按占位符形态拆开。 */
export function phoneFromSiteData(data) {
  const cards = (data && data.contact && data.contact.cards) || [];
  for (const c of cards) {
    const href = String((c && c.href) || '');
    if (/^tel:/i.test(href)) {
      const shown = String((c && c.value) || '').trim();
      if (shown) return shown;
      const n = href.slice(4).replace(/[^\d+]/g, '').trim();
      if (n) return n;
    }
  }
  const lines = (data && data.resume && data.resume.basics && data.resume.basics.lines) || [];
  for (const row of lines) {
    for (const item of Array.isArray(row) ? row : [row]) {
      const href = String((item && item.href) || '');
      if (/^tel:/i.test(href)) return String((item && item.text) || href.slice(4)).trim();
    }
  }
  return '';
}

/* 把页面里的占位串换成真实号码；号码为空则原样返回（宁可显示占位也不报错）。
   占位符有「带国际区号 / 不带 / 带空格 / 纯数字」四种形态，逐一对应替换。 */
export function injectResumePhone(html, phone) {
  const display = String(phone || '').trim();
  if (!display) return String(html || '');
  const digits = display.replace(/\D/g, '');
  const local = digits.replace(/^86(?=1\d{10}$)/, '');
  const localSpaced = display.replace(/^\+?\s*86[\s-]*/, '');
  const map = [
    ['+86 138 0000 0000', display],
    ['+8613800000000', digits],
    ['138 0000 0000', localSpaced || local || display],
    ['13800000000', local || digits],
  ];
  let out = String(html || '');
  for (const [ph, val] of map) out = out.split(ph).join(val);
  return out;
}

export async function resumePhone(env) {
  if (!env || !env.DB) return '';
  try {
    const row = await env.DB
      .prepare("SELECT payload FROM site_content WHERE key = 'site-data'")
      .first();
    if (!row || !row.payload) return '';
    return phoneFromSiteData(JSON.parse(row.payload));
  } catch (e) {
    return '';
  }
}
