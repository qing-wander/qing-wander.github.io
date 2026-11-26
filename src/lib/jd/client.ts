/**
 * JD 匹配客户端（M2）—— 自 js/jd-match.js 逐字平移的数据 / 请求 / 文案 / 导出层。
 * React 端点解算用 aiEndpoint()（旧 window.CP_AI_ENDPOINT 逻辑收编）。
 * 旧 js/jd-match.js 在 M2-M3 期间继续服务 index.html 的 AI 面板（window.CP_JD_UI），
 * 两处实现以本文件为准源对照迁移；M3 收编 AI 面板后旧文件下线（docs 方案 §2.3）。
 */
import { aiEndpoint } from '../api/endpoints';

export const CFG = {
  /** 旧版 fallback 端点（tcloudbase 网关），仅当 aiEndpoint() 为空时兜底——与 jd-match.js 一致 */
  endpointFallback: 'https://resume-ai-d9g7zghnxda2ee2cb-1307508155.ap-shanghai.app.tcloudbase.com/chat',
  maxChars: 1500,
  minChars: 30,
  timeout: 38000, // 云函数侧模型超时 26s，这里留网关与冷启动余量
  quota: '每人 10 分钟 4 次',
} as const;

export const STATUS_CN: Record<string, string> = { covered: '覆盖', partial: '部分', gap: '缺口' };

/** 三个示例 JD：分别对应「技术深度匹配」「同栈不同赛道」「明显跨岗」。 */
export const EXAMPLES: Record<string, string> = {
  agent: [
    '岗位：AI Agent 工程师（企业智能体平台）',
    '团队方向：把大模型能力做成可交付、可治理的企业级 Agent 产品。',
    '岗位职责：',
    '1. 负责 Agent 平台的架构设计与核心模块开发，包含任务规划、工具调用、多智能体编排与记忆管理；',
    '2. 建设 RAG 检索链路：文档解析、切片策略、向量检索、重排与召回效果评测；',
    '3. 负责 Agent 运行时的可观测与治理：调用链追踪、成本与配额控制、失败重试与降级；',
    '4. 与业务团队共建行业智能体（金融投研、营销获客、客服等场景），推动 PoC 到上线。',
    '任职要求：',
    '1. 本科及以上学历，3 年以上后端研发经验，熟悉 Java、Go 或 Python 之一；',
    '2. 熟悉 LLM 应用开发，理解 Prompt 工程、Function Calling、MCP 等机制；',
    '3. 有向量数据库（Milvus / Elasticsearch）使用与检索评测经验；',
    '4. 熟悉分布式系统与高并发服务，能独立完成模块从 0 到 1 落地。',
  ].join('\n'),

  backend: [
    '岗位：Java 后端工程师（金融科技 · 交易与网关方向）',
    '岗位职责：',
    '1. 负责交易网关与分布式服务的设计开发，保障高并发下的稳定性与一致性；',
    '2. 参与实时数据链路建设，基于 Kafka / Flink 完成流式计算与指标聚合；',
    '3. 负责服务治理：限流降级、熔断重试、链路追踪与容量评估；',
    '4. 配合前端与产品完成需求交付，参与技术方案评审与线上问题排查。',
    '任职要求：',
    '1. 本科及以上，3 年以上 Java 服务端开发经验，熟悉 Spring Cloud / Dubbo；',
    '2. 熟悉 MySQL、Redis、消息队列，具备分库分表与缓存设计经验；',
    '3. 有金融、支付或 SaaS 行业背景优先；',
    '4. 有 Kubernetes 与 CI/CD 落地经验优先。',
  ].join('\n'),

  solution: [
    '岗位：AI 解决方案工程师（售前 / 交付）',
    '岗位职责：',
    '1. 面向银行、券商、保险客户梳理业务场景，输出 AI Agent 解决方案与投标技术方案；',
    '2. 配合销售完成需求调研、方案汇报、POC 验证与竞品对比；',
    '3. 沉淀行业方案模板与最佳实践，向产研团队反馈需求；',
    '4. 支持项目交付，协调内外部资源推进上线。',
    '任职要求：',
    '1. 本科及以上，3 年以上 To B 解决方案或售前经验；',
    '2. 熟悉大模型与 Agent 的技术边界，能与客户技术负责人对话；',
    '3. 优秀的方案撰写与表达能力，能独立完成标书技术部分；',
    '4. 有金融行业客户资源或项目经验优先。',
  ].join('\n'),
};

/* ── 响应类型（与云函数 functions/api/chat.js mode:'jd' 的 JSON 形状对齐；宽松 passthrough 语义与旧版一致） ── */

export interface JdEvidence {
  point?: string;
  title?: string;
  /** 切片与该条要求的覆盖率；兼容旧字段 ground */
  ratio?: number | null;
  ground?: number | null;
  /** 切片原文（可点开核对） */
  excerpt?: string;
}

export interface JdRow {
  req: string;
  status?: string;
  gap?: string;
  probe?: string;
  evidence?: JdEvidence[];
}

