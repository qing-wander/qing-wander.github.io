/**
 * /jd.html 岛组件（M2）—— 自 js/jd-match.js 三态渲染逐类名平移。
 * DOM 结构 / 类名 / aria 与旧版一致（N1：css/jd-match.css + jd.html 内联打印样式零改动）。
 * 表单 + 空态由 Astro SSG 直出（水合前即最终形态）；结果 / 加载 / 错误仅在客户端产生。
 */
import { useEffect, useRef, useState } from 'react';
import {
  CFG, EXAMPLES, STATUS_CN, copyText, errorText, requestJd, shortTitle, toMarkdown,
  type JdMatchData,
} from '../../lib/jd/client';

const TIP_DEFAULT =
  '⌘ / Ctrl + Enter 提交 · 单次 1500 字 · 每人 10 分钟 4 次 · JD 正文不入库，只留哈希留痕';

type Phase = 'idle' | 'loading' | 'error' | 'result';
type Tip = { text: string; kind?: 'ok' | 'err' | 'busy' };

/* ── 小件：来源徽标 sup（company 页共用同款语义，此处按 jd 数据形状内联） ── */

function EvidenceItem({
  ev, idx, openKey, toggle,
}: {
  ev: NonNullable<JdMatchData['match']>['rows'] extends (infer R)[] | undefined
    ? (R extends { evidence?: (infer E)[] | undefined } ? E : never) : never;
  idx: `${number}-${number}`;
  openKey: string | null;
  toggle: (k: string) => void;
}) {
  const ratio = Number(ev && (ev.ratio != null ? ev.ratio : ev.ground)) || 0;
  const title = '原始切片：' + String(ev?.title || '') + ' · 与原文重合 ' + Math.round(ratio * 100) + '%';
  if (!ev?.excerpt) {
    return (
      <div className="jd-ev-item">
        <p className="jd-ev-point">{ev?.point}</p>
        <span className="jd-ev-src" title={title}>{shortTitle(ev?.title)}</span>
      </div>
    );
  }
  const open = openKey === idx;
  return (
    <div className="jd-ev-item">
      <p className="jd-ev-point">{ev.point}</p>
      <button
        className="jd-ev-src" type="button" aria-expanded={open}
        title={title + ' · 点击展开原文'}
        onClick={() => toggle(idx)}
      >
        {shortTitle(ev.title)} <span className="jd-ev-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {!open && <pre className="jd-ev-excerpt" hidden>{ev.excerpt}</pre>}
      {open && <pre className="jd-ev-excerpt">{ev.excerpt}</pre>}
    </div>
  );
}

