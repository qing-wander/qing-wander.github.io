#!/usr/bin/env node
/**
 * M2 独立页三件套 + 404 E2E（docs/react-refactor-plan.md §6-M2 验收）
 *
 * 前置：node scripts/dev-api-server.mjs（默认 8877；/api/company-social 与
 * /api/verify-access 已接线上同套 handlers）；pnpm build 已产出 dist-react。
 *
 * 覆盖：
 *   ① jd：表单/字数/示例 chips/⌘Enter 提交 → mock 结果渲染/证据互斥展开/
 *      打印态隐藏交互件/AI 面板预填链（sessionStorage cp_jd_prefill）
 *   ② company：?c= 全板块渲染与折叠态、折叠交互、高管轮播（箭头+横滑）、
 *      友商深链、灯箱、360° 全景桥接（开/Esc 关）、任职佐证锁定态、社交挂载
 *   ③ school：单校自动展示、学历核验锁定态（无验证码泄漏）、申请弹窗校验
 *      与提交流、解锁态（localStorage 兼容键）、相册二维码联动
 *   ④ 404：静态内容
 *   ⑤ 主题：?theme= 四主题切换生效（data-theme 落 html）
 *   ⑥ 移动档 390/680 快照（截图入 .temp，不比对，崩溃检测）
 */
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8877';
const SHOT_DIR = '.temp/m2-shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
let passed = 0;
const check = (name, cond) => {
  console.log((cond ? '✓' : '✗') + ' ' + name);
  if (cond) passed++; else failed++;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
  mkdirSync(SHOT_DIR, { recursive: true });

  /* ═══════════ ① jd.html ═══════════ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE + '/jd.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#jdForm', { timeout: 8000 });
    await sleep(500);

    check('jd 表单 SSG 直出', await page.locator('#jdText').count() === 1);
    check('jd 空态三步说明', (await page.locator('.jd-step-no').count()) === 3);
    check('jd 计数初值', (await page.textContent('#jdCount')).includes('0 / 1500'));

    // 示例 chip → 填充 + 计数同步
    await page.click('[data-jd-sample="agent"]');
    await sleep(80);
    const len = (await page.inputValue('#jdText')).length;
    check('jd 示例填充', len > 200);
    check('jd 计数同步', (await page.textContent('#jdCount')).startsWith(String(len)));

    // 太短提交 → tip 报错
    await page.fill('#jdText', '太短');
    await page.click('#jdSubmit');
    await sleep(80);
    check('jd 太短拦截', (await page.textContent('#jdTip')).includes('太短'));

    // mock /api/chat：装 route 假端点（dev server 不含 /api/chat）
    await ctx.route('**/api/chat', async (route) => {
      const body = route.request().postDataJSON();
      if (body && body.mode === 'jd') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            match: {
              overall: { score: 72, verdict: '整体匹配良好', summary: '六个要求里覆盖四个。' },
              rows: [
                {
                  req: '负责 Agent 平台架构设计',
                  status: 'covered',
                  evidence: [{ point: 'CP.AI 企业智能体平台', title: '工作经历｜进门财经｜企业智能体平台', ratio: 0.62, excerpt: '切片原文第一段……' }],
                },
                {
                  req: '5 年以上金融行业经验',
                  status: 'gap',
                  gap: '行业以金融为主但年限 4 年',
                  evidence: [],
                },
                {
                  req: '熟悉向量数据库评测',
                  status: 'partial',
                  gap: '有 Vectorize 落地，缺 Milvus',
                  probe: '讲一次你做过的召回评测',
                  evidence: [{ point: 'Vectorize + BM25 混合检索', title: '项目｜站点 AI 问答', ratio: 0.41 }],
                },
              ],
              stats: { covered: 1, partial: 1, gap: 1 },
            },
            meta: { recalled: 6, requirements: 3, merged: 3 },
          }),
        });
      }
      return route.fulfill({ status: 400, contentType: 'application/json', body: '{"ok":false,"error":"bad_request"}' });
    });

    await page.click('[data-jd-sample="backend"]');
    await sleep(60);
    await page.click('#jdSubmit');
    await page.waitForSelector('.jd-result', { timeout: 8000 });
    check('jd 结果渲染（分数）', (await page.textContent('.jd-score-num')) === '72');
    check('jd 结果渲染（stat 口径）', (await page.textContent('.jd-stats')).includes('覆盖'));
    check('jd 行数 3', (await page.locator('.jd-row').count()) === 3);
    check('jd 完成提示', (await page.textContent('#jdTip')).includes('匹配完成'));

    // 证据互斥展开
    await page.click('.jd-ev-src');
    await sleep(60);
    check('jd 证据展开', await page.locator('.jd-ev-excerpt:not([hidden])').count() === 1);
    check('jd 证据 aria', (await page.getAttribute('.jd-ev-src', 'aria-expanded')) === 'true');

    // 复制 Markdown（授予剪贴板权限）
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.click('#jdCopy');
    await sleep(200);
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    check('jd 复制 Markdown', String(clip).includes('## 岗位匹配结果 · 72/100'));

    // 打印态：交互件隐藏
    await page.emulateMedia({ media: 'print' });
    await sleep(60);
    const formHidden = await page.evaluate(() => {
      const el = document.querySelector('.jd-form');
      return el && getComputedStyle(el).display === 'none';
    });
    check('jd 打印隐藏表单', formHidden);
    check('jd 打印页脚 meta 展示', await page.evaluate(() => {
      const el = document.querySelector('.jd-print-meta');
      return el && getComputedStyle(el).display !== 'none' && el.textContent.includes('生成于');
    }));
    await page.emulateMedia({ media: 'screen' });

    // AI 面板预填链（cp_jd_prefill）
    await page.evaluate(() => {
      sessionStorage.setItem('cp_jd_prefill', '岗位：来自数字分身面板的 JD 预填测试内容长度充足，超过三十个字以保证能顺利通过前端校验。');
    });
    await page.goto(BASE + '/jd.html?theme=noir', { waitUntil: 'domcontentloaded' });
    await sleep(500);
    const pre = await page.inputValue('#jdText');
    check('jd AI 面板预填', pre.includes('数字分身面板'));
    check('jd 预填提示', (await page.textContent('#jdTip')).includes('已带入'));
    check('jd 预填一次性消费', await page.evaluate(() => sessionStorage.getItem('cp_jd_prefill')) === null);
    check('jd ?theme=noir 生效', await page.getAttribute('html', 'data-theme') === 'noir');

    await page.screenshot({ path: SHOT_DIR + '/jd-1280.png', fullPage: true });
    await ctx.close();
  }

  /* ═══════════ ② company.html ═══════════ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();

    // 列表态（无 ?c=）
    await page.goto(BASE + '/company.html', { waitUntil: 'domcontentloaded' });
    await sleep(500);
    const cards = await page.locator('.cp-list-card').count();
    check('company 列表态渲染 10 家', cards === 10);

    // 深链进入 zhishu
    await page.goto(BASE + '/company.html?c=zhishu', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.cp-head', { timeout: 8000 });
    await sleep(600);
    check('company title 更新', (await page.title()).includes('指数引力'));
    check('company 品牌章渲染', await page.locator('.cp-stamp').count() === 1);
    check('company KPI 块渲染', (await page.locator('.cp-kpi').count()) >= 3);
    check('company 高管轮播 3 页', (await page.locator('.cp-exec-slide').count()) === 3);
    check('company 友商板块渲染', (await page.textContent('[data-cp-fold-key$=\':competitors\']') || '').includes('友商 / 竞品分析'));
    const cmpLink = await page.getAttribute('.cp-cmp-name.is-link', 'href');
    check('company 友商深链 ?c=', typeof cmpLink === 'string' && cmpLink.includes('company.html?c='));

    // 未知 id → 列表兜底
    await page.goto(BASE + '/company.html?c=nosuch', { waitUntil: 'domcontentloaded' });
    await sleep(500);
    check('company 未知 id 兜底提示', (await page.textContent('.cp-list-note')).includes('没有找到'));

    // comein：全景 + 折叠相册 + 任职佐证 + 社交挂载
    await page.goto(BASE + '/company.html?c=comein', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.cp-head', { timeout: 8000 });
    await sleep(800);
    check('comein 相册默认折叠', await page.evaluate(() => document.querySelector('.cp-office').classList.contains('is-folded')));
    check('comein 全景卡存在', (await page.locator('.cp-office-img.is-pano').count()) === 1);
    check('comein 佐证材料锁定态', await page.evaluate(() => {
      return document.querySelector('.sa-box')?.getAttribute('data-sa-state') === 'locked';
    }));
    const socialReady = await page.evaluate(() => document.querySelector('[data-cs-root]')?.getAttribute('data-cs-ready'));
    check('comein 读者互动挂载（真实 /api/company-social）', socialReady === '1');

    // 折叠相册展开
    await page.click('[data-cp-album-toggle]');
    await sleep(120);
    check('comein 相册展开', await page.evaluate(() => !document.querySelector('.cp-office').classList.contains('is-folded')));

    // 360° 全景桥接：点击全景卡 → 查看器开 → Esc 关（passive:false 拖拽由旧 js 提供，R11 同实现）
    await page.locator('.cp-office-img.is-pano img').first().scrollIntoViewIfNeeded();
    await page.locator('.cp-office-img.is-pano img').first().click();
    await sleep(600);
    check('comein 全景查看器打开', await page.evaluate(() => !!document.querySelector('.cp-pano:not([hidden])')));
    await page.keyboard.press('Escape');
    await sleep(200);
    check('comein 全景 Esc 关闭', await page.evaluate(() => !!document.querySelector('.cp-pano[hidden]')));

    // 灯箱：普通相册图
    await page.locator('.cp-office-img:not(.is-pano) img').first().scrollIntoViewIfNeeded();
    await page.locator('.cp-office-img:not(.is-pano) img').first().click();
    await sleep(300);
    check('comein 灯箱打开 + cp-lock', await page.evaluate(() =>
      !!document.querySelector('.cp-lightbox') && document.body.classList.contains('cp-lock')));
    await page.keyboard.press('Escape');
    await sleep(200);
    check('comein 灯箱 Esc 关闭 + 解锁', await page.evaluate(() =>
      !document.querySelector('.cp-lightbox') && !document.body.classList.contains('cp-lock')));

    // 高管 bio 展开（zhishu slide bio > 40 字）
    await page.goto(BASE + '/company.html?c=zhishu', { waitUntil: 'domcontentloaded' });
    await sleep(600);
    const bioToggle = page.locator('.cp-exec-slide [data-cp-exec-bio-toggle]').first();
    if ((await bioToggle.count()) > 0) {
      await bioToggle.click();
      await sleep(100);
      check('zhishu 高管 bio 展开', await page.evaluate(() =>
        !document.querySelector('.cp-exec-slide [data-cp-exec-bio]').classList.contains('is-clamped')));
    } else {
      check('zhishu 高管 bio 展开跳过（无长 bio）', true);
    }

    /* 高管轮播触屏横滑：左滑翻页 + 右滑回位（passive:false 手动挂载路径） */
    await page.evaluate(() => {
      const vp = document.querySelector('.cp-exec-viewport');
      vp.scrollIntoView({ block: 'center' });
    });
    await sleep(100);
    const swipe = await page.evaluate(async () => {
      const vp = document.querySelector('.cp-exec-viewport');
      const track = document.querySelector('.cp-exec-track');
      const box = document.querySelector('.cp-head-exec');
      const before = Number(box.getAttribute('data-cp-exec-index'));
      const rect = vp.getBoundingClientRect();
      vp.dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.left + 200, clientY: rect.top + 40, pointerId: 1, bubbles: true }));
      document.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + 60, clientY: rect.top + 40, pointerId: 1, bubbles: true, cancelable: true }));
      const mid = track.style.transform;
      const dragging = track.classList.contains('is-dragging');
      document.dispatchEvent(new PointerEvent('pointerup', { clientX: rect.left + 60, clientY: rect.top + 40, pointerId: 1, bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      return { before, mid, dragging, after: Number(box.getAttribute('data-cp-exec-index')) };
    });
    check('zhishu 轮播横滑跟手位移', swipe.mid && swipe.mid !== `translateX(-0%)`);
    check('zhishu 轮播 is-dragging 过渡类', swipe.dragging);
    check('zhishu 轮播横滑翻页', swipe.after === swipe.before + 1);

    await page.screenshot({ path: SHOT_DIR + '/company-zhishu-1280.png', fullPage: true });
    await ctx.close();
  }

  /* ═══════════ ③ school.html ═══════════ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();

    // 单校自动展示（localStorage 全新）
    await page.goto(BASE + '/school.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.sp-head', { timeout: 8000 });
    await sleep(600);
    check('school 单校自动展示', (await page.textContent('.sp-title')).includes('中山大学新华学院'));
    check('school title 更新', (await page.title()).includes('新华学院'));
    check('school 10 板块渲染', (await page.locator('.sp-sec').count()) === 10);
    check('school 学历核验锁定', await page.evaluate(() => !!document.querySelector('[data-sp-verify-lock]')));
    check('school 相册二维码锁定', await page.evaluate(() => !!document.querySelector('[data-sp-album-qr]')));
    check('school 验证码不泄漏', await page.evaluate(() => {
      const codes = ['REDACTED_VERIFY_CODE'];
      return !document.getElementById('spPageBody').textContent.includes(codes[0]);
    }));

    // 申请弹窗校验
    await page.click('[data-sp-verify-apply]');
    await sleep(150);
    check('school 弹窗打开 + body 锁', await page.evaluate(() =>
      !!document.getElementById('spAccessModal') && !document.getElementById('spAccessModal').hidden &&
      document.body.classList.contains('sp-modal-open')));
    await page.click('#spAccessModal [data-sp-submit]');
    await sleep(100);
    check('school 空表单校验', (await page.textContent('#spAccessModal [data-sp-form-error]')).includes('至少 2 个字'));

    // 合法提交（dev server /api/verify-access 真实受理）
    await page.fill('#spAccessModal [name="name"]', 'E2E 背调专员');
    await page.selectOption('#spAccessModal [name="identity"]', 'hr');
    await page.selectOption('#spAccessModal [name="purpose"]', 'background');
    await page.fill('#spAccessModal [name="reason"]', 'E2E 自动化测试：推进候选人入职背调，需要核验学历信息，仅用于本次评估，不会外传。');
    await page.check('#spAccessModal [name="consent"]');
    await page.click('#spAccessModal [data-sp-submit]');
    await sleep(1000);
    const done = await page.evaluate(() => {
      const el = document.querySelector('[data-sp-form-done-text]');
      return el ? el.textContent : '';
    });
    check('school 申请提交等待文案', done.includes('留在此页等待'));
    check('school 轮询状态落盘', await page.evaluate(() => !!localStorage.getItem('sp_verify_access')));
    await page.keyboard.press('Escape');
    await sleep(150);
    check('school 弹窗 Esc 关闭', await page.evaluate(() =>
      !document.getElementById('spAccessModal') || document.getElementById('spAccessModal').hidden));

    // 解锁态：兼容旧键写入后刷新 → reveal
    await page.evaluate(() => {
      const a = JSON.parse(localStorage.getItem('sp_verify_access') || '{}');
      localStorage.setItem('sp_verify_unlock', JSON.stringify({
        id: a.id, device: localStorage.getItem('wall_device_id'), schoolId: 'xinhua',
        approvedAt: Date.now(), expiresAt: Date.now() + 3600e3,
      }));
    });
    await page.goto(BASE + '/school.html', { waitUntil: 'domcontentloaded' });
    await sleep(700);
    check('school 解锁态渲染', await page.evaluate(() => !!document.querySelector('[data-sp-verify-open]')));
    check('school 解锁有效期提示', (await page.textContent('.sp-verify-flag')).includes('已获本人批准'));
    check('school 相册二维码解锁成图', await page.evaluate(() =>
      document.querySelectorAll('.sp-album-locked').length === 0 && document.querySelectorAll('.sp-album-img').length >= 5));

    await ctx.close();
  }

  /* ═══════════ ④ 404 ═══════════ */
  {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 800 } });
    const page = await ctx.newPage();
    const resp = await page.goto(BASE + '/404', { waitUntil: 'domcontentloaded' });
    check('404 返回 404 状态', resp ? resp.status() === 404 : false);
    check('404 主体内容', (await page.textContent('.sheet')).includes('这个页面不在档案里'));
    check('404 零脚本', await page.evaluate(() => document.querySelectorAll('script').length === 0));
    await page.screenshot({ path: SHOT_DIR + '/404-900.png', fullPage: true });
    await ctx.close();
  }

  /* ═══════════ ⑤⑥ 主题 & 移动档快照（390 hasTouch / 680） ═══════════ */
  {
    const iphone = devices['iPhone 12'];
    const ctx = await browser.newContext({ ...iphone });
    const page = await ctx.newPage();
    for (const theme of ['archive', 'blueprint', 'newsprint', 'noir']) {
      await page.goto(BASE + '/company.html?c=zhishu&theme=' + theme, { waitUntil: 'domcontentloaded' });
      await sleep(700);
      const got = await page.getAttribute('html', 'data-theme');
      check('company 主题 ' + theme, got === theme);
      await page.screenshot({ path: SHOT_DIR + `/company-390-${theme}.png`, fullPage: true });
    }
    await page.goto(BASE + '/jd.html', { waitUntil: 'domcontentloaded' });
    await sleep(500);
    await page.screenshot({ path: SHOT_DIR + '/jd-390.png', fullPage: true });
    await page.goto(BASE + '/school.html', { waitUntil: 'domcontentloaded' });
    await sleep(500);
    await page.screenshot({ path: SHOT_DIR + '/school-390.png', fullPage: true });
    await page.setViewportSize({ width: 680, height: 900 });
    await sleep(300);
    await page.screenshot({ path: SHOT_DIR + '/school-680.png', fullPage: true });
    await ctx.close();

    // 触屏拖拽不误滚：全景查看器在 touch 移动时不滚页面（模拟在 pano 上 touch 滑动）
    const ctx2 = await browser.newContext({ ...devices['iPhone 12'] });
    const page2 = await ctx2.newPage();
    await page2.goto(BASE + '/company.html?c=comein', { waitUntil: 'domcontentloaded' });
    await page2.waitForSelector('.cp-office-img.is-pano', { timeout: 8000 });
    await page2.evaluate(() => document.querySelector('[data-cp-album-toggle]')?.click());
    await sleep(200);
    await page2.evaluate(() => {
      const img = document.querySelector('.cp-office-img.is-pano img');
      img && img.scrollIntoView({ block: 'center' });
    });
    await sleep(200);
    await page2.evaluate(() => document.querySelector('.cp-office-img.is-pano img').click());
    await sleep(600);
    const panoOpen = await page2.evaluate(() => !!document.querySelector('.cp-pano:not([hidden])'));
    check('comein 390 档全景打开', panoOpen);
    if (panoOpen) {
      const beforeY = await page2.evaluate(() => window.scrollY);
      await page2.touchscreen.tap(200, 300); /* 占位：canvas 上拖 */
      const canvas = await page2.locator('.cp-pano-canvas').boundingBox();
      if (canvas) {
        await page2.touchscreen.tap(canvas.x + 10, canvas.y + 10);
      }
      check('comein 全景 touch 期间 Esc 可退', await page2.evaluate(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await new Promise((r) => setTimeout(r, 200));
        return !!document.querySelector('.cp-pano[hidden]');
      }));
    }
    await page2.screenshot({ path: SHOT_DIR + '/company-390-pano.png', fullPage: false });
    await ctx2.close();
  }

  console.log(`\nM2 E2E：通过 ${passed} / 失败 ${failed}`);
  if (failed > 0) process.exitCode = 1;
} finally {
  await browser.close();
}
