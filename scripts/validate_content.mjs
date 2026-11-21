#!/usr/bin/env node
/* ──────────────────────────────────────────────────────────────────────
   内容校验 · validate_content.mjs
   ──────────────────────────────────────────────────────────────────────
   对 data/site-data.json → resume 做结构与边界校验，并检查生成物是否漂移。
   CI（.github/workflows/content-build.yml）在每次 push 跑一遍：
   结构错了、生成物被手改、页面预算超了，都会让流水线红掉，而不是静默上线。

   用法：
     node scripts/validate_content.mjs          校验 + 漂移检查
     node scripts/validate_content.mjs --no-drift  只校验数据（本地改稿时用）

   校验分三档：
     error  必须修，CI 直接失败
     warn   改了要留意（预算接近上限、字段为空壳）
   ────────────────────────────────────────────────────────────────────── */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = resolve(ROOT, 'data/site-data.json');
const QR_FILE = resolve(ROOT, 'images/edu-verify-qr.png');

const errors = [];
const warns = [];
const fail = (m) => errors.push(m);
const warn = (m) => warns.push(m);

/* 页面预算：5 年经验一页放不下、两页是硬上限。
   这里用「可见字符数 + 条目数」做近似预算，真正的页数由 Playwright 打印校验补位。 */
const BUDGET = {
  maxPages: 2,
  summaryChars: 220,
  experienceBullets: 10,
  projectBullets: 16,
  skillGroups: 6,
  totalChars: 3800,
  warnRatio: 0.92,
};

const ALLOWED_TAGS = new Set(['strong', 'em', 'b', 'small', 'br']);

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, '');
const chars = (s) => Array.from(stripTags(s)).length;

function checkTags(html, where) {
  const tags = String(html || '').match(/<\/?([a-zA-Z0-9]+)[^>]*>/g) || [];
  tags.forEach((t) => {
    const name = (t.match(/<\/?([a-zA-Z0-9]+)/) || [])[1];
    if (!ALLOWED_TAGS.has(name)) fail(`${where} 使用了不允许的标签 <${name}>（只允许 ${[...ALLOWED_TAGS].join('/')}）`);
  });
  if (String(html || '').includes('data:')) fail(`${where} 内嵌了 data: URI，图片请放 images/ 走文件路径`);
}

function need(obj, key, where) {
  const v = obj && obj[key];
  if (typeof v !== 'string' || !v.trim()) fail(`${where} 缺字段 ${key}`);
  return v;
}

const data = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
const r = data.resume;
if (!r) {
  console.error('✗ data/site-data.json 缺少 resume 块');
  process.exit(1);
}

/* ── 1. 基本结构 ── */
need(r.meta, 'title', 'resume.meta');
need(r.meta, 'description', 'resume.meta');
if (r.meta.maxPages !== BUDGET.maxPages) {
  fail(`resume.meta.maxPages 必须是 ${BUDGET.maxPages}（5 年经验简历两页是硬上限）`);
}

const b = r.basics || {};
if (b.editable !== 'manual') fail('resume.basics.editable 应为 manual（基本信息由后台人工配置，AI 只做微调）');
need(b, 'name', 'resume.basics');
need(b, 'role', 'resume.basics');
need(b, 'avatar', 'resume.basics');
if (!Array.isArray(b.lines) || b.lines.length === 0) fail('resume.basics.lines 至少要有 1 行');
(b.lines || []).forEach((line, i) => {
  if (!Array.isArray(line) || line.length === 0) fail(`resume.basics.lines[${i}] 是空行`);
  (line || []).forEach((t) => {
    if (!t.label) fail(`resume.basics.lines[${i}] 有缺少 label 的条目`);
    if (t.href && !t.text) fail(`resume.basics.lines[${i}] 的链接条目缺少 text`);
    if (!t.href && !t.value) fail(`resume.basics.lines[${i}]「${t.label}」缺少 value`);
    if (t.href && /^\s*(javascript:|data:)/i.test(t.href)) fail(`resume.basics 出现不安全的链接 ${t.href}`);
  });
});

/* ── 2. 个人简介 / 工作 / 项目 / 技能 ── */
if (r.summary && r.summary.editable !== 'ai') warn('resume.summary.editable 不是 ai，JD 定制时会被跳过');
const summaryText = need(r.summary, 'html', 'resume.summary');
checkTags(summaryText, 'resume.summary');
if (chars(summaryText) > BUDGET.summaryChars) {
  fail(`个人简介 ${chars(summaryText)} 字，超过预算 ${BUDGET.summaryChars} 字`);
}

const ids = new Set();
const collectIds = (list, where) => {
  (list || []).forEach((item, i) => {
    const id = item && item.id;
    if (!id) fail(`${where}[${i}] 缺少稳定 id（RAG 切片与后台 diff 都靠它）`);
    else if (ids.has(id)) fail(`id 重复：${id}`);
    else ids.add(id);
  });
};

