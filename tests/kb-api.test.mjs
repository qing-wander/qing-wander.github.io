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
