import { useState } from 'react';
import { useMessages, useReplyMutation, useSetMessageStatus, type MsgFilter } from '../queries';
import { fmt, useToast } from '../toast';
import type { Message } from '../../../lib/api/admin';

/** 留言审核：筛选 / 分页 / 行内回复面板（⌘·Ctrl+Enter 发送，与旧版交互一致） */
export function MessagesTab({
  device, focus, onExitFocus,
}: { device: string; focus: string; onExitFocus: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [applied, setApplied] = useState<MsgFilter>({ q: '', status: '', device, focus, limit: 50, offset: 0 });
  const [open, setOpen] = useState<string | null>(focus || null);
  const [draft, setDraft] = useState('');

  const { data, isLoading } = useMessages(applied);
  const setStatusMut = useSetMessageStatus();
  const replyMut = useReplyMutation();

  const total = data?.total ?? 0;
  const rows = data?.messages ?? [];

  return (
    <section className="panel" id="panelMessages" role="tabpanel">
      <div className="toolbar">
        <input className="search" type="search" placeholder="搜内容 / 称呼…" value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { setOpen(null); setApplied({ q: q.trim(), status, device: applied.device, focus: '', limit: 50, offset: 0 }); } }} />
        <select className="select" value={status} onChange={(e) => { setStatus(e.target.value); setOpen(null); setApplied({ q: q.trim(), status: e.target.value, device: applied.device, focus: '', limit: 50, offset: 0 }); }}>
          <option value="">全部状态</option>
          <option value="visible">正常</option>
          <option value="hidden">已隐藏</option>
          <option value="pending">待回复</option>
          <option value="replied">已回复</option>
        </select>
        <button className="btn" type="button" onClick={() => { setOpen(null); setApplied({ q: q.trim(), status, device: applied.device, focus: '', limit: 50, offset: 0 }); }}>筛选</button>
        <span className="toolbar-note">
          {data ? ('共 ' + total + ' 条' +
            (applied.device ? ' · 设备 ' + applied.device.slice(0, 8) + '…' : '') +
            (applied.focus ? ' · 已定位单条留言（点「筛选」回到列表）' : '')) : ''}
        </span>
        {applied.device ? (
          <button className="btn btn-ghost" type="button" onClick={() => { setOpen(null); onExitFocus(); setApplied({ q: '', status: '', device: '', focus: '', limit: 50, offset: 0 }); }}>清除设备筛选</button>
        ) : null}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>时间</th><th>设备</th><th>称呼</th><th>内容</th><th>状态</th><th>对话</th><th className="th-act">操作</th></tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="empty">加载中…</td></tr>
            ) : !rows.length ? (
              <tr><td colSpan={7} className="empty">没有符合条件的留言</td></tr>
            ) : rows.flatMap((m) => {
              const hidden = m.status === 'hidden';
              const legacy = m.device_hash === 'legacy';
              const n = m.reply_count;
              const line = (
                <tr key={m.id} data-msg-id={m.id}>
                  <td className="mono">{fmt(m.created_at)}</td>
                  <td className="mono" title={m.device_hash}>
                    {legacy ? <span className="tag tag-legacy">legacy</span> : m.device_hash.slice(0, 8) + '…'}
                  </td>
                  <td>{m.name ?? ''}</td>
                  <td className="text">{m.text}</td>
                  <td>{hidden ? <span className="tag tag-hide">已隐藏</span> : <span className="tag tag-ok">正常</span>}</td>
                  <td>{n
                    ? <span className={'tag ' + (m.owner_replied ? 'tag-ok' : 'tag-hide')}>{n} 条 · {m.owner_replied ? '已回' : '待回'}</span>
                    : <span className="tag tag-legacy">无</span>}</td>
                  <td className="act">
                    <button className="btn btn-sm" type="button" onClick={() => { setOpen(open === m.id ? null : m.id); setDraft(''); }}>回复</button>{' '}
                    <button className={'btn btn-sm' + (hidden ? '' : ' btn-danger')} type="button" disabled={setStatusMut.isPending}
                      onClick={() => setStatusMut.mutate(
                        { id: m.id, status: hidden ? 'visible' : 'hidden' },
                        { onSuccess: () => toast(hidden ? '已恢复公开' : '已隐藏，公开端看不到') },
                      )}>{hidden ? '恢复' : '隐藏'}</button>
                  </td>
                </tr>
              );
              if (open !== m.id) return [line];
              return [line, <ReplyRow key={m.id + '-reply'} msg={m} draft={draft} setDraft={setDraft}
                onSend={(text) => replyMut.mutate(
                  { messageId: m.id, text },
                  {
                    onSuccess: () => { toast('已回复，访客回到本设备刷新即可看到'); setDraft(''); },
                    onError: (e) => toast(e.message || '回复失败', true),
                  },
                )}
                onDelete={(rid) => replyMut.mutate(
                  { id: rid },
                  { onSuccess: () => toast('已删除这条回复'), onError: (e) => toast(e.message || '删除失败', true) },
                )}
                busy={replyMut.isPending} />];
            })}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <button className="btn btn-ghost" type="button" disabled={applied.offset <= 0} onClick={() => setApplied({ ...applied, offset: Math.max(0, applied.offset - applied.limit) })}>上一页</button>
        <span className="pager-info">{total ? `${applied.offset + 1}–${Math.min(applied.offset + applied.limit, total)} / ${total}` : '0 / 0'}</span>
        <button className="btn btn-ghost" type="button" disabled={applied.offset + applied.limit >= total} onClick={() => setApplied({ ...applied, offset: applied.offset + applied.limit })}>下一页</button>
      </div>
    </section>
  );
}

