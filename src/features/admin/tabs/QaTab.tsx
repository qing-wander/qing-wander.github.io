import { useQa, useQaTopics, useQaTrend } from '../queries';
import { fmt } from '../toast';

/** 问答看板：指标 + 14 天趋势（CSS 柱）+ 高频问题/命中 + 聚类建议 + 近期记录 */
export function QaTab() {
  const qa = useQa();
  const trend = useQaTrend(14);
  const topics = useQaTopics(200);

  const t = qa.data?.totals;
  const series = trend.data?.series ?? [];
  const max = Math.max(1, ...series.map((x) => x.total));

  return (
    <section className="panel" id="panelQa" role="tabpanel">
      <div className="stats stats-qa">
        <article className="stat"><p className="stat-num">{t?.total ?? '—'}</p><p className="stat-label">问答总量</p></article>
        <article className="stat"><p className="stat-num">{t?.last7 ?? '—'}</p><p className="stat-label">近 7 天</p></article>
        <article className="stat"><p className="stat-num">{t?.empty ?? '—'}</p><p className="stat-label">空召回</p></article>
        <article className="stat"><p className="stat-num">{t?.empty_rate == null ? '—' : t.empty_rate + '%'}</p><p className="stat-label">空召回率</p></article>
        <article className="stat"><p className="stat-num">{t?.ms_avg ?? '—'}</p><p className="stat-label">平均耗时 (ms)</p></article>
      </div>

      <div className="qa-box qa-trend-box">
        <div className="qa-box-head"><h2>问答趋势（近 14 天）</h2>
          <span className="toolbar-note">灰柱=总问答，红柱=空召回；没数据的日期补 0</span></div>
        <div className="qa-trend">
          {series.length ? series.map((x) => {
            const hTotal = Math.round((x.total / max) * 100);
            const hEmpty = x.total ? Math.round((x.empty / max) * 100) : 0;
            return (
              <div key={x.date} className="qa-trend-col" title={`${x.date}：${x.total} 次，空召回 ${x.empty}`}>
                <div className="qa-trend-stack">
                  <div className="qa-trend-bar" style={{ height: Math.max(hTotal - hEmpty, 0) }} />
                  <div className="qa-trend-empty" style={{ height: hEmpty }} />
                </div>
                <span className="qa-trend-x">{x.label}</span>
                <span className="qa-trend-n">{x.total || ''}</span>
              </div>
            );
          }) : <span className="empty">{trend.isError ? '趋势接口不可用' : '还没有数据'}</span>}
        </div>
        <div className="qa-trend-legend"><span className="lg lg-total"></span>已作答 / 总问答<span className="lg lg-empty"></span>空召回</div>
      </div>

      <div className="qa-grid">
        <div className="qa-box">
          <div className="qa-box-head"><h2>高频问题</h2><span className="toolbar-note">用户真正关心什么 —— 空召回的问题优先补切片</span></div>
          <ul className="qa-list">
            {qa.data?.top_questions?.length
              ? qa.data.top_questions.map((r, i) => <li key={i}><span className="qa-q">{r.q}</span><span className="qa-n">{r.n} 次</span></li>)
              : <li className="empty">还没有问答记录</li>}
          </ul>
        </div>
        <div className="qa-box">
          <div className="qa-box-head"><h2>命中片段热度</h2><span className="toolbar-note">哪些经历被反复引用</span></div>
          <ul className="qa-list">
            {qa.data?.top_hits?.length
              ? qa.data.top_hits.map((r, i) => <li key={i}><span className="qa-q mono">{r.id}</span><span className="qa-n">{r.n} 次</span></li>)
              : <li className="empty">还没有命中记录</li>}
          </ul>
        </div>
      </div>

      <div className="qa-box qa-topics">
        <div className="qa-box-head"><h2>问题聚类（语义归并）</h2><span className="toolbar-note">同一件事的不同问法合成一类；空召回过半的会出现在“建议补切片”</span></div>
        {topics.data?.suggest?.length ? (
          <div className="qa-suggest">
            <strong>建议补切片：</strong>
            {topics.data.suggest.map((x) => `${x.topic}（${x.count} 次，空召回 ${x.empty_rate}%）`).join(' · ')}
          </div>
        ) : null}
        <ul className="qa-list">
          {topics.data?.topics?.length
            ? topics.data.topics.map((x, i) => (
              <li key={i}>
                <span className="qa-q" title={(x.examples || []).join(' / ')}>{x.topic}</span>
                {x.empty_rate >= 50 && x.count >= 2
                  ? <span className="pill bad">空召回 {x.empty_rate}%</span>
                  : <span className="pill">{x.count} 次</span>}
              </li>
            ))
            : <li className="empty">{topics.isError ? '聚类接口不可用' : '还没有足够的问题可聚类'}</li>}
        </ul>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>时间</th><th>问题</th><th>命中</th><th>耗时</th><th>状态</th></tr></thead>
          <tbody>
            {qa.data?.recent?.length
              ? qa.data.recent.map((r, i) => (
                <tr key={i}>
                  <td className="mono">{fmt(r.ts)}</td>
                  <td>{r.query}</td>
                  <td className="mono">{r.hit_count}</td>
                  <td className="mono">{r.ms ?? '—'}</td>
                  <td>{r.empty ? <span className="pill bad">空召回</span> : <span className="pill">已作答</span>}</td>
                </tr>
              ))
              : <tr><td colSpan={5} className="empty">还没有问答记录</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
