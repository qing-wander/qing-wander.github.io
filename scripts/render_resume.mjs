#!/usr/bin/env node
/* ──────────────────────────────────────────────────────────────────────
   简历生成器 · render_resume.mjs
   ──────────────────────────────────────────────────────────────────────
   唯一真相源：data/site-data.json → resume
   模板：      templates/resume.template.html（CSS / 弹窗 / JS / 打印逻辑）
   生成物：    resume.html（AUTO-GENERATED，禁止手改）

   用法：
     node scripts/render_resume.mjs           写盘
     node scripts/render_resume.mjs --check   只比对，不写盘；有漂移退出码 1
     node scripts/render_resume.mjs --stdout  打印到标准输出（调试用）

   规则：
     · 只替换模板里的 {{RESUME_*}} 占位与 {{RESUME_BODY}}，模板其余部分逐字保留，
       所以样式 / 布局 / 打印行为与迁移前完全一致。
     · 姓名、公司、时间、学校、学历、验证码等「事实字段」只做 HTML 转义后输出，
       不会被模型改写；需要强调的富文本（bullet / skill 行）以 html 字段存放。
     ────────────────────────────────────────────────────────────────────── */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = resolve(ROOT, 'data/site-data.json');
const TEMPLATE_FILE = resolve(ROOT, 'templates/resume.template.html');
const OUTPUT_FILE = resolve(ROOT, 'resume.html');

const BANNER = [
  '<!-- AUTO-GENERATED FILE — 请勿手改 -->',
  '<!-- 真相源：data/site-data.json → resume；模板：templates/resume.template.html -->',
  '<!-- 重新生成：node scripts/render_resume.mjs；漂移检查：node scripts/validate_content.mjs -->',
].join('\n');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const raw = (s) => String(s == null ? '' : s);
const NO_BREAK = '\u3000'; // 简历里的全角间隔，和原稿一致