export default function JdPage() {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [tip, setTip] = useState<Tip>({ text: TIP_DEFAULT });
  const [elapsed, setElapsed] = useState('0.0s');
  const [result, setResult] = useState<{ data: JdMatchData; seconds: number } | null>(null);
  const [lastError, setLastError] = useState<{ code?: string; serverMessage?: string } | null>(null);
  const [openEv, setOpenEv] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [prefilled, setPrefilled] = useState(false);

  const busy = phase === 'loading';
  const formRef = useRef<HTMLFormElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const retryRef = useRef(false); /* 网络闪断 / 超时自动重试一次，与 AI 面板同策略 */

  /* 从数字分身面板「打开完整对照」跳转过来时：预填刚才的 JD（旧版内联脚本行为） */
  useEffect(() => {
    let prefill = '';
    try { prefill = sessionStorage.getItem('cp_jd_prefill') || ''; } catch { /* noop */ }
    if (!prefill) return;
    try { sessionStorage.removeItem('cp_jd_prefill'); } catch { /* noop */ }
    if (prefilled || (taRef.current && taRef.current.value)) return;
    setText(prefill);
    setPrefilled(true);
    setTip({ text: '已带入数字分身面板里的 JD，直接点「开始匹配」', kind: 'ok' });
  }, [prefilled]);

  /* 加载态计时器（旧版 state.ticker 语义：0.1s 步进） */
  useEffect(() => {
    if (phase !== 'loading') return;
    const t0 = Date.now();
    setElapsed('0.0s');
    const t = setInterval(() => setElapsed(((Date.now() - t0) / 1000).toFixed(1) + 's'), 100);
    return () => clearInterval(t);
  }, [phase]);

  const count = text.length;
  const near = count > CFG.maxChars * 0.9;

  function submit(isRetry = false) {
    if (busy) return;
    const jd = text.trim();
    if (jd.length < CFG.minChars) {
      setTip({ text: 'JD 太短了，至少 ' + CFG.minChars + ' 字，才好逐条对照。也可以点上面的示例。', kind: 'err' });
      taRef.current?.focus();
      return;
    }
    if (jd.length > CFG.maxChars) {
      setTip({ text: 'JD 超过 ' + CFG.maxChars + ' 字，删掉公司介绍、福利等非要求段落再试。', kind: 'err' });
      return;
    }
    retryRef.current = isRetry;
    setPhase('loading');
    setResult(null);
    setOpenEv(null);
    setTip({
      text: isRetry ? '通道闪断，正在自动重试一次…' : '正在解析 JD 并逐条对照档案…',
      kind: 'busy',
    });
    const started = Date.now();
    requestJd(jd)
      .then((data) => {
        setResult({ data, seconds: (Date.now() - started) / 1000 });
        setPhase('result');
        const n = data.match && data.match.rows ? data.match.rows.length : 0;
        setTip({
          text: (isRetry ? '自动重试成功：' : '匹配完成：') + n + ' 条需求已对照，证据均可回溯到档案切片。',
          kind: 'ok',
        });
        /* 结果在首屏外时带过去，别让人以为没反应 */
        setTimeout(() => {
          const rect = stageRef.current?.getBoundingClientRect();
          if (rect && (rect.top < 0 || rect.top > window.innerHeight * 0.75)) {
            stageRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
          }
        }, 30);
      })
      .catch((err: { code?: string; serverMessage?: string }) => {
        /* 网络闪断 / 网关超时先自动重试一次，别让用户误以为功能坏了 */
        if (!isRetry && (err.code === 'network' || err.code === 'timeout')) {
          setPhase('idle');
          setTimeout(() => submit(true), 900);
          return;
        }
        setLastError(err);
        setPhase('error');
        setTip({ text: errorText(err), kind: 'err' });
      });
  }

  function toggleEv(key: string) {
    /* 互斥展开：再点收起，点别条先收旧的 */
    setOpenEv((cur) => (cur === key ? null : key));
  }

  function onChip(key: string) {
    const jd = EXAMPLES[key];
    if (!jd) return;
    setText(jd);
    setTip({ text: TIP_DEFAULT });
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      try { ta.setSelectionRange(0, 0); ta.scrollTop = 0; } catch { /* noop */ }
    });
  }

  return (
    <div className="jd-wrap">
      <form
        ref={formRef} className="jd-form" id="jdForm" noValidate
        aria-busy={busy ? 'true' : 'false'}
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <div className="jd-form-head">
          <span className="jd-form-no">INPUT//JD</span>
          <span className="jd-form-hint">建议保留「岗位职责 + 任职要求」</span>
        </div>
        <textarea
          ref={taRef} className="jd-textarea" id="jdText" rows={10} maxLength={CFG.maxChars}
          spellCheck={false} aria-label="粘贴岗位 JD" value={text}
          placeholder={'粘贴 JD，例如：\n1. 负责企业级 AI Agent 平台的架构设计，含任务规划、工具调用与多智能体编排；\n2. 建设 RAG 检索链路，熟悉向量检索与召回评测；\n3. 3 年以上后端研发经验，熟悉 Java 或 Go……'}
          onChange={(e) => {
            setText(e.target.value);
            if (tip.kind === 'err') setTip({ text: TIP_DEFAULT });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="jd-form-foot">
          <span className={'jd-count' + (near ? ' is-near' : '')} id="jdCount">{count} / {CFG.maxChars}</span>
          <button className="jd-submit" id="jdSubmit" type="submit" disabled={busy}>
            {busy ? '匹配中… ' : '开始匹配 '}<span aria-hidden="true">{busy ? '◌' : '▶'}</span>
          </button>
        </div>
        <div className="jd-samples">
          <span className="jd-samples-label">没有现成 JD？点一个示例：</span>
          <div className="jd-chips" id="jdChips">
            <button className="jd-chip" type="button" data-jd-sample="agent" onClick={() => onChip('agent')}>AI Agent 工程师</button>
            <button className="jd-chip" type="button" data-jd-sample="backend" onClick={() => onChip('backend')}>Java 后端（金融）</button>
            <button className="jd-chip" type="button" data-jd-sample="solution" onClick={() => onChip('solution')}>AI 解决方案</button>
          </div>
        </div>
        <p className={'jd-form-tip' + (tip.kind ? ' is-' + tip.kind : '')} id="jdTip">{tip.text}</p>
      </form>

      <div className="jd-stage" ref={stageRef} id="jdStage" role="region" aria-label="岗位匹配结果">
        {phase === 'idle' && !result && <EmptyState />}

        {phase === 'loading' && (
          <div className="jd-loading">
            <div className="jd-loading-head">
              <span className="jd-empty-no">RUNNING</span>
              <span className="jd-loading-time" id="jdElapsed">{elapsed}</span>
            </div>
            <p className="jd-loading-title">
              正在把 JD 逐条对照到档案上
              <span className="jd-dots" aria-hidden="true"><i></i><i></i><i></i></span>
            </p>
            <div className="jd-progress" aria-hidden="true"><i></i></div>
            <ul className="jd-loading-steps">
              <li>拆解 JD 需求条目</li>
              <li>在档案切片上召回</li>
              <li>约束模型按结构输出对照表</li>
            </ul>
            <p className="jd-loading-note">首次调用可能冷启动，一般 8–20 秒；生成的是对照表，不是小作文。</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="jd-error">
            <span className="jd-empty-no">FAILED</span>
            <p className="jd-error-title">{errorText(lastError)}</p>
            <p className="jd-error-note">已填的内容还在左边，可以直接再点一次「开始匹配」。</p>
            <button className="jd-act" type="button" id="jdRetry" onClick={() => submit()}>重试一次 ↻</button>
          </div>
        )}

        {(phase === 'result' && result) && (
          <Result
            data={result.data} seconds={result.seconds}
            openEv={openEv} toggleEv={toggleEv}
            copied={copied} onCopy={() => {
              copyText(toMarkdown(result.data)).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }).catch(() => { /* 旧版提示复制失败 */ });
            }}
            onAgain={() => {
              formRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
              setTimeout(() => taRef.current?.focus(), 280);
            }}
          />
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="jd-empty" id="jdEmpty">
      <div className="jd-empty-head">
        <span className="jd-empty-no">HOW IT WORKS</span>
        <span className="jd-empty-lamp"><i className="lamp lamp-green"></i>AGENT READY</span>
      </div>
      <ol className="jd-steps">
        <li><span className="jd-step-no">01</span><div><b>拆需求</b><p>按行与分号把 JD 切成条目，去掉序号和套话，最多 14 条。</p></div></li>
        <li><span className="jd-step-no">02</span><div><b>召回档案</b><p>每条需求在简历档案切片上做 TF-IDF 检索，项目与工作经历优先，取 6 段进上下文。</p></div></li>
        <li><span className="jd-step-no">03</span><div><b>约束输出</b><p>模型只能引用召回原文，按固定结构输出覆盖 / 部分 / 缺口与追问点，证据带出处。</p></div></li>
      </ol>
      <p className="jd-empty-note">左侧贴 JD 或点一个示例，结果会显示在这里。</p>
      <ul className="jd-limits" aria-label="使用限制">
        <li>单次 ≤ 1500 字</li>
        <li>10 分钟 4 次</li>
        <li>证据带出处</li>
        <li>JD 正文不入库</li>
      </ul>
    </div>
  );
}

function Result({
  data, seconds, openEv, toggleEv, copied, onCopy, onAgain,
}: {
  data: JdMatchData; seconds: number;
  openEv: string | null; toggleEv: (k: string) => void;
  copied: boolean; onCopy: () => void; onAgain: () => void;
}) {
  const m = data.match || {};
  const o = m.overall || {};
  const rows = Array.isArray(m.rows) ? m.rows : [];
  const stats = m.stats || { covered: 0, partial: 0, gap: 0 };
  const meta = data.meta || {};
  const score = Math.max(0, Math.min(100, Number(o.score) || 0));
  const band = score >= 80 ? 'high' : score >= 60 ? 'mid' : score >= 35 ? 'low' : 'none';
  const tagCls = band === 'high' ? 'tag-orange' : band === 'mid' ? 'tag-blue' : '';
  /* 生成时间在客户端产生（打印页脚），不能 SSG 直出 */
  const [stamp] = useState(() => new Date().toLocaleString('zh-CN', { hour12: false }));

  return (
    <div className="jd-result">
      <div className="jd-summary">
        <div className="jd-score" data-band={band}>
          <span className="jd-score-num">{score}</span>
          <span className="jd-score-max">/ 100</span>
          <span className="jd-score-cap">档案覆盖度</span>
        </div>
        <div className="jd-summary-main">
          <div className="jd-summary-top">
            <span className={'tag ' + tagCls}>{o.verdict || '已比对'}</span>
            <span className="jd-summary-meta">
              {meta.recalled || 0} 段切片 · {meta.requirements || 0} 条需求
              {meta.merged != null && meta.requirements != null && meta.merged < meta.requirements ? ' → 合并为 ' + meta.merged + ' 个需求点' : ''} · {seconds.toFixed(1)}s
            </span>
          </div>
          <p className="jd-summary-text">{o.summary || '已按 JD 逐条对照档案。'}</p>
          <div className="jd-stats">
            <span className="jd-stat" data-status="covered"><b>{stats.covered || 0}</b>覆盖</span>
            <span className="jd-stat" data-status="partial"><b>{stats.partial || 0}</b>部分</span>
            <span className="jd-stat" data-status="gap"><b>{stats.gap || 0}</b>缺口</span>
          </div>
        </div>
      </div>
      <div className="jd-table" role="table" aria-label="JD 需求与档案对照表">
        <div className="jd-thead" role="row">
          <span role="columnheader">#</span>
          <span role="columnheader">JD 要求</span>
          <span role="columnheader">对应证据</span>
          <span role="columnheader">缺口</span>
          <span role="columnheader">面试追问点</span>
        </div>
        {rows.map((r, i) => (
          <JdRowItem key={i} r={r} i={i} openEv={openEv} toggleEv={toggleEv} />
        ))}
      </div>
      <div className="jd-actions">
        <button className="jd-act" type="button" id="jdCopy" onClick={onCopy}>
          {copied ? '已复制 ✓' : '复制成 Markdown ⧉'}
        </button>
        <button className="jd-act jd-act-ghost" type="button" id="jdAgain" onClick={onAgain}>换一份 JD ↺</button>
        <span className="jd-foot-note">证据均取自本页档案切片 · 缺口照实列出，不做粉饰 · 点证据来源可展开原文核对</span>
      </div>
      <p className="jd-print-meta" hidden>
        来源：李清求职作品集 · 岗位匹配（RAG 检索 + 约束生成）· 生成于 {stamp} · qingfin.cn/jd.html
      </p>
    </div>
  );
}

function JdRowItem({
  r, i, openEv, toggleEv,
}: {
  r: NonNullable<JdMatchData['match']>['rows'] extends (infer X)[] | undefined ? X : never;
  i: number; openEv: string | null; toggleEv: (k: string) => void;
}) {
  const status = STATUS_CN[r.status || ''] ? r.status! : 'partial';
  const ev = Array.isArray(r.evidence) ? r.evidence : [];
  const gap = status === 'covered' ? <span className="jd-ok">—</span> : (r.gap || '档案里没有直接对应');
  return (
    <div className="jd-row" data-status={status} role="row">
      <span className="jd-row-no" aria-hidden="true">{(i + 1) < 10 ? '0' : ''}{i + 1}</span>
      <div className="jd-cell jd-req" role="cell" data-label="JD 要求">
        <div className="jd-cell-in">
          <span className="jd-badge">{STATUS_CN[status]}</span>
          <p>{r.req}</p>
        </div>
      </div>
      <div className="jd-cell jd-ev" role="cell" data-label="对应证据">
        <div className="jd-cell-in">
          {ev.length
            ? ev.map((e, k) => (
              <EvidenceItem key={k} ev={e} idx={`${i}-${k}`} openKey={openEv} toggle={toggleEv} />
            ))
            : <span className="jd-none">无匹配证据</span>}
        </div>
      </div>
      <div className="jd-cell jd-gap" role="cell" data-label="缺口">
        <div className="jd-cell-in">{gap}</div>
      </div>
      <div className="jd-cell jd-probe" role="cell" data-label="追问点">
        <div className="jd-cell-in">
          {r.probe ? <span className="jd-quote">{'“' + r.probe + '”'}</span> : <span className="jd-none">—</span>}
        </div>
      </div>
    </div>
  );
}
