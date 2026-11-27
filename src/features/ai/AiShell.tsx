/**
 * AI 数字分身面板（M3-B 分片二）—— 自 js/main.js 第 11 节（975-1546 行）逐字平移的状态机。
 *
 * 桥接策略（docs/react-refactor-plan.md §5.4 client:idle + M3-B 定案）：
 * - 面板 aside 由本组件 SSR 直出（与旧版 index.html 面板壳逐字一致）并作单根岛 client:idle 水合；
 *   FAB（#aiFab）保持 Astro 模板 SSG 静态直出（React 岛外，元素身份永不重建），
 *   点击通过 document 级事件委托进入 React 状态机（ai-skins 的 stage.click → aiFab.click()
 *   同样命中），aria-expanded 由水合后直改同步。
 *   水合保留 DOM 元素身份 → ai-skins / ai-voice / ai-voice-cloud / ai-stage-link /
 *   ai-panel-ux / gender-switch 六个外围脚本零改动继续协作（MutationObserver / 全局事件 / fixed DOM id）。
 * - js/main.js 第 11 节由 index.astro 注入的 window.CP_AI_REACT 守卫短路（旧版不受影响）。
 * - js/jd-match.js 不再底载：请求 / 错误文案 / 示例 / Markdown 导出改用 src/lib/jd/client.ts（M2 已平移）。
 * - 已停用的「自动弹出 / 招呼气泡」旧代码不迁移（旧版 aiScheduleAuto 本就短路）。
 */

import { useEffect, useRef, useState } from 'react';
import { CFG, errorText, EXAMPLES, requestJd, type JdMatchData } from '../../lib/jd/client';
import { AiJdCard } from './AiJdCard';
import { AiMsg, type AiMsgItem } from './AiMessages';
import { AI, aiRenderError, askAI, esc, fetchGreeting, syncWindowContracts } from './chat';

type PanelItem = AiMsgItem | { id: number; jdCard: { data: JdMatchData; elapsed: number; jdText: string } };

/* ai-head 静态标记（与旧版 index.html 逐字一致）。
   用 dangerouslySetInnerHTML 容器渲染：ai-voice.js（音量开关）与 ai-panel-ux.js（窗口层按钮）
   会在「SSR 输出后、React 水合前」的窗口期往 head 里注入节点，React 不 diff 危险容器子树，
   注入按钮得以保留（旧版无水合的等效行为）；#aiClose 点击由 document 委托接管。 */
const HEAD_HTML =
  '<span class="ai-head-mark">AI<i>.</i>ME</span>' +
  '<span class="ai-head-sub">DIGITAL TWIN // LI QING</span>' +
  '<span class="ai-head-status"><i class="ai-lamp" aria-hidden="true"></i>在线</span>' +
  '<button class="ai-close" id="aiClose" aria-label="关闭数字分身">×</button>';

let uid = 0;

