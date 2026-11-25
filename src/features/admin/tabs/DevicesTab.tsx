import { useState } from 'react';
import { useBlockDevice, useDevices } from '../queries';
import { fmt } from '../toast';

/** 设备台账：搜索 / 分页 / 拉黑解封（DOM 结构与旧版一致，吃 admin.css 原样式） */
export function DevicesTab({ onViewMessages }: { onViewMessages: (hash: string) => void }) {
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const { data, isLoading } = useDevices(limit, offset, q);
  const block = useBlockDevice();

  const total = data?.total ?? 0;
  const rows = data?.devices ?? [];
  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + limit, total);

  return (
    <section className="panel" id="panelDevices" role="tabpanel">
      <div className="toolbar">
        <input className="search" type="search" placeholder="按设备哈希前缀搜索…" value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { setQ(input.trim()); setOffset(0); } }} />
        <button className="btn" type="button" onClick={() => { setQ(input.trim()); setOffset(0); }}>搜索</button>
        <span className="toolbar-note">
          {data ? (data.legacyMessages ? `另有 ${data.legacyMessages} 条迁移前旧留言（legacy）` : `共 ${total} 台设备`) : ''}
        </span>
        <button className="btn btn-ghost" type="button" onClick={() => { location.href = '/api/admin/export'; }}>导出 CSV</button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>设备</th><th>首见</th><th>最近活跃</th><th>留言</th><th>最近一条</th><th>状态</th><th className="th-act">操作</th></tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="empty">加载中…</td></tr>
            ) : !rows.length ? (
              <tr><td colSpan={7} className="empty">还没有设备留言</td></tr>
            ) : rows.map((x) => {
              const blocked = x.status === 'blocked';
              return (
                <tr key={x.device_hash}>
                  <td className="mono" title={x.device_hash}>{x.device_hash.slice(0, 12)}…</td>
                  <td className="mono">{fmt(x.first_seen)}</td>
                  <td className="mono">{fmt(x.last_seen)}</td>
                  <td className="mono">{x.messages}{x.hidden ? <span className="tag tag-hide">隐藏 {x.hidden}</span> : null}</td>
                  <td className="text">{x.last_text ? x.last_text.slice(0, 60) : '—'}</td>
                  <td>{blocked ? <span className="tag tag-block">已拉黑</span> : <span className="tag tag-ok">正常</span>}</td>
                  <td className="act">
                    <button className="btn btn-sm" type="button" onClick={() => onViewMessages(x.device_hash)}>看留言</button>{' '}
                    <button className={'btn btn-sm' + (blocked ? '' : ' btn-danger')} type="button"
                      disabled={block.isPending}
                      onClick={() => block.mutate({ device_hash: x.device_hash, blocked }, {
                        onSuccess: () => { /* toast 由 App 层桥接，见 toastBridge */ },
                      })}>
                      {blocked ? '解封' : '拉黑'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <button className="btn btn-ghost" type="button" disabled={offset <= 0} onClick={() => setOffset(Math.max(0, offset - limit))}>上一页</button>
        <span className="pager-info">{total ? `${from}–${to} / ${total}` : '0 / 0'}</span>
        <button className="btn btn-ghost" type="button" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>下一页</button>
      </div>
    </section>
  );
}
