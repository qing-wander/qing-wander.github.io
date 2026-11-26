/**
 * 公司档案 · 调研类板块（M2）—— 逐块复刻 js/company-profile.js 的 render 函数。
 * 类名 / 结构 / aria 与旧版一致（css/company-profile.css 零改动）。
 * 文案与数据口径原样保留：不合并口径、不把自述当结论（N1 行为等价）。
 */
import { useState } from 'react';
import FoldableSection, { Sup } from './FoldableSection';
import { ExecCard } from './ExecCarousel';
import type { ChartMetric, Company } from './data';

/* ── SVG 柱状图（零依赖，hover 显示数值）── */
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
  const step = v / mag;
  const nice = step <= 1 ? 1 : step <= 2 ? 2 : step <= 2.5 ? 2.5 : step <= 5 ? 5 : 10;
  return nice * mag;
}
function fmtNum(v: number): string {
  if (v >= 100) return String(Math.round(v));
  return String(Math.round(v * 10) / 10);
}

function ChartSVG({ metric }: { metric: ChartMetric }) {
  const pts = metric.points || [];
  if (!pts.length) return null;
  const W = 560, H = 240, padL = 46, padR = 14, padT = 26, padB = 34;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  let max = 0;
  for (const p of pts) max = Math.max(max, Number(p.value) || 0);
  const top = niceCeil(max * 1.12);
  const sx = innerW / pts.length;

  return (
    <svg className="cp-chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={String(metric.label || '') + '柱状图'}>
      {/* 网格与 y 轴刻度 */}
      {[0, 1, 2, 3, 4].map((g) => {
        const gy = padT + innerH - (innerH * g / 4);
        return (
          <g key={g}>
            <line x1={padL} y1={gy} x2={W - padR} y2={gy} className={g === 0 ? 'cp-grid cp-axis' : 'cp-grid'} />
            <text x={padL - 6} y={gy + 4} className="cp-tick" textAnchor="end">{fmtNum(top * g / 4)}</text>
          </g>
        );
      })}
      {/* 柱与数值 */}
      {pts.map((p, k) => {
        const v = Number(p.value) || 0;
        const h = Math.max(2, innerH * (v / top));
        const x = padL + sx * k + sx * 0.22;
        const bw = sx * 0.56;
        const y = padT + innerH - h;
        const last = k === pts.length - 1;
        const label = p.label + '：' + fmtNum(v) + (p.note ? '（' + p.note + '）' : '');
        return (
          <g key={k} className={'cp-bar-g' + (last ? ' is-latest' : '')}>
            <rect className="cp-bar" x={x} y={y} width={bw} height={h} rx="1">
              <title>{label}</title>
            </rect>
            <text
              className={'cp-bar-val' + (last ? ' is-latest-text' : '')}
              x={x + bw / 2} y={y - 6} textAnchor="middle"
            >{fmtNum(v)}</text>
            <text className="cp-tick cp-x" x={x + bw / 2} y={H - 10} textAnchor="middle">{p.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function ChartBlock({ c }: { c: Company }) {
  const ch = c.chart;
  const hasChart = !!(ch && ch.metrics && ch.metrics.length);
  const [active, setActive] = useState(0);
  if (!hasChart || !ch) return null;
  return (
    <div className="cp-chart">
      <div className="cp-chart-head">
        <h4>{ch.title || '业绩走势'}</h4>
        <div className="cp-chart-tabs" role="tablist">
          {ch.metrics.map((m, i) => (
            <button
              key={m.id} type="button" className="cp-tab" role="tab" data-metric={m.id}
              aria-selected={i === active ? 'true' : 'false'}
              onClick={() => setActive(i)}
            >{m.label}</button>
          ))}
        </div>
      </div>
      <div className="cp-chart-body">
        {ch.metrics.map((m, i) => (
          <div key={m.id} className="cp-chart-panel" data-panel={m.id} hidden={i !== active}>
            <ChartSVG metric={m} />
          </div>
        ))}
      </div>
      {ch.latest && (
        <p className="cp-chart-latest">
          <span className="cp-latest-dot" aria-hidden="true"></span>
          {ch.latest}<Sup n={ch.source || ''} />
        </p>
      )}
    </div>
  );
}

/* ── KPI ── */
export function KpiBlock({ c }: { c: Company }) {
  const kpis = c.kpis || [];
  if (!kpis.length) return null;
  return (
    <div className="cp-kpis">
      {kpis.map((k, i) => (
        <div key={i} className="cp-kpi">
          <strong>{k.value}<Sup n={k.source || ''} /></strong>
          <span>{k.label}</span>
          {k.sub ? <em>{k.sub}</em> : null}
        </div>
      ))}
    </div>
  );
}

/* ── 公司在做什么 ── */
export function BusinessBlock({ c }: { c: Company }) {
  const rows = [
    { label: '主营业务', text: c.business?.main },
    { label: '商业模式', text: c.business?.model },
    { label: '行业位置', text: c.business?.position },
    { label: '平台自述', text: c.business?.bossIntro, source: c.bossProfile?.source },
  ].filter((r) => r.text);
  if (!rows.length) return null;
  return (
    <FoldableSection
      title="公司在做什么" stateKey={`${c.id}:business`} count={rows.length} threshold={5} foldH={150}
    >
      {rows.map((r, i) => (
        <div key={i} className="cp-row">
          <p className="cp-row-label">{r.label}</p>
          <p className="cp-row-text">{r.text}<Sup n={'source' in r ? r.source : undefined} /></p>
        </div>
      ))}
    </FoldableSection>
  );
}

/* ── 融资历程 ── */
export function FundingBlock({ c }: { c: Company }) {
  const f = c.funding;
  if (!f || !f.rounds || !f.rounds.length) return null;
  return (
    <FoldableSection title="融资历程" stateKey={`${c.id}:funding`} count={f.rounds.length} threshold={4} foldH={160}>
      {f.note ? <p className="cp-note">{f.note}</p> : null}
      <ol className="cp-rounds">
        {f.rounds.map((r, i) => (
          <li key={i} className={'cp-round' + (i === 0 ? ' is-latest-round' : '')}>
            <span className="cp-round-dot" aria-hidden="true"></span>
            <div className="cp-round-main">
              <p className="cp-round-title">
                <b>{r.round}</b>
                <span className="cp-round-amount">{r.amount || '金额未公开'}</span>
              </p>
              <p className="cp-round-meta">{r.investors || ''}</p>
            </div>
            <span className="cp-round-date">{r.date}</span>
            <Sup n={r.source || ''} />
          </li>
        ))}
      </ol>
    </FoldableSection>
  );
}

/* ── 投资方与股权穿透：机构品牌名与工商登记主体分开列，注明核验依据 ── */
export function InvestorsBlock({ c }: { c: Company }) {
  const inv = c.investors;
  if (!inv || !inv.list || !inv.list.length) return null;
  return (
    <FoldableSection
      title="投资方与股权穿透" stateKey={`${c.id}:investors`}
      count={inv.list.length} threshold={4} foldH={220}
    >
      <p className="cp-note">{inv.note || ''}<Sup n={18} /></p>
      <div className="cp-inv-list">
        {inv.list.map((it, i) => (
          <div key={i} className={'cp-inv-item' + (it.stake === '未公开' ? ' is-unverified' : '')}>
            <p className="cp-inv-name">{it.name}<Sup n={it.source || ''} /></p>
            <div className="cp-inv-grid">
              <div><span>工商 / 上层主体</span><p>{it.entity || '—'}</p></div>
              <div><span>持股</span><p>{it.stake || '—'}</p></div>
              <div><span>参与轮次</span><p>{it.rounds || '—'}</p></div>
            </div>
            <p className="cp-inv-verify"><b>核验依据</b> {it.verify || '—'}</p>
          </div>
        ))}
      </div>
      {inv.others ? <p className="cp-inv-others">{inv.others}</p> : null}
    </FoldableSection>
  );
}

/* ── 主体 / 名称变更 × 融资轮次 × 投资方：只做并列陈列，不合并口径 ── */
export function EntityHistoryBlock({ c }: { c: Company }) {
  const eh = c.entityHistory;
  if (!eh || !eh.rows || !eh.rows.length) return null;
  return (
    <FoldableSection
      title="主体名称变更与融资轮次对照" stateKey={`${c.id}:entity-history`}
      count={eh.rows.length} threshold={4} foldH={210}
    >
      <p className="cp-note">{eh.note || ''}</p>
      <div className="cp-eh-list">
        {eh.rows.map((r, i) => (
          <div key={i} className="cp-eh-row">
            <div className="cp-eh-time">{r.period || ''}</div>
            <div className="cp-eh-body">
              <p className="cp-eh-entity">{r.entity || ''}</p>
              <p className="cp-eh-event">{r.event || ''}</p>
              <p className="cp-eh-field"><span>对应投资方</span>{r.investors || '—'}</p>
              <p className="cp-eh-field"><span>依据与判断</span>{r.basis || '—'}<Sup n={r.source || ''} /></p>
            </div>
          </div>
        ))}
      </div>
    </FoldableSection>
  );
}

/* ── 数据可信度：可核验 / 自述 / 口径冲突分开列出 ── */
export function DataConfidenceBlock({ c }: { c: Company }) {
  const dc = c.dataConfidence;
  if (!dc) return null;
  const counts = (dc.verified || []).length + (dc.unverified || []).length + (dc.conflicts || []).length;
  const levelText: Record<string, string> = {
    A: 'A · 审计 / 交易所披露', B: 'B · 部分可核验', C: 'C · 主要为企业自述',
  };
  const list = (arr?: string[], cls = '') =>
    !arr || !arr.length ? null : (
      <ul className={'cp-conf-list ' + cls}>{arr.map((x, i) => <li key={i}>{x}</li>)}</ul>
    );
  return (
    <FoldableSection
      cls={'cp-sec cp-conf cp-conf-' + String(dc.level || 'b').toLowerCase()}
      stateKey={`${c.id}:confidence`} count={counts} threshold={8} foldH={170}
      title={<>数据可信度 <span className="cp-conf-badge">{levelText[dc.level || ''] || dc.level}</span></>}
    >
      <p className="cp-note">{dc.summary || ''}</p>
      <div className="cp-conf-cols">
        <div><h5>可独立核验</h5>{list(dc.verified, 'is-ok')}</div>
        <div><h5>仅企业 / 媒体自述</h5>{list(dc.unverified, 'is-warn')}</div>
        <div><h5>口径冲突</h5>{list(dc.conflicts, 'is-risk')}</div>
      </div>
      <p className="cp-conf-foot">档案中的规模、收入、覆盖率类数字多为官网或受访者口径，未经第三方审计；本档案不对其真实性作背书，仅标注来源与冲突。</p>
    </FoldableSection>
  );
}

/* ── 微信公众号：只收可确证的官方账号；微信号未公开时不编造 ── */
export function WechatBlock({ c }: { c: Company }) {
  const wx = c.wechat || [];
  if (!wx.length) return null;
  return (
    <section className="cp-sec">
      <h4 className="cp-sec-title">微信公众号</h4>
      <div className="cp-wechat-list">
        {wx.map((w, i) => (
          <div key={i} className="cp-wechat-item">
            <span className="cp-wechat-mark" aria-hidden="true">微</span>
            <div className="cp-wechat-body">
              <p className="cp-wechat-name">{w.name}<Sup n={w.source || ''} /></p>
              {w.account ? <p className="cp-wechat-id">微信号 · {w.account}</p> : null}
              {w.note ? <p className="cp-wechat-note">{w.note}</p> : null}
              {w.url ? (
                <a className="cp-wechat-link" href={w.url} target="_blank" rel="noopener noreferrer">查看来源文章 ↗</a>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── 行业知名度与客户 ── */
export function RecognitionBlock({ c }: { c: Company }) {
  const rec = c.recognition || [];
  if (!rec.length) return null;
  return (
    <FoldableSection title="行业知名度与客户" stateKey={`${c.id}:recognition`} count={rec.length} threshold={5} foldH={160}>
      <ul className="cp-recog">
        {rec.map((r, i) => (
          <li key={i}>
            <p className="cp-recog-t">{r.title}</p>
            <p className="cp-recog-d">{r.detail}<Sup n={r.source || ''} /></p>
          </li>
        ))}
      </ul>
    </FoldableSection>
  );
}

/* ── 前身 / 历史沿革 ── */
export function PredecessorBlock({ c }: { c: Company }) {
  const p = c.predecessor;
  if (!p) return null;
  const kv = (label: string, text?: string) =>
    !text ? null : (
      <div className="cp-row">
        <p className="cp-row-label">{label}</p>
        <p className="cp-row-text">{text}</p>
      </div>
    );
  return (
    <FoldableSection title="前身与沿革" stateKey={`${c.id}:predecessor`} count={8} threshold={7} foldH={160}>
      <div className="cp-predecessor">
        <div className="cp-pred-head">
          <span className="cp-pred-tag">前身</span>
          <span className="cp-pred-name">{p.shortName || p.name || ''}</span>
          {p.founded ? <span className="cp-pred-founded">{p.founded} 成立</span> : null}
        </div>
        {kv('全称', p.name)}
        {kv('成立时间', p.founded)}
        {p.formerName ? kv('曾用名', p.formerName) : null}
        {kv('法定代表人', p.legalRep)}
        {kv('注册资本', p.capital)}
        {kv('团队规模', p.scale)}
        {kv('主营业务', p.business)}
        {p.link ? (
          <div className="cp-row">
            <p className="cp-row-label">与本公司关系</p>
            <p className="cp-row-text">{p.link}{(p.sources || []).map((n, i) => <Sup key={i} n={n} />)}</p>
          </div>
        ) : null}
      </div>
    </FoldableSection>
  );
}

/* ── BOSS 直聘档案 ── */
export function BossProfileBlock({ c }: { c: Company }) {
  const b = c.bossProfile;
  if (!b) return null;
  const src = b.source || '';
  /* 档案只沉淀稳定事实：在招职位数 / 招聘 Boss 数属每日变动的动态信息，已不展示 */
  const quick = [
    { label: '行业标签', value: b.industryTag },
    { label: '团队规模', value: b.scaleTag },
    { label: '融资标签', value: b.financingTag },
    { label: '工作时间', value: b.workTime },
  ].filter((x) => x.value);

  const line = (label: string, text?: string, withSource?: boolean) =>
    !text ? null : (
      <div className="cp-row">
        <p className="cp-row-label">{label}</p>
        <p className="cp-row-text">{text}{withSource ? <Sup n={src} /> : null}</p>
      </div>
    );
  const multi = (label: string, arr?: string[], withSource?: boolean) =>
    !arr || !arr.length ? null : (
      <div className="cp-row">
        <p className="cp-row-label">{label}</p>
        <p className="cp-row-text">
          {arr.map((m, i) => <span key={i}>{m}{i < arr.length - 1 ? <br /> : null}</span>)}
          {withSource ? <Sup n={src} /> : null}
        </p>
      </div>
    );
  const tagList = (label: string, arr?: string[]) =>
    !arr || !arr.length ? null : (
      <div className="cp-row">
        <p className="cp-row-label">{label}</p>
        <p className="cp-row-text">
          {/* 旧版 innerHTML 拼接以空格分隔 pill（CSS 无 gap，间距靠文本节点）；
              空格只能作兄弟文本节点——包 wrapper 会让每个 .cp-pill 都成为
              :first-child，破坏「首个 pill 蓝底」的既有样式语义 */}
          {arr.flatMap((x, i) => (i > 0 ? [' ', <span key={x} className="cp-pill">{x}</span>] : [<span key={x} className="cp-pill">{x}</span>]))}
        </p>
      </div>
    );

  let rows = 0;
  const add = (node: ReturnType<typeof line>) => { if (node) rows++; return node; };

  return (
    <FoldableSection
      title={b.platformTitle || '招聘平台档案 · BOSS直聘'}
      stateKey={`${c.id}:boss`} count={rows} threshold={6} foldH={220}
      countText={rows + ' 条信息'}
    >
      {quick.length ? (
        <div className="cp-kpis">
          {quick.map((x) => (
            <div key={x.label} className="cp-kpi"><strong>{x.value}</strong><span>{x.label}</span></div>
          ))}
        </div>
      ) : null}
      {add(line('名称沿革', b.rename))}
      {add(line('平台简介', b.intro, true))}
      {add(line('工商口径', b.registryNote))}
      {add(line('口径说明', b.financingNote))}
      {add(multi('企业文化', b.culture, true))}
      {b.welfare && b.welfare.length ? add(tagList(b.welfareLabel || '福利标签', b.welfare)) : null}
      {b.talentDevelopment && b.talentDevelopment.length ? add(tagList('人才发展', b.talentDevelopment)) : null}
      {/* 有产品橱窗时收编这行 pill，避免同一批产品名重复出现 */}
      {b.products && b.products.length && !(c.showcase && c.showcase.length) ? add(tagList('产品矩阵', b.products)) : null}
      {add(multi('产品与服务', b.productDetails))}
      {add(multi('发展历程', b.milestones, true))}
      {add(multi('平台荣誉', b.awards, true))}
      {b.foundingTeam && b.foundingTeam.length ? (
        <div className="cp-exec-list">
          {b.foundingTeam.map((f, i) => <ExecCard key={i} f={f} source={src} />)}
        </div>
      ) : null}
      {add(multi('办公地点', b.offices, true))}
    </FoldableSection>
  );
}

/* ── 发展前景 ── */
export function OutlookBlock({ c }: { c: Company }) {
  const o = c.outlook || {};
  if (!o.opportunities && !o.risks) return null;
  const lis = (arr?: string[]) => (
    <ul className="cp-outlook-list">{(arr || []).map((x, i) => <li key={i}>{x}</li>)}</ul>
  );
  const count = (o.opportunities || []).length + (o.risks || []).length;
  return (
    <FoldableSection title="发展前景" stateKey={`${c.id}:outlook`} count={count} threshold={8} foldH={180}>
      <div className="cp-outlook">
        <div className="cp-outlook-col">
          <p className="cp-outlook-h is-op">▚ 机会</p>
          {lis(o.opportunities)}
        </div>
        <div className="cp-outlook-col">
          <p className="cp-outlook-h is-risk">▞ 风险</p>
          {lis(o.risks)}
        </div>
      </div>
    </FoldableSection>
  );
}
