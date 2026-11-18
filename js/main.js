/* ════════════════════════════════════════════════════════
   求职作品集 · 数据驱动渲染 + 交互脚本
   数据源：data/site-data.json（唯一编辑源）
   - http(s) 环境读取 JSON 并渲染
   - 读取失败（文件缺失 / file:// 协议限制）→ 明确提示，不做示例数据兜底
    交互：导航 / 滚动进场 / 数字滚动 / 技能条 / 模态框 / Toast /
          风格彩蛋控制台
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ══════════════ 数据层 ══════════════ */

  /* 数据加载：优先用 index.html 头顶预载的同步快照 data/site-data.js（
     一次请求、可被 CDN 与浏览器缓存）；只有快照缺失时才回退请求 JSON。
     两者都拿不到就明确提示，不再回落到任何示例人物数据。 */
  function loadSiteData() {
    if (window.SITE_DATA) return Promise.resolve(window.SITE_DATA);
    return fetch('data/site-data.json?v=' + Date.now(), { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .catch(function (err) {
        try { console.error('[site-data] 数据加载失败：' + (err && err.message || '未知原因')); } catch (e) {}
        return null;
      });
  }

  /* ══════════════ 渲染层 ══════════════ */

  function $(id) { return document.getElementById(id); }

  /* ── Toast（分享卡、留言墙等场景共用的轻提示） ──
     注意：必须放在 IIFE 顶层。留言墙 initWall() 与 initInteractions() 是同级函数，
     若把 showToast 定义在 initInteractions 内部，留言墙调用时会 ReferenceError。 */
  var toastEl = null;
  var toastTimer = null;
  function showToast(msg, type) {
    if (!toastEl) toastEl = $('toast');
    if (!toastEl) return;
    toastEl.textContent = msg;
    /* ok / err / info 由 CSS 左边框色带区分；旧调用只传 msg 时保持中性 */
    toastEl.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2800);
  }
  function esc(s) { /* 文本转义（字段值默认按纯文本；需 HTML 的字段走 innerHTML） */
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderSite(d) {
    /* ── 全局 meta ── */
    if (d.meta) {
      if (d.meta.pageTitle) document.title = d.meta.pageTitle;
      if (d.meta.description) {
        var md = document.querySelector('meta[name="description"]');
        if (md) md.setAttribute('content', d.meta.description);
      }
      $('brandSub').innerHTML = d.meta.brandSub || '';
      if (d.meta.brandMark) {
        $('brandMark').innerHTML = esc(d.meta.brandMark) + '<span class="brand-dot">.</span>';
        $('footerBrandMark').innerHTML = esc(d.meta.brandMark) + '<span class="brand-dot">.</span>';
      }
      $('statusPill').innerHTML = '<i class="lamp lamp-green"></i>' + esc(d.meta.statusPill || '');
      if (d.meta.footer) {
        $('footerTagline').textContent = d.meta.footer.tagline || '';
        $('footerCopyright').textContent = d.meta.footer.copyright || '';
        $('footerCoord').textContent = d.meta.footer.coord || '';
      }
    }

    /* ── HERO ── */
    var h = d.hero || {};
    document.querySelectorAll('.hero-corner').forEach(function (el) {
      var i = parseInt(el.getAttribute('data-corners'), 10);
      el.textContent = (h.corners && h.corners[i]) || '';
    });
    $('heroTags').innerHTML = (h.tags || []).map(function (t) {
      return '<span class="tag ' + (t.cls || 'tag-orange') + '">' + esc(t.text) + '</span>';
    }).join('');
    var cn = esc(h.nameCn || '');
    $('heroNameCn').innerHTML = cn +
      '<i class="glitch-layer glitch-blue" aria-hidden="true">' + cn + '</i>' +
      '<i class="glitch-layer glitch-orange" aria-hidden="true">' + cn + '</i>';
    $('heroNameEn').textContent = h.nameEn || '';
    $('heroRole').innerHTML = esc(h.role || '') + ' <span class="role-slash">/</span> <span class="role-en">' + esc(h.roleEn || '').replace(/ /g, '&nbsp;') + '</span>';
    $('heroBio').textContent = h.bio || '';
    $('heroCta').innerHTML =
      '<a class="btn btn-solid" href="#projects">' + esc(h.ctaProjects || '查看作品') + ' <span class="btn-arrow" aria-hidden="true">▶▶</span></a>' +
      '<a class="btn btn-ghost" href="#jd">' + esc(h.ctaJd || 'JD 匹配') + ' <span class="btn-arrow" aria-hidden="true">▶</span></a>' +
      '<a class="btn btn-ghost" href="' + esc(h.resumeFile || 'resume.html') + '">' + esc(h.ctaResume || '查看简历') + ' <span class="btn-arrow" aria-hidden="true">▶</span></a>';
    $('heroStatus').textContent = h.statusMeta || '';
    var ic = h.idcard || {};
    $('idcardPhoto').src = ic.photo || '';
    $('idcardPhoto').alt = (h.nameCn || '') + '的个人形象照';
    $('idcardTitle').innerHTML = esc(ic.titleCn || '') + '<br><span>' + esc(ic.titleEn || '').replace(/ /g, '&nbsp;') + '</span>';
    $('idcardNo').textContent = ic.no || '';
    $('idcardStatus').textContent = ic.status || '';
    $('idcardFields').innerHTML = (ic.fields || []).map(function (f) {
      return '<div class="field ' + (f.cls || '') + '"><dt>' + esc(f.dt) + '</dt><dd>' + esc(f.dd) + '</dd></div>';
    }).join('');
    $('idcardFootCode').textContent = ic.footCode || '';

    /* ── MARQUEE（原实现为重复两遍拼接实现无缝循环） ── */
    var mq = esc(d.marquee || '');
    $('marqueeText').innerHTML = mq + mq;

    /* ── 关于我 ── */
    var ab = d.about || {};
    $('aboutPhoto').src = ab.photo || '';
    $('aboutPhoto').alt = ab.photoAlt || '';
    $('aboutPhotoNo').textContent = ab.photoNo || '';
    $('aboutStamp').innerHTML = ab.stamp || '';
    $('aboutLead').innerHTML = ab.lead || '';
    $('aboutParagraphs').innerHTML = (ab.paragraphs || []).map(function (t) {
      return '<p class="reveal">' + t + '</p>'; /* 段落支持 <strong> 等内联标记 */
    }).join('');
    $('aboutStats').innerHTML = (ab.stats || []).map(function (s) {
      return '<li class="reveal"><strong data-count="' + esc(s.count) + '"' +
        (s.suffix ? ' data-suffix="' + esc(s.suffix) + '"' : '') + '>0</strong><span>' + esc(s.label) + '</span></li>';
    }).join('');

    /* ── 求职意向 ── */
    $('objGrid').innerHTML = (d.objective && d.objective.cards || []).map(function (c) {
      return '<div class="obj-card ' + (c.cls || '') + ' reveal">' +
        '<span class="obj-tag">' + esc(c.tag) + '</span>' +
        (c.role ? '<h3 class="obj-role">' + esc(c.role) + '</h3><p class="obj-role-sub">' + esc(c.roleSub || '') + '</p>'
                : '<h3 class="obj-role-sm">' + esc(c.roleSm || '') + '</h3>') +
        '<p class="obj-desc">' + esc(c.desc || '') + '</p></div>';
    }).join('');

    /* ── 教育经历 ── */
    var ed = d.education || {}, em = ed.main || {};
    var eduMain =
      '<div class="edu-card reveal">' +
        '<div class="edu-card-head"><span class="edu-years">' + esc(em.time) + '</span>' +
        '<span class="tag ' + (em.tagCls || 'tag-orange') + '">' + esc(em.tag) + '</span></div>' +
        '<div class="edu-brand">' + (em.logo ? '<img class="edu-logo" src="' + esc(em.logo) + '" alt="' + esc(em.school) + ' 校徽">' : '') +
        '<h3 class="edu-school">' + esc(em.school) + '</h3></div>' +
        '<p class="edu-major">' + esc(em.major) + ' <span class="edu-en">' + esc(em.majorEn) + '</span></p>' +
        '<div class="edu-stats">' + (em.stats || []).map(function (s) {
          return '<div class="edu-stat ' + (s.cls || '') + '"><strong>' + esc(s.num) + '<span>' + esc(s.unit) + '</span></strong><em>' + esc(s.label) + '</em></div>';
        }).join('') + '</div>' +
        (em.notes || []).map(function (n, i) {
          return '<p class="edu-note' + (i > 0 ? ' edu-note-extra' : '') + '">' + esc(n) + '</p>';
        }).join('') +
      '</div>';
    var eduSides = '<div class="edu-side">' + (ed.sides || []).map(function (s) {
      return '<div class="edu-side-card reveal"><span class="side-no">' + esc(s.no) + '</span><h4>' + esc(s.title) + '</h4><p>' + esc(s.text) + '</p></div>';
    }).join('') + '</div>';
    $('eduGrid').innerHTML = eduMain + eduSides;

    /* ── 工作经历 ── */
    $('expList').innerHTML = (d.experience || []).map(function (x) {
      return '<article class="exp-card reveal">' +
        '<div class="exp-head"><div><h3 class="exp-company">' + esc(x.company) + '</h3>' +
        '<p class="exp-role">' + esc(x.role) + '</p></div><span class="exp-time">' + esc(x.time) + '</span></div>' +
        '<ul class="exp-points">' + (x.points || []).map(function (p) {
          return '<li>' + p + '</li>'; /* 要点支持 <strong> 内联标记 */
        }).join('') + '</ul>' +
        '<div class="exp-tags">' + (x.tags || []).map(function (t) {
          return '<span class="tag ' + (t.cls || '') + '">' + esc(t.text) + '</span>';
        }).join('') + '</div></article>';
    }).join('');

    /* ── 项目作品 ── */
    window.__PROJECTS__ = d.projects || [];
    $('projGrid').innerHTML = window.__PROJECTS__.map(function (p, i) {
      return '<article class="proj-card reveal" data-proj="' + i + '" tabindex="0" role="button" aria-label="查看项目 ' + esc(p.title) + ' 的详情">' +
        '<div class="proj-media"><img src="' + esc(p.img) + '" alt="' + esc(p.imgAlt) + '" width="640" height="360">' +
        '<span class="proj-no" aria-hidden="true">' + esc(p.no) + '</span>' +
        '<span class="proj-hover-ui" aria-hidden="true"><span class="proj-hover-btn">查看详情 <i>▶</i></span></span></div>' +
        '<div class="proj-body"><div class="proj-meta">' +
        '<span class="proj-co"' + (p.company ? '' : ' hidden') + '>' + esc(p.company || '') + '</span>' +
        (p.url
          ? '<a class="proj-link" href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer" aria-label="打开 ' + esc(p.title) + ' 线上产品">线上产品 ↗</a>'
          : (p.note ? '<span class="proj-note">' + esc(p.note) + '</span>' : '')) +
        '<span class="tag ' + (p.badgeCls || 'tag-orange') + '">' + esc(p.badge) + '</span>' +
        '<span class="proj-year">' + esc(p.year) + '</span></div>' +
        '<h3 class="proj-title">' + esc(p.title) + ' <span class="proj-title-en">' + esc(p.titleEn) + '</span></h3>' +
        '<p class="proj-desc">' + esc(p.desc) + '</p>' +
        '<div class="proj-stack">' + (p.stackTags || []).map(function (s) { return '<span>' + esc(s) + '</span>'; }).join('') + '</div></div></article>';
    }).join('');

    /* ── 个人作品（水平无缝自动滚动）── */
    var _worksCards = (d.works || []).map(function (w) {
      var up = w.status === 'upcoming';
      return '<article class="work-card' + (up ? ' work-upcoming' : '') + '">' +
        (up ? '<span class="work-badge">预告 · 规划中</span>' : '') +
        '<div class="work-head"><span class="work-no" aria-hidden="true">' + esc(w.no) + '</span>' +
        '<h3 class="work-title">' + esc(w.title) + '<span class="work-title-en">' + esc(w.titleEn) + '</span></h3></div>' +
        '<p class="work-desc">' + esc(w.desc) + '</p>' +
        '<div class="work-tech">' + (w.tech || []).map(function (t) {
          return '<span>' + esc(t) + '</span>';
        }).join('') + '</div>' +
        '<div class="work-links">' +
        (up
          ? '<span class="work-soon">规划中 · 敬请期待</span>'
          : ((w.github || w.live)
            ? (w.github ? '<a class="work-link work-gh" href="' + esc(w.github) + '" target="_blank" rel="noopener noreferrer" aria-label="查看 ' + esc(w.title) + ' 的 GitHub 源码">GitHub 源码 ↗</a>' : '') +
              (w.live ? '<a class="work-link" href="' + esc(w.live) + '" target="_blank" rel="noopener noreferrer" aria-label="在线访问 ' + esc(w.title) + '">在线访问 ↗</a>' : '')
            : '<span class="work-soon">内部项目 · 未公开源码</span>')) +
        '</div></article>';
    }).join('');
    /* 无缝滚动：卡片组重复两遍，track 平移 -50% 形成无限循环 */
    var _worksSet = '<div class="works-set">' + _worksCards + '</div>';
    var _wGrid = $('worksGrid');
    _wGrid.innerHTML = _worksSet + '<div class="works-set" aria-hidden="true">' + _worksCards + '</div>';
    /* 恒定速度：滚动时长 = 单组宽度 / 速度(px/s)，随内容多少自适应 */
    var _wSet = _wGrid.firstElementChild;
    if (_wSet) {
      _wGrid.style.setProperty('--scroll-duration', (_wSet.getBoundingClientRect().width / 110).toFixed(2) + 's');
    }
    /* 卡片对齐内容安全区：偏移 = 板块左缘到窗口 + 板块左内边距（随宽度自适应） */
    var _wSec = document.getElementById('works');
    if (_wSec) {
      var _wPad = _wSec.getBoundingClientRect().left + parseFloat(getComputedStyle(_wSec).paddingLeft);
      _wGrid.style.setProperty('--ws-pad', Math.max(0, Math.round(_wPad)) + 'px');
    }

    /* ── 专业技能 ── */
    var sk = d.skills || {};
    if (sk.rows && sk.rows.length) {
      $('skillBars').innerHTML = '<div class="cap-list">' + sk.rows.map(function (r) {
        return '<div class="cap" data-domain="' + esc(r.domain || 'mix') + '">' +
            '<div class="cap-left">' +
              '<div class="cap-head">' +
                '<span class="cap-dot" aria-hidden="true"></span>' +
                '<h3 class="cap-name">' + esc(r.name) + '</h3>' +
                (r.ref ? (r.refUrl
                  ? '<a class="tag cap-ref" href="' + esc(r.refUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(r.ref) + ' ↗</a>'
                  : '<span class="tag cap-ref">' + esc(r.ref) + '</span>') : '') +
              '</div>' +
              '<span class="cap-stack">' + esc(r.stack || '') + '</span>' +
            '</div>' +
            '<div class="cap-right">' +
              '<p class="cap-proof">' + esc(r.proof || '') + '</p>' +
            '</div>' +
          '</div>';
      }).join('') + '</div>';
    } else {
      $('skillBars').innerHTML = (sk.bars || []).map(function (b) {
        return '<div class="skill"><div class="skill-head"><span>' + esc(b.label) + '</span><b>' + esc(b.pct) + '</b></div>' +
          '<div class="skill-bar"><i data-w="' + esc(b.pct) + '"></i></div></div>';
      }).join('');
    }
    $('toolboxTitle').textContent = sk.toolboxTitle || '工具箱 TOOLBOX';
    if (sk.toolboxGroups && sk.toolboxGroups.length) {
      $('toolboxTags').innerHTML = sk.toolboxGroups.map(function (g) {
        return '<div class="cloud-group">' +
            '<div class="cloud-group-head">' + esc(g.label) + '</div>' +
            '<div class="cloud-tags">' + (g.tags || []).map(function (t) {
              return '<span class="tag tag-lg ' + (t.cls || '') + '">' + esc(t.text) + '</span>';
            }).join('') + '</div>' +
          '</div>';
      }).join('');
    } else {
      $('toolboxTags').innerHTML = (sk.toolbox || []).map(function (t) {
        return '<span class="tag tag-lg ' + (t.cls || '') + '">' + esc(t.text) + '</span>';
      }).join('');
    }
    $('skillsNote').textContent = sk.note || '';

    /* ── 获奖证书 ── */
    var aw = d.awards || {};
    $('certGrid').innerHTML = (aw.certs || []).map(function (c, i) {
      return '<figure class="cert-card reveal">' +
        '<div class="cert-media"><img src="' + esc(c.img) + '" alt="' + esc(c.alt) + '" width="620" height="446">' +
        '<span class="cert-stamp ' + (c.stampCls || '') + '" aria-hidden="true">' + esc(c.stamp || 'CERT-0' + (i + 1)) + '</span></div>' +
        '<figcaption><strong>' + esc(c.title) + '</strong><span>' + esc(c.sub) + '</span></figcaption></figure>';
    }).join('');
    $('awardList').innerHTML = (aw.list || []).map(function (a) {
      return '<li class="reveal"><span class="award-year">' + esc(a.year) + '</span>' +
        '<span class="award-name">' + esc(a.name) + '<span>' + esc(a.sub) + '</span></span></li>';
    }).join('');

    /* ── 联系方式 ── */
    var ct = d.contact || {};
    $('contactBig').innerHTML = ct.big || '';
    $('contactGrid').innerHTML = (ct.cards || []).map(function (c) {
      var inner = '<span class="contact-label">' + esc(c.label) + '</span>' +
        '<span class="contact-value">' + esc(c.value) + '</span>' +
        (c.mini ? '<span class="contact-mini">' + esc(c.mini) + '</span>' : '') +
        (c.plain ? '' : '<span class="pixel-arrow contact-arrow" aria-hidden="true">▶</span>');
      var wide = c.span ? ' contact-card-wide' : '';
      return c.plain || !c.href
        ? '<div class="contact-card contact-card-plain' + wide + ' reveal">' + inner + '</div>'
        : '<a class="contact-card' + wide + ' reveal" href="' + esc(c.href) + '"' +
          (/^https?:/.test(c.href) ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + inner + '</a>';
    }).join('');
    var cta = ct.cta || {};
    $('resumeCta').innerHTML =
      '<div class="resume-cta-text"><strong>' + esc(cta.title) + '</strong><p>' + esc(cta.desc) + '</p></div>' +
      '<a class="btn btn-solid btn-lg" href="' + esc(cta.resumeFile || 'resume.html') + '">' + esc(cta.btnDownload) + ' <span class="btn-arrow" aria-hidden="true">▶</span></a>' +
      '<a class="btn btn-ghost btn-lg" href="' + esc(cta.resumeFile || 'resume.html') + '" target="_blank">' + esc(cta.btnPreview) + '</a>';

    /* ── 留言墙（文案；列表与提交见交互层第 12 节） ── */
    var wl = d.wall || {};
    if ($('wallLead')) $('wallLead').innerHTML = wl.lead || '';
    /* 留言墙文案整包交给交互层；empty/closed 两个别名兼容旧版读取 */
    window.__WALL_TEXT = Object.assign({ empty: wl.emptyText || '', closed: wl.closedText || '' }, wl);
  }

  /* ══════════════ 交互层（渲染完成后初始化） ══════════════ */

  function initInteractions() {
    /* ── 1. 移动端菜单 ── */
    var menuBtn = $('menuBtn');
    var nav = $('nav');
    function closeMenu() {
      nav.classList.remove('open');
      menuBtn.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
    }
    menuBtn.addEventListener('click', function () {
      var isOpen = nav.classList.toggle('open');
      menuBtn.classList.toggle('open', isOpen);
      menuBtn.setAttribute('aria-expanded', String(isOpen));
    });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) closeMenu(); });
    window.addEventListener('resize', function () { if (window.innerWidth > 1280) closeMenu(); });

    /* ── 2. 导航当前区高亮 ── */
    var sections = ['about', 'objective', 'jd', 'experience', 'projects', 'works', 'skills', 'education', 'awards', 'contact', 'wall']
      .map(function (id) { return document.getElementById(id); })
      .filter(Boolean);
    var navLinks = Array.prototype.slice.call(nav.querySelectorAll('a[data-sec]'));
    function highlightNav() {
      var pos = window.scrollY + window.innerHeight * 0.32;
      var currentId = '';
      sections.forEach(function (sec) { if (sec.offsetTop <= pos) currentId = sec.id; });
      navLinks.forEach(function (link) { link.classList.toggle('active', link.dataset.sec === currentId); });
    }
    window.addEventListener('scroll', highlightNav, { passive: true });
    highlightNav();

    /* ── 3. 滚动进场动画 ── */
    var revealEls = document.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window) {
      var revealObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            revealObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
      revealEls.forEach(function (el) { revealObserver.observe(el); });
    } else {
      revealEls.forEach(function (el) { el.classList.add('in'); });
    }

    /* ── 4. 数字滚动动画 ── */
    function animateCount(el) {
      var target = parseInt(el.dataset.count, 10) || 0;
      var suffix = el.dataset.suffix || '';
      var duration = 1100;
      var start = null;
      function tick(ts) {
        if (!start) start = ts;
        var p = Math.min((ts - start) / duration, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased) + (p === 1 ? suffix : '');
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }
    var countEls = document.querySelectorAll('[data-count]');
    if ('IntersectionObserver' in window) {
      var countObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            animateCount(entry.target);
            countObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.6 });
      countEls.forEach(function (el) { countObserver.observe(el); });
    } else {
      countEls.forEach(function (el) { el.textContent = el.dataset.count + (el.dataset.suffix || ''); });
    }

    /* ── 5. 技能条填充 ── */
    var skillBars = document.querySelectorAll('.skill-bar i');
    if ('IntersectionObserver' in window) {
      var barObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var bar = entry.target;
            setTimeout(function () { bar.style.width = 'calc(' + bar.dataset.w + '% - 6px)'; }, 120);
            barObserver.unobserve(bar);
          }
        });
      }, { threshold: 0.4 });
      skillBars.forEach(function (bar) { barObserver.observe(bar); });
    } else {
      skillBars.forEach(function (bar) { bar.style.width = 'calc(' + bar.dataset.w + '% - 6px)'; });
    }

    /* ── 6. 项目详情模态框 ── */
    var PROJECTS = window.__PROJECTS__ || [];
    var modal = $('projModal');
    var modalImg = $('modalImg');
    var modalVideo = $('modalVideo');
    var videoPlay = $('videoPlay');
    var videoDur = $('videoDur');
    var modalNo = $('modalNo');
    var modalBadge = $('modalBadge');
    var modalYear = $('modalYear');
    var modalTitle = $('modalTitle');
    var modalDesc = $('modalDesc');
    var modalPoints = $('modalPoints');
    var modalStack = $('modalStack');
    var modalStats = $('modalStats');
    var modalLink = $('modalLink');
    var modalNote = $('modalNote');
    var lastFocused = null;

    /* 实战演示视频：暂停并复位（移除 src + load() 中止缓冲，回到插画封面态） */
    function resetVideo() {
      if (modalVideo) {
        try { modalVideo.pause(); } catch (err) {}
        modalVideo.removeAttribute('src');
        try { modalVideo.load(); } catch (err) {}
        modalVideo.hidden = true;
      }
      modalImg.hidden = false;
      if (videoPlay) videoPlay.hidden = true;
    }

    function openModal(index) {
      var p = PROJECTS[index];
      if (!p) return;
      resetVideo();
      modalImg.src = p.img;
      modalImg.alt = p.modalTitle + ' 项目封面';
      modalNo.textContent = p.no;
      modalBadge.textContent = p.badge;
      modalYear.textContent = p.yearDetail || p.year;
      modalTitle.textContent = p.modalTitle || p.title;
      modalDesc.textContent = p.modalDesc || p.desc;
      modalPoints.innerHTML = (p.points || []).map(function (t) { return '<li>' + t + '</li>'; }).join('');
      modalStack.textContent = p.stack;
      if (modalLink) {
        if (p.url) {
          modalLink.href = p.url;
          modalLink.hidden = false;
          modalLink.setAttribute('aria-label', '打开 ' + (p.modalTitle || p.title) + ' 线上产品');
        } else {
          modalLink.hidden = true;
          modalLink.removeAttribute('href');
        }
      }
      if (modalNote) {
        modalNote.textContent = p.url ? '' : (p.note || '');
        modalNote.hidden = !(modalNote.textContent);
      }
      modalStats.innerHTML = (p.stats || []).map(function (st) {
        return '<div><strong>' + esc(st.v) + '</strong><span>' + esc(st.s) + '</span></div>';
      }).join('');
      /* 实战演示视频：有 video 字段才启用（插画封面 + 播放按钮，preload=none 不点击零流量） */
      if (p.video && p.video.src && modalVideo && videoPlay) {
        modalVideo.src = p.video.src;
        modalVideo.poster = p.video.poster || p.img;
        modalVideo.setAttribute('aria-label', (p.modalTitle || p.title) + ' 实战演示视频');
        videoPlay.setAttribute('aria-label', '播放' + (p.modalTitle || p.title) + '实战演示视频');
        videoDur.textContent = p.video.duration ? '· ' + p.video.duration : '';
        videoPlay.hidden = false;
      }
      lastFocused = document.activeElement;
      modal.hidden = false;
      document.body.style.overflow = 'hidden';
      document.querySelector('.modal-close').focus();
    }
    function closeModal() {
      resetVideo();
      modal.hidden = true;
      document.body.style.overflow = '';
      if (lastFocused) lastFocused.focus();
    }
    if (videoPlay) {
      videoPlay.addEventListener('click', function () {
        if (!modalVideo || !modalVideo.getAttribute('src')) return;
        modalImg.hidden = true;
        videoPlay.hidden = true;
        modalVideo.hidden = false;
        var pr = modalVideo.play();
        if (pr && pr.catch) pr.catch(function () { /* 自动播放被拦截时控件已可见，可手动点播放 */ });
      });
    }
    document.querySelectorAll('.proj-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('a')) return; /* 卡片内的外链自行跳转 */
        openModal(parseInt(card.dataset.proj, 10));
      });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openModal(parseInt(card.dataset.proj, 10));
        }
      });
    });
    modal.addEventListener('click', function (e) {
      if (e.target.hasAttribute('data-close') || e.target.closest('[data-close]')) closeModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) closeModal();
    });

    /* ── 7. Toast：已提升到 IIFE 顶层（见 showToast），此处不再重复定义 ── */

    /* ── 9. 风格控制台（私人彩蛋：三连击页脚「FILE END — EOF」唤出） ── */
    var NAMES = { archive: 'ARCHIVE', blueprint: 'BLUEPRINT', newsprint: 'NEWSPRINT', noir: 'NOIR' };
    var THEME_ORDER = ['archive', 'blueprint', 'newsprint', 'noir'];
    var THEME_STORE = { mode: 'portfolio_theme_mode', manual: 'portfolio_theme_manual' };

    function storeGet(key) {
      try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function storeSet(key, val) {
      try { localStorage.setItem(key, val); } catch (e) {}
    }

    var ctl = document.createElement('div');
    ctl.className = 'theme-ctl';
    ctl.innerHTML =
      '<button class="theme-ctl-btn" id="themeNextBtn" title="切换到下一套风格（手动选择后锁定）">▸ STYLE · <b id="themeNowName"></b></button>' +
      '<button class="theme-ctl-btn" id="themeAutoBtn" title="暂停 / 恢复每日自动轮换">◌ AUTO · <b id="themeAutoState"></b></button>';
    document.body.appendChild(ctl);

    var themeNowName = $('themeNowName');
    var themeAutoState = $('themeAutoState');
    var themeAutoBtn = $('themeAutoBtn');

    function applyTheme(t) {
      document.documentElement.setAttribute('data-theme', t);
      themeNowName.textContent = NAMES[t] || t.toUpperCase();
    }
    function renderAutoState() {
      var manual = storeGet(THEME_STORE.mode) === 'manual';
      themeAutoState.textContent = manual ? 'OFF' : 'ON';
      themeAutoBtn.classList.toggle('off', manual);
    }

    var eggTimer = null, eggHits = 0, hideTimer = null;
    var eofEgg = $('eofEgg');
    if (eofEgg) {
      eofEgg.style.cursor = 'default';
      eofEgg.addEventListener('click', function () {
        eggHits++;
        if (eggHits === 1) {
          eggTimer = setTimeout(function () { eggHits = 0; }, 2000);
        }
        if (eggHits >= 3) {
          eggHits = 0;
          clearTimeout(eggTimer);
          ctl.classList.toggle('show');
          if (ctl.classList.contains('show')) {
            applyTheme(document.documentElement.getAttribute('data-theme'));
            renderAutoState();
            scheduleHide();
          }
        }
      });
    }
    function scheduleHide() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () { ctl.classList.remove('show'); }, 10000);
    }
    ctl.addEventListener('mouseenter', function () { clearTimeout(hideTimer); });
    ctl.addEventListener('mouseleave', function () { if (ctl.classList.contains('show')) scheduleHide(); });
    ctl.addEventListener('click', function () { if (ctl.classList.contains('show')) scheduleHide(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { clearTimeout(hideTimer); ctl.classList.remove('show'); }
    });

    $('themeNextBtn').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var next = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length];
      applyTheme(next);
      storeSet(THEME_STORE.mode, 'manual');
      storeSet(THEME_STORE.manual, next);
      renderAutoState();
      try { history.replaceState(null, '', location.pathname); } catch (e) {}
    });

    themeAutoBtn.addEventListener('click', function () {
      if (storeGet(THEME_STORE.mode) === 'manual') {
        storeSet(THEME_STORE.mode, 'auto');
        var n = new Date();
        var day = Math.floor((n - new Date(n.getFullYear(), 0, 0)) / 864e5);
        applyTheme(THEME_ORDER[day % THEME_ORDER.length]);
      } else {
        storeSet(THEME_STORE.mode, 'manual');
        storeSet(THEME_STORE.manual, document.documentElement.getAttribute('data-theme'));
      }
      renderAutoState();
      try { history.replaceState(null, '', location.pathname); } catch (e) {}
    });

    /* ── 10. 作品集分享卡（静态宣传图：竖版 / 方形，预览 + 下载） ── */
    /* 预览走 1080px 轻量 WebP（约 88KB/64KB，显示尺寸下与原图无可见差异），
       避免直拉 2160px 原图（591KB/395KB）在慢链路下拖长加载；
       WebP 加载失败（极旧浏览器或网络抖动）自动回退 256 色 PNG 预览；
       下载仍给 2160px 原图 PNG，保证分享场景最高清晰度。 */
    var SHARE_CARDS = [
      {
        file: 'images/陈培胜-作品集-分享卡-竖版.png',
        name: '陈培胜-作品集-分享卡-竖版.png',
        preview: 'images/陈培胜-作品集-分享卡-竖版-预览.webp',
        fallback: 'images/陈培胜-作品集-分享卡-竖版-预览.png'
      },
      {
        file: 'images/陈培胜-作品集-分享卡-方形.png',
        name: '陈培胜-作品集-分享卡-方形.png',
        preview: 'images/陈培胜-作品集-分享卡-方形-预览.webp',
        fallback: 'images/陈培胜-作品集-分享卡-方形-预览.png'
      }
    ];
    var shareBtn = $('shareBtn');
    var shareOverlay = $('shareOverlay');
    var shareImg = $('shareImg');
    var shareDownload = $('shareDownload');
    var shareCur = 0;

    function setShareCard(i) {
      shareCur = ((i % SHARE_CARDS.length) + SHARE_CARDS.length) % SHARE_CARDS.length;
      var c = SHARE_CARDS[shareCur];
      /* 预览失败 → 回退 PNG 预览（只回退一次，防循环） */
      shareImg.onerror = function () {
        if (shareImg.getAttribute('src') === c.preview) { shareImg.src = c.fallback; }
      };
      shareImg.src = c.preview;
      shareImg.alt = '陈培胜作品集分享卡' + (shareCur === 0 ? '（竖版）' : '（方形）');
      document.querySelectorAll('.share-tab').forEach(function (t, idx) {
        t.classList.toggle('on', idx === shareCur);
        t.setAttribute('aria-selected', idx === shareCur ? 'true' : 'false');
      });
    }

    function closeShare() {
      shareOverlay.hidden = true;
      document.body.style.overflow = '';
      shareImg.onerror = null;
      shareImg.removeAttribute('src');
    }

    if (shareBtn) {
      shareBtn.addEventListener('click', function () {
        setShareCard(0);
        shareOverlay.hidden = false;
        document.body.style.overflow = 'hidden';
      });
    }
    if (shareDownload) {
      shareDownload.addEventListener('click', function () {
        var c = SHARE_CARDS[shareCur];
        var a = document.createElement('a');
        a.href = c.file;
        a.download = c.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast('正在下载「' + (shareCur === 0 ? '竖版' : '方形') + '」分享卡');
      });
    }
    if (shareOverlay) {
      shareOverlay.addEventListener('click', function (e) {
        if (e.target === shareOverlay) closeShare();
      });
      var shareCloseBtn = $('shareClose');
      if (shareCloseBtn) shareCloseBtn.addEventListener('click', closeShare);
      var shareCancelBtn = $('shareCancel');
      if (shareCancelBtn) shareCancelBtn.addEventListener('click', closeShare);
      document.querySelectorAll('.share-tab').forEach(function (t, idx) {
        t.addEventListener('click', function () { setShareCard(idx); });
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !shareOverlay.hidden) closeShare();
      });
    }

    /* ── 11. CP.AI 简历问答助手（已接入后端：腾讯云 CloudBase 云函数 + 静态 RAG） ──
       链路：静态页 → CloudBase HTTP 网关 /chat → 云函数 resume-ai-chat
             → char-bigram TF-IDF 检索 knowledge/ 切片 → hy3 生成（带 <context> 约束）
       源码：functions/tencent/（index.js 业务主体 / prompt.js 提示词与拦截） */
    var AI_CONFIG = {
      endpoint: 'https://resume-ai-d9g7zghnxda2ee2cb-1307508155.ap-shanghai.app.tcloudbase.com/chat',
      timeout: 20000,       // 云函数执行超时 30s，前端留余量
      maxChars: 200,        // 与后端 MAX_QUESTION_CHARS 对齐
      welcome: '你好，我是 CP.AI —— 陈培胜的档案问答助手。<br>后端跑在 <b>CloudBase 云函数</b>上：先用 TF-IDF 在简历档案切片里召回相关段落，再交给大模型受约束生成答案，每次回答都会标注依据来源。<br>可以问我项目细节、技术栈、工作经历。',
      quickQuestions: ['主导过哪些 0→1 系统？', 'Agent 架构经验？', '技术栈与方向？', '联系方式？'],
      /* ── 主动性：停留 10 秒仍未开口，就主动把问题递到手边 ── */
      autoDelay: 10000,             // 展开面板的时刻（毫秒）
      autoTipAhead: 8500,           // 距展开还剩多久就冒自我介绍气泡 → 进页面约 1.5s 即打招呼
      autoCooldown: 30 * 60 * 1000, // 同一台设备 30 分钟内不再自动弹
      autoTip: '👋 我是 AI 简历问答助手，点我直接问～',
      autoLead: '我是 CP.AI，陈培胜的档案问答助手。<br>这页塞了 6 套系统、几十条技术细节，翻页挺慢——<b>直接问我更快</b>，回答都带原文出处。<br>不想打字就先点一个：',
      autoPrompts: [
        { q: '你主导过哪些 0→1 的系统？', label: '0→1 系统' },
        { q: 'Agent 架构这块你做到什么程度？', label: 'Agent 深度' },
        { q: '技术栈与方向？', label: '技术栈' }
      ],
      /* JD 匹配：与问答共用 /chat 端点，靠 mode 分流；长度/额度口径以 jd-match.js 为准 */
      jd: {
        minChars: 30,
        maxChars: 1500,
        samples: [
          { key: 'agent', label: 'Agent 岗' },
          { key: 'backend', label: '后端岗' },
          { key: 'solution', label: '售前岗' }
        ]
      }
    };
    var aiFab = $('aiFab');
    /* 「岗位匹配」独立脚本（js/jd-match.js）复用同一台云函数与同一个 /chat 端点 */
    window.CP_AI_ENDPOINT = AI_CONFIG.endpoint;
    var aiPanel = $('aiPanel');
    var aiCloseBtn = $('aiClose');
    var aiBody = $('aiBody');
    var aiInput = $('aiInput');
    var aiSend = $('aiSend');
    var aiQuick = $('aiQuick');
    var aiModeBar = $('aiModeBar');
    var aiReady = false;
    var aiBusy = false;
    var aiMode = 'qa';   /* 'qa' | 'jd'：同一端点两种问法 */

    function jdUI() { return window.CP_JD_UI || null; }
    function jdCfg() {
      var u = jdUI();
      return u ? u.config() : {
        minChars: AI_CONFIG.jd.minChars, maxChars: AI_CONFIG.jd.maxChars,
        timeout: 38000, quota: '每人 10 分钟 4 次'
      };
    }

    function aiScroll() { aiBody.scrollTop = aiBody.scrollHeight; }
    function aiAppendMsg(who, html) {
      var wrap = document.createElement('div');
      wrap.className = 'ai-msg ai-msg-' + who;
      wrap.innerHTML = '<span class="ai-msg-name">' + (who === 'bot' ? 'CP.AI' : 'YOU') + '</span>' +
        '<div class="ai-bubble">' + html + '</div>';
      aiBody.appendChild(wrap);
      aiScroll();
      return wrap;
    }
    function aiShowTyping() {
      var t = aiAppendMsg('bot', '<span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span>');
      t.classList.add('ai-typing');
      return t;
    }

    /* ── JD 模式：与问答共用端点 / 知识库 / 皮肤语音观察契约 ── */
    function aiSetMode(next) {
      if (next !== 'jd') next = 'qa';
      if (aiMode === next) return;
      aiMode = next;
      if (aiPanel) aiPanel.classList.toggle('ai-mode-jd', next === 'jd');
      if (aiModeBar) {
        aiModeBar.querySelectorAll('[data-ai-mode]').forEach(function (b) {
          var on = b.getAttribute('data-ai-mode') === next;
          b.classList.toggle('on', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      }
      if (aiInput) {
        aiInput.placeholder = next === 'jd'
          ? '粘贴岗位 JD（30–1500 字），逐条对照档案…'
          : '问问 CP.AI：他的 Agent 架构经验？';
        aiInput.setAttribute('aria-label', next === 'jd' ? '输入岗位 JD' : '输入你的问题');
      }
      if (aiSend) aiSend.setAttribute('aria-label', next === 'jd' ? '开始匹配 JD' : '发送问题');
      aiRenderQuick();
      if (next === 'jd') {
        aiAppendMsg('bot', '已切到 <b>JD 匹配</b>：粘贴岗位描述，我会拆成需求逐条对照档案证据，列出覆盖 / 部分 / 缺口与面试追问点。<br>一次 30–1500 字，' + jdCfg().quota + '；也可以点下面的示例直接填入。');
      }
      if (aiInput && aiPanel && !aiPanel.hidden) aiInput.focus();
    }

    function aiRenderQuick() {
      if (!aiQuick) return;
      if (aiMode === 'jd') {
        aiQuick.innerHTML = AI_CONFIG.jd.samples.map(function (s) {
          return '<button class="ai-chip" type="button" data-jd-sample="' + s.key + '">' + esc(s.label) + ' →</button>';
        }).join('') + '<button class="ai-chip ai-chip-mode" type="button" data-ai-mode="qa">← 问答</button>';
        return;
      }
      aiQuick.innerHTML = AI_CONFIG.quickQuestions.map(function (q) {
        return '<button class="ai-chip" type="button">' + esc(q) + '</button>';
      }).join('') + '<button class="ai-chip ai-chip-mode" type="button" data-ai-mode="jd">JD 匹配 ↗</button>';
      aiQuick.querySelectorAll('.ai-chip').forEach(function (chip) {
        if (chip.getAttribute('data-ai-mode')) return;
        chip.addEventListener('click', function () { aiSubmit(chip.textContent); });
      });
    }

    function aiSubmitJD(raw) {
      var u = jdUI();
      var cfg = jdCfg();
      var jd = String(raw || '').trim();
      if (jd.length < cfg.minChars) {
        aiAppendMsg('bot', '▍JD 太短了（' + jd.length + '/' + cfg.minChars + ' 字），贴完整的岗位职责与任职要求再发。');
        return;
      }
      if (jd.length > cfg.maxChars) {
        aiAppendMsg('bot', '▍JD 超过 ' + cfg.maxChars + ' 字，删掉公司介绍和福利段落再发。');
        return;
      }
      if (!u) {
        aiAppendMsg('bot', '▍JD 组件还没加载好，刷新页面再试；急的话用页面下方的「JD 匹配」区块。');
        return;
      }
      aiBusy = true;
      if (aiSend) aiSend.disabled = true;
      var flat = jd.replace(/\s+/g, ' ');
      var preview = flat.slice(0, 52) + (flat.length > 52 ? '…' : '');
      aiAppendMsg('user', esc(preview));
      var typing = aiShowTyping();
      var started = Date.now();
      u.request(jd).then(function (data) {
        typing.remove();
        var m = data.match || {}, o = m.overall || {};
        var score = Math.max(0, Math.min(100, Number(o.score) || 0));
        var n = (m.rows && m.rows.length) || 0;
        var req = Number(data.meta && data.meta.requirements) || 0;
        var coverage = req > n
          ? 'JD 拆出 ' + req + ' 条要求，合并为 ' + n + ' 个需求点'
          : '已逐条对照 ' + n + ' 个需求点';
        aiAppendMsg('bot', '覆盖度 <b>' + score + '/100</b>（' + esc(o.verdict || '已比对') + '），' + coverage + '。完整对照表在下面 ↓');
        aiAppendJDCard(data, (Date.now() - started) / 1000);
      }).catch(function (err) {
        typing.remove();
        aiAppendMsg('bot', '▍' + esc(u.errorText(err)));
      }).then(function () {
        aiBusy = false;
        if (aiSend) aiSend.disabled = false;
        if (aiPanel && !aiPanel.hidden && aiInput) aiInput.focus();
      });
    }

    function aiAppendJDCard(data, elapsed) {
      var m = data.match || {}, o = m.overall || {};
      var rows = Array.isArray(m.rows) ? m.rows : [];
      var stats = m.stats || {};
      var meta = data.meta || {};
      var score = Math.max(0, Math.min(100, Number(o.score) || 0));
      var band = score >= 80 ? 'high' : score >= 60 ? 'mid' : score >= 35 ? 'low' : 'none';
      var CN = { covered: '覆盖', partial: '部分', gap: '缺口' };
      var card = document.createElement('div');
      card.className = 'ai-jd-card';
      card._jdData = data;
      var html =
        '<div class="ai-jd-top">' +
          '<div class="ai-jd-score" data-band="' + band + '"><b>' + score + '</b><span>/100</span></div>' +
          '<div class="ai-jd-topmain">' +
            '<p class="ai-jd-verdict">' + esc(o.verdict || '已比对') + '</p>' +
            '<p class="ai-jd-sum">' + esc(o.summary || '已按 JD 逐条对照档案。') + '</p>' +
            '<div class="ai-jd-stats"><span class="s-c">覆盖 ' + (stats.covered || 0) + '</span>' +
              '<span class="s-p">部分 ' + (stats.partial || 0) + '</span>' +
              '<span class="s-g">缺口 ' + (stats.gap || 0) + '</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="ai-jd-meta">' + (meta.recalled || 0) + ' 段切片 · ' +
          (Number(meta.requirements) || rows.length) + ' 条要求 → ' + rows.length + ' 个需求点 · ' +
          elapsed.toFixed(1) + 's</div>' +
        '<div class="ai-jd-rows">';
      rows.forEach(function (r, i) {
        var st = CN[r.status] ? r.status : 'partial';
        var ev = Array.isArray(r.evidence) ? r.evidence.slice(0, 2) : [];
        var evHtml = ev.length ? ev.map(function (e) {
          var title = String(e.title || '').split('｜')[0].slice(0, 18);
          return '<li>' + esc(e.point) + '<span>' + esc(title) + '</span></li>';
        }).join('') : '<li class="none">无匹配证据</li>';
        html +=
          '<div class="ai-jd-item" data-status="' + st + '">' +
            '<div class="ai-jd-item-h"><span class="ai-jd-no">' + (i + 1 < 10 ? '0' : '') + (i + 1) + '</span>' +
              '<span class="ai-jd-badge">' + CN[st] + '</span><p>' + esc(r.req) + '</p></div>' +
            (r.gap && st !== 'covered' ? '<p class="ai-jd-gap">缺口：' + esc(r.gap) + '</p>' : '') +
            '<ul class="ai-jd-ev">' + evHtml + '</ul>' +
            (r.probe ? '<button class="ai-jd-probe" type="button" data-ai-probe="' + i + '">追问：' + esc(r.probe) + ' →</button>' : '') +
          '</div>';
      });
      html += '</div>' +
        '<div class="ai-jd-acts">' +
          '<button class="ai-jd-act" type="button" data-jd-copy="1">复制 Markdown ⧉</button>' +
          '<a class="ai-jd-act ai-jd-act-ghost" href="#jd">打开完整对照 ↗</a>' +
        '</div>' +
        '<p class="ai-jd-note">证据取自档案切片 · 缺口照实列出 · 点追问可直接问 CP.AI</p>';
      card.innerHTML = html;
      aiBody.appendChild(card);
      aiScroll();
      var copyBtn = card.querySelector('[data-jd-copy]');
      if (copyBtn) {
        copyBtn.addEventListener('click', function () {
          var u = jdUI();
          if (!u) return;
          var text = u.toMarkdown(data);
          var done = function (ok) {
            copyBtn.textContent = ok ? '已复制 ✓' : '复制失败';
            setTimeout(function () { copyBtn.textContent = '复制 Markdown ⧉'; }, 2000);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
          } else {
            var ta = document.createElement('textarea');
            ta.value = text; ta.setAttribute('readonly', '');
            ta.style.position = 'fixed'; ta.style.top = '-1000px';
            document.body.appendChild(ta); ta.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) {}
            document.body.removeChild(ta);
            done(ok);
          }
        });
      }
    }

    function aiOpenPanel(auto) {
      aiPanel.hidden = false;
      aiPanel.classList.add('opening');
      setTimeout(function () { aiPanel.classList.remove('opening'); }, 320);
      aiFab.setAttribute('aria-expanded', 'true');
      if (!aiReady) {
        aiReady = true;
        if (!auto) aiAppendMsg('bot', AI_CONFIG.welcome);
        aiRenderQuick();
      }
      /* 自动弹出时不抢焦点：移动端不弹键盘，桌面端不打断当前阅读位置 */
      if (!auto) setTimeout(function () { aiInput.focus(); }, 60);
    }
    function aiClosePanel() {
      aiPanel.hidden = true;
      aiFab.setAttribute('aria-expanded', 'false');
    }
    function aiSubmit(text) {
      var q = (typeof text === 'string' ? text : aiInput.value).trim();
      if (!q || aiBusy) return;
      if (aiMode === 'jd') { aiSubmitJD(q); return; }
      if (aiPanel) aiPanel.classList.remove('ai-quiet');
      aiBusy = true;
      aiSend.disabled = true;
      aiAppendMsg('user', esc(q));
      aiInput.value = '';
      aiInput.style.height = '';
      if (q.length > AI_CONFIG.maxChars) {
        aiAppendMsg('bot', '▍问题太长啦，' + AI_CONFIG.maxChars + ' 字以内就好。');
        aiBusy = false;
        aiSend.disabled = false;
        return;
      }
      var typing = aiShowTyping();
      askAI(q).then(function (data) {
        typing.remove();
        aiAppendMsg('bot', aiRenderAnswer(data));
      }).catch(function (err) {
        typing.remove();
        aiAppendMsg('bot', aiRenderError(err));
      }).then(function () {
        aiBusy = false;
        aiSend.disabled = false;
        if (!aiPanel.hidden) aiInput.focus();
      });
    }
    /* 真实请求：POST /chat，契约 { question } → { ok, answer, sources[], fallback } */
    function askAI(question) {
      var ctrl = (typeof AbortController === 'function' ? new AbortController() : null);
      var timer = null;
      var opts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question })
      };
      if (ctrl) opts.signal = ctrl.signal;

      return new Promise(function (resolve, reject) {
        if (ctrl) {
          timer = setTimeout(function () { ctrl.abort(); }, AI_CONFIG.timeout);
        }
        fetch(AI_CONFIG.endpoint, opts).then(function (r) {
          return r.text().then(function (txt) {
            var d = null;
            try { d = JSON.parse(txt); } catch (e) { d = null; }
            if (!d) { reject(new Error('bad_json')); return; }
            if (!r.ok || !d.ok) { reject(new Error(d.error || ('http_' + r.status))); return; }
            resolve(d);
          });
        }).catch(reject).then(function () {
          if (timer) clearTimeout(timer);
        });
      });
    }

    /* 答案文本：转义后把换行变 <br>，来源单独渲染成标签 */
    function aiRenderAnswer(data) {
      var html = esc(String(data.answer || '')).replace(/\r?\n/g, '<br>');
      if (data.sources && data.sources.length) {
        var tags = data.sources.slice(0, 3).map(function (s) {
          var label = esc(String(s.title || ''));
          if (label.length > 26) label = label.slice(0, 26) + '…';
          return '<span class="ai-src" title="' + esc(String(s.id || '')) + '">' + label + '</span>';
        }).join('');
        html += '<div class="ai-src-row"><span class="ai-src-label">依据</span>' + tags + '</div>';
      }
      return html;
    }

    function aiRenderError(err) {
      var code = (err && err.message) || '';
      if (code === 'rate_limited') return '▍问得有点急，隔一分钟再问我吧。';
      if (code === 'AbortError') return '▍响应超时了，稍等再试一次。';
      if (code === 'origin_denied' || code === 'bad_request') {
        return '▍通道拒绝了这次请求。可以直接邮件联系：shenge.work@gmail.com';
      }
      return '▍通道暂时不可用，请稍后再试，或邮件联系：shenge.work@gmail.com';
    }
    /* ── 主动性：停留 10 秒自动打招呼（每会话一次，同设备 30 分钟冷却） ──
       思路：先 4 秒后冒一个小气泡做预告，到 10 秒仍没被搭理才展开面板并递上三个入口；
       用户任何主动动作（点浮标 / 关面板 / 提问题 / 按 Esc）都视作"已接管"，立刻撤销自动行为。 */
    var aiAutoTimer = null;
    var aiTipTimer = null;
    var aiTipEl = null;
    var aiLastScroll = 0;
    var aiManual = false;

    function aiHideTip() {
      if (aiTipEl && aiTipEl.parentNode) aiTipEl.parentNode.removeChild(aiTipEl);
      aiTipEl = null;
    }
    function aiShowTip() {
      if (aiTipEl || !aiFab || !aiFab.parentNode) return;
      aiTipEl = document.createElement('div');
      aiTipEl.className = 'ai-fab-tip';
      aiTipEl.textContent = AI_CONFIG.autoTip;
      aiFab.parentNode.appendChild(aiTipEl);
    }
    function aiCancelAuto() {
      if (aiAutoTimer) { clearTimeout(aiAutoTimer); aiAutoTimer = null; }
      if (aiTipTimer) { clearTimeout(aiTipTimer); aiTipTimer = null; }
      aiHideTip();
    }
    function aiAutoOpen() {
      if (!aiPanel.hidden) return;
      aiHideTip();
      aiOpenPanel(true);
      aiPanel.classList.add('ai-quiet');
      var lead = aiAppendMsg('bot',
        AI_CONFIG.autoLead +
        '<div class="ai-greet-acts">' + AI_CONFIG.autoPrompts.map(function (p) {
          return '<button class="ai-greet-btn" type="button" data-ai-q="' + esc(p.q) + '">' +
            esc(p.label) + ' →</button>';
        }).join('') + '</div>');
      lead.classList.add('ai-greet');
      if (aiFab) {
        aiFab.classList.add('ai-fab-pulse');
        setTimeout(function () { aiFab.classList.remove('ai-fab-pulse'); }, 1700);
      }
    }
    function aiTryAutoOpen() {
      aiAutoTimer = null;
      if (aiManual || !aiPanel.hidden) return;
      if (document.hidden) { aiAutoTimer = setTimeout(aiTryAutoOpen, 3000); return; }
      /* 正在滚动/惯性滚动时不打断，等手停下来再弹 */
      if (Date.now() - aiLastScroll < 800) { aiAutoTimer = setTimeout(aiTryAutoOpen, 1400); return; }
      try {
        sessionStorage.setItem('cpai_auto', '1');
        localStorage.setItem('cpai_auto_ts', String(Date.now()));
      } catch (e) {}
      aiAutoOpen();
    }
    function aiScheduleAuto() {
      if (!aiFab || !aiPanel) return;
      try {
        if (sessionStorage.getItem('cpai_auto') === '1') return;
        var ts = parseInt(localStorage.getItem('cpai_auto_ts') || '0', 10);
        if (ts && (Date.now() - ts) < AI_CONFIG.autoCooldown) return;
      } catch (e) {}
      aiTipTimer = setTimeout(aiShowTip, Math.max(1200, AI_CONFIG.autoDelay - AI_CONFIG.autoTipAhead));
      aiAutoTimer = setTimeout(aiTryAutoOpen, AI_CONFIG.autoDelay);
    }

    window.addEventListener('scroll', function () { aiLastScroll = Date.now(); }, false);

    if (aiFab) {
      aiFab.addEventListener('click', function () {
        aiManual = true; aiCancelAuto();
        if (aiPanel.hidden) aiOpenPanel(); else aiClosePanel();
      });
    }
    if (aiCloseBtn) {
      aiCloseBtn.addEventListener('click', function () {
        aiManual = true; aiCancelAuto();
        aiClosePanel();
      });
    }
    if (aiSend) aiSend.addEventListener('click', function () { aiManual = true; aiCancelAuto(); aiSubmit(); });

    /* 模式栏 + 快捷 chips：问答 / JD 互切，JD 示例只填输入框不直接发 */
    function aiModeClick(e) {
      var btn = (e.target && e.target.closest) ? e.target.closest('[data-ai-mode]') : null;
      if (!btn) return false;
      e.preventDefault();
      aiManual = true; aiCancelAuto();
      aiSetMode(btn.getAttribute('data-ai-mode'));
      return true;
    }
    if (aiModeBar) aiModeBar.addEventListener('click', aiModeClick);
    if (aiQuick) {
      aiQuick.addEventListener('click', function (e) {
        if (aiModeClick(e)) return;
        var sample = (e.target && e.target.closest) ? e.target.closest('[data-jd-sample]') : null;
        if (!sample) return;
        e.preventDefault();
        aiManual = true; aiCancelAuto();
        var u = jdUI();
        var ex = u ? u.examples() : {};
        var key = sample.getAttribute('data-jd-sample');
        if (ex[key] && aiInput) {
          aiInput.value = ex[key];
          aiInput.style.height = Math.min(aiInput.scrollHeight, 88) + 'px';
          aiInput.focus();
        }
      });
    }
    /* 主动开场里的引导按钮统一走委托，点一下就等于替你问了一句 */
    if (aiBody) {
      aiBody.addEventListener('click', function (e) {
        var probe = (e.target && e.target.closest) ? e.target.closest('[data-ai-probe]') : null;
        if (probe) {
          e.preventDefault();
          var cardEl = probe.closest ? probe.closest('.ai-jd-card') : null;
          var rows = cardEl && cardEl._jdData && cardEl._jdData.match && cardEl._jdData.match.rows;
          var idx = parseInt(probe.getAttribute('data-ai-probe'), 10);
          var q = rows && rows[idx] && rows[idx].probe;
          if (q) { aiSetMode('qa'); aiSubmit(q); }
          return;
        }
        var btn = (e.target && e.target.closest) ? e.target.closest('[data-ai-q]') : null;
        if (!btn) return;
        e.preventDefault();
        aiManual = true; aiCancelAuto();
        aiSubmit(btn.getAttribute('data-ai-q'));
      });
    }
    if (aiInput) {
      aiInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiManual = true; aiCancelAuto(); aiSubmit(); }
      });
      aiInput.addEventListener('input', function () {
        aiInput.style.height = 'auto';
        aiInput.style.height = Math.min(aiInput.scrollHeight, 88) + 'px';
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && aiPanel && !aiPanel.hidden) {
        aiManual = true; aiCancelAuto();
        aiClosePanel();
      }
    });

    aiScheduleAuto();
  }

  /* ── 12. 留言墙（Cloudflare Pages Function /api/wall，D1 存储） ──
     分页 / 刷新 / 新留言轮询 / 加载与错误态 / 快捷键 / 站长诊断 / 人机校验。
     file:// 或两条线路都不通 → 明确降级，不影响页面其余部分。 */
  function initWall() {
    var form = $('wallForm');
    if (!form) return;
    var listEl = $('wallList');
    var nameEl = $('wallName');
    var textEl = $('wallText');
    var countEl = $('wallCount');
    var submitBtn = $('wallSubmit');
    var totalEl = $('wallTotal');
    var noteEl = $('wallNote');
    var moreBtn = $('wallMore');
    var newBtn = $('wallNew');
    var refreshBtn = $('wallRefresh');
    var tipEl = $('wallFormTip');
    var T = window.__WALL_TEXT || {};
    var LIMIT = 20;
    var POLL_MS = 60000;
    var debugOn = /(?:^|[?&])wallDebug=1(?:&|$)/.test(location.search);

    /* 人机校验（Cloudflare Turnstile，2026-11-19 接入）
       · widget 懒渲染：脚本没到就轮询等待，最多 ~8 秒，超时视为不可用
       · 脚本被墙 / 加载失败 → 容器保持 hidden，提交不带 token，
         服务端会自动降到严格额度（每 IP 每小时 1 条），留言仍然可用
       · sitekey 是公开值，放前端没问题；密钥只在 Pages 环境变量里 */
    var TS_SITEKEY = '0x4AAAAAAGHnx0m992aGGpUJ';
    var tsBox = $('wallTurnstile');
    var tsToken = '';
    var tsWidget = null;
    var tsRendered = false;

    function renderTurnstile() {
      if (!tsBox || tsRendered || !window.turnstile || typeof window.turnstile.render !== 'function') return;
      try {
        tsWidget = window.turnstile.render(tsBox, {
          sitekey: TS_SITEKEY,
          theme: 'light',
          size: 'normal',
          callback: function (t) { tsToken = String(t || ''); },
          'expired-callback': function () { tsToken = ''; },
          'error-callback': function () { tsToken = ''; tsBox.hidden = true; }
        });
        tsRendered = true;
        tsBox.hidden = false;
      } catch (e) {
        tsRendered = false;
        tsBox.hidden = true;
      }
    }
    (function waitTurnstile(n) {
      if (window.turnstile && typeof window.turnstile.render === 'function') { renderTurnstile(); return; }
      if ((n || 0) >= 40) return;
      setTimeout(function () { waitTurnstile((n || 0) + 1); }, 200);
    })();

    function resetTurnstile() {
      tsToken = '';
      if (tsWidget != null && window.turnstile && typeof window.turnstile.reset === 'function') {
        try { window.turnstile.reset(tsWidget); } catch (e) {}
      }
    }

    var state = {
      mode: 'loading',          /* loading | open | closed | error */
      messages: [], total: 0, hasMore: false,
      busy: false, refreshing: false, loadingMore: false,
      showNew: false, latestId: null, highlightId: null, myIds: [],
      updatedAt: 0, base: '', status: 0, reason: '', closedMsg: '', errorMsg: ''
    };
    try { /* 本次会话自己贴的留言，刷新后仍能标「· 我」 */
      var saved = JSON.parse(sessionStorage.getItem('cp-wall-myids') || '[]');
      if (Array.isArray(saved)) state.myIds = saved.slice(-30);
    } catch (e) {}

    function escT(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    function tpl(str, vars) {
      return String(str == null ? '' : str).replace(/\{(\w+)\}/g, function (all, k) {
        return vars[k] == null ? '' : vars[k];
      });
    }
    function setText(el, s) { if (el) el.textContent = s; }
    function fmtTime(ts) {
      try {
        var dt = new Date(ts);
        var pad = function (n) { return (n < 10 ? '0' : '') + n; };
        return dt.getFullYear() + '.' + pad(dt.getMonth() + 1) + '.' + pad(dt.getDate()) + ' ' + pad(dt.getHours()) + ':' + pad(dt.getMinutes());
      } catch (e) { return ''; }
    }
    function clockTime(ts) {
      try {
        var dt = new Date(ts), pad = function (n) { return (n < 10 ? '0' : '') + n; };
        return pad(dt.getHours()) + ':' + pad(dt.getMinutes());
      } catch (e) { return ''; }
    }
    function relTime(ts) {
      var s = Math.max(0, Math.floor((Date.now() - Number(ts)) / 1000));
      if (!isFinite(s)) return '';
      if (s < 60) return T.timeNow || '刚刚';
      if (s < 3600) return tpl(T.timeMin || '{n} 分钟前', { n: Math.floor(s / 60) });
      if (s < 86400) return tpl(T.timeHour || '{n} 小时前', { n: Math.floor(s / 3600) });
      var d = Math.floor(s / 86400);
      return d < 7 ? tpl(T.timeDay || '{n} 天前', { n: d }) : fmtTime(ts);
    }

    /* API 双线路：GitHub Pages 只有静态文件，/api 不存在 →
       自动切到 Cloudflare Pages（同一份 functions/api，github.io 已列入来源白名单）。
       本地预览只打本机，避免测试留言被写进线上。 */
    var API_BASES = (function () {
      var host = location.hostname || '';
      if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(host)) return [''];
      if (/\.github\.io$/i.test(host)) return ['https://shenge-work.pages.dev'];
      return ['', 'https://shenge-work.pages.dev'];
    })();

    /* 依次尝试线路；404/405 或非 JSON（静态主机把 /api 当文件返回）视为该线路没有 API。
       serverFailover 只给 GET 用：POST 收到 5xx 时不能盲目换线路重试，可能重复写入。 */
    function apiFetch(path, opts, serverFailover) {
      var i = 0, tried = {}, usedBase = '';
      function next() {
        if (i >= API_BASES.length) return Promise.reject(new Error('no_api'));
        var base = API_BASES[i++];
        var url = new URL(base + path, location.href).href;
        if (tried[url]) return next();
        tried[url] = 1;
        usedBase = base || '(同源)';
        return fetch(url, opts).then(function (r) {
          var ct = r.headers.get('content-type') || '';
          if (r.status === 404 || r.status === 405 || ct.indexOf('application/json') < 0) return next();
          if (serverFailover && r.status >= 500) return next();
          return r.json().then(function (j) {
            return { ok: r.ok, status: r.status, body: j, base: usedBase };
          });
        }, function () { return next(); });
      }
      return next();
    }

    function renderSkeleton() {
      if (!listEl) return;
      var card = '<div class="wall-skeleton"><div class="wall-skeleton-line short"></div>' +
        '<div class="wall-skeleton-line"></div><div class="wall-skeleton-line mid"></div></div>';
      listEl.innerHTML = card + card + card;
    }
    function renderClosed(text) {
      if (listEl) listEl.innerHTML = '<p class="wall-empty">' +
        escT(text || state.closedMsg || T.closedText || T.closed || '留言墙暂未开放') + '</p>';
      if (newBtn) newBtn.hidden = true;
    }
    function syncFormEnabled() {
      if (submitBtn) submitBtn.disabled = (state.mode === 'closed' || state.busy);
    }
    function renderError(text) {
      if (!listEl) return;
      listEl.innerHTML = '<p class="wall-error">' +
        escT(text || state.errorMsg || T.errorText || '留言没能加载出来') +
        '<button type="button" id="wallRetry">' + escT(T.retryText || '重试') + '</button></p>';
    }
    function renderItems() {
      if (!listEl) return;
      if (!state.messages.length) {
        listEl.innerHTML = '<p class="wall-empty">' + escT(T.emptyText || T.empty || '还没有留言') + '</p>';
        return;
      }
      listEl.innerHTML = state.messages.map(function (m) {
        var cls = 'wall-item reveal in';
        if (m.id && m.id === state.highlightId) cls += ' is-new';
        if (m.id && state.myIds.indexOf(m.id) >= 0) cls += ' is-own';
        var iso = '';
        try { iso = new Date(m.ts).toISOString(); } catch (e) {}
        return '<article class="' + cls + '" data-id="' + escT(m.id) + '">' +
          '<div class="wall-item-head"><span class="wall-item-no">#' + escT(String(m.id || '').slice(-5)) + '</span>' +
          '<strong class="wall-item-name">' + escT(m.name || '匿名访客') + '</strong>' +
          '<time class="wall-item-time" data-ts="' + escT(String(m.ts)) + '" datetime="' + escT(iso) +
          '" title="' + escT(fmtTime(m.ts)) + '">' + escT(relTime(m.ts)) + '</time></div>' +
          '<p class="wall-item-text">' + escT(m.text) + '</p>' +
          '</article>';
      }).join('');
    }
    function updateBoardMeta() {
      var open = state.mode === 'open';
      setText(totalEl, open ? tpl(T.countText || '共 {n} 条留言', { n: state.total }) : '');
      var note = '';
      if (open) {
        note = tpl(T.shownText || '已显示 {shown} / {total} 条', { shown: state.messages.length, total: state.total });
        if (state.updatedAt) note += ' · ' + tpl(T.updatedText || '更新于 {time}', { time: clockTime(state.updatedAt) });
      }
      setText(noteEl, note);
      if (moreBtn) {
        moreBtn.hidden = !(open && state.hasMore);
        moreBtn.disabled = state.busy;
        moreBtn.textContent = state.loadingMore ? (T.moreLoadingText || '读取中…') : (T.moreText || '加载更早的留言 ▼');
      }
      if (newBtn) {
        newBtn.hidden = !(open && state.showNew);
        newBtn.textContent = T.newText || '有新留言 ▲';
      }
      if (refreshBtn) {
        refreshBtn.disabled = state.busy || state.mode === 'closed';
        refreshBtn.classList.toggle('is-loading', !!state.refreshing);
      }
    }
    function renderDebug() {
      if (!listEl || !listEl.parentNode) return;
      var old = listEl.parentNode.querySelector('.wall-debug');
      if (old) old.parentNode.removeChild(old);
      var lines = [
        '留言墙诊断 · ?wallDebug=1',
        'API 线路 : ' + (state.base || '（未发出请求）'),
        'HTTP     : ' + (state.status || '-'),
        'mode     : ' + state.mode,
        'open     : ' + (state.mode === 'open'),
        'reason   : ' + (state.reason || '-'),
        'total    : ' + state.total
      ];
      if (state.reason === 'kv_not_bound') {
        lines.push('', '→ Cloudflare Pages 未绑定 SITE_KV：Settings → Functions → KV namespace bindings 添加 SITE_KV，保存后重新部署。',
          '→ 一键自检：./scripts/wall-check.sh');
      } else if (state.reason === 'network_error') {
        lines.push('', '→ 两条线路都没拿到 JSON：检查网络，或确认 functions/api 已随站点部署。');
      } else if (state.reason === 'local_static') {
        lines.push('', '→ 当前是本地静态预览（无 /api）：改用 node scripts/dev-api-server.mjs 启动 8877 端口。');
      } else if (state.reason === 'file_protocol') {
        lines.push('', '→ 当前是 file:// 直开，请用「本地预览.command」启动 HTTP 服务。');
      }
      var box = document.createElement('div');
      box.className = 'wall-debug';
      box.textContent = lines.join('\n');
      listEl.parentNode.insertBefore(box, listEl);
    }
    function render() {
      if (nameEl) nameEl.disabled = (state.mode === 'closed');
      if (textEl) textEl.disabled = (state.mode === 'closed');
      syncFormEnabled();
      if (state.mode === 'loading') renderSkeleton();
      else if (state.mode === 'closed') renderClosed();
      else if (state.mode === 'error') renderError();
      else renderItems();
      updateBoardMeta();
      if (debugOn) renderDebug();
    }
    function applyPage(d, reset) {
      var page = Array.isArray(d.messages) ? d.messages : [];
      if (reset) {
        state.messages = page.slice();
      } else { /* 按 id 去重：翻页期间若有人插了新留言，避免重复卡片 */
        var seen = {};
        state.messages.forEach(function (m) { seen[m.id] = 1; });
        page.forEach(function (m) { if (!seen[m.id]) { seen[m.id] = 1; state.messages.push(m); } });
      }
      state.total = Number(d.total) || state.messages.length;
      state.hasMore = typeof d.hasMore === 'boolean' ? d.hasMore : (state.messages.length < state.total);
      state.latestId = state.messages.length ? state.messages[0].id : null;
      state.mode = 'open';
      state.updatedAt = Date.now();
    }

    /* keep：刷新时一次拉回当前已展开的条数，不让「刷新」把列表折叠回第一页 */
    function loadFirst(silent, keep) {
      if (state.busy) return Promise.resolve();
      state.busy = true;
      state.refreshing = !!silent;
      if (!silent) { state.mode = 'loading'; }
      render();
      var limit = Math.min(50, Math.max(LIMIT, keep || state.messages.length));
      return apiFetch('/api/wall?limit=' + limit + '&offset=0',
        { headers: { 'Accept': 'application/json' } }, true)
        .then(function (res) {
          state.status = res.status;
          state.base = res.base;
          var d = res.body || {};
          if (!res.ok || !d.ok) throw new Error('bad_response');
          if (d.open === false) {
            state.mode = 'closed';
            state.reason = d.reason || 'unknown';
            state.messages = []; state.total = 0; state.hasMore = false;
            state.showNew = false;
            render();
            return;
          }
          state.reason = '';
          state.showNew = false;
          applyPage(d, true);
          render();
        })
        .catch(function () {
          state.mode = 'error';
          /* 本地 8765 静态预览本来就没有 /api，给站长一句可执行的提示，而不是干巴巴的「加载失败」 */
          var isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(location.hostname || '');
          state.reason = isLocal ? 'local_static' : 'network_error';
          state.errorMsg = isLocal
            ? (T.localText || '本地静态预览没有留言 API · 要联调请运行 node scripts/dev-api-server.mjs 并打开 http://127.0.0.1:8877')
            : '';
          render();
        })
        .then(function () {
          state.busy = false;
          state.refreshing = false;
          syncFormEnabled();
          updateBoardMeta();
        });
    }
    function loadMore() {
      if (state.busy || state.mode !== 'open' || !state.hasMore) return;
      state.busy = true; state.loadingMore = true;
      updateBoardMeta();
      apiFetch('/api/wall?limit=' + LIMIT + '&offset=' + state.messages.length,
        { headers: { 'Accept': 'application/json' } }, true)
        .then(function (res) {
          var d = res.body || {};
          if (!res.ok || !d.ok || d.open === false) { showToast(T.errorText || '加载失败，稍后再试', 'err'); return; }
          applyPage(d, false);
          render();
        })
        .catch(function () { showToast(T.errorText || '加载失败，稍后再试', 'err'); })
        .then(function () {
          state.busy = false; state.loadingMore = false;
          syncFormEnabled(); updateBoardMeta();
        });
    }
    /* 轻量轮询：只取总数与最新 id，不传正文；有新留言时显示提示按钮，不打断阅读 */
    function peek() {
      if (state.busy || state.mode !== 'open') return;
      apiFetch('/api/wall?peek=1', { headers: { 'Accept': 'application/json' } }, true)
        .then(function (res) {
          var d = res.body || {};
          if (!res.ok || !d.ok || d.open === false) return;
          if (d.latest && d.latest.id && d.latest.id !== state.latestId && !state.showNew) {
            state.showNew = true;
            updateBoardMeta();
          }
        })
        .catch(function () {});
    }
    function updateTimes() {
      if (!listEl) return;
      listEl.querySelectorAll('.wall-item-time[data-ts]').forEach(function (el) {
        el.textContent = relTime(Number(el.getAttribute('data-ts')));
      });
    }
    function refresh() { state.showNew = false; loadFirst(true, state.messages.length); }
    function updateCount() {
      if (!countEl) return;
      var n = Array.from(textEl.value || '').length;
      countEl.textContent = n + ' / 300';
      countEl.classList.toggle('is-near', n > 270);
    }

    if (tipEl && T.tipText) setText(tipEl, T.tipText);
    if (moreBtn && T.moreText) setText(moreBtn, T.moreText);

    if (/^file:/.test(location.protocol)) {
      state.mode = 'closed';
      state.reason = 'file_protocol';
      state.closedMsg = T.fileText || '本地双击打开时留言墙不可用，请用「本地预览.command」启动 HTTP 服务';
      render();
      return;
    }

    loadFirst(false);

    if (refreshBtn) refreshBtn.addEventListener('click', refresh);
    if (newBtn) newBtn.addEventListener('click', refresh);
    if (moreBtn) moreBtn.addEventListener('click', loadMore);
    if (listEl) listEl.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'wallRetry') loadFirst(false);
    });
    if (textEl) textEl.addEventListener('input', updateCount);

    function quickSubmit(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (form.requestSubmit) form.requestSubmit();
        else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    }
    [nameEl, textEl].forEach(function (el) { if (el) el.addEventListener('keydown', quickSubmit); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (state.mode === 'closed') { showToast(T.closedText || '留言墙暂未开放', 'err'); return; }
      if (state.busy) return;
      var text = String(textEl.value || '').trim();
      if (!text) { showToast(T.emptyPostText || '先写点什么吧', 'err'); textEl.focus(); return; }
      if (Array.from(text).length < 2) { showToast(T.shortText || '再多写两个字吧（至少 2 个字）', 'err'); textEl.focus(); return; }
      var name = String(nameEl.value || '').trim();
      state.busy = true;
      submitBtn.disabled = true;
      var old = submitBtn.textContent;
      submitBtn.textContent = '发送中…';
      updateBoardMeta();
      apiFetch('/api/wall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, text: text, turnstileToken: tsToken })
      })
        .then(function (res) {
          var d = res.body || {};
          if (res.ok && d.ok) {
            applyPage(d, true);
            var first = state.messages[0];
            if (first && first.id) {
              state.highlightId = first.id;
              if (state.myIds.indexOf(first.id) < 0) state.myIds.push(first.id);
              try { sessionStorage.setItem('cp-wall-myids', JSON.stringify(state.myIds.slice(-30))); } catch (err) {}
            }
            state.showNew = false;
            textEl.value = '';
            nameEl.value = '';
            updateCount();
            resetTurnstile();
            showToast(d.duplicate ? (T.duplicateText || '这条留言刚刚已经贴过啦')
              : (T.postOkText || '已贴上留言墙，感谢你的想法 ▶'), d.duplicate ? 'info' : 'ok');
            render();
            if (listEl && listEl.firstElementChild && listEl.firstElementChild.scrollIntoView) {
              try { listEl.firstElementChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (err) {}
            }
          } else {
            var msg = d.message || T.postFailText || '留言失败，稍后再试';
            if (res.status === 429 && d.retryAfter) {
              msg += '（约 ' + Math.max(1, Math.ceil(Number(d.retryAfter) / 60)) + ' 分钟后）';
            }
            /* 被打到严格额度：多半是人机校验没通过，重置 widget 让访客能重新验证 */
            if (res.status === 429 && d.verifyRequired) resetTurnstile();
            showToast(msg, 'err');
          }
        })
        .catch(function () { showToast(T.netFailText || '网络异常，留言未能发送', 'err'); })
        .then(function () {
          state.busy = false;
          submitBtn.textContent = old;
          syncFormEnabled();
          updateBoardMeta();
        });
    });

    setInterval(function () {
      if (document.hidden || state.mode !== 'open') return;
      updateTimes();
      peek();
    }, POLL_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.mode === 'open') peek();
    });
  }

  /* ══════════════ 视口自适应 ══════════════
     1) --vw-real：真实内容视口宽度（排除 Windows 经典滚动条），供全幅区块使用
     2) 顶栏导航逐项退让：以右侧「分享 / 访问统计」区左边界为界，凡是被它遮住、
        无法完整显示的导航项一律隐藏；能完整显示几项就留几项（从最右侧起让位）。
        一项都放不下时才整体收成汉堡菜单，并在菜单里恢复全部入口。
        字体放大 / 浏览器缩放 / 翻译变长都走同一套几何判断，任何屏幕都不横向裁切。
     3) 裁决前先移除 .bar-tight 与隐藏标记，避免上一轮结果影响本轮判断而抖动。 */
  function syncResponsiveGuard() {
    var root = document.documentElement;
    var bar = document.querySelector('.topbar-inner');
    root.style.setProperty('--vw-real', root.clientWidth + 'px');
    if (!bar) return;
    var nav = document.getElementById('nav');
    var rightArea = document.querySelector('.topbar-right');
    var items = nav ? Array.prototype.slice.call(nav.querySelectorAll('a')) : [];
    if (!items.length) return;

    /* 复位：全部显示，按真实布局重新裁决 */
    document.body.classList.remove('bar-tight');
    for (var i = 0; i < items.length; i++) items[i].classList.remove('nav-item-hidden');

    /* 汉堡菜单展开时为竖排，逐项裁剪无意义且会误伤菜单里的入口，直接跳过 */
    if (window.getComputedStyle(nav).flexDirection === 'column') return;

    /* 分享 / 计数区左边界即「完整显示」的右极限；取不到则退回顶栏右内缘 */
    var limit = rightArea ? rightArea.getBoundingClientRect().left
                          : bar.getBoundingClientRect().right - 12;
    var tolerance = 1;

    function visibleItems() {
      return items.filter(function (a) { return !a.classList.contains('nav-item-hidden'); });
    }
    /* 当前最右侧仍越界的那一项；都在界内则返回 null */
    function rightmostCovered() {
      var vis = visibleItems();
      if (!vis.length) return null;
      var last = vis[vis.length - 1];
      return last.getBoundingClientRect().right > limit - tolerance ? last : null;
    }

    /* 从最右侧起逐项隐藏被遮住的导航项；隐藏后布局重排，循环内重新测量 */
    var covered;
    while ((covered = rightmostCovered())) {
      covered.classList.add('nav-item-hidden');
    }

    /* 一项都放不下 → 收成汉堡菜单，并在菜单里恢复全部入口 */
    if (!visibleItems().length) {
      for (var j = 0; j < items.length; j++) items[j].classList.remove('nav-item-hidden');
      document.body.classList.add('bar-tight');
      var menuEl = document.getElementById('menuBtn');
      if (menuEl) {
        menuEl.classList.remove('open');
        menuEl.setAttribute('aria-expanded', 'false');
      }
    }
  }
  syncResponsiveGuard();
  window.addEventListener('resize', syncResponsiveGuard, { passive: true });
  window.addEventListener('load', syncResponsiveGuard);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncResponsiveGuard);

  /* ══════════════ 启动 ══════════════ */
  /* 数据缺失时的最小提示：不借用任何示例人物数据 */
  function showDataError() {
    var box = document.createElement('div');
    box.className = 'data-error';
    box.innerHTML = '<strong>数据未能加载</strong><span>请按 ⌘/Ctrl + Shift + R 强制刷新；若仍空白，说明 data/site-data.js 没有随页面发布。</span>';
    document.body.insertBefore(box, document.body.firstChild);
  }

  loadSiteData().then(function (data) {
    if (!data) { showDataError(); return; }
    try {
      renderSite(data);
      initInteractions();
      initWall();
      syncResponsiveGuard(); /* 计数器数字位等动态内容渲染后再校一次 */
    } catch (err) {
      try { console.error('[site-data] 渲染失败：', err); } catch (e) {}
      showDataError();
    }
  });

})();
