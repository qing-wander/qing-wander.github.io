import { useState } from 'react';
import { useVariant } from '../queries';
import { useToast } from '../toast';
import type { VariantRes } from '../../../lib/api/admin';

/** 按 JD 生成简历变体：生成 → 统计卡 → 下载 HTML */
export function VariantTab() {
  const toast = useToast();
  const [jd, setJd] = useState('');
  const [rewrite, setRewrite] = useState(false);
  const [result, setResult] = useState<VariantRes | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const gen = useVariant();

  function download() {
    if (!result?.html) return;
    const blob = new Blob([result.html], { type: 'text/html; charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'resume-' + new Date().toISOString().slice(0, 10) + '.html';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
  }

  const s = result?.stats;

  return (
    <section className="panel" id="panelVariant" role="tabpanel">
      <div className="toolbar">
        <span className="toolbar-note">贴一段 JD → 按命中度重新选材，产出与正式简历同版式的变体。只删不改文案，基本信息 / 教育 / 公司名 / 时间一律不动。</span>
      </div>
      <article className="cfg-card">
        <div className="cfg-head"><h2>目标岗位 JD</h2>
          <span className="pill">{result ? 'resume-' + new Date().toISOString().slice(0, 10) + '.html' : '空'}</span></div>
        <p className="cfg-note">至少 20 字。生成后先核对下方统计，确认选材合理再下载。</p>
        <textarea className="cfg-textarea" rows={8} placeholder="把岗位职责 + 任职要求贴进来…" value={jd} onChange={(e) => setJd(e.target.value)} />
        <label className="cfg-check">
          <input type="checkbox" checked={rewrite} onChange={(e) => setRewrite(e.target.checked)} /> 按 JD 微调 bullet 文案（会调模型，改动逐条过护栏，不过就保留原文）
        </label>
        <div className="cfg-actions">
          <span className="toolbar-note">
            {gen.isPending ? '生成中…（检索 + 选材 + 渲染）' : result ? '已生成，记得核对 2 页红线' : '尚未生成'}
          </span>
          <button className="btn" type="button" disabled={gen.isPending}
            onClick={() => {
              if (jd.trim().length < 20) { toast('JD 至少 20 字', true); return; }
              const t0 = Date.now();
              gen.mutate({ jd: jd.trim(), rewrite }, {
                onSuccess: (d) => { setResult(d); setElapsed((Date.now() - t0) / 1000); toast('变体已生成'); },
                onError: (e) => toast(e.message || '生成失败', true),
              });
            }}>生成变体</button>
          <button className="btn btn-ghost" type="button" disabled={!result} onClick={download}>下载 HTML</button>
        </div>
      </article>

      {s ? (
        <article className="cfg-card" id="variantStatsCard">
          <div className="cfg-head"><h2>选材结果</h2></div>
          <div className="stat-grid">
            {[
              ['bullet 数量', `${s.bullets_before ?? '—'} → ${s.bullets_after ?? '—'}`],
              ['删掉条目', String(s.bullets_dropped ?? '—')],
              ['项目', `${s.projects ?? '—'} / ${s.projects_total ?? '—'}`],
              ['HTML 体积', (s.bytes ?? '—') + ' B'],
              ['检索最高分', String(s.top_score ?? '—')],
              ['耗时', elapsed.toFixed(1) + ' s'],
            ].map(([label, val]) => (
              <div className="stat" key={label}><span className="stat-num">{val}</span><span className="stat-label">{label}</span></div>
            ))}
          </div>
          <p className="cfg-note">{
            s.rewrite?.requested
              ? (s.rewrite.model
                ? `改写：${s.rewrite.rewritten} 条通过护栏，${s.rewrite.rejected} 条退回原文`
                  + (s.rewrite.chars_delta ? `（净增 ${s.rewrite.chars_delta} 字）` : '')
                  + (s.rewrite.reasons?.length ? ' ｜ 拦截原因：' + s.rewrite.reasons.slice(0, 5).join('、') + (s.rewrite.reasons.length > 5 ? '…' : '') : '')
                : `改写未生效：${s.rewrite.reason || '模型无响应'}（已按原文输出）`)
              : '技能顺序：' + (s.skills_order ?? []).join(' → ')
          }</p>
        </article>
      ) : null}
    </section>
  );
}
