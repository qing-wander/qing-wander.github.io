/* /api/kb 的纯函数用例：分词同源、RRF 融合、口语意图赦免
   跑法：node --test tests/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tokenize, rrf, hintedSections } from '../functions/api/kb.js';

test('tokenize：中文 bigram + 英文整词，与构建端同源', () => {
  const t = tokenize('云沙箱 Sandbox 多租户');
  assert.ok(t.includes('云沙'), '相邻汉字要切 bigram');
  assert.ok(t.includes('沙箱'));
  assert.ok(t.includes('sandbox'), '英文按整词并小写');
  assert.ok(!t.includes('云'), '单字不进索引，避免噪音');
});

test('tokenize：标点与空白不产生 token', () => {
  const t = tokenize('？，。  ');
  assert.deepEqual(t, []);
});

test('rrf：只看名次不看量纲，两路都靠前的排最前', () => {
  const fused = rrf([
    { items: ['a', 'b', 'c'] },
    { items: ['c', 'a', 'd'] },
  ]);
  assert.equal(fused[0].id, 'a', 'a 名次 1+2 应最高');
  assert.equal(fused[1].id, 'c', 'c 名次 3+1 次之');
  assert.ok(fused[0].score > fused[1].score);
});

test('rrf：单路时保持原顺序', () => {
  const fused = rrf([{ items: ['x', 'y'] }]);
  assert.deepEqual(fused.map((f) => f.id), ['x', 'y']);
});

test('hintedSections：口语问法能识别章节意图', () => {
  assert.ok(hintedSections('他几年经验').has('experience'));
  assert.ok(hintedSections('他什么学历').has('education'));
  assert.ok(hintedSections('怎么联系他').has('contact'));
  assert.ok(hintedSections('他会哪些技能').has('skills'));
  assert.equal(hintedSections('今天天气怎么样').size, 0, '无关问题不该有意图');
});

test('pickSemantic：地板去底噪，相对窗口只留冠军梯队，且剥掉 kb_version 前缀', async () => {
  const { pickSemantic } = await import('../functions/api/kb.js');
  const keep = pickSemantic([
    { id: 'kb-5f9004b7:proj-comein-01', score: 0.5279 },
    { id: 'kb-5f9004b7:skill-02', score: 0.5193 },   // 与最高分差 0.0086 → 留
    { id: 'kb-5f9004b7:me-01', score: 0.4910 },      // 差 0.0369 → 留（窗口 0.04）
    { id: 'kb-5f9004b7:proj-comein-05', score: 0.4100 }, // 低于地板 0.42 → 丢
  ]);
  assert.equal(keep.length, 3);
  assert.equal(keep[0], 'proj-comein-01', 'id 前缀要剥掉，才能对上 D1 主键');
  assert.ok(!keep.includes('proj-comein-05'));
});

test('pickSemantic：全空时返回空数组，不抛', () => {
  return import('../functions/api/kb.js').then(({ pickSemantic }) => {
    assert.deepEqual(pickSemantic([]), []);
  });
});

test('buildMessages：提示词锁死公司名/学历/数字，且片段带 id 可回链', async () => {
  const { buildMessages, LOCKED_FIELDS } = await import('../functions/api/chat.js');
  const msgs = buildMessages('他在进门财经做什么', [
    { id: 'exp-inmen-01', title: '深圳进门财经科技股份有限公司 · Agent 工程师', text: '主导 AI 金融投研工作台核心基建' },
  ]);
  assert.equal(msgs[0].role, 'system');
  assert.ok(msgs[0].content.includes(LOCKED_FIELDS), '锁定字段要明写进系统提示');
  // 拒答话术随助手身份改过第一人称（「这块我的简历里没写」），
  // 这里只校验「明确拒答 / 不编造」的语义，不锁死具体措辞。
  assert.ok(/简历里没写|没写这块|不做承诺/.test(msgs[0].content), '要有拒答话术');
  assert.ok(msgs[1].content.includes('[exp-inmen-01]'), '片段 id 必须带进上下文，答案才能挂引用');
});

test('splitRequirements：去序号/去重/分号切/上限 14', async () => {
  const { splitRequirements } = await import('../functions/api/jd.js');
  const jd = ['1. 负责 Agent 编排与工具调用链路设计', '- 熟悉 Java 并发与 JVM 调优',
    '（2）熟悉 Java 并发与 JVM 调优', '；只有三个字', '学历本科及以上；五年以上经验'].join('\n');
  const reqs = splitRequirements(jd);
  assert.ok(reqs.length >= 4 && reqs.length <= 14);
  assert.equal(reqs[0], '负责 Agent 编排与工具调用链路设计');
  assert.equal(reqs.filter((r) => r === '熟悉 Java 并发与 JVM 调优').length, 1, '重复要去掉');
  assert.ok(!reqs.some((r) => r.length < 4));
});

test('statusOf：覆盖率三档阈值（0.55 / 0.25）', async () => {
  const { statusOf } = await import('../functions/api/jd.js');
  assert.equal(statusOf(0.9), 'covered');
  assert.equal(statusOf(0.55), 'covered');
  assert.equal(statusOf(0.54), 'partial');
  assert.equal(statusOf(0.25), 'partial');
  assert.equal(statusOf(0.24), 'gap');
});

test('coverageOf：命中专业词算覆盖，命中不了的技能算缺口', async () => {
  const { coverageOf, statusOf } = await import('../functions/api/jd.js');
  const text = '主导 AI 金融投研工作台核心基建研发：Agent 基座与多租户云沙箱隔离执行、弹性配额';
  assert.equal(statusOf(coverageOf('多租户云沙箱隔离', text).ratio), 'covered');
  assert.equal(statusOf(coverageOf('Kubernetes 与 CI/CD 落地经验', text).ratio), 'gap');
});

test('splitRequirements：标题行不进需求点', async () => {
  const { splitRequirements } = await import('../functions/api/jd.js');
  const reqs = splitRequirements('岗位职责：\n任职要求\n1. 负责 Agent 平台架构设计；2. 熟悉向量检索');
  assert.ok(!reqs.some((r) => r === '任职要求'), '纯标题行要丢掉');
  assert.ok(reqs.length >= 2);
});

test('parseJudge：从代码块/夹带文字里抠出 JSON 判定，非法项丢弃', async () => {
  const { parseJudge } = await import('../functions/api/jd.js');
  const text = '判定如下：\n```json\n[{"i":0,"status":"covered"},{"i":1,"status":"gap"},{"i":9,"status":"covered"},{"i":2,"status":"maybe"}]\n```';
  const out = parseJudge(text, 3);
  assert.ok(out, '应能从夹带文字里解析');
  assert.equal(out[0], 'covered');
  assert.equal(out[1], 'gap');
  assert.equal(out[2], null, '非法状态丢弃');
  assert.equal(parseJudge('没有 JSON', 2), null);
});

test('buildJudgeMessages：需求点带序号、片段带 id 与正文', async () => {
  const { buildJudgeMessages } = await import('../functions/api/jd.js');
  const msgs = buildJudgeMessages(['熟悉 Agent 编排'], [[{ id: 'proj-comein-01', title: 't', text: 'Agent 基座' }]]);
  assert.ok(msgs[0].content.includes('covered'), '要给出三档定义');
  assert.ok(msgs[1].content.includes('#0 需求：熟悉 Agent 编排'));
  assert.ok(msgs[1].content.includes('[proj-comein-01]'), '片段 id 必须带进去');
});
