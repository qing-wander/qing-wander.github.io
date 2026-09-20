/* ════════════════════════════════════════════════════════
   李清求职作品集 · 交互脚本
   导航 / 滚动进场 / 数字滚动 / 技能条 / 项目模态框 / Toast
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 1. 移动端菜单 ─────────────────────────── */
  const menuBtn = document.getElementById('menuBtn');
  const nav = document.getElementById('nav');

  function closeMenu() {
    nav.classList.remove('open');
    menuBtn.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
  }
  menuBtn.addEventListener('click', function () {
    const isOpen = nav.classList.toggle('open');
    menuBtn.classList.toggle('open', isOpen);
    menuBtn.setAttribute('aria-expanded', String(isOpen));
  });
  nav.addEventListener('click', function (e) {
    if (e.target.closest('a')) closeMenu();
  });
  window.addEventListener('resize', function () {
    if (window.innerWidth > 1024) closeMenu();
  });

  /* ── 2. 导航当前区高亮 ─────────────────────── */
  const sections = ['about', 'objective', 'education', 'experience', 'projects', 'skills', 'awards', 'contact']
    .map(function (id) { return document.getElementById(id); })
    .filter(Boolean);
  const navLinks = Array.prototype.slice.call(nav.querySelectorAll('a[data-sec]'));

  function highlightNav() {
    const pos = window.scrollY + window.innerHeight * 0.32;
    let currentId = '';
    sections.forEach(function (sec) {
      if (sec.offsetTop <= pos) currentId = sec.id;
    });
    navLinks.forEach(function (link) {
      link.classList.toggle('active', link.dataset.sec === currentId);
    });
  }
  window.addEventListener('scroll', highlightNav, { passive: true });
  highlightNav();

  /* ── 3. 滚动进场动画 ───────────────────────── */
  const revealEls = document.querySelectorAll('.reveal');
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

  /* ── 4. 数字滚动动画 ───────────────────────── */
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
    countEls.forEach(function (el) {
      el.textContent = el.dataset.count + (el.dataset.suffix || '');
    });
  }

  /* ── 5. 技能条填充 ─────────────────────────── */
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

  /* ── 6. 项目详情数据 ───────────────────────── */
    var PROJECTS = [
    {
      no: 'P-01',
      img: 'images/project-1.jpg',
      badge: '单据合规率 93%',
      year: '2023.06 — 2026.04 · 驻场财务支撑 · 独立负责',
      title: '费控中枢 EXPENSE HUB — 部门费用报销管控体系',
      desc: '在南方电网数字平台驻场期间独立搭起来的费用管控体系：覆盖 15 个部门的月度报销审核，从票据合规校验、费用台账编制，到异常数据分析和付款审批跟进，把「每一笔费用合规、可追溯」变成日常。',
      points: [
        '独立审核 15 个部门月度报销单据，严格校验票据合规性、费用标准与审批流程；',
        '月度编制费用台账，分析明细与异常数据，跟进付款审批及支付全流程；',
        '优化报销流程与制度执行，推动 3 项制度优化落地，有效降低业务端退回率；',
        '一对一反馈退回单据、讲解发票规范，组织业务部门财务培训。'
      ],
      stack: '费用审核 · 合规校验 · 费用台账 · 异常分析 · 制度优化 · 财务培训',
      stats: [
        { v: '93%', s: '单据合规率' },
        { v: '95%', s: '报销办理效率' },
        { v: '15 个', s: '覆盖部门' }
      ]
    },
    {
      no: 'P-02',
      img: 'images/project-2.jpg',
      badge: '账实相符',
      year: '2023.06 — 2026.04 · 驻场财务支撑 · 独立负责',
      title: '对账闭环 RECON LOOP — 供应商往来对账管理',
      desc: '供应商往来款项的常态化核对机制：定期与供应商核对往来款项、梳理应付账款明细，发现差异不放过——定位原因、跟进调整，直到闭环。月结前的往来账项清理，让账实相符、余额可追溯成为常态。',
      points: [
        '定期与供应商核对往来款项，梳理应付账款明细；',
        '跟进差异调整与对账闭环，不留给月结「历史遗留」；',
        '协助完成月度结账前往来账项清理，确保账实相符；',
        '与费控体系联动，付款审批与支付全流程可追溯。'
      ],
      stack: '往来核对 · 应付账款 · 差异调整 · 月结清理 · 账实核验',
      stats: [
        { v: '月度', s: '对账频率' },
        { v: '全量', s: '应付账款梳理' },
        { v: '闭环', s: '差异处理机制' }
      ]
    },
    {
      no: 'P-03',
      img: 'images/project-3.jpg',
      badge: '金蝶系统管理员',
      year: '2021.06 — 2026.04 · 跨两段经历 · 持续深耕',
      title: '系统桥梁 SYS BRIDGE — 金蝶运维与财务系统优化',
      desc: '从国地规划的金蝶系统管理员，到南方电网驻场时财务系统与业务端的「翻译」：一边维护账号权限与基础数据，一边收集各部门的系统问题与优化需求，分类同步运维、跟进工单，推动功能迭代上线并验证效果。',
      points: [
        '担任金蝶财务系统管理员：账号开通/注销、角色权限配置与申请审批；',
        '维护会计科目、客户/供应商档案、项目档案等系统基础数据；',
        '收集各部门系统问题与优化需求，分类整理同步运维，跟进工单处理；',
        '协调推动故障修复与功能迭代上线，验证优化效果后同步业务端。'
      ],
      stack: '金蝶运维 · 权限配置 · 基础数据 · 需求管理 · 工单跟进 · 功能迭代',
      stats: [
        { v: '2 套', s: '财务系统运维' },
        { v: '3 项', s: '制度优化落地' },
        { v: '双端', s: '业务与运维对接' }
      ]
    },
    {
      no: 'P-04',
      img: 'images/project-4.jpg',
      badge: '数据质量管控',
      year: '2026.05 — 2026.07 · 综合财务 · 项目制',
      title: '数据验收 PAYCHECK — 外包薪资验收数据管控',
      desc: '科锐国际项目制阶段的核心工作：外包员工薪资验收核对。对薪资应收数据做日常校验与整理，主动识别数据异常、定位差异原因，推动业务端完成问题闭环——目标是让验收数据零差错、按时落地。',
      points: [
        '负责外包员工薪资验收核对，对薪资应收数据日常校验与整理；',
        '逐项核查数据准确性，不放过任何一处可疑差异；',
        '主动识别薪资数据异常，定位差异原因；',
        '跟进并推动业务端完成问题闭环，保障验收按时落地。'
      ],
      stack: '数据校验 · 质量管控 · 异常识别 · 差异定位 · 问题闭环',
      stats: [
        { v: '100%', s: '应收数据逐项核查' },
        { v: '全流程', s: '差异定位到闭环' },
        { v: '按时', s: '验收落地保障' }
      ]
    }
  ];

  /* ── 7. 项目模态框 ─────────────────────────── */
  var modal = document.getElementById('projModal');
  var modalImg = document.getElementById('modalImg');
  var modalNo = document.getElementById('modalNo');
  var modalBadge = document.getElementById('modalBadge');
  var modalYear = document.getElementById('modalYear');
  var modalTitle = document.getElementById('modalTitle');
  var modalDesc = document.getElementById('modalDesc');
  var modalPoints = document.getElementById('modalPoints');
  var modalStack = document.getElementById('modalStack');
  var modalStats = document.getElementById('modalStats');
  var lastFocused = null;

  function openModal(index) {
    var p = PROJECTS[index];
    if (!p) return;
    modalImg.src = p.img;
    modalImg.alt = p.title + ' 项目封面';
    modalNo.textContent = p.no;
    modalBadge.textContent = p.badge;
    modalYear.textContent = p.year;
    modalTitle.textContent = p.title;
    modalDesc.textContent = p.desc;
    modalPoints.innerHTML = p.points.map(function (t) { return '<li>' + t + '</li>'; }).join('');
    modalStack.textContent = p.stack;
    modalStats.innerHTML = p.stats.map(function (st) {
      return '<div><strong>' + st.v + '</strong><span>' + st.s + '</span></div>';
    }).join('');
    lastFocused = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    document.querySelector('.modal-close').focus();
  }
  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
    if (lastFocused) lastFocused.focus();
  }

  document.querySelectorAll('.proj-card').forEach(function (card) {
    card.addEventListener('click', function () {
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

  /* ── 8. Toast（简历下载提示）──────────────── */
  var toast = document.getElementById('toast');
  var toastTimer = null;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 2600);
  }
  document.querySelectorAll('a[download]').forEach(function (link) {
    link.addEventListener('click', function () {
      showToast('简历已开始下载 — 如未触发，请右键「链接另存为」');
    });
  });

})();
