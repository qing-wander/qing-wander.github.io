/* ════════════════════════════════════════════════════════
   公司档案抽屉 · company-profile.js
   ────────────────────────────────────────────────────────
   数据源：data/company-profiles.js 快照（真源 data/company-profiles.json）
   出处：resume.html（工作经历徽章）与 index.html（SEC.04 卡片）共用。

   职责：
     1. 扫描 .cp-quick[data-cp-quick] 填充速览行（quickStats）
     2. 委托监听 .cp-badge[data-cp] 点击 → 打开抽屉
     3. 抽屉：公司档案（本体/业务/融资或业绩图表/知名度/前景/办公环境/来源）
     4. SVG 柱状图（零依赖，hover 显示数值）
     5. 环境图灯箱、hash 深链 (#company=xxx)、Esc / 遮罩关闭
   打印：@media print 隐藏全部 UI（见 company-profile.css）。
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var DATA = (typeof window !== 'undefined' && window.COMPANY_PROFILES) || null;
  var companies = (DATA && DATA.companies) || {};
  var meta = (DATA && DATA.meta) || {};

  function company(id) { return companies[id] || null; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function sup(n) {
    return n ? '<sup class="cp-ref">' + esc(n) + '</sup>' : '';
  }

  /* ══════════════ 速览行填充 ══════════════ */
  function fillQuick() {
    var nodes = document.querySelectorAll('.cp-quick[data-cp-quick]');
    for (var i = 0; i < nodes.length; i++) {
      var c = company(nodes[i].getAttribute('data-cp-quick'));
      if (c && c.quickStats && c.quickStats.length) {
        nodes[i].textContent = c.quickStats.join('　·　');
        nodes[i].removeAttribute('hidden');
      }
    }
  }

  /* ══════════════ SVG 柱状图 ══════════════ */
  function niceCeil(v) {
    if (v <= 0) return 1;
    var mag = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    var step = v / mag;
    var nice = step <= 1 ? 1 : step <= 2 ? 2 : step <= 2.5 ? 2.5 : step <= 5 ? 5 : 10;
    return nice * mag;
  }
  function fmtNum(v) {
    if (v >= 100) return String(Math.round(v));
    return String(Math.round(v * 10) / 10);
  }

  function renderChartSVG(metric, unitSuffix) {
    var pts = metric.points || [];
    if (!pts.length) return '';
    var W = 560, H = 240, padL = 46, padR = 14, padT = 26, padB = 34;
    var innerW = W - padL - padR, innerH = H - padT - padB;
    var max = 0;
    for (var i = 0; i < pts.length; i++) max = Math.max(max, Number(pts[i].value) || 0);
    var top = niceCeil(max * 1.12);
    var sx = innerW / pts.length;

    var s = '<svg class="cp-chart-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
      esc(metric.label) + '柱状图">';
    /* 网格与 y 轴刻度 */
    for (var g = 0; g <= 4; g++) {
      var gy = padT + innerH - (innerH * g / 4);
      s += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" class="cp-grid"' +
        (g === 0 ? ' class="cp-grid cp-axis"' : '') + '/>';
      s += '<text x="' + (padL - 6) + '" y="' + (gy + 4) + '" class="cp-tick" text-anchor="end">' +
        fmtNum(top * g / 4) + '</text>';
    }
    /* 柱与数值 */
    for (var k = 0; k < pts.length; k++) {
      var v = Number(pts[k].value) || 0;
      var h = Math.max(2, innerH * (v / top));
      var x = padL + sx * k + sx * 0.22;
      var bw = sx * 0.56;
      var y = padT + innerH - h;
      var last = k === pts.length - 1;
      var label = pts[k].label + '：' + fmtNum(v) + (pts[k].note ? '（' + pts[k].note + '）' : '') +
        (unitSuffix || '');
      s += '<g class="cp-bar-g' + (last ? ' is-latest' : '') + '">' +
        '<rect class="cp-bar" x="' + x + '" y="' + y + '" width="' + bw + '" height="' + h + '" rx="1">' +
        '<title>' + esc(label) + '</title></rect>' +
        '<text class="cp-bar-val' + (last ? ' is-latest-text' : '') + '" x="' + (x + bw / 2) + '" y="' +
        (y - 6) + '" text-anchor="middle">' + fmtNum(v) + '</text>' +
        '<text class="cp-tick cp-x" x="' + (x + bw / 2) + '" y="' + (H - 10) + '" text-anchor="middle">' +
        esc(pts[k].label) + '</text></g>';
    }
    s += '</svg>';
    return s;
  }

  function renderChartBlock(c) {
    var ch = c.chart;
    if (!ch || !ch.metrics || !ch.metrics.length) return '';
    var html = '<div class="cp-chart">' +
      '<div class="cp-chart-head"><h4>' + esc(ch.title || '业绩走势') + '</h4>' +
      '<div class="cp-chart-tabs" role="tablist">';
    for (var i = 0; i < ch.metrics.length; i++) {
      html += '<button type="button" class="cp-tab" role="tab" data-metric="' + esc(ch.metrics[i].id) + '"' +
        (i === 0 ? ' aria-selected="true"' : ' aria-selected="false"') + '>' + esc(ch.metrics[i].label) + '</button>';
    }
    html += '</div></div><div class="cp-chart-body">';
    for (var j = 0; j < ch.metrics.length; j++) {
      html += '<div class="cp-chart-panel" data-panel="' + esc(ch.metrics[j].id) + '"' +
        (j === 0 ? '' : ' hidden') + '>' + renderChartSVG(ch.metrics[j], '') + '</div>';
    }
    html += '</div>';
    if (ch.latest) {
      html += '<p class="cp-chart-latest"><span class="cp-latest-dot" aria-hidden="true"></span>' +
        esc(ch.latest) + sup(ch.source || '') + '</p>';
    }
    html += '</div>';
    return html;
  }

  function renderFundingBlock(c) {
    if (!c.funding || !c.funding.rounds || !c.funding.rounds.length) return '';
    var html = '<div class="cp-funding"><h4>融资历程</h4>';
    if (c.funding.note) html += '<p class="cp-note">' + esc(c.funding.note) + '</p>';
    html += '<ol class="cp-rounds">';
    for (var i = 0; i < c.funding.rounds.length; i++) {
      var r = c.funding.rounds[i];
      html += '<li class="cp-round' + (i === 0 ? ' is-latest-round' : '') + '">' +
        '<span class="cp-round-dot" aria-hidden="true"></span>' +
        '<div class="cp-round-main"><p class="cp-round-title"><b>' + esc(r.round) + '</b>' +
        '<span class="cp-round-amount">' + esc(r.amount || '金额未公开') + '</span></p>' +
        '<p class="cp-round-meta">' + esc(r.investors || '') + '</p></div>' +
        '<span class="cp-round-date">' + esc(r.date) + '</span>' + sup(r.source || '') + '</li>';
    }
    html += '</ol></div>';
    return html;
  }

  /* ══════════════ 抽屉 ══════════════ */
  var drawer = null;    /* .cp-drawer 根节点（单例） */
  var lastFocus = null;

  function buildDrawer() {
    if (drawer) return drawer;
    drawer = document.createElement('div');
    drawer.className = 'cp-drawer';
    drawer.id = 'cpDrawer';
    drawer.hidden = true;
    drawer.innerHTML =
      '<div class="cp-backdrop" data-cp-close="1"></div>' +
      '<aside class="cp-panel" role="dialog" aria-modal="true" aria-labelledby="cpTitle">' +
      '  <button class="cp-close" type="button" data-cp-close="1" aria-label="关闭公司档案">✕</button>' +
      '  <div class="cp-panel-scroll" id="cpScroll"></div>' +
      '</aside>';
    document.body.appendChild(drawer);
    drawer.addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target.closest('[data-cp-close]') : null;
      if (t) { ev.preventDefault(); close(); return; }
      var tab = ev.target.closest ? ev.target.closest('.cp-tab') : null;
      if (tab) { switchTab(tab); return; }
      var img = ev.target.closest ? ev.target.closest('.cp-office-img img') : null;
      if (img) { openLightbox(img); }
    });
    drawer.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') close();
    });
    return drawer;
  }

  function switchTab(tab) {
    var wrap = tab.closest('.cp-chart');
    if (!wrap) return;
    var tabs = wrap.querySelectorAll('.cp-tab');
    var panels = wrap.querySelectorAll('.cp-chart-panel');
    for (var i = 0; i < tabs.length; i++) {
      var active = tabs[i] === tab;
      tabs[i].setAttribute('aria-selected', active ? 'true' : 'false');
    }
    var mid = tab.getAttribute('data-metric');
    for (var j = 0; j < panels.length; j++) {
      panels[j].hidden = panels[j].getAttribute('data-panel') !== mid;
    }
  }

  function kpiBlock(c) {
    var html = '<div class="cp-kpis">';
    (c.kpis || []).forEach(function (k) {
      html += '<div class="cp-kpi"><strong>' + esc(k.value) + sup(k.source || '') + '</strong>' +
        '<span>' + esc(k.label) + '</span>' +
        (k.sub ? '<em>' + esc(k.sub) + '</em>' : '') + '</div>';
    });
    return html + '</div>';
  }

  function sectionBlock(title, rows) {
    var html = '<section class="cp-sec"><h4 class="cp-sec-title">' + esc(title) + '</h4>';
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i].text) continue;
      html += '<div class="cp-row"><p class="cp-row-label">' + esc(rows[i].label) + '</p>' +
        '<p class="cp-row-text">' + esc(rows[i].text) + sup(rows[i].source || '') + '</p></div>';
    }
    return html + '</section>';
  }

  function recognitionBlock(c) {
    if (!c.recognition || !c.recognition.length) return '';
    var html = '<section class="cp-sec"><h4 class="cp-sec-title">行业知名度与客户</h4><ul class="cp-recog">';
    c.recognition.forEach(function (r) {
      html += '<li><p class="cp-recog-t">' + esc(r.title) + '</p>' +
        '<p class="cp-recog-d">' + esc(r.detail) + sup(r.source || '') + '</p></li>';
    });
    return html + '</ul></section>';
  }

  function bossProfileBlock(c) {
    var b = c.bossProfile;
    if (!b) return '';
    var src = b.source || '';
    var html = '<section class="cp-sec"><h4 class="cp-sec-title">' +
      esc(b.platformTitle || '招聘平台档案 · BOSS直聘') + '</h4>';
    var quick = [
      { label: '在招职位', value: b.openJobs ? (b.openJobs + ' 个') : '' },
      { label: '招聘 Boss', value: b.recruiters ? (b.recruiters + ' 位') : '' },
      { label: '行业标签', value: b.industryTag },
      { label: '团队规模', value: b.scaleTag },
      { label: '融资标签', value: b.financingTag },
      { label: '工作时间', value: b.workTime }
    ].filter(function (x) { return x.value; });
    if (quick.length) {
      html += '<div class="cp-kpis">';
      quick.forEach(function (x) {
        html += '<div class="cp-kpi"><strong>' + esc(x.value) + '</strong><span>' + esc(x.label) + '</span></div>';
      });
      html += '</div>';
    }
    function tagList(arr) {
      return '<div class="cp-row"><p class="cp-row-text">' +
        (arr || []).map(function (x) { return '<span class="cp-pill">' + esc(x) + '</span>'; }).join(' ') +
        '</p></div>';
    }
    function line(label, text, withSource) {
      if (!text) return '';
      return '<div class="cp-row"><p class="cp-row-label">' + esc(label) + '</p><p class="cp-row-text">' +
        esc(text) + (withSource ? sup(src) : '') + '</p></div>';
    }
    function multi(label, arr, withSource) {
      if (!arr || !arr.length) return '';
      return '<div class="cp-row"><p class="cp-row-label">' + esc(label) + '</p><p class="cp-row-text">' +
        arr.map(function (m) { return esc(m); }).join('<br>') +
        (withSource ? sup(src) : '') + '</p></div>';
    }
    html += line('名称沿革', b.rename);
    html += line('平台简介', b.intro, true);
    html += line('工商口径', b.registryNote);
    html += line('口径说明', b.financingNote);
    html += multi('企业文化', b.culture, true);
    if (b.welfare && b.welfare.length) {
      html += '<div class="cp-row"><p class="cp-row-label">' +
        esc(b.welfareLabel || '福利标签') + '</p>' + tagList(b.welfare) + '</div>';
    }
    if (b.talentDevelopment && b.talentDevelopment.length) {
      html += '<div class="cp-row"><p class="cp-row-label">人才发展</p>' + tagList(b.talentDevelopment) + '</div>';
    }
    if (b.products && b.products.length) {
      html += '<div class="cp-row"><p class="cp-row-label">产品矩阵</p>' + tagList(b.products) + '</div>';
    }
    html += multi('产品与服务', b.productDetails);
    html += multi('发展历程', b.milestones, true);
    html += multi('平台荣誉', b.awards, true);
    if (b.foundingTeam && b.foundingTeam.length) {
      b.foundingTeam.forEach(function (f) {
        html += '<div class="cp-row"><p class="cp-row-label">' + esc(f.title) + '</p><p class="cp-row-text">' +
          '<b>' + esc(f.name) + '</b> · ' + esc(f.bio) + sup(src) + '</p></div>';
      });
    }
    html += multi('办公地点', b.offices, true);
    return html + '</section>';
  }

  function outlookBlock(c) {
    var o = c.outlook || {};
    if (!o.opportunities && !o.risks && !o.myTake) return '';
    function lis(arr) {
      return '<ul class="cp-outlook-list">' + (arr || []).map(function (x) {
        return '<li>' + esc(x) + '</li>';
      }).join('') + '</ul>';
    }
    return '<section class="cp-sec"><h4 class="cp-sec-title">发展前景</h4>' +
      '<div class="cp-outlook"><div class="cp-outlook-col"><p class="cp-outlook-h is-op">▚ 机会</p>' +
      lis(o.opportunities) + '</div>' +
      '<div class="cp-outlook-col"><p class="cp-outlook-h is-risk">▞ 风险</p>' + lis(o.risks) + '</div></div>' +
      (o.myTake ? '<div class="cp-mytake"><p class="cp-mytake-tag">我的判断（主观 · 站在求职者角度，非公司披露）</p><p>' +
        esc(o.myTake) + '</p></div>' : '') + '</section>';
  }

  /* 办公图相册：超过 3 张默认折叠（第 4 张起加 is-extra），
     按钮委托在 document 上 —— 抽屉与独立档案页共用同一份行为 */
  var OFFICE_FOLD = 3;

  function officeBlock(c) {
    if (!c.office || !c.office.length) return '';
    var many = c.office.length > OFFICE_FOLD;
    var html = '<section class="cp-sec"><h4 class="cp-sec-title">办公与环境</h4><div class="cp-office' +
      (many ? ' is-folded' : '') + '" data-cp-album>';
    c.office.forEach(function (o, i) {
      var extra = many && i >= OFFICE_FOLD ? ' is-extra' : '';
      if (o.img) {
        html += '<figure class="cp-office-img' + extra + '"><img src="' + esc(o.img) + '" alt="' + esc(o.alt || o.note || '') +
          '" loading="lazy"><figcaption>' + esc(o.note || '') + '</figcaption></figure>';
      } else {
        html += '<figure class="cp-office-img is-ph' + extra + '"><div class="cp-ph"><span class="cp-ph-code">' +
          esc(c.code || '') + '</span><span class="cp-ph-tag">照片待补充</span></div>' +
          '<figcaption>' + esc(o.note || '') + '</figcaption></figure>';
      }
    });
    html += '</div>';
    if (many) {
      html += '<button class="cp-album-toggle" type="button" data-cp-album-toggle aria-expanded="false">' +
        '展开全部 ' + c.office.length + ' 张 ↓</button>';
    }
    return html + '</section>';
  }

  function sourcesBlock(c) {
    var list = (c.sources || []).map(function (s) {
      return '<li><span class="cp-src-no">[' + esc(s.n) + ']</span>' +
        (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.name) + ' ↗</a>'
               : esc(s.name)) + '</li>';
    }).join('');
    return '<footer class="cp-sources"><p class="cp-src-title">数据来源（采集于 ' +
      esc(meta.collectedAt || '') + '）</p><ol>' + list + '</ol>' +
      (meta.disclaimer ? '<p class="cp-disclaimer">' + esc(meta.disclaimer) + '</p>' : '') +
      '</footer>';
  }

  function renderPanel(id) {
    var c = company(id);
    if (!c) return '<div class="cp-empty">未找到 ' + esc(id) + ' 的公司档案</div>';
    var reg = c.registry || {};
    var pills = [c.stage, c.scale, reg.hq].filter(Boolean)
      .map(function (p) { return '<span class="cp-pill">' + esc(p) + '</span>'; }).join('');
    var site = c.website ? '<a class="cp-site" href="' + esc(c.website.href) +
      '" target="_blank" rel="noopener noreferrer">' + esc(c.website.text) + ' ↗</a>' : '';
    var founded = reg.founded ? '<span class="cp-founded">成立于 ' + esc(reg.founded) + '</span>' : '';

    var stamp = c.logo
      ? '<span class="cp-stamp has-logo" aria-hidden="true"><img class="cp-stamp-logo" src="' +
        esc(c.logo) + '" alt=""></span>'
      : '<span class="cp-stamp" aria-hidden="true">' + esc(c.code || '') + '</span>';

    var html =
      '<header class="cp-head">' +
      '  <div class="cp-head-top">' +
      '    ' + stamp +
      '    <div class="cp-head-main">' +
      '      <h3 class="cp-title" id="cpTitle">' + esc(c.name) + '</h3>' +
      '      <p class="cp-sub">' + esc(c.industry || '') + (site ? ' · ' + site : '') +
                (founded ? ' · ' + founded : '') + '</p>' +
      '      <p class="cp-entity">' + esc(c.entity || c.name) + sup(reg.source || '') + '</p>' +
      (c.renameNote ? '      <p class="cp-entity">' + esc(c.renameNote) +
        sup((c.bossProfile || {}).source || '') + '</p>' : '') +
      '    </div>' +
      '  </div>' +
      '  <p class="cp-oneline">' + esc(c.oneLine || '') + '</p>' +
      '  <div class="cp-pills">' + pills + '</div>' +
      '</header>' +
      '<div class="cp-sec cp-sec-first">' + kpiBlock(c) + '</div>' +
      sectionBlock('公司在做什么', [
        { label: '主营业务', text: (c.business || {}).main },
        { label: '商业模式', text: (c.business || {}).model },
        { label: '行业位置', text: (c.business || {}).position },
        { label: '平台自述', text: (c.business || {}).bossIntro, source: (c.bossProfile || {}).source }
      ]) +
      (c.chart ? renderChartBlock(c) : '') +
      (c.funding ? renderFundingBlock(c) : '') +
      recognitionBlock(c) +
      bossProfileBlock(c) +
      outlookBlock(c) +
      officeBlock(c) +
      sourcesBlock(c);
    return html;
  }

  /* ══════════════ 开 / 关 / 深链 ══════════════ */
  var openedByHash = false;

  function open(id) {
    var c = company(id);
    if (!c) return;
    buildDrawer();
    drawer.querySelector('.cp-panel-scroll').innerHTML = renderPanel(id);
    drawer.querySelector('.cp-panel').setAttribute('data-cp-open-id', id);
    drawer.hidden = false;
    document.body.classList.add('cp-lock');
    drawer.querySelector('.cp-panel-scroll').scrollTop = 0;
    lastFocus = document.activeElement;
    var btn = drawer.querySelector('.cp-close');
    if (btn) btn.focus();
    /* replaceState：不产生历史记录、不触发滚动；首页锚点导航不受影响 */
    try { history.replaceState(null, '', '#company=' + encodeURIComponent(id)); } catch (e) { /* file:// 下可能受限，忽略 */ }
  }

  function close() {
    if (!drawer || drawer.hidden) return;
    drawer.hidden = true;
    document.body.classList.remove('cp-lock');
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    openedByHash = false;
    /* 关闭即清除 #company= 深链（replaceState 不触发 scroll/hashchange），
       避免刷新后抽屉再次弹出 */
    try {
      if ((location.hash || '').indexOf('#company=') === 0) {
        history.replaceState(null, '', location.pathname + location.search);
      }
    } catch (e) { /* file:// 下 replaceState 可能受限，忽略 */ }
  }

  function handleHash() {
    var m = (location.hash || '').match(/^#company=([a-z0-9_-]+)/i);
    if (m) {
      if (!company(m[1])) return;
      openedByHash = true;
      open(m[1]);
    } else if (drawer && !drawer.hidden && openedByHash) {
      close();
    }
  }

  /* ══════════════ 灯箱 ══════════════ */
  var lightbox = null;
  function openLightbox(img) {
    if (!lightbox) {
      lightbox = document.createElement('div');
      lightbox.className = 'cp-lightbox';
      lightbox.hidden = true;
      lightbox.innerHTML = '<button type="button" class="cp-lightbox-close" aria-label="关闭">✕</button><img alt="">';
      lightbox.addEventListener('click', function (ev) {
        if (ev.target === lightbox || ev.target.classList.contains('cp-lightbox-close')) closeLightbox();
      });
      document.body.appendChild(lightbox);
    }
    lightbox.querySelector('img').src = img.currentSrc || img.src;
    lightbox.querySelector('img').alt = img.alt || '';
    lightbox.hidden = false;
    document.body.classList.add('cp-lock');
  }
  function closeLightbox() {
    if (!lightbox) return;
    lightbox.hidden = true;
    if (drawer && !drawer.hidden) return; /* 抽屉还开着，保持锁定 */
    document.body.classList.remove('cp-lock');
  }

  window.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (lightbox && !lightbox.hidden) closeLightbox();
    else close();
  });

  /* ══════════════ 启动 ══════════════ */
  function start() {
    fillQuick();
    /* resume.html / index.html 双页面：委托全文档捕获徽章点击（含 main.js 动态渲染的卡片） */
    document.addEventListener('click', function (ev) {
      /* 公司名链接（a.cp-name-link）与历史徽章都走这里；拦截 <a> 默认跳转，
         由 open() 内的 replaceState 维护 #company= 深链 */
      var b = ev.target.closest ? ev.target.closest('[data-cp]') : null;
      if (!b) return;
      if (b.tagName === 'A') ev.preventDefault();
      if (drawer && !drawer.hidden && drawer.querySelector('.cp-panel').getAttribute('data-cp-open-id') === b.dataset.cp) {
        close(); /* 再点同一家公司 = 收起 */
        return;
      }
      lastFocus = b;
      open(b.getAttribute('data-cp'));
    }, true);
    /* 相册展开 / 收起：不绑定具体节点，抽屉与独立页复用 */
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest ? ev.target.closest('[data-cp-album-toggle]') : null;
      if (!t) return;
      var grid = t.closest('.cp-sec').querySelector('[data-cp-album]');
      if (!grid) return;
      var folded = grid.classList.toggle('is-folded');
      t.setAttribute('aria-expanded', folded ? 'false' : 'true');
      t.textContent = folded
        ? '展开全部 ' + grid.children.length + ' 张 ↓'
        : '收起相册 ↑';
    }, true);
    window.addEventListener('hashchange', handleHash);
    handleHash();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  /* 对外暴露：独立档案页（company.html）复用同一渲染函数，
     抽屉与独立页的数据、结构天然一致，改 JSON 一次两边同步。
     open / close 给首页 main.js 的既有调用方沿用。 */
  window.CompanyProfile = {
    render: renderPanel,
    get: company,
    list: function () { return Object.keys(companies).map(function (k) { return companies[k]; }); },
    meta: function () { return meta; },
    open: open,
    close: close
  };
})();
