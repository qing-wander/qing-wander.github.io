import { describe, expect, it, vi } from 'vitest';
import {
  adminGet, ApiError, devicesSchema, messagesSchema, statsSchema, variantSchema, voiceSchema,
  authMethodsSchema, qaSchema,
} from './admin';

/**
 * zod 契约快照（M1 首批）：样例与 functions/api/admin/** 的 JSDoc/实现一致。
 * 后端改字段形状 → 这里先红，再决定改 schema 还是改后端（回归闸门语义）。
 */

describe('statsSchema', () => {
  it('接受完整字段并透传数字', () => {
    const d = statsSchema.parse({ stats: { pv: 10, uv: 3, empty_by_mistake: 1 } });
    expect(d.stats.pv).toBe(10);
  });
});

describe('devicesSchema', () => {
  it('缺省字段落到安全默认值', () => {
    const d = devicesSchema.parse({ devices: [{ device_hash: 'abc', status: 'ok' }], total: 1 });
    const row = d.devices[0];
    if (!row) throw new Error('row missing');
    expect(row.messages).toBe(0);
    expect(row.hidden).toBe(0);
    expect(row.first_seen).toBeUndefined();
  });
  it('legacyMessages 缺省为 0', () => {
    const d = devicesSchema.parse({});
    expect(d.legacyMessages).toBe(0);
    expect(d.devices).toEqual([]);
    expect(d.total).toBe(0);
  });
});

describe('messagesSchema', () => {
  it('replies 数组落默认并解析 author/status', () => {
    const d = messagesSchema.parse({
      messages: [{ id: 'm1', device_hash: 'legacy', text: '你好', status: 'visible',
        replies: [{ id: 'r1', author: 'owner', text: '回复', created_at: 1795000000000 }] }],
    });
    expect(d.messages[0]?.replies?.[0]?.author).toBe('owner');
    expect(d.total).toBe(0);
  });
});

describe('qaSchema / authMethodsSchema / voiceSchema / variantSchema', () => {
  it('qa 空看板样例可解析', () => {
    const d = qaSchema.parse({ totals: { total: 0, last7: 0, empty: 0, empty_rate: 0, ms_avg: null } });
    expect(d.recent).toEqual([]);
  });
  it('authMethods 未配置微信样例', () => {
    const d = authMethodsSchema.parse({ ok: true, wechat: { qr: false, mp: false }, inWechat: false, mini: false, email: { enabled: true, count: 1, hint: 'de***@local.test' } });
    expect(d.email.enabled).toBe(true);
  });
  it('voice 默认音色号兜底', () => {
    const d = voiceSchema.parse({ voices: [] });
    expect(d.default_female_voice).toBe(101001);
    expect(d.female_is_default).toBe(true);
  });
  it('variant rewrite 缺省为未请求', () => {
    const d = variantSchema.parse({ html: '<x/>', stats: { bullets_before: 20 } });
    expect(d.stats.rewrite.requested).toBe(false);
    expect(d.stats.skills_order).toEqual([]);
  });
});

describe('adminGet', () => {
  it('401 时抛 ApiError（跳登录副作用在 jsdom 由 location.replace 接管）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(adminGet('/api/admin/stats', statsSchema)).rejects.toBeInstanceOf(ApiError);
    vi.unstubAllGlobals();
  });
});
