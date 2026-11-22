/* ════════════════════════════════════════════════════════
   岗位匹配 / JD MATCH · 招聘方视角的对照表
   ────────────────────────────────────────────────────────
   数据链路：本页表单 → 云函数 POST { mode:'jd', jd }
            → 拆需求 / 逐条 TF-IDF 召回档案切片
            → 模型按固定结构输出 → 前端渲染对照表
   端点与问答助手共用（window.CP_AI_ENDPOINT，见 js/main.js 第 11 节），
   不额外引入后端；额度、长度与降级都在云函数侧兜底。
   ════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var form = document.getElementById('jdForm');
  var stage = document.getElementById('jdStage');

  var CFG = {
    /* 端点与问答助手共用；main.js 在数据渲染后才会写入 window.CP_AI_ENDPOINT，
       所以这里惰性读取，不依赖脚本加载顺序 */
    endpointFallback: 'https://resume-ai-d9g7zghnxda2ee2cb-1307508155.ap-shanghai.app.tcloudbase.com/chat',
    maxChars: 1500,
    minChars: 30,
    timeout: 38000,     // 云函数侧模型超时 26s，这里留网关与冷启动余量
    quota: '每人 10 分钟 4 次'
  };

  function endpoint() {
    return window.CP_AI_ENDPOINT || CFG.endpointFallback;
  }

  var STATUS_CN = { covered: '覆盖', partial: '部分', gap: '缺口' };

  /* 三个示例 JD：分别对应「技术深度匹配」「同栈不同赛道」「明显跨岗」，
     最后一个是故意留出缺口的——对照表敢列缺口，比满分更有说服力。 */
  var EXAMPLES = {
    agent: [
      '岗位：AI Agent 工程师（企业智能体平台）',
      '团队方向：把大模型能力做成可交付、可治理的企业级 Agent 产品。',
      '岗位职责：',
      '1. 负责 Agent 平台的架构设计与核心模块开发，包含任务规划、工具调用、多智能体编排与记忆管理；',
      '2. 建设 RAG 检索链路：文档解析、切片策略、向量检索、重排与召回效果评测；',
      '3. 负责 Agent 运行时的可观测与治理：调用链追踪、成本与配额控制、失败重试与降级；',
      '4. 与业务团队共建行业智能体（金融投研、营销获客、客服等场景），推动 PoC 到上线。',
      '任职要求：',
      '1. 本科及以上学历，3 年以上后端研发经验，熟悉 Java、Go 或 Python 之一；',
      '2. 熟悉 LLM 应用开发，理解 Prompt 工程、Function Calling、MCP 等机制；',
      '3. 有向量数据库（Milvus / Elasticsearch）使用与检索评测经验；',
      '4. 熟悉分布式系统与高并发服务，能独立完成模块从 0 到 1 落地。'
    ].join('\n'),

    backend: [
      '岗位：Java 后端工程师（金融科技 · 交易与网关方向）',
      '岗位职责：',
      '1. 负责交易网关与分布式服务的设计开发，保障高并发下的稳定性与一致性；',
      '2. 参与实时数据链路建设，基于 Kafka / Flink 完成流式计算与指标聚合；',
      '3. 负责服务治理：限流降级、熔断重试、链路追踪与容量评估；',
      '4. 配合前端与产品完成需求交付，参与技术方案评审与线上问题排查。',
      '任职要求：',
      '1. 本科及以上，3 年以上 Java 服务端开发经验，熟悉 Spring Cloud / Dubbo；',
      '2. 熟悉 MySQL、Redis、消息队列，具备分库分表与缓存设计经验；',
      '3. 有金融、支付或 SaaS 行业背景优先；',
      '4. 有 Kubernetes 与 CI/CD 落地经验优先。'
    ].join('\n'),

    solution: [
      '岗位：AI 解决方案工程师（售前 / 交付）',
      '岗位职责：',
      '1. 面向银行、券商、保险客户梳理业务场景，输出 AI Agent 解决方案与投标技术方案；',
      '2. 配合销售完成需求调研、方案汇报、POC 验证与竞品对比；',
      '3. 沉淀行业方案模板与最佳实践，向产研团队反馈需求；',
      '4. 支持项目交付，协调内外部资源推进上线。',
      '任职要求：',
      '1. 本科及以上，3 年以上 To B 解决方案或售前经验；',
      '2. 熟悉大模型与 Agent 的技术边界，能与客户技术负责人对话；',
      '3. 优秀的方案撰写与表达能力，能独立完成标书技术部分；',
      '4. 有金融行业客户资源或项目经验优先。'
    ].join('\n')
  };

  /* 对外工具：AI 助手面板的「JD 匹配」模式复用同一套请求 / 导出 / 错误文案，
     避免两处口径漂移。均为惰性引用，调用时 IIFE 已执行完，安全。 */
  window.CP_JD_UI = {
    config: function () {
      return { minChars: CFG.minChars, maxChars: CFG.maxChars, timeout: CFG.timeout, quota: CFG.quota };
    },
    examples: function () { return EXAMPLES; },
    request: function (jd) { return request(jd); },
    errorText: function (err) { return errorText(err); },
    toMarkdown: function (data) { return toMarkdown(data); }
  };

  if (!form || !stage) return;

  var textEl = document.getElementById('jdText');
  var countEl = document.getElementById('jdCount');
  var tipEl = document.getElementById('jdTip');
  var submitEl = document.getElementById('jdSubmit');
  var TIP_DEFAULT = tipEl ? tipEl.textContent : '';

  var state = { busy: false, lastData: null, elapsed: 0, ticker: null };

  /* ── 小工具 ── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function shortTitle(t) {
    var s = String(t || '').split('｜')[0].trim();
    return s.length > 24 ? s.slice(0, 24) + '…' : s;
  }
  function setTip(msg, kind) {
    if (!tipEl) return;
    tipEl.textContent = msg;
    tipEl.className = 'jd-form-tip' + (kind ? ' is-' + kind : '');
  }
  function resetTip() { setTip(TIP_DEFAULT, ''); }

  function updateCount() {
    if (!countEl) return;
    var n = textEl.value.length;
    countEl.textContent = n + ' / ' + CFG.maxChars;
    countEl.classList.toggle('is-near', n > CFG.maxChars * 0.9);
  }

  function setBusy(on) {
    state.busy = on;
    if (!submitEl) return;
    submitEl.disabled = on;
    submitEl.innerHTML = on ? '匹配中… <span aria-hidden="true">◌</span>' : '开始匹配 <span aria-hidden="true">▶</span>';
    form.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  function makeErr(code, msg) {
    var e = new Error(code || 'unknown');
    e.code = code || 'unknown';
    e.serverMessage = msg || '';
    return e;
  }

  function errorText(err) {
    var c = (err && err.code) || '';
    if (c === 'timeout') return '这次等太久了，模型可能正忙，稍后再点一次。';
    if (c === 'network') return '网络或通道异常，检查网络后重试；也可以直接邮件联系。';
    if (c === 'jd_quota') return 'JD 匹配' + CFG.quota + '，歇一会儿再来；急的话直接邮件：hi@chenpeisheng.cn';
    if (c === 'rate_limited') return '请求有点急，等十几秒再试。';
    if (c === 'parse_failed') return '模型这次没按结构输出，再点一次通常就好。';
    if (c === 'no_match') return '档案里没有和这份 JD 相关的资料，换个岗位试试。';
    if (c === 'bad_request') {
      var m = (err && err.serverMessage) || '';
      /* 线上云函数还没更新到支持 mode:'jd' 时，旧代码会报「缺少 question」 */
      if (m.indexOf('question') !== -1) return '后端云函数还是旧版本（不含 JD 匹配），重新部署 functions/tencent 后再试。';
      return m || 'JD 格式或长度不合要求，检查一下再提交。';
    }
    if (c === 'origin_denied') return '当前域名不在白名单里，本地预览请用 127.0.0.1:8000。';
    if (c === 'server_misconfig') return '后端的模型 Key 还没配置好，暂时无法匹配。';
    if (c === 'bad_json') return '通道返回了无法解析的内容，稍后再试。';
    return (err && err.serverMessage) || '匹配失败，稍后再试，或邮件联系：hi@chenpeisheng.cn';
  }

  /* ── 请求：POST { mode:'jd', jd } ── */
  function request(jd) {
    return new Promise(function (resolve, reject) {
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        if (ctrl) { try { ctrl.abort(); } catch (e) {} }
        reject(makeErr('timeout'));
      }, CFG.timeout);

      var opts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'jd', jd: jd })
      };
      if (ctrl) opts.signal = ctrl.signal;

      function done(fn, val) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(val);
      }

      fetch(endpoint(), opts).then(function (r) {
        return r.text().then(function (txt) {
          var d = null;
          try { d = JSON.parse(txt); } catch (e) { d = null; }
          if (!d) { done(reject, makeErr('bad_json')); return; }
          if (!r.ok || !d.ok) { done(reject, makeErr(d.error || ('http_' + r.status), d.message)); return; }
          done(resolve, d);
        });
      }).catch(function (e) {
        if (e && e.name === 'AbortError') done(reject, makeErr('timeout'));
        else done(reject, makeErr('network'));
      });
    });
  }

  /* ── 三态渲染：空态 / 加载 / 结果（错误复用空态样式） ── */
  function stopTicker() {
    if (state.ticker) { clearInterval(state.ticker); state.ticker = null; }
  }

  function renderLoading() {
    stage.innerHTML =
      '<div class="jd-loading">' +
        '<div class="jd-loading-head">' +
          '<span class="jd-empty-no">RUNNING</span>' +
          '<span class="jd-loading-time" id="jdElapsed">0.0s</span>' +
        '</div>' +
        '<p class="jd-loading-title">正在把 JD 逐条对照到档案上' +
          '<span class="jd-dots" aria-hidden="true"><i></i><i></i><i></i></span></p>' +
        '<div class="jd-progress" aria-hidden="true"><i></i></div>' +
        '<ul class="jd-loading-steps">' +
          '<li>拆解 JD 需求条目</li>' +
          '<li>在档案切片上召回</li>' +
          '<li>约束模型按结构输出对照表</li>' +
        '</ul>' +
        '<p class="jd-loading-note">首次调用可能冷启动，一般 8–20 秒；生成的是对照表，不是小作文。</p>' +
      '</div>';

    var t0 = Date.now();
    var el = document.getElementById('jdElapsed');
    stopTicker();
    state.ticker = setInterval(function () {
      if (!el) return;
      el.textContent = ((Date.now() - t0) / 1000).toFixed(1) + 's';
    }, 100);
  }

  function renderError(err) {
    stopTicker();
    stage.innerHTML =
      '<div class="jd-error">' +
        '<span class="jd-empty-no">FAILED</span>' +
        '<p class="jd-error-title">' + esc(errorText(err)) + '</p>' +
        '<p class="jd-error-note">已填的内容还在左边，可以直接再点一次「开始匹配」。</p>' +
        '<button class="jd-act" type="button" id="jdRetry">重试一次 ↻</button>' +
      '</div>';
    var retry = document.getElementById('jdRetry');
    if (retry) retry.addEventListener('click', submit);
  }

  function rowHtml(r, i) {
    var status = STATUS_CN[r.status] ? r.status : 'partial';
    var ev = Array.isArray(r.evidence) ? r.evidence : [];
    var evHtml = ev.length
      ? ev.map(function (e, k) {
          /* 后端 evidence.ratio 是切片与该条要求的覆盖率；兼容旧字段 ground */
          var ratio = Number(e.ratio != null ? e.ratio : e.ground) || 0;
          var title = '原始切片：' + String(e.title || '') + ' · 与原文重合 ' + Math.round(ratio * 100) + '%';
          var src = e.excerpt
            ? '<button class="jd-ev-src" type="button" data-ev-toggle="' + i + '-' + k + '"' +
              ' aria-expanded="false" title="' + esc(title) + ' · 点击展开原文">' +
              esc(shortTitle(e.title)) + ' <span class="jd-ev-caret" aria-hidden="true">▾</span></button>' +
              '<pre class="jd-ev-excerpt" id="jdEv-' + i + '-' + k + '" hidden>' + esc(e.excerpt) + '</pre>'
            : '<span class="jd-ev-src" title="' + esc(title) + '">' + esc(shortTitle(e.title)) + '</span>';
          return '<div class="jd-ev-item">' +
            '<p class="jd-ev-point">' + esc(e.point) + '</p>' +
            src +
          '</div>';
        }).join('')
      : '<span class="jd-none">无匹配证据</span>';

    var gap = r.status === 'covered'
      ? '<span class="jd-ok">—</span>'
      : esc(r.gap || '档案里没有直接对应');

    return '<div class="jd-row" data-status="' + status + '" role="row">' +
      '<span class="jd-row-no" aria-hidden="true">' + (i + 1 < 10 ? '0' : '') + (i + 1) + '</span>' +
      '<div class="jd-cell jd-req" role="cell" data-label="JD 要求"><div class="jd-cell-in">' +
        '<span class="jd-badge">' + STATUS_CN[status] + '</span>' +
        '<p>' + esc(r.req) + '</p>' +
      '</div></div>' +
      '<div class="jd-cell jd-ev" role="cell" data-label="对应证据"><div class="jd-cell-in">' + evHtml + '</div></div>' +
      '<div class="jd-cell jd-gap" role="cell" data-label="缺口"><div class="jd-cell-in">' + gap + '</div></div>' +
      '<div class="jd-cell jd-probe" role="cell" data-label="追问点"><div class="jd-cell-in">' +
        (r.probe ? '<span class="jd-quote">“' + esc(r.probe) + '”</span>' : '<span class="jd-none">—</span>') +
      '</div></div>' +
    '</div>';
  }

  function renderResult(data, elapsed) {
    stopTicker();
    state.lastData = data;
    state.elapsed = elapsed / 1000;

    var m = data.match || {};
    var o = m.overall || {};
    var rows = Array.isArray(m.rows) ? m.rows : [];
    var stats = m.stats || { covered: 0, partial: 0, gap: 0 };
    var meta = data.meta || {};
    var score = Math.max(0, Math.min(100, Number(o.score) || 0));
    var band = score >= 80 ? 'high' : score >= 60 ? 'mid' : score >= 35 ? 'low' : 'none';
    var tagCls = band === 'high' ? 'tag-orange' : band === 'mid' ? 'tag-blue' : '';

    stage.innerHTML =
      '<div class="jd-result">' +
        '<div class="jd-summary">' +
          '<div class="jd-score" data-band="' + band + '">' +
            '<span class="jd-score-num">' + score + '</span>' +
            '<span class="jd-score-max">/ 100</span>' +
            '<span class="jd-score-cap">档案覆盖度</span>' +
          '</div>' +
          '<div class="jd-summary-main">' +
            '<div class="jd-summary-top">' +
              '<span class="tag ' + tagCls + '">' + esc(o.verdict || '已比对') + '</span>' +
              '<span class="jd-summary-meta">' +
                (meta.recalled || 0) + ' 段切片 · ' +
                (meta.requirements || 0) + ' 条需求' +
                (meta.merged && meta.merged < meta.requirements ? ' → 合并为 ' + meta.merged + ' 个需求点' : '') + ' · ' +
                state.elapsed.toFixed(1) + 's' +
              '</span>' +
            '</div>' +
            '<p class="jd-summary-text">' + esc(o.summary || '已按 JD 逐条对照档案。') + '</p>' +
            '<div class="jd-stats">' +
              '<span class="jd-stat" data-status="covered"><b>' + (stats.covered || 0) + '</b>覆盖</span>' +
              '<span class="jd-stat" data-status="partial"><b>' + (stats.partial || 0) + '</b>部分</span>' +
              '<span class="jd-stat" data-status="gap"><b>' + (stats.gap || 0) + '</b>缺口</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="jd-table" role="table" aria-label="JD 需求与档案对照表">' +
          '<div class="jd-thead" role="row">' +
            '<span role="columnheader">#</span>' +
            '<span role="columnheader">JD 要求</span>' +
            '<span role="columnheader">对应证据</span>' +
            '<span role="columnheader">缺口</span>' +
            '<span role="columnheader">面试追问点</span>' +
          '</div>' +
          rows.map(rowHtml).join('') +
        '</div>' +
        '<div class="jd-actions">' +
          '<button class="jd-act" type="button" id="jdCopy">复制成 Markdown ⧉</button>' +
          '<button class="jd-act jd-act-ghost" type="button" id="jdAgain">换一份 JD ↺</button>' +
          '<span class="jd-foot-note">证据均取自本页档案切片 · 缺口照实列出，不做粉饰 · 点证据来源可展开原文核对</span>' +
        '</div>' +
        '<p class="jd-print-meta" hidden>来源：陈培胜求职作品集 · 岗位匹配（RAG 检索 + 约束生成）· 生成于 ' +
          new Date().toLocaleString('zh-CN', { hour12: false }) + ' · chenpeisheng.cn/jd.html</p>' +
      '</div>';

    var copyBtn = document.getElementById('jdCopy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var md = toMarkdown(data);
        copyText(md).then(function () {
          copyBtn.textContent = '已复制 ✓';
          setTimeout(function () { copyBtn.textContent = '复制成 Markdown ⧉'; }, 2000);
        }).catch(function () {
          copyBtn.textContent = '复制失败，请手动选';
        });
      });
    }
    var again = document.getElementById('jdAgain');
    if (again) {
      again.addEventListener('click', function () {
        form.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setTimeout(function () { textEl.focus(); }, 280);
      });
    }

    /* 结果在首屏外时带过去，别让人以为没反应 */
    var rect = stage.getBoundingClientRect();
    if (rect.top < 0 || rect.top > window.innerHeight * 0.75) {
      stage.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  /* ── Markdown 导出（贴到邮件 / 飞书都还算整齐） ── */
  function mdCell(s) {
    return String(s == null ? '' : s)
      .replace(/\|/g, '\\|')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\r?\n/g, ' ');
  }
  function toMarkdown(data) {
    var m = data.match || {};
    var o = m.overall || {};
    var rows = Array.isArray(m.rows) ? m.rows : [];
    var out = [];
    out.push('## 岗位匹配结果 · ' + (Number(o.score) || 0) + '/100（' + (o.verdict || '') + '）');
    if (o.summary) out.push('', '> ' + mdCell(o.summary));
    out.push('', '| # | JD 要求 | 状态 | 对应证据 | 缺口 | 面试追问点 |');
    out.push('|---|---|---|---|---|---|');
    rows.forEach(function (r, i) {
      var ev = (r.evidence || []).map(function (e) {
        return e.point + '（' + shortTitle(e.title) + '）';
      }).join('<br>');
      out.push('| ' + (i + 1) + ' | ' + mdCell(r.req) + ' | ' + (STATUS_CN[r.status] || '部分') + ' | ' +
        mdCell(ev || '—') + ' | ' + mdCell(r.gap || '—') + ' | ' + mdCell(r.probe || '—') + ' |');
    });
    out.push('', '---', '来源：陈培胜求职作品集 · 岗位匹配（RAG 检索 + 约束生成）https://chenpeisheng.cn/jd.html');
    return out.join('\n');
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('copy_failed'));
    });
  }

  /* ── 提交流程：断连 / 超时自动重试一次（与 AI 面板同策略），其余错误给手动重试 ── */
  function submit(isRetry) {
    if (state.busy) return;
    var jd = String(textEl.value || '').trim();
    if (jd.length < CFG.minChars) {
      setTip('JD 太短了，至少 ' + CFG.minChars + ' 字，才好逐条对照。也可以点上面的示例。', 'err');
      textEl.focus();
      return;
    }
    if (jd.length > CFG.maxChars) {
      setTip('JD 超过 ' + CFG.maxChars + ' 字，删掉公司介绍、福利等非要求段落再试。', 'err');
      return;
    }

    setBusy(true);
    setTip(isRetry ? '通道闪断，正在自动重试一次…' : '正在解析 JD 并逐条对照档案…', 'busy');
    renderLoading();

    var started = Date.now();
    request(jd).then(function (data) {
      renderResult(data, Date.now() - started);
      var n = data.match && data.match.rows ? data.match.rows.length : 0;
      setTip(isRetry
        ? '自动重试成功：' + n + ' 条需求已对照，证据均可回溯到档案切片。'
        : '匹配完成：' + n + ' 条需求已对照，证据均可回溯到档案切片。', 'ok');
    }).catch(function (err) {
      var code = (err && err.code) || '';
      /* 网络闪断 / 网关超时先自动重试一次，别让用户误以为功能坏了 */
      if (!isRetry && (code === 'network' || code === 'timeout')) {
        state.busy = false;
        if (submitEl) submitEl.disabled = false;
        setTimeout(function () { submit(true); }, 900);
        return;
      }
      renderError(err);
      setTip(errorText(err), 'err');
    }).then(function () {
      state.busy = false;
      if (submitEl) submitEl.disabled = false;
      form.removeAttribute('aria-busy');
      if (submitEl) submitEl.innerHTML = '开始匹配 <span aria-hidden="true">▶</span>';
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    submit();
  });

  if (textEl) {
    textEl.addEventListener('input', function () {
      updateCount();
      if (tipEl && tipEl.classList.contains('is-err')) resetTip();
    });
    textEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
      }
    });
  }

  var chips = document.getElementById('jdChips');
  if (chips) {
    chips.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-jd-sample]') : null;
      if (!btn) return;
      var key = btn.getAttribute('data-jd-sample');
      if (!EXAMPLES[key]) return;
      textEl.value = EXAMPLES[key];
      updateCount();
      resetTip();
      textEl.focus();
      try { textEl.setSelectionRange(0, 0); textEl.scrollTop = 0; } catch (err) {}
    });
  }

  /* 证据「点开核对」：点击切片来源展开 / 收起原文（互斥展开，避免滚来滚去） */
  stage.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('[data-ev-toggle]') : null;
    if (!btn) return;
    var pre = document.getElementById('jdEv-' + btn.getAttribute('data-ev-toggle'));
    if (!pre) return;
    var open = pre.hidden;
    /* 先收起同一张结果卡里已展开的，再开当前这条 */
    stage.querySelectorAll('.jd-ev-excerpt:not([hidden])').forEach(function (p) {
      if (p !== pre) {
        p.hidden = true;
        var b = stage.querySelector('[data-ev-toggle="' + p.id.replace('jdEv-', '') + '"]');
        if (b) { b.setAttribute('aria-expanded', 'false'); var c = b.querySelector('.jd-ev-caret'); if (c) c.textContent = '▾'; }
      }
    });
    pre.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    var caret = btn.querySelector('.jd-ev-caret');
    if (caret) caret.textContent = open ? '▴' : '▾';
  });

  updateCount();
  resetTip();
})();