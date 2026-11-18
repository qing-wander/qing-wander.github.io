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
