/* ════════════════════════════════════════════════════════
   打印效果预览组件 · resume.html 专用
   ────────────────────────────────────────────────────────
   预览源是「真实导出的那份 PDF」，不是 CSS 猜出来的近似效果：

     resume.html --Chrome 打印--> PDF（HR 收到的文件）
                              |- 彩色版：PDF 逐页原样栅格化
                              `- 黑白版：对同一批像素做灰度化

   因此版式、底色、序号色块都已固化在 PDF 里；黑白打印机不会像
   「直接打印 HTML 且没勾背景图形」那样把底色/白字吞掉。生成脚本：
   node scripts/render_print_previews.mjs

   真实导出完全没动：底部按钮仍调用原来那一次 window.print()。
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var PV_VER = '20261125b';   // 与模板里 js/print-preview.js 的版本号一起改
  var PV_PAGES = 2;           // 简历硬约束 2 页，由 render_print_previews 校验
  var IMG = 'assets/print-preview/';
  var ov = null, built = false;

  function pages(kind) {
    var html = '';
    for (var i = 1; i <= PV_PAGES; i++) {
      var src = IMG + kind + '-' + i + '.png?v=' + PV_VER;
      html +=
        '<div class="pv-sheet">' +
          '<span class="pv-sheet-label">第 ' + i + ' 页 · 点击看大图</span>' +
          '<a href="' + src + '" target="_blank" rel="noopener">' +
            '<img src="' + src + '" alt="' + (kind === 'bw' ? '黑白' : '彩色') + '打印预览 第 ' + i + ' 页" loading="lazy">' +
          '</a>' +
        '</div>';
    }
    return html;
  }

  function build() {
    if (built) return;
    ov = document.createElement('div');
    ov.className = 'pv-overlay';
    ov.id = 'pvOverlay';
    ov.hidden = true;
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', '打印效果预览');
    ov.innerHTML =
      '<div class="pv-panel">' +
        '<div class="pv-head">' +
          '<div><span class="pv-kicker">PRINT PREVIEW</span><h2>打印效果预览</h2></div>' +
          '<button class="pv-close" type="button" data-pv-close aria-label="关闭预览">×</button>' +
        '</div>' +
        '<p class="pv-intro">两栏都取自同一份<strong>真实导出的 PDF</strong>：左边就是投递给 HR 的彩色文件；右边是对该文件逐像素灰度化，模拟黑白打印。底色和文字已固化在 PDF 中，不会因打印机未勾选「背景图形」而消失。</p>' +
        '<div class="pv-toolbar">' +
          '<span class="pv-source">预览源：真实 PDF · 非 CSS 模拟</span>' +
          '<span class="pv-pages">A4 · ' + PV_PAGES + ' 页</span>' +
        '</div>' +
        '<div class="pv-stage">' +
          '<figure class="pv-col">' +
            '<figcaption><b>彩色打印</b><span>导出 PDF 原样，HR 屏幕上看到的效果</span></figcaption>' +
            '<div class="pv-paper">' + pages('color') + '</div>' +
          '</figure>' +
          '<figure class="pv-col">' +
            '<figcaption><b>黑白打印</b><span>对真实 PDF 逐像素灰度化的近似效果</span></figcaption>' +
            '<div class="pv-paper">' + pages('bw') + '</div>' +
          '</figure>' +
        '</div>' +
        '<div class="pv-foot">' +
          '<p class="pv-note">灰度是像素级模拟：不同打印机驱动的灰阶与网点可能略有差异，最终请以实际设备输出为准。</p>' +
          '<div class="pv-actions">' +
            '<button class="pv-btn is-ghost" type="button" data-pv-close>关闭</button>' +
            '<button class="pv-btn is-primary" type="button" data-pv-print>按此效果打印 / 保存 PDF →</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    built = true;

    ov.addEventListener('click', function (e) {
      if (e.target === ov) { close(); return; }
      var t = e.target;
      while (t && t !== ov && t.nodeType === 1) {
        if (t.hasAttribute && t.hasAttribute('data-pv-close')) { close(); return; }
        if (t.hasAttribute && t.hasAttribute('data-pv-print')) {
          close();
          /* 导出链路不变：仍是原来那一次 window.print() */
          window.print();
          return;
        }
        t = t.parentNode;
      }
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && ov && !ov.hidden) close();
    }, true);
  }

  function close() {
    if (!ov) return;
    ov.hidden = true;
    document.body.classList.remove('pv-open');
  }

  window.openPrintPreview = function () {
    build();
    ov.hidden = false;
    document.body.classList.add('pv-open');
    var btn = ov.querySelector('.pv-close');
    if (btn) btn.focus();
  };
})();
