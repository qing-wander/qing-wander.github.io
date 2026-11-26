/**
 * JD 匹配结果卡（M3-B）—— 自 js/main.js aiAppendJDCard（1174-1259 行）逐字平移。
 *
 * DOM 契约：卡是 aiBody 下的裸 div（不包 .ai-msg）；类名 / data-属性与旧版完全一致
 * （ai-voice.js 的观察只读 .ai-msg、ai-stage-link.js 依赖「卡是 lastElementChild」语义）。
 * 「复制 Markdown」「打开完整对照（sessionStorage cp_jd_prefill 预填链）」行为逐字平移。
 */

import { useEffect, useRef, useState } from 'react';
import { copyText, STATUS_CN, toMarkdown, type JdMatchData } from '../../lib/jd/client';

interface Props {
  data: JdMatchData;
  /** 请求耗时（秒） */
  elapsed: number;
  /** 本次匹配的 JD 原文（aiLastJD 快照，预填链用） */
  jdText: string;
  /** JD 卡内「追问」按钮：切回问答模式并直接提交该问题 */
  onProbe: (q: string) => void;
  /** 「打开完整对照」前关闭面板（旧版 aiClosePanel） */
  onClose: () => void;
}

export function AiJdCard({ data, elapsed, jdText, onProbe, onClose }: Props) {
  const m = data.match || {};
  const o = m.overall || {};
  const rows = Array.isArray(m.rows) ? m.rows : [];
  const stats = m.stats || {};
  const meta = data.meta || {};
  const score = Math.max(0, Math.min(100, Number(o.score) || 0));
  const band = score >= 80 ? 'high' : score >= 60 ? 'mid' : score >= 35 ? 'low' : 'none';

  const [copyLabel, setCopyLabel] = useState('复制 Markdown ⧉');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  function onCopy() {
    copyText(toMarkdown(data)).then(
      () => setCopyLabel('已复制 ✓'),
      () => setCopyLabel('复制失败'),
    );
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyLabel('复制 Markdown ⧉'), 2000);
  }

  function onOpen() {
    /* JD 匹配已迁独立页：把刚发过的 JD 带过去预填，用户不用重贴 */
    try { sessionStorage.setItem('cp_jd_prefill', jdText); } catch { /* 隐身模式等场景忽略 */ }
    onClose();
    location.href = 'jd.html';
  }

  return (
    <div className="ai-jd-card" data-mode="jd">
      <div className="ai-jd-top">
        <div className="ai-jd-score" data-band={band}><b>{score}</b><span>/100</span></div>
        <div className="ai-jd-topmain">
          <p className="ai-jd-verdict">{o.verdict || '已比对'}</p>
          <p className="ai-jd-sum">{o.summary || '已按 JD 逐条对照档案。'}</p>
          <div className="ai-jd-stats"><span className="s-c">覆盖 {stats.covered || 0}</span>
            <span className="s-p">部分 {stats.partial || 0}</span>
            <span className="s-g">缺口 {stats.gap || 0}</span></div>
        </div>
      </div>
      <div className="ai-jd-meta">{meta.recalled || 0} 段切片 · {(Number(meta.requirements) || rows.length)} 条要求 → {rows.length} 个需求点 · {elapsed.toFixed(1)}s</div>
      <div className="ai-jd-rows">
        {rows.map((r, i) => {
          const st = STATUS_CN[r.status || ''] ? (r.status as keyof typeof STATUS_CN) : 'partial';
          const ev = Array.isArray(r.evidence) ? r.evidence.slice(0, 2) : [];
          return (
            <div className="ai-jd-item" data-status={st} key={i}>
              <div className="ai-jd-item-h"><span className="ai-jd-no">{(i + 1 < 10 ? '0' : '') + (i + 1)}</span>
                <span className="ai-jd-badge">{STATUS_CN[st]}</span><p>{r.req}</p></div>
              {r.gap && st !== 'covered' ? <p className="ai-jd-gap">缺口：{r.gap}</p> : null}
              <ul className="ai-jd-ev">
                {ev.length ? ev.map((e, j) => (
                  <li key={j}>{e?.point ?? ''}<span>{String(e?.title || '').split('｜')[0]?.slice(0, 18) ?? ''}</span></li>
                )) : <li className="none">无匹配证据</li>}
              </ul>
              {r.probe ? (
                <button className="ai-jd-probe" type="button" data-ai-probe={i}
                  title={r.probe} aria-label={`追问：${r.probe}`}
                  onClick={() => onProbe(r.probe as string)}>追问：{r.probe} →</button>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="ai-jd-acts">
        <button className="ai-jd-act" type="button" data-jd-copy="1" onClick={onCopy}>{copyLabel}</button>
        <button className="ai-jd-act ai-jd-act-ghost" type="button" data-jd-open="1" onClick={onOpen}>打开完整对照 ↗</button>
      </div>
      <p className="ai-jd-note">证据取自档案切片 · 缺口照实列出 · 点追问可直接问数字分身</p>
    </div>
  );
}