export default function AiShell() {
  /* ── 开合与模式 ── */
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [mode, setModeState] = useState<'qa' | 'jd'>('qa');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');

  /* ── 消息流（.ai-msg 与 .ai-jd-card 混排，均为 aiBody 直接子节点） ── */
  const [items, setItems] = useState<PanelItem[]>([]);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const openRef = useRef(false);
  const readyRef = useRef(false);
  const welcomeRef = useRef<string>(AI.welcome);
  const lastJDRef = useRef('');
  /* document 委托（#aiFab / #aiClose 点击）调用的动作引用：
     effect 依赖空数组挂载一次，动作经 ref 取每次 render 的最新闭包 */
  const actionsRef = useRef<{ open: () => void; close: () => void }>({ open: () => {}, close: () => {} });

  /* 水合完成标记：外围脚本 / E2E 可感知 React 版已接管；
     FAB（岛外静态 DOM）点击通过 document 委托进入状态机（ai-skins 舞台单击 → aiFab.click() 同链） */
  useEffect(() => {
    syncWindowContracts();
    fetchGreeting((html) => { welcomeRef.current = html; });
    (window as unknown as { CP_AI_REACT_READY?: boolean }).CP_AI_REACT_READY = true;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Element | null;
      if (!t || !t.closest) return;
      if (t.closest('#aiClose')) { e.preventDefault(); actionsRef.current.close(); return; }
      if (t.closest('#aiFab')) {
        e.preventDefault();
        if (openRef.current) actionsRef.current.close(); else actionsRef.current.open();
      }
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  /* 面板开合：body 锁（滚动穿透防护）+ FAB aria-expanded 同步（旧版 aiOpenPanel/aiClosePanel 同款） */
  useEffect(() => {
    document.body.classList.toggle('ai-lock', open);
    openRef.current = open;
    const fab = document.getElementById('aiFab');
    if (fab) fab.setAttribute('aria-expanded', open ? 'true' : 'false');
  }, [open]);

  /* 新消息后滚到底（旧版 aiScroll） */
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  function push(it: PanelItem) { setItems((prev) => [...prev, it]); }
  function removeById(id: number) { setItems((prev) => prev.filter((x) => x.id !== id)); }

  /* ── 模式切换（aiSetMode 平移：类名 / placeholder / aria / 引导消息） ── */
  function setMode(next: 'qa' | 'jd') {
    const target: 'qa' | 'jd' = next === 'jd' ? 'jd' : 'qa';
    if (mode === target) return;
    setModeState(target);
    if (target === 'jd') {
      push({
        id: ++uid, who: 'bot', mode: 'jd',
        html: '已切到 <b>JD 匹配</b>：粘贴岗位描述，我会拆成需求逐条对照档案证据，列出覆盖 / 部分 / 缺口与面试追问点。<br>一次 30–1500 字，' + CFG.quota + '；也可以点下面的示例直接填入。',
      });
    }
    if (panelRef.current && !panelRef.current.hidden) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  /* ── 开合（aiOpenPanel / aiClosePanel 平移；不依赖 render 闭包，供 document 委托调用） ── */
  function openPanel() {
    setOpen(true);
    setOpening(true);
    setTimeout(() => setOpening(false), 320);
    if (!readyRef.current) {
      readyRef.current = true;
      push({ id: ++uid, who: 'bot', mode: 'qa', html: welcomeRef.current });
    }
    setTimeout(() => inputRef.current?.focus(), 60);
  }

  function closePanel() {
    setOpen(false);
    setModeState((prev) => (prev === 'jd' ? 'qa' : prev)); /* 关闭即回到问答模式 */
  }

  /* Esc 关面板（旧版 document keydown） */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) closePanel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, mode]);

  /* ── 问答提交（aiSubmit + askAI + aiRenderAnswer 平移） ── */
  function submitChat(q: string) {
    if (!q || busy) return;
    setBusy(true);
    push({ id: ++uid, who: 'user', mode: 'qa', html: esc(q) });
    if (q.length > AI.maxChars) {
      push({ id: ++uid, who: 'bot', mode: 'qa', html: '▍问题太长啦，' + AI.maxChars + ' 字以内就好。' });
      setBusy(false);
      return;
    }
    const typingId = ++uid;
    push({ id: typingId, who: 'bot', mode: 'qa', typing: true, html: '' });
    askAI(q).then((data) => {
      removeById(typingId);
      push({
        id: ++uid, who: 'bot', mode: 'qa',
        html: esc(String(data.answer || '')).replace(/\r?\n/g, '<br>'),
        sources: data.sources && data.sources.length ? data.sources.slice(0, 3) : undefined,
      });
    }).catch((err: { message?: string }) => {
      removeById(typingId);
      push({ id: ++uid, who: 'bot', mode: 'qa', html: aiRenderError(err) });
    }).finally(() => {
      setBusy(false);
      if (panelRef.current && !panelRef.current.hidden) {
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    });
  }

  /* ── JD 匹配提交（aiSubmitJD 平移：校验 / typing / 断连重试一次 / 结果卡） ── */
  function submitJD(raw: string, isRetry = false) {
    const jd = String(raw || '').trim();
    if (jd.length < CFG.minChars) {
      push({ id: ++uid, who: 'bot', mode: 'jd', html: '▍JD 太短了（' + jd.length + '/' + CFG.minChars + ' 字），贴完整的岗位职责与任职要求再发。' });
      return;
    }
    if (jd.length > CFG.maxChars) {
      push({ id: ++uid, who: 'bot', mode: 'jd', html: '▍JD 超过 ' + CFG.maxChars + ' 字，删掉公司介绍和福利段落再发。' });
      return;
    }
    setBusy(true);
    lastJDRef.current = jd;
    const flat = jd.replace(/\s+/g, ' ');
    const preview = flat.slice(0, 52) + (flat.length > 52 ? '…' : '');
    push({ id: ++uid, who: 'user', mode: 'jd', html: esc(preview) });
    const typingId = ++uid;
    push({ id: typingId, who: 'bot', mode: 'jd', typing: true, html: '' });
    const started = Date.now();
    requestJd(jd).then((data) => {
      removeById(typingId);
      const m = data.match || {}, o = m.overall || {};
      const score = Math.max(0, Math.min(100, Number(o.score) || 0));
      const n = (m.rows && m.rows.length) || 0;
      const req = Number(data.meta && data.meta.requirements) || 0;
      const coverage = req > n
        ? 'JD 拆出 ' + req + ' 条要求，合并为 ' + n + ' 个需求点'
        : '已逐条对照 ' + n + ' 个需求点';
      push({ id: ++uid, who: 'bot', mode: 'jd', html: '覆盖度 <b>' + score + '/100</b>（' + esc(o.verdict || '已比对') + '），' + coverage + '。完整对照表在下面 ↓' });
      push({ id: ++uid, jdCard: { data, elapsed: (Date.now() - started) / 1000, jdText: jd } });
    }).catch((err: { code?: string }) => {
      removeById(typingId);
      const code = (err && err.code) || '';
      /* 断连/超时先自动重试一次（旧版注释：用户手动点一次成功率其实很高，别让人误以为功能坏了） */
      if (!isRetry && (code === 'network' || code === 'timeout')) {
        push({ id: ++uid, who: 'bot', mode: 'jd', html: '▍通道闪断，正在自动重试一次…' });
        setTimeout(() => submitJD(raw, true), 900);
        return;
      }
      push({ id: ++uid, who: 'bot', mode: 'jd', html: '▍' + esc(errorText(err)) });
    }).finally(() => {
      setBusy(false);
      if (panelRef.current && !panelRef.current.hidden) {
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    });
  }

  /* ── 提交入口（qa / jd 分流） ── */
  function submit(q?: string) {
    const question = (typeof q === 'string' ? q : text).trim();
    if (!question || busy) return;
    if (mode === 'jd') { submitJD(question); return; }
    submitChat(question);
    setText('');
    if (inputRef.current) inputRef.current.style.height = '';
  }

  /* 输入框自适应高度（旧版 input 事件，ref 直改不进 state） */
  function autosize(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 88) + 'px';
  }

  function onInput(e: React.FormEvent<HTMLTextAreaElement>) {
    setText(e.currentTarget.value);
    autosize(e.currentTarget);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  /* JD 示例 chip：填入输入框不直接发（旧版行为） */
  function onSample(key: string) {
    const ex = EXAMPLES[key];
    if (!ex) return;
    setText(ex);
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 88) + 'px';
        inputRef.current.focus();
      }
    }, 0);
  }

  /* JD 卡「追问」：切回问答并直接提问（旧版 data-ai-probe 行为） */
  function onProbe(q: string) {
    setModeState('qa');
    submitChat(q);
  }

  const quick = mode === 'jd'
    ? <>
      {AI.jd.samples.map((s) => (
        <button className="ai-chip" type="button" key={s.key} data-jd-sample={s.key}
          onClick={() => onSample(s.key)}>{s.label} →</button>
      ))}
      <button className="ai-chip ai-chip-mode" type="button" data-ai-mode="qa"
        onClick={() => setMode('qa')}>← 问答</button>
    </>
    : <>
      {AI.quickQuestions.map((q) => (
        <button className="ai-chip" type="button" key={q}
          onClick={() => submit(q)}>{q}</button>
      ))}
      <button className="ai-chip ai-chip-mode" type="button" data-ai-mode="jd"
        onClick={() => setMode('jd')}>JD 匹配 ↗</button>
    </>;

  /* document 委托动作每次 render 后刷新到最新闭包（状态读取走 ref / 函数式 setState，安全） */
  actionsRef.current = { open: openPanel, close: closePanel };

  return (
    <aside className={'ai-panel' + (mode === 'jd' ? ' ai-mode-jd' : '') + (opening ? ' opening' : '')}
      id="aiPanel" role="dialog" aria-modal="false" aria-label="李清的数字分身" hidden={!open} ref={panelRef}>
        <div className="ai-head" dangerouslySetInnerHTML={{ __html: HEAD_HTML }} />
        <div className="ai-modebar" id="aiModeBar" role="group" aria-label="对话模式">
          <button className={'ai-mode-btn' + (mode === 'qa' ? ' on' : '')} type="button" data-ai-mode="qa"
            aria-pressed={mode === 'qa' ? 'true' : 'false'} onClick={() => setMode('qa')}>问答</button>
          <button className={'ai-mode-btn' + (mode === 'jd' ? ' on' : '')} type="button" data-ai-mode="jd"
            aria-pressed={mode === 'jd' ? 'true' : 'false'} onClick={() => setMode('jd')}>JD 匹配</button>
          <span className="ai-mode-hint">同一个我 · 两种问法</span>
        </div>
        <div className="ai-body" id="aiBody" aria-live="polite" ref={bodyRef}>
          {items.map((it) => 'jdCard' in it
            ? <AiJdCard key={it.id} data={it.jdCard.data} elapsed={it.jdCard.elapsed}
              jdText={it.jdCard.jdText} onProbe={onProbe} onClose={closePanel} />
            : <AiMsg key={it.id} item={it} />)}
        </div>
        <div className="ai-quick" id="aiQuick">{quick}</div>
        <div className="ai-inputrow">
          <textarea id="aiInput" rows={1}
            placeholder={mode === 'jd' ? '粘贴岗位 JD（30–1500 字），逐条对照档案…' : '问我：我做过哪些 Agent 项目？'}
            aria-label={mode === 'jd' ? '输入岗位 JD' : '输入你的问题'}
            ref={inputRef} value={text} onInput={onInput} onKeyDown={onKeyDown}></textarea>
          <button className="ai-send" id="aiSend"
            aria-label={mode === 'jd' ? '开始匹配 JD' : '发送问题'}
            disabled={busy} onClick={() => submit()}>▶</button>
        </div>
        <div className="ai-foot" aria-hidden="true">CLOUDFLARE FUNCTIONS · 混合检索（BM25 + 向量 RRF）· 受约束生成 · AI 语音合成（可关闭）// 已接入</div>
    </aside>
  );
}
