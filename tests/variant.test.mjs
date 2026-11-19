/* 变体生成接口 —— 离线契约测试
   ──────────────────────────────────────────────────────────────
   用 rag/chunks.json 伪装 D1，直接调 onRequestPost，
   验证：选材上限、L0 不变、返回的 HTML 与正式简历同一模板骨架。
   ────────────────────────────────────────────────────────────── */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequestPost } from '../functions/api/variant.js';

const chunks = JSON.parse(readFileSync(new URL('../rag/chunks.json', import.meta.url), 'utf8')).chunks;
const siteData = JSON.parse(readFileSync(new URL('../data/site-data.json', import.meta.url), 'utf8'));

const env = {
  DB: {
    prepare() {
      return {
        async all() {
          return { results: chunks.map((c) => ({ id: c.id, title: c.title || '', text: c.text || '' })) };
        },
      };
    },
  },
};

function req(jd) {
  return new Request('https://shenge-work.pages.dev/api/variant', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jd }),
  });
}

const AGENT_JD = `岗位：AI Agent 工程师
职责：负责多 Agent 编排与 RAG 检索增强系统落地，搭建企业级 AI 基础设施；
参与 IM 网关、分布式系统设计；推动 MCP / Skill 生态接入；建设评测体系。
要求：熟悉 Java / Go / Python 至少两门，了解向量数据库、Prompt 工程、Kubernetes 部署；
有从 0 到 1 交付经验，能独立完成技术选型。`;

test('JD 太短直接 400', async () => {
  const r = await onRequestPost({ request: req('太短了'), env });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'jd_too_short');
});

test('正常 JD 出变体，且只删不改', async () => {
  const r = await onRequestPost({ request: req(AGENT_JD), env });
  const d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.ok, true);

  /* 同一模板骨架：打印按钮 / 简历页脚 / 主题变量都在 */
  assert.match(d.html, /AUTO-GENERATED/);
  assert.match(d.html, /<html/);
  assert.ok(d.html.length > 30000, 'HTML 体量异常，可能模板没注入');

  /* L0：公司全称、时间、学校原样保留 */
  for (const exp of siteData.resume.experience) {
    assert.ok(d.html.includes(exp.company), `公司名丢了：${exp.company}`);
    assert.ok(d.html.includes(exp.period), `时间段丢了：${exp.period}`);
  }
  assert.ok(d.html.includes(siteData.resume.education.school));

  /* 选材上限 */
  assert.ok(d.stats.projects <= 4);
  assert.ok(d.stats.bullets_after <= d.stats.bullets_before);
  assert.ok(d.stats.bullets_after > 0);
});

test('与档案无交集的 JD 不硬凑', async () => {
  const r = await onRequestPost({
    request: req('招聘厨师长一名，负责川菜热菜出品，需要有后厨团队管理经验，熟悉食材采购与成本核算，持健康证。'),
    env,
  });
  const d = await r.json();
  /* 要么明确说没交集，要么仍给出一个能看的版本 —— 都不能返回半成品 */
  if (r.status === 200) {
    assert.equal(d.ok, true);
    assert.ok(d.stats.bullets_after > 0);
  } else {
    assert.equal(d.ok, false);
    assert.equal(d.error, 'no_overlap');
  }
});