function metaToken(t) {
  if (t.href) {
    const target = t.external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<b>${esc(t.label)}</b> <a class="link" href="${esc(t.href)}"${target}>${esc(t.text)}</a>`;
  }
  return `<b>${esc(t.label)}</b> ${esc(t.value)}`;
}

function header(r) {
  const lines = r.basics.lines.map((toks) =>
    '        <p>' + toks.map(metaToken).join(NO_BREAK) + '</p>');
  return [
    '  <!-- 头部 -->',
    '  <header class="sheet-head">',
    `    <div class="avatar"><img src="${esc(r.basics.avatar)}" alt="${esc(r.basics.avatarAlt)}"></div>`,
    '    <div class="head-main">',
    '      <div class="head-line">',
    `        <h1 class="head-name">${esc(r.basics.name)}</h1>`,
    `        <p class="head-role">${esc(r.basics.role)}</p>`,
    '      </div>',
    '      <div class="head-meta">',
    ...lines,
    '      </div>',
    '    </div>',
    '  </header>',
  ];
}

function section(comment, no, title, inner) {
  return [
    `  <!-- ${comment} -->`,
    '  <section class="sec">',
    `    <div class="sec-title"><span class="sec-no">${no}</span><h2>${title}</h2><span class="sec-line"></span></div>`,
    ...inner,
    '  </section>',
  ];
}

function bullets(items) {
  return [
    '      <ul class="pts">',
    ...items.map((b) => `        <li>${raw(b.html)}</li>`),
    '      </ul>',
  ];
}

function summarySection(r) {
  return section('个人简介', '01', '个人简介', [`    <p class="sec-intro">${raw(r.summary.html)}</p>`]);
}

function experienceSection(r) {
  const inner = [];
  r.experience.forEach((e) => {
    inner.push(
      '    <div class="item">',
      '      <div class="item-head">',
      `        <p class="item-title">${esc(e.company)}<span> ${esc(e.companyNote)}</span><span>${esc(e.role)}</span></p>`,
      `        <span class="item-time">${esc(e.period)}</span>`,
      '      </div>',
      ...bullets(e.bullets),
      '    </div>',
    );
  });
  return section('工作经历', '02', '工作经历', inner);
}

function projectsSection(r) {
  const inner = [];
  r.projects.forEach((p) => {
    inner.push(
      '    <div class="item">',
      '      <div class="item-head">',
      `        <p class="item-title"><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.name)}</a> <span>${esc(p.subtitle)}</span></p>`,
      `        <span class="item-time">${esc(p.period)}</span>`,
      '      </div>',
      `      <p class="proj-lead"><span class="proj-lead-bar">｜</span><span>${esc(p.lead)}</span></p>`,
      ...bullets(p.bullets),
      '    </div>',
    );
  });
  return section('项目经历', '03', '项目经历', inner);
}

function skillsSection(r) {
  const inner = ['    <div class="skill-cats">'];
  r.skills.forEach((s) => {
    inner.push(
      '      <div class="skill-cat">',
      `        <p class="skill-cat-name">${esc(s.name)}</p>`,
      '        <div>',
      `          <p class="skill-row-main">${raw(s.main)}</p>`,
      `          <p class="skill-row-sub">${raw(s.sub)}</p>`,
      '        </div>',
      '      </div>',
    );
  });
  inner.push('    </div>');
  return section('专业技能', '04', '专业技能', inner);
}

function educationSection(r) {
  const e = r.education;
  const inner = [
    '    <div class="item">',
    '      <div class="item-head">',
    `        <p class="item-title">${esc(e.school)} <span>${esc(e.note)}</span></p>`,
    `        <span class="item-time">${esc(e.period)}</span>`,
    '      </div>',
    ...bullets(e.bullets),
    '      <div class="edu-verify">',
    '        <div class="edu-verify-text">',
    `          <p class="edu-verify-label">${esc(e.verify.label)}</p>`,
    `          <p class="edu-verify-code">${esc(e.verify.code)}</p>`,
    `          <p class="edu-verify-tip">${esc(e.verify.tip)}</p>`,
    '        </div>',
    `        <img class="edu-verify-qr" src="${esc(e.verify.qrImage)}" alt="${esc(e.verify.qrAlt)}">`,
    '      </div>',
    '    </div>',
  ];
  return section('教育经历', '05', '教育经历', inner);
}

function renderBody(r) {
  return [
    header(r),
    summarySection(r),
    experienceSection(r),
    projectsSection(r),
    skillsSection(r),
    educationSection(r),
  ].map((sec) => sec.join('\n')).join('\n\n');
}

function render(data) {
  const r = data && data.resume;
  if (!r) throw new Error('data/site-data.json 缺少 resume 块');
  const tpl = readFileSync(TEMPLATE_FILE, 'utf8');
  const out = tpl
    .replace('{{RESUME_TITLE}}', () => esc(r.meta.title))
    .replace('{{RESUME_DESCRIPTION}}', () => esc(r.meta.description))
    .replace('{{RESUME_OG_TITLE}}', () => esc(r.meta.ogTitle))
    .replace('{{RESUME_OG_DESCRIPTION}}', () => esc(r.meta.ogDescription))
    .replace('{{RESUME_BODY}}', () => renderBody(r));
  if (out.includes('{{RESUME_')) throw new Error('模板里还有未替换的 {{RESUME_*}} 占位');
  return out.replace('<!DOCTYPE html>\n', '<!DOCTYPE html>\n' + BANNER + '\n');
}

export { render };

function main() {
const args = process.argv.slice(2);
const data = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
const html = render(data);

if (args.includes('--stdout')) {
  process.stdout.write(html);
} else if (args.includes('--check')) {
  let current = '';
  try { current = readFileSync(OUTPUT_FILE, 'utf8'); } catch (e) { /* 文件缺失也算漂移 */ }
  if (current === html) {
    console.log('[render_resume] resume.html 与数据一致 ✓');
  } else {
    console.error('[render_resume] resume.html 与 data/site-data.json 不一致，请运行 node scripts/render_resume.mjs');
    process.exit(1);
  }
} else {
  writeFileSync(OUTPUT_FILE, html);
  console.log('[render_resume] 已生成 resume.html（' + Buffer.byteLength(html) + ' bytes）');
}
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
