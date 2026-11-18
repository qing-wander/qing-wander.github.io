/* RAG 切片与词面检索的回归用例
   跑法：node --test tests/*.test.mjs
   关注三件事：切片是否完备且 id 稳定、隐私字段有没有漏、检索命中率有没有跌破闸门。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChunks } from '../scripts/build_rag_chunks.mjs';
import { search } from '../scripts/rag_query.mjs';
import { tokenize } from '../scripts/lib/rag-tokenize.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(resolve(ROOT, 'data/site-data.json'), 'utf8'));
const payload = JSON.parse(readFileSync(resolve(ROOT, 'rag/chunks.json'), 'utf8'));
const golden = JSON.parse(readFileSync(resolve(ROOT, 'tests/golden-queries.json'), 'utf8'));

test('切片产物与 data/site-data.json 同源（未重建就红）', () => {
  const fresh = buildChunks(data);
  assert.equal(fresh.kb_version, payload.kb_version, 'kb_version 不一致，说明 rag/chunks.json 没重建');
  assert.equal(fresh.count, payload.count);
  assert.deepEqual(
    fresh.chunks.map((c) => [c.id, c.text]),
    payload.chunks.map((c) => [c.id, c.text]),
    '切片正文与重建结果不一致',
  );
});

test('经历 / 项目 bullet 都有同 id 的切片，教育 bullet 并入教育片', () => {
  const ids = new Set(payload.chunks.map((c) => c.id));
  const bullets = [
    ...data.resume.experience.flatMap((e) => e.bullets),
    ...data.resume.projects.flatMap((p) => p.bullets),
  ].map((b) => b.id);
  const missing = bullets.filter((id) => !ids.has(id));
  assert.deepEqual(missing, [], '有 bullet 没进切片：' + missing.join(', '));

  const eduChunk = payload.chunks.find((c) => c.id === 'edu-main');
  assert.ok(eduChunk, '缺少 edu-main');
  for (const b of data.resume.education.bullets) {
    const plain = b.html.replace(/<[^>]+>/g, '');
    assert.ok(eduChunk.text.includes(plain), `教育 bullet ${b.id} 没并进 edu-main`);
  }
});

test('切片元数据齐备且对外可见', () => {
  const required = ['id', 'kind', 'section', 'entity_id', 'entity_type', 'title', 'text', 'url',
    'tags', 'visibility', 'lang', 'kb_version', 'source_path'];
  for (const c of payload.chunks) {
    for (const k of required) assert.ok(c[k] !== undefined && c[k] !== '', `${c.id} 缺字段 ${k}`);
    assert.equal(c.visibility, 'public', `${c.id} 不是 public`);
    assert.equal(c.lang, 'zh');
    assert.ok(c.source_path.startsWith('data/site-data.json#/'), `${c.id} 的 source_path 无法回链`);
    assert.ok(Array.isArray(c.tags) && c.tags.length <= 6, `${c.id} tags 异常`);
  }
  const ids = payload.chunks.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, '切片 id 有重复');
});

test('隐私闸门：产物里没有手机号、tel: 与会话串', () => {
  const raw = JSON.stringify(payload);
  assert.ok(!/1[3-9][0-9]{9}/.test(raw.replace(/[^\d]/g, x => x)), '疑似手机号进库');
  assert.ok(!/tel:/i.test(raw), 'tel: 直拨链接进库');
  assert.ok(!/180\s?2283\s?4605/.test(raw), '简历上的手机号进库');
});

test('分词：中文 bigram、英文整词，单字不丢', () => {
  assert.deepEqual(tokenize('云沙箱'), ['云沙', '沙箱']);
  assert.ok(tokenize('LangGraph RAG').includes('langgraph'));
  assert.ok(tokenize('RAG').includes('rag'));
  assert.deepEqual(tokenize('5'), ['5']);
});

test('词面检索：金标集 hit@3 不低于闸门', () => {
  let hit = 0;
  const misses = [];
  for (const item of golden.queries) {
    const top3 = search(payload, item.q, 3).map((h) => h.id);
    if (top3.some((id) => item.expect.includes(id))) hit++;
    else misses.push(`${item.q} → ${top3.join(', ') || '(空)'}`);
  }
  const rate = hit / golden.queries.length;
  assert.ok(rate >= golden.gateHit3, `hit@3 ${(rate * 100).toFixed(1)}% 低于闸门 ${golden.gateHit3 * 100}%：\n${misses.join('\n')}`);
});

test('无关问题不召回：交给线上走拒答话术', () => {
  for (const q of golden.offTopic) {
    assert.equal(search(payload, q, 3).length, 0, `「${q}」召回了切片，应直接拒答`);
  }
});