collectIds(r.experience, 'resume.experience');
const expBullets = (r.experience || []).reduce((n, e) => n + (e.bullets || []).length, 0);
if (!r.experience || !r.experience.length) fail('resume.experience 不能为空');
if (expBullets > BUDGET.experienceBullets) {
  fail(`工作经历 ${expBullets} 条 bullet，超过预算 ${BUDGET.experienceBullets} 条（两页装不下）`);
}
(r.experience || []).forEach((e, i) => {
  const where = `resume.experience[${i}]`;
  need(e, 'company', where);
  need(e, 'role', where);
  need(e, 'period', where);
  if (!Array.isArray(e.lock) || !e.lock.includes('company') || !e.lock.includes('period')) {
    fail(`${where} 必须锁定 company 与 period（公司名、任职时间是事实，AI 不可改）`);
  }
  if (!Array.isArray(e.bullets) || e.bullets.length === 0) fail(`${where} 没有 bullet`);
  (e.bullets || []).forEach((bl, j) => {
    if (!bl.id) fail(`${where}.bullets[${j}] 缺少 id`);
    if (!bl.html || !chars(bl.html)) fail(`${where}.bullets[${j}] 是空 bullet`);
    checkTags(bl.html, `${where}.bullets[${j}]`);
  });
});

collectIds(r.projects, 'resume.projects');
const prjBullets = (r.projects || []).reduce((n, p) => n + (p.bullets || []).length, 0);
if (!r.projects || !r.projects.length) fail('resume.projects 不能为空');
if (prjBullets > BUDGET.projectBullets) {
  fail(`项目经历 ${prjBullets} 条 bullet，超过预算 ${BUDGET.projectBullets} 条`);
}
(r.projects || []).forEach((p, i) => {
  const where = `resume.projects[${i}]`;
  need(p, 'name', where);
  need(p, 'period', where);
  need(p, 'subtitle', where);
  need(p, 'lead', where);
  if (!p.url || !/^https?:\/\//.test(p.url)) fail(`${where}.url 必须是 http(s) 链接`);
  if (!Array.isArray(p.lock) || !p.lock.includes('name') || !p.lock.includes('period')) {
    fail(`${where} 必须锁定 name 与 period（项目名、时间线是事实，AI 不可改）`);
  }
  (p.bullets || []).forEach((bl, j) => {
    if (!bl.id) fail(`${where}.bullets[${j}] 缺少 id`);
    if (!bl.html || !chars(bl.html)) fail(`${where}.bullets[${j}] 是空 bullet`);
    checkTags(bl.html, `${where}.bullets[${j}]`);
  });
});

collectIds(r.skills, 'resume.skills');
if (!r.skills || !r.skills.length) fail('resume.skills 不能为空');
if ((r.skills || []).length > BUDGET.skillGroups) {
  fail(`专业技能 ${r.skills.length} 组，超过预算 ${BUDGET.skillGroups} 组`);
}
(r.skills || []).forEach((s, i) => {
  const where = `resume.skills[${i}]`;
  need(s, 'name', where);
  need(s, 'main', where);
  checkTags(s.main, `${where}.main`);
  checkTags(s.sub, `${where}.sub`);
});

/* ── 3. 教育经历（人工维护） ── */
const e = r.education || {};
if (e.editable !== 'manual') fail('resume.education.editable 应为 manual（学校、专业、学历由人工维护）');
need(e, 'school', 'resume.education');
need(e, 'note', 'resume.education');
need(e, 'period', 'resume.education');
(e.bullets || []).forEach((bl, j) => {
  if (!bl.html || !chars(bl.html)) fail(`resume.education.bullets[${j}] 是空 bullet`);
  checkTags(bl.html, `resume.education.bullets[${j}]`);
});
const v = e.verify || {};
need(v, 'label', 'resume.education.verify');
need(v, 'code', 'resume.education.verify');
need(v, 'tip', 'resume.education.verify');
if (!/^[A-Z0-9]{10,22}$/.test(String(v.code || ''))) fail('学信网验证码格式异常（应为 10–22 位大写字母数字）');
if (!v.qrImage || /^data:/i.test(v.qrImage)) fail('学信网二维码必须是 images/ 下的文件路径，不能内联 base64');
if (v.qrImage && !existsSync(resolve(ROOT, v.qrImage))) fail(`二维码文件不存在：${v.qrImage}`);
if (!existsSync(QR_FILE)) fail('缺少 images/edu-verify-qr.png');

/* ── 3.5 公司档案（company-profiles.json） ──
   规则：结构齐全、来源编号连续且被引用处可回查、图片落盘存在、
   experience.profileId 必须能索引到档案。 */
const PROFILES_FILE = resolve(ROOT, 'data/company-profiles.json');
if (existsSync(PROFILES_FILE)) {
  let profiles = null;
  try {
    profiles = JSON.parse(readFileSync(PROFILES_FILE, 'utf8'));
  } catch (err) {
    fail(`data/company-profiles.json 不是合法 JSON：${err.message}`);
  }
  if (profiles && profiles.companies) {
    const comps = profiles.companies;
    Object.keys(comps).forEach((cid) => {
      const c = comps[cid];
      const where = `company-profiles.companies.${cid}`;
      if (c.id !== cid) fail(`${where}.id 与键名不一致`);
      need(c, 'name', where);
      need(c, 'code', where);
      need(c, 'oneLine', where);
      if (!Array.isArray(c.quickStats) || c.quickStats.length < 2 || c.quickStats.length > 4)
        fail(`${where}.quickStats 应为 2–4 条速览数据`);
      if (!Array.isArray(c.kpis) || c.kpis.length !== 4)
        fail(`${where}.kpis 必须正好 4 格（成立 / 融资或营收 / 团队 / 关键数字）`);
      ['main', 'model', 'position'].forEach((k) => {
        if (!c.business || !c.business[k]) fail(`${where}.business.${k} 缺失`);
      });

      /* 来源编号：1..n 连续，引用处必须存在 */
      const nums = (c.sources || []).map((s) => s.n);
      nums.forEach((n, i) => { if (n !== i + 1) fail(`${where}.sources[${i}].n 必须是 ${i + 1}（连续编号）`); });
      const refd = new Set();
      const collectRef = (val) => { if (Number.isInteger(val) && val > 0) refd.add(val); };
      (c.kpis || []).forEach((k) => collectRef(k.source));
      if (c.registry) collectRef(c.registry.source);
      ((c.funding && c.funding.rounds) || []).forEach((rr) => collectRef(rr.source));
      (c.recognition || []).forEach((rz) => collectRef(rz.source));
      if (c.chart) collectRef(c.chart.source);
      refd.forEach((n) => { if (!nums.includes(n)) fail(`${where} 引用了不存在的来源编号 [${n}]`); });

      /* 图表与融资至少有一样成内容 */
      if (!c.chart && !(c.funding && c.funding.rounds && c.funding.rounds.length))
        fail(`${where} 既没有 chart 也没有 funding.rounds（发展数据模块不能为空）`);

      /* 办公图：非占位必须真实落盘 */
      (c.office || []).forEach((o, i) => {
        if (!o.placeholder && !o.img) fail(`${where}.office[${i}] 缺 img 或 placeholder 标记`);
        if (o.img && !existsSync(resolve(ROOT, o.img))) fail(`${where}.office[${i}] 图片不存在：${o.img}`);
        if (o.img && /^data:/i.test(o.img)) fail(`${where}.office[${i}] 不能内联 base64，请放 images/`);
      });
    });

    /* experience.profileId → 档案索引一致 */
    (r.experience || []).forEach((e, i) => {
      if (e.profileId && !comps[e.profileId])
        fail(`resume.experience[${i}].profileId="${e.profileId}" 在 company-profiles.json 中不存在`);
    });
    (data.experience || []).forEach((e, i) => {
      if (e.profileId && !comps[e.profileId])
        fail(`experience[${i}].profileId="${e.profileId}" 在 company-profiles.json 中不存在`);
    });
  } else {
    warn('data/company-profiles.json 缺少 companies 字段，公司档案入口将不可用');
  }
} else {
  fail('缺少 data/company-profiles.json（公司档案数据源）');
}

/* ── 4. 页面预算（近似） ── */
const totalChars = chars(summaryText) +
  (r.experience || []).reduce((n, x) => n + (x.bullets || []).reduce((m, bl) => m + chars(bl.html), 0), 0) +
  (r.projects || []).reduce((n, x) => n + chars(x.lead) + (x.bullets || []).reduce((m, bl) => m + chars(bl.html), 0), 0) +
  (r.skills || []).reduce((n, s) => n + chars(s.main) + chars(s.sub), 0) +
  (e.bullets || []).reduce((n, bl) => n + chars(bl.html), 0);
if (totalChars > BUDGET.totalChars) {
  fail(`简历正文 ${totalChars} 字，超过两页预算 ${BUDGET.totalChars} 字`);
} else if (totalChars > BUDGET.totalChars * BUDGET.warnRatio) {
  warn(`简历正文 ${totalChars} 字，已接近两页上限 ${BUDGET.totalChars} 字，再加内容前先确认页数`);
}

/* ── 5. 生成物漂移 ── */
if (!process.argv.includes('--no-drift')) {
  try {
    execFileSync(process.execPath, [resolve(ROOT, 'scripts/render_resume.mjs'), '--check'], { stdio: 'pipe' });
  } catch (err) {
    fail('resume.html 与 data/site-data.json 不一致：手改了生成物，或改完数据忘了 render');
  }
}

/* ── 6. 输出 ── */
console.log(`内容规模：正文 ${totalChars} 字 · 工作 ${expBullets} 条 · 项目 ${prjBullets} 条 · 技能 ${(r.skills || []).length} 组`);
warns.forEach((w) => console.log('⚠ ' + w));
if (errors.length) {
  errors.forEach((m) => console.error('✗ ' + m));
  console.error(`\n校验失败：${errors.length} 项 error / ${warns.length} 项 warn`);
  process.exit(1);
}
console.log(`✓ 校验通过（${warns.length} 项 warn）`);
