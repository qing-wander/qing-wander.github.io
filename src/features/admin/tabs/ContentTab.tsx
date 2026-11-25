import { useEffect, useState } from 'react';
import { useContentOne, useContentList, useKb, useRebuildKb, useResetContent, useSaveContent } from '../queries';
import { fmt, useToast } from '../toast';

const CONTENT_LABEL: Record<string, string> = {
  'site-data': '首页 / 全站文案',
  'company-profiles': '公司档案',
  'school-profiles': '学校档案',
  people: '页脚推荐的人',
  contributions: 'GitHub 贡献',
  'work-details': '作品案例',
  'asset-manifest': '资源 CDN 映射',
};

/** 站点数据：数据项 chips（大文件按需拉）+ JSON 编辑器（保存前本地校验）+ KB 状态/重建 */
export function ContentTab() {
  const toast = useToast();
  const list = useContentList();
  const [cur, setCur] = useState('');
  const one = useContentOne(cur);
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);
  const save = useSaveContent();
  const reset = useResetContent();
  const kb = useKb();
  const rebuild = useRebuildKb();

  useEffect(() => {
    if (!cur && list.data?.keys?.length) setCur(list.data.keys[0]?.key ?? '');
  }, [list.data, cur]);

  useEffect(() => {
    if (one.data) { setText(one.data.text); setDirty(false); }
  }, [one.data]);

  const items = list.data?.keys ?? [];
  const configuredCount = items.filter((x) => x.configured).length;

  function switchKey(key: string) {
    if (dirty && !window.confirm('当前内容未保存，确定切换？')) return;
    setCur(key);
  }

  return (
    <section className="panel" id="panelContent" role="tabpanel">
      <div className="toolbar">
        <span className="toolbar-note">公开仓库会被 fork，真人数据只存云端 D1；仓库里的 data/*.json 是脱敏占位副本。这里改完，访客端最多 5 分钟生效（带 <span className="mono">?v=</span> 可立刻刷新）。</span>
        <button className="btn btn-ghost" type="button" onClick={() => { list.refetch(); toast('已重新读取'); }}>重新读取</button>
      </div>

      <article className="cfg-card">
        <div className="cfg-head"><h2>数据项</h2><span className="pill">{items.length ? `${configuredCount}/${items.length} 已配置` : '—'}</span></div>
        <p className="cfg-note">选一项编辑。留空并「恢复默认」会删掉云端记录，访客端回退到仓库脱敏副本。</p>
        <div className="voice-chips">
          {items.length ? items.map((it) => {
            const on = it.key === cur;
            const size = it.configured ? (it.size > 1024 ? Math.round(it.size / 1024) + 'KB' : it.size + 'B') : '默认';
            return (
              <button key={it.key} type="button" className={'voice-chip' + (on ? ' is-on' : '')} onClick={() => switchKey(it.key)}>
                {CONTENT_LABEL[it.key] ?? it.key} <small>{size}</small>
              </button>
            );
          }) : <span className="empty">{list.isLoading ? '加载中…' : '没有数据项'}</span>}
        </div>
      </article>

      <article className="cfg-card">
        <div className="cfg-head"><h2>内容（JSON）</h2>
          <span className="pill">{cur ? (one.data?.configured
            ? '已配置 · ' + fmt(one.data.updated_at) + ' · ' + (one.data.text || '').length + ' 字符'
            : one.data ? '未配置 · 使用仓库脱敏副本' : '读取中') : '—'}</span></div>
        <p className="cfg-note">必须是合法 JSON，顶层为对象；最大 2MB。保存前会先做语法校验，不合法不会写库。</p>
        <label className="cfg-label">{(cur && (CONTENT_LABEL[cur] ?? cur)) || '未选择数据项'}
          <textarea className="cfg-textarea" rows={14} spellCheck={false} value={text} disabled={!cur || one.isLoading}
            onChange={(e) => { setText(e.target.value); setDirty(true); }} />
        </label>
        <div className="cfg-actions">
          <span className="toolbar-note">云端已配置的项目会标「已配置」</span>
          <button className="btn btn-ghost" type="button" disabled={!one.data?.configured || reset.isPending}
            onClick={() => {
              if (!window.confirm('恢复默认会删除云端这份数据，访客端回退到仓库脱敏副本。确定？')) return;
              reset.mutate(cur, {
                onSuccess: () => toast('已恢复默认'),
                onError: (e) => toast(e.message || '恢复失败', true),
              });
            }}>恢复默认</button>
          <button className="btn" type="button" disabled={!cur || save.isPending}
            onClick={() => {
              let parsed: unknown;
              try { parsed = JSON.parse(text); }
              catch (e) { toast('不是合法 JSON：' + (e as Error).message, true); return; }
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { toast('顶层必须是 JSON 对象', true); return; }
              save.mutate({ key: cur, text }, {
                onSuccess: () => toast(cur === 'site-data' ? '已保存，知识库在后台自动重建' : '已保存：' + (CONTENT_LABEL[cur] ?? cur)),
                onError: (e) => toast(e.message || '保存失败', true),
              });
            }}>保存</button>
        </div>
      </article>

      <article className="cfg-card">
        <div className="cfg-head"><h2>知识库</h2><span className={'pill' + (kb.data?.stale ? ' warn' : '')}>
          {kb.isLoading ? '读取中…' : kb.isError ? '不可用' : kb.data?.count ? (kb.data.kb_version || '已建立') : '未建'}</span></div>
        <p className="cfg-note">AI 问答的检索索引（切片 + 向量）。保存「首页 / 全站文案」后会自动重建；失败或想强制刷新时，手动点一次。</p>
        <div className="cfg-actions">
          <span className="toolbar-note">{kb.data
            ? (kb.data.count
              ? [kb.data.count + ' 片', kb.data.terms + ' 词', '更新于 ' + fmt(kb.data.updated_at)]
                  .concat(kb.data.stale ? ['已落后于站点数据，建议重建'] : [])
                  .concat(!kb.data.worker_ready ? ['未配置 KB_WORKER_URL'] : []).join(' · ')
              : '知识库还没建，点右侧「重建知识库」')
            : ''}</span>
          <button className="btn btn-ghost" type="button" onClick={() => kb.refetch()}>查看状态</button>
          <button className="btn" type="button" disabled={rebuild.isPending}
            onClick={() => rebuild.mutate(undefined, {
              onSuccess: (d) => toast('已重建：' + ((d as { count?: number })?.count ?? '?') + ' 片'),
              onError: (e) => toast(e.message || '重建失败', true),
            })}>{rebuild.isPending ? '重建中…' : '重建知识库'}</button>
        </div>
      </article>
    </section>
  );
}
