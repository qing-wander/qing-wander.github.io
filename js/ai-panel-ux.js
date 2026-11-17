/* ════════════════════════════════════════════════════════════
   CP.AI 面板「窗口层」交互脚本
   --------------------------------------------------------------
   · js/main.js 的问答 / 自动打招呼 / 云函数请求全部零改动
   · 只观察 #aiPanel 的 hidden 属性变化，与原开关（浮标 / × / Esc）
     完全解耦；关闭时一步复位，不需要「先缩小再关闭」
   · 放大按钮、遮罩都由本文件动态注入，沿用站点 Neo-brutalism 样式
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var panel = document.getElementById('aiPanel');
  var head = panel ? panel.querySelector('.ai-head') : null;
  var closeBtn = document.getElementById('aiClose');
  var fab = document.getElementById('aiFab');
  if (!panel || !head || !closeBtn) return;

  /* Windows 式最大化 / 还原图标，纯 inline SVG 零外部依赖 */
  var SVG_OPEN = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">' +
    '<rect x="2.5" y="2.5" width="11" height="11"/><path d="M2.5 5.5h11"/></svg>';
  var SVG_BACK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">' +
    '<path d="M5.5 5.5V2.5H13.5V10.5H10.5"/><rect x="2.5" y="5.5" width="8" height="8"/></svg>';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ai-win-btn';
  btn.id = 'aiWinSize';
  head.insertBefore(btn, closeBtn);

  var scrim = document.createElement('div');
  scrim.className = 'ai-panel-scrim';
  scrim.id = 'aiPanelScrim';
  scrim.hidden = true;
  scrim.setAttribute('aria-hidden', 'true');
  panel.parentNode.insertBefore(scrim, panel);

  function isMax() { return panel.classList.contains('is-max'); }

  function syncBtn() {
    var on = isMax();
    btn.innerHTML = on ? SVG_BACK : SVG_OPEN;
    btn.setAttribute('aria-label', on ? '还原窗口（收回原本大小）' : '放大窗口（居中展开）');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.title = on ? '还原窗口 · 回到原本大小' : '放大窗口 · 居中展开（不全屏）';
  }

  function setMax(on) {
    if (panel.hidden) return;                 /* 关闭态不允许放大 */
    on = !!on;
    panel.classList.toggle('is-max', on);
    document.body.classList.toggle('ai-panel-max', on);
    scrim.hidden = !on;
    panel.setAttribute('aria-modal', on ? 'true' : 'false');
    syncBtn();
  }

  /* 关闭 = 一步到位：× / Esc / 浮标切换 / 点遮罩都收敛到这里复位 */
  function reset() {
    panel.classList.remove('is-max');
    document.body.classList.remove('ai-panel-max');
    scrim.hidden = true;
    panel.setAttribute('aria-modal', 'false');
    syncBtn();
  }

  btn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    setMax(!isMax());
  });

  /* 点遮罩直接调用原关闭按钮，复用 main.js 的 aiClosePanel 逻辑 */
  scrim.addEventListener('click', function () { closeBtn.click(); });

  if (window.MutationObserver) {
    new MutationObserver(function () {
      if (panel.hidden) reset(); else syncBtn();
    }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  } else {
    closeBtn.addEventListener('click', reset);
    if (fab) fab.addEventListener('click', function () { if (panel.hidden) reset(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panel.hidden) reset();
    });
  }

  syncBtn();

  /* 控制台快捷入口：window.CPAI_PANEL_UX.expand() / .restore() / .close() */
  window.CPAI_PANEL_UX = {
    expand: function () { setMax(true); },
    restore: function () { setMax(false); },
    close: function () { if (!panel.hidden) closeBtn.click(); },
    isExpanded: isMax
  };
})();
