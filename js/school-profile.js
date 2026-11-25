/* ════════════════════════════════════════════════════════
   学校档案 · school-profile.js
   ────────────────────────────────────────────────────────
   数据源：data/school-profiles.js（由 school-profiles.json 生成）
   用法：  window.SchoolProfile.render('xinhua') → 完整档案 HTML
           window.SchoolProfile.get / list / meta
   与公司档案同款：独立页与未来可能的抽屉共用同一渲染函数；
   长板块默认折叠、会话内记住展开状态、打印时强制全展开。
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var ROOT = (window.SCHOOL_PROFILES && typeof window.SCHOOL_PROFILES === 'object')
    ? window.SCHOOL_PROFILES : { meta: {}, schools: {} };
  var SCHOOLS = ROOT.schools || {};
  var META = ROOT.meta || {};
  var CUR = null;                 // 当前渲染的学校，供 sup() 查来源
  var FOLD_KEY = 'sp_fold_state';
  var foldState = {};
  try { foldState = JSON.parse(sessionStorage.getItem(FOLD_KEY) || '{}') || {}; } catch (e) { foldState = {}; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function school(id) { return SCHOOLS[id] || null; }
  function arr(x) { return Array.isArray(x) ? x : []; }

  /* 来源上标：0 = 本人自述，其余对应 sources[].id */
  function sup(n) {
    if (n === 0) return '<sup class="sp-sup sp-sup-self">[自述]</sup>';
    if (!n && n !== 0) return '';
    var hit = null;
    arr(CUR && CUR.sources).forEach(function (x) { if (x.id === n) hit = x; });
    var title = hit ? hit.title : ('资料来源 ' + n);
    if (hit && hit.url) {
      return '<sup class="sp-sup"><a href="' + esc(hit.url) + '" target="_blank" rel="noopener noreferrer" title="' + esc(title) + '">[' + n + ']</a></sup>';
    }
    return '<sup class="sp-sup" title="' + esc(title) + '">[' + n + ']</sup>';
  }

  function isExpanded(key, def) {
    return Object.prototype.hasOwnProperty.call(foldState, key) ? !!foldState[key] : def;
  }
  function saveFold(key, expanded) {
    foldState[key] = !!expanded;
    try { sessionStorage.setItem(FOLD_KEY, JSON.stringify(foldState)); } catch (e) {}
  }

  /* 统一的板块 + 折叠封装（超过一屏的板块传 folded: true） */
  function fold(title, en, inner, opts) {
    opts = opts || {};
    var key = opts.key || title;
    var expanded = isExpanded(key, !opts.folded);
    return '<section class="sp-sec sp-fold' + (expanded ? '' : ' is-folded') + '" data-sp-fold="' + esc(key) + '">' +
      '<div class="sp-sec-head"><h2>' + esc(title) + '</h2><span class="sp-sec-en">' + esc(en) + '</span><span class="sp-sec-line"></span></div>' +
      (opts.note ? '<p class="sp-sec-note">' + esc(opts.note) + '</p>' : '') +
      '<div class="sp-fold-clip">' + inner + '</div>' +
      '<button class="sp-fold-more" type="button" data-sp-fold-toggle aria-expanded="' + (expanded ? 'true' : 'false') + '">' +
        (expanded ? '收起板块 ↑' : '展开全部 ↓') + '</button>' +
      '</section>';
  }

  /* ── 头部 ─────────────────────────────────────────────── */
  function head(s) {
    var stamp = s.logo
      ? '<span class="sp-stamp has-logo" aria-hidden="true"><img class="sp-stamp-logo" src="' + esc(s.logo) + '" alt=""></span>'
      : '<span class="sp-stamp" aria-hidden="true">' + esc(s.code || 'SCHOOL') + '</span>';
    var pills = arr(s.pills).map(function (p) {
      return '<span class="sp-pill">' + esc(p) + '</span>';
    }).join('');
    return '<header class="sp-head">' +
      '<div class="sp-head-top">' + stamp +
        '<div class="sp-head-main">' +
          '<span class="sp-kicker">SCHOOL FILE · 学校档案</span>' +
          '<h1 class="sp-title">' + esc(s.name) + '</h1>' +
          (s.currentName ? '<p class="sp-current"><b>现校名</b>' + esc(s.currentName) + '</p>' : '') +
          '<p class="sp-sub">' + esc(s.industry || '') + ' · ' + esc(s.period || '') + ' · ' + esc(s.degree || '') + '</p>' +
          '<p class="sp-oneline">' + esc(s.oneLine || '') + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="sp-pills">' + pills + '</div>' +
    '</header>';
  }

  function kpiBlock(s) {
    var cells = arr(s.kpis).map(function (k) {
      return '<div class="sp-kpi">' +
        '<p class="sp-kpi-label">' + esc(k.label) + '</p>' +
        '<p class="sp-kpi-value">' + esc(k.value) + '</p>' +
        '<p class="sp-kpi-sub">' + esc(k.sub || '') + '</p>' +
      '</div>';
    }).join('');
    return '<div class="sp-sec sp-sec-first"><div class="sp-kpi-grid">' + cells + '</div>' +
      (s.nameNote ? '<p class="sp-callout" style="margin-top:12px">' + esc(s.nameNote) + sup(1) + '</p>' : '') +
      (s.logoNote ? '<p class="sp-note" style="margin-top:8px">' + esc(s.logoNote) + '</p>' : '') +
    '</div>';
  }

  /* ── 1. 学校维度 ──────────────────────────────────────── */
  function schoolIntro(s) {
    var sc = s.school || {};
    var rows = arr(sc.facts).map(function (f) {
      return '<div class="sp-row"><p class="sp-row-label">' + esc(f.label) + '</p>' +
        '<p class="sp-row-text">' + esc(f.text) + sup(f.source) + '</p></div>';
    }).join('');
    var site = sc.website
      ? '<p class="sp-row-text"><a href="' + esc(sc.website.href) + '" target="_blank" rel="noopener noreferrer">' + esc(sc.website.text) + ' ↗</a></p>'
      : '';
    return '<p class="sp-callout">' + esc(sc.intro || '') + sup(1) + '</p>' +
      '<div style="margin-top:12px">' + rows + '</div>' +
      (site ? '<div class="sp-row"><p class="sp-row-label">官网</p>' + site + '</div>' : '') +
      (sc.motto ? '<p class="sp-note" style="margin-top:10px"><strong>校训：</strong>' + esc(sc.motto) + sup(1) + '</p>' : '');
  }

  function historyBlock(s) {
    var sc = s.school || {};
    var hist = arr(sc.history).map(function (h) {
      return '<div class="sp-hist-item">' +
        '<p class="sp-hist-date">' + esc(h.date) + '</p>' +
        '<div><p class="sp-hist-title">' + esc(h.title) + '</p>' +
        '<p class="sp-hist-text">' + esc(h.text) + sup(h.source) + '</p></div>' +
      '</div>';
    }).join('');
    var campuses = arr(sc.campuses).map(function (c) {
      return '<div class="sp-campus">' +
        '<p class="sp-campus-name">' + esc(c.name) + sup(c.source) + '</p>' +
        '<p class="sp-campus-addr">' + esc(c.address) + '</p>' +
        '<p class="sp-campus-note">' + esc(c.note || '') + '</p>' +
      '</div>';
    }).join('');
    var highs = arr(sc.highlights).map(function (h) {
      return '<div class="sp-highlight"><p class="sp-highlight-title">' + esc(h.title) + '</p>' +
        '<p class="sp-highlight-detail">' + esc(h.detail) + sup(h.source) + '</p></div>';
    }).join('');
    return '<div class="sp-hist">' + hist + '</div>' +
      (campuses ? '<h3 style="font-size:14px;font-weight:900;margin:16px 0 2px">两个校区</h3><div class="sp-campus-grid">' + campuses + '</div>' : '') +
      (highs ? '<h3 style="font-size:14px;font-weight:900;margin:18px 0 10px">与专业相关的办学条件</h3>' + highs : '');
  }

  /* ── 2. 在校经历维度 ──────────────────────────────────── */
  function timelineBlock(s) {
    var tl = s.timeline || {};
    var items = arr(tl.items).map(function (t) {
      var tags = arr(t.tags).map(function (g) { return '<span class="sp-tag">' + esc(g) + '</span>'; }).join('');
      return '<div class="sp-tl-item' + (t.kind === 'after' ? ' is-after' : '') + '">' +
        '<span class="sp-tl-no">' + esc(t.no) + '</span><span class="sp-tl-term">' + esc(t.term) + '</span>' +
        '<p class="sp-tl-title">' + esc(t.title) + sup(0) + '</p>' +
        '<p class="sp-tl-text">' + esc(t.text) + '</p>' +
        (tags ? '<div class="sp-tags">' + tags + '</div>' : '') +
      '</div>';
    }).join('');
    return '<div class="sp-timeline">' + items + '</div>';
  }

  /* ── 3. 课程表 ────────────────────────────────────────── */
  function coursesBlock(s) {
    var c = s.courses || {};
    var rows = arr(c.terms).map(function (t) {
      var chips = arr(t.items).map(function (it) {
        return '<span class="sp-chip' + (it.confirmed ? '' : ' is-ref') + '">' + esc(it.name) + '</span>';
      }).join('');
      return '<tr>' +
        '<td><span class="sp-term">' + esc(t.term) + '</span><span class="sp-term-en">' + esc(t.en) + '</span></td>' +
        '<td><span class="sp-focus">' + esc(t.focus) + '</span></td>' +
        '<td><div class="sp-chips">' + chips + '</div></td>' +
        '<td><span class="sp-output">' + esc(t.output) + '</span></td>' +
      '</tr>';
    }).join('');
    return '<div class="sp-table-wrap"><table class="sp-table">' +
      '<thead><tr><th>学年</th><th>阶段重点</th><th>主修课程</th><th>能力产出</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
      '<div class="sp-legend">' +
        '<span><i class="is-solid"></i>简历 / 作品集明确记载</span>' +
        '<span><i class="is-ref"></i>同课程群常见科目（参考）</span>' +
      '</div>';
  }

  /* ── 4. 获奖证书 ──────────────────────────────────────── */
  function awardsBlock(s) {
    return '<div class="sp-award-grid">' + arr(s.awards).map(function (a) {
      return '<div class="sp-award' + (a.muted ? ' is-muted' : '') + '">' +
        '<img class="sp-award-img" src="' + esc(a.img) + '" alt="' + esc(a.alt) + '" loading="lazy" data-sp-zoom>' +
        '<div class="sp-award-body">' +
          '<span class="sp-award-tag">' + esc(a.tag || a.level) + '</span>' +
          '<p class="sp-award-title">' + esc(a.title) + '</p>' +
          '<p class="sp-award-org">' + esc(a.org || '') + (a.year ? ' · ' + esc(a.year) : '') + '</p>' +
          '<p class="sp-award-note">' + esc(a.note || '') + '</p>' +
        '</div></div>';
    }).join('') + '</div>';
  }

  /* ── 5. 相册 ──────────────────────────────────────────── */
  function albumBlock(s) {
    return '<div class="sp-album-grid">' + arr(s.album).map(function (a) {
      var media = a.empty
        ? '<div class="sp-album-empty"><span>＋</span>暂无可公开照片</div>'
        : '<img class="sp-album-img" src="' + esc(a.img) + '" alt="' + esc(a.alt) + '" loading="lazy" data-sp-zoom>';
      return '<div class="sp-album-item">' +
        '<span class="sp-album-tag">' + esc(a.tag || '') + '</span>' + media +
        '<span class="sp-album-cap">' + esc(a.caption) + '</span>' +
        '<span class="sp-album-note">' + esc(a.note || '') + '</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  /* ── 6. 从课程到工程（补充维度） ──────────────────────── */
  function growthBlock(s) {
    var g = s.growth || {};
    return arr(g.items).map(function (it) {
      return '<div class="sp-growth-item">' +
        '<span class="sp-growth-course">' + esc(it.course) + '</span>' +
        '<span class="sp-growth-arrow">→</span>' +
        '<span class="sp-growth-now">' + esc(it.now) + '</span>' +
        '<p class="sp-growth-text">' + esc(it.text) + sup(0) + '</p>' +
      '</div>';
    }).join('');
  }

  /* ── 7. 学历核验 ──────────────────────────────────────── */
  function verifyBlock(s) {
    var v = s.verify || {};
    return '<div class="sp-verify">' +
      '<div class="sp-verify-text">' +
        '<p class="sp-verify-label">' + esc(v.label) + sup(5) + '</p>' +
        '<p class="sp-verify-code">' + esc(v.code) + '</p>' +
        '<p class="sp-verify-tip">' + esc(v.tip) + '</p>' +
      '</div>' +
      '<img class="sp-verify-qr" src="' + esc(v.qrImage) + '" alt="' + esc(v.qrAlt) + '" data-sp-zoom>' +
    '</div>';
  }

  /* ── 8. 数据说明 + 来源 + 页脚 ────────────────────────── */
  function sourcesBlock(s) {
    var dc = s.dataConfidence || {};
    var conf = arr(dc.items).map(function (i) {
      return '<div class="sp-conf-item"><span class="sp-conf-label">' + esc(i.label) + '</span>' +
        '<span class="sp-conf-level">' + esc(i.level) + '</span>' +
        '<span class="sp-conf-detail">' + esc(i.detail) + '</span></div>';
    }).join('');
    var src = arr(s.sources).map(function (x) {
      return '<div class="sp-src-item"><span class="sp-src-no">[' + esc(x.id) + ']</span>' +
        '<div class="sp-src-title"><a href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer">' + esc(x.title) + ' ↗</a>' +
        '<span class="sp-src-url">' + esc(x.url) + '</span></div>' +
        '<p class="sp-src-note">' + esc(x.note || '') + '</p></div>';
    }).join('');
    return '<p class="sp-callout">' + esc(dc.note || '') + '</p>' +
      (conf ? '<h3 style="font-size:13px;font-weight:900;margin:14px 0 6px">数据置信度</h3>' + conf : '') +
      (src ? '<h3 style="font-size:13px;font-weight:900;margin:16px 0 6px">资料来源</h3>' + src : '');
  }

  function foot() {
    var backR = META.backToResume || 'resume.html';
    var backP = META.backToPortfolio || 'index.html';
    return '<div class="sp-foot">' +
      '<a class="sp-foot-link" href="' + esc(backR) + '">← 返回网页简历</a>' +
      '<a class="sp-foot-link is-alt" href="' + esc(backP) + '">作品集主页 ↗</a>' +
      '<button class="sp-foot-link is-alt" type="button" data-sp-print>打印 / 存为 PDF ⎙</button>' +
    '</div>' +
    '<p class="sp-disclaimer">' + esc(META.disclaimer || '') +
      (META.collectedAt ? ' · 资料整理于 ' + esc(META.collectedAt) : '') + '</p>';
  }

  /* ── 主渲染 ───────────────────────────────────────────── */
  function render(id) {
    var s = school(id);
    if (!s) return '<div class="sp-page-empty">未找到「' + esc(id) + '」的学校档案</div>';
    CUR = s;
    var sc = s.school || {}, tl = s.timeline || {}, cs = s.courses || {}, gr = s.growth || {};
    var html =
      head(s) +
      kpiBlock(s) +
      fold('学校概况', 'SCHOOL', schoolIntro(s), { key: 'intro', folded: true }) +
      fold('名称沿革与关键节点', 'HISTORY', historyBlock(s), { key: 'history' }) +
      fold('在校经历', 'TIMELINE', timelineBlock(s), { key: 'timeline', note: tl.note }) +
      fold('主修课程表', 'COURSE MAP', coursesBlock(s), { key: 'courses', note: cs.note, folded: true }) +
      fold('获奖证书', 'AWARDS', awardsBlock(s), { key: 'awards' }) +
      fold('校园相册', 'ALBUM', albumBlock(s), { key: 'album', folded: true }) +
      fold('从课程到工程', 'GROWTH', growthBlock(s), { key: 'growth', note: gr.note }) +
      fold('学历核验', 'VERIFY', verifyBlock(s), { key: 'verify' }) +
      fold('数据说明与资料来源', 'SOURCES', sourcesBlock(s), { key: 'sources', folded: true }) +
      foot();
    return html;
  }

  /* ── 交互：折叠 / 相册大图 / 打印（事件委托，重渲染后仍生效） ── */
  function closest(el, sel) {
    while (el && el.nodeType === 1) {
      if (el.matches && el.matches(sel)) return el;
      el = el.parentElement;
    }
    return null;
  }
  function lightbox() {
    var lb = document.getElementById('spLightbox');
    if (lb) return lb;
    lb = document.createElement('div');
    lb.className = 'sp-lightbox';
    lb.id = 'spLightbox';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-modal', 'true');
    lb.setAttribute('aria-label', '图片放大预览');
    lb.innerHTML = '<button class="sp-lightbox-close" type="button" aria-label="关闭大图">×</button>' +
      '<img id="spLightboxImg" alt="">';
    document.body.appendChild(lb);
    return lb;
  }
  function openZoom(src, alt) {
    var lb = lightbox();
    var img = document.getElementById('spLightboxImg');
    if (img) { img.src = src; img.alt = alt || ''; }
    lb.classList.add('show');
  }
  function closeZoom() {
    var lb = document.getElementById('spLightbox');
    if (!lb) return;
    lb.classList.remove('show');
    var img = document.getElementById('spLightboxImg');
    if (img) img.removeAttribute('src');
  }

  function start() {
    document.addEventListener('click', function (e) {
      var t = e.target;
      var lb = document.getElementById('spLightbox');
      if (lb && lb.classList.contains('show') && (t === lb || closest(t, '.sp-lightbox-close'))) { closeZoom(); return; }

      var btn = closest(t, '[data-sp-fold-toggle]');
      if (btn) {
        var sec = closest(btn, '[data-sp-fold]');
        if (!sec) return;
        var folded = sec.classList.toggle('is-folded');
        btn.setAttribute('aria-expanded', folded ? 'false' : 'true');
        btn.textContent = folded ? '展开全部 ↓' : '收起板块 ↑';
        saveFold(sec.getAttribute('data-sp-fold'), !folded);
        return;
      }
      if (closest(t, '[data-sp-print]')) { window.print(); return; }
      var zi = closest(t, '[data-sp-zoom]');
      if (zi && zi.getAttribute('src')) { openZoom(zi.getAttribute('src'), zi.getAttribute('alt')); return; }
      if (lb && lb.classList.contains('show') && t && t.tagName === 'IMG') { /* 点大图不关 */ }
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var lb = document.getElementById('spLightbox');
        if (lb && lb.classList.contains('show')) { closeZoom(); e.stopPropagation(); }
      }
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.SchoolProfile = {
    render: render,
    get: school,
    list: function () { return Object.keys(SCHOOLS).map(function (k) { return SCHOOLS[k]; }); },
    meta: function () { return META; }
  };
})();