function ReplyRow({ msg, draft, setDraft, onSend, onDelete, busy }: {
  msg: Message; draft: string; setDraft: (s: string) => void;
  onSend: (text: string) => void; onDelete: (rid: string) => void; busy: boolean;
}) {
  const reps = msg.replies ?? [];
  return (
    <tr className="reply-row" data-reply-for={msg.id}>
      <td colSpan={7}>
        <div className="reply-panel">
          <div className="rp-title">对话 · {reps.length} 条</div>
          <div className="rp-list">
            {reps.length ? reps.map((r) => {
              const owner = r.author === 'owner';
              const hidden = r.status === 'hidden';
              return (
                <div key={r.id} className={'rp-item' + (owner ? ' is-owner' : '') + (hidden ? ' is-hidden' : '')}>
                  <div className="rp-head">
                    <span className="rp-who">{owner ? '我 · 回复' : '访客 · 追问'}</span>
                    <span className="rp-time">{fmt(r.created_at)}</span>
                    {hidden ? <span className="tag tag-hide">已隐藏</span> : null}
                    <button className="btn btn-sm btn-danger rp-del" type="button" disabled={busy} onClick={() => onDelete(r.id)}>删除</button>
                  </div>
                  <div className="rp-text">{r.text}</div>
                </div>
              );
            }) : <p className="rp-empty">还没有对话。写下第一条回复，它会直接贴到访客那台设备的这条留言下面。</p>}
          </div>
          <div className="rp-compose">
            <textarea className="rp-input" rows={3} maxLength={300} value={draft}
              placeholder="写回复…（访客回到同一设备刷新即可看到）"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  if (Array.from(draft.trim()).length >= 2) onSend(draft.trim());
                }
              }} />
            <div className="rp-foot">
              <span className="toolbar-note">⌘ / Ctrl + Enter 快速发送 · 回复只对该设备可见</span>
              <button className="btn btn-sm rp-send" type="button" disabled={busy}
                onClick={() => {
                  const text = draft.trim();
                  if (Array.from(text).length < 2) return;
                  onSend(text);
                }}>{busy ? '发送中…' : '发送回复 ▶'}</button>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