export interface JdMatchData {
  ok: true;
  match?: {
    overall?: { score?: number; verdict?: string; summary?: string };
    rows?: JdRow[];
    stats?: { covered?: number; partial?: number; gap?: number };
  };
  meta?: {
    recalled?: number;
    requirements?: number;
    merged?: number;
  };
}

export class JdError extends Error {
  code: string;
  serverMessage: string;
  constructor(code: string, msg = '') {
    super(code || 'unknown');
    this.code = code || 'unknown';
    this.serverMessage = msg || '';
  }
}

export function shortTitle(t: unknown): string {
  const parts = String(t ?? '').split('｜');
  const s = (parts[0] ?? '').trim();
  return s.length > 24 ? s.slice(0, 24) + '…' : s;
}

/* ── 请求：POST { mode:'jd', jd }（AbortController 超时语义与旧版一致） ── */
export function requestJd(jd: string): Promise<JdMatchData> {
  return new Promise((resolve, reject) => {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (ctrl) { try { ctrl.abort(); } catch { /* noop */ } }
      reject(new JdError('timeout'));
    }, CFG.timeout);

    const opts: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'jd', jd }),
    };
    if (ctrl) opts.signal = ctrl.signal;

    const done = <T,>(fn: (v: T) => void, val: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(val);
    };

    const endpoint = aiEndpoint() || CFG.endpointFallback;
    fetch(endpoint, opts)
      .then((r) =>
        r.text().then((txt) => {
          let d: unknown;
          try { d = JSON.parse(txt); } catch { d = null; }
          const obj = d as (Record<string, unknown> | null);
          if (!obj) { done(reject, new JdError('bad_json')); return; }
          if (!r.ok || obj.ok !== true) {
            const err = obj.error;
            done(reject, new JdError(err ? String(err) : 'http_' + r.status, typeof obj.message === 'string' ? obj.message : ''));
            return;
          }
          done(resolve, obj as unknown as JdMatchData);
        }),
      )
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === 'AbortError') done(reject, new JdError('timeout'));
        else done(reject, new JdError('network'));
      });
  });
}

export function errorText(err: { code?: string; serverMessage?: string } | null | undefined): string {
  const c = err?.code || '';
  if (c === 'timeout') return '这次等太久了，模型可能正忙，稍后再点一次。';
  if (c === 'network') return '网络或通道异常，检查网络后重试；也可以直接邮件联系。';
  if (c === 'jd_quota') return 'JD 匹配' + CFG.quota + '，歇一会儿再来；急的话直接邮件：hi@chenpeisheng.cn';
  if (c === 'rate_limited') return '请求有点急，等十几秒再试。';
  if (c === 'parse_failed') return '模型这次没按结构输出，再点一次通常就好。';
  if (c === 'no_match') return '档案里没有和这份 JD 相关的资料，换个岗位试试。';
  if (c === 'bad_request') {
    const m = err?.serverMessage || '';
    /* 线上云函数还没更新到支持 mode:'jd' 时，旧代码会报「缺少 question」 */
    if (m.indexOf('question') !== -1) return '后端云函数还是旧版本（不含 JD 匹配），重新部署 functions/tencent 后再试。';
    return m || 'JD 格式或长度不合要求，检查一下再提交。';
  }
  if (c === 'origin_denied') return '当前域名不在白名单里，本地预览请用 127.0.0.1:8000。';
  if (c === 'server_misconfig') return '后端的模型 Key 还没配置好，暂时无法匹配。';
  if (c === 'bad_json') return '通道返回了无法解析的内容，稍后再试。';
  return err?.serverMessage || '匹配失败，稍后再试，或邮件联系：hi@chenpeisheng.cn';
}

/* ── Markdown 导出（贴到邮件 / 飞书都还算整齐） ── */
function mdCell(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, ' ');
}

export function toMarkdown(data: JdMatchData): string {
  const m = data.match || {};
  const o = m.overall || {};
  const rows: JdRow[] = Array.isArray(m.rows) ? m.rows : [];
  const out: string[] = [];
  out.push('## 岗位匹配结果 · ' + (Number(o.score) || 0) + '/100（' + (o.verdict || '') + '）');
  if (o.summary) out.push('', '> ' + mdCell(o.summary));
  out.push('', '| # | JD 要求 | 状态 | 对应证据 | 缺口 | 面试追问点 |');
  out.push('|---|---|---|---|---|---|');
  (rows as JdRow[]).forEach((r: JdRow, i: number) => {
    const ev = (r.evidence || [])
      .map((e) => e.point + '（' + shortTitle(e.title) + '）')
      .join('<br>');
    out.push(
      '| ' + (i + 1) + ' | ' + mdCell(r.req) + ' | ' + (STATUS_CN[r.status || ''] || '部分') + ' | ' +
      mdCell(ev || '—') + ' | ' + mdCell(r.gap || '—') + ' | ' + mdCell(r.probe || '—') + ' |',
    );
  });
  out.push('', '---', '来源：陈培胜求职作品集 · 岗位匹配（RAG 检索 + 约束生成）https://chenpeisheng.cn/jd.html');
  return out.join('\n');
}

export function copyText(text: string): Promise<void> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* noop */ }
    document.body.removeChild(ta);
    if (ok) resolve();
    else reject(new Error('copy_failed'));
  });
}
