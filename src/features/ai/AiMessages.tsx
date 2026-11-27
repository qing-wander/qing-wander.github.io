/**
 * AI 面板消息渲染（M3-B）—— 自 js/main.js aiAppendMsg / aiShowTyping /
 * aiRenderAnswer / bindAiSources（1058-1385 行）逐字平移。
 *
 * DOM 契约：.ai-msg[data-mode] > .ai-msg-name + .ai-bubble；typing 态加 .ai-typing；
 * 依据按钮 .ai-src（aria-expanded）互斥展开 .ai-src-body[data-for]（插在 .ai-src-row 之后）。
 * ai-voice.js 的 MutationObserver 读新增 .ai-msg 朗读；ai-stage-link.js 读 .ai-msg 做描边联动。
 */

import { useState } from 'react';
import type { AiSource } from './chat';
import { esc } from './chat';

export interface AiMsgItem {
  id: number;
  who: 'user' | 'bot';
  /** bubble 主内容：受控拼接的 html（esc + 换行转 br），与旧版 innerHTML 同口径 */
  html: string;
  mode: 'qa' | 'jd';
  /** typing dots 态（.ai-typing） */
  typing?: boolean;
  /** qa 答案依据（最多渲染 3 个按钮） */
  sources?: AiSource[];
}

interface Props {
  item: AiMsgItem;
}

export function AiMsg({ item }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const sources = item.sources && item.sources.length ? item.sources.slice(0, 3) : [];

  /* 「依据」点击展开/收起切片原文；同一消息内互斥（与旧版 bindAiSources 一致） */
  function onSrcClick(s: AiSource, hasText: boolean) {
    if (!hasText) return;
    if (expandedId === String(s.id || '')) { setExpandedId(null); return; }
    setExpandedId(String(s.id || ''));
  }

  const expanded = expandedId != null ? sources.find((s) => String(s.id || '') === expandedId) : null;
  const expandedText = expanded ? String(expanded.excerpt || expanded.text || '') : '';

  return (
    <div className={`ai-msg ai-msg-${item.who}${item.typing ? ' ai-typing' : ''}`} data-mode={item.mode}>
      <span className="ai-msg-name">{item.who === 'bot' ? '李清 · AI数字分身' : 'YOU'}</span>
      <div className="ai-bubble">
        {item.typing ? (
          <><span className="ai-dot" /><span className="ai-dot" /><span className="ai-dot" /></>
        ) : (
          <span dangerouslySetInnerHTML={{ __html: item.html }} />
        )}
        {sources.length ? (
          <div className="ai-src-row">
            <span className="ai-src-label">依据</span>
            {sources.map((s) => {
              const excerpt = String(s.excerpt || s.text || '');
              let label = esc(String(s.title || ''));
              if (label.length > 26) label = label.slice(0, 26) + '…';
              return (
                <button className="ai-src" type="button" key={String(s.id || '')}
                  data-src-id={String(s.id || '')}
                  aria-expanded={expandedId === String(s.id || '')}
                  title={excerpt ? '点击展开原文' : esc(String(s.id || ''))}
                  onClick={() => onSrcClick(s, !!excerpt)}>{label}</button>
              );
            })}
          </div>
        ) : null}
        {expandedText ? <div className="ai-src-body" data-for={expandedId || ''}>{expandedText}</div> : null}
      </div>
    </div>
  );
}
