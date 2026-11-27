/* ════════════════════════════════════════════════════════════
   展示套装：头像 + 3D 模型 + AI 语音音色一起换
   - 套装映射只放非个人静态资源路径与音色兜底值；线上音色由 D1
     admin_config.ai_voice_male / ai_voice_female 决定，后台可改。
   - 套装由后台「展示套装」开关决定（admin_config.gender）；公开站
     不提供切换按钮、不绑快捷键、不写本地缓存。?gender= 仅作后台预览。
   - 优先级：?gender= 预览参数 > 后台配置 > 站点数据 hero.gender > 男版。
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var MAP = {
    male: {
      img: 'images/portrait.jpg',
      alt: '李清——橙色连帽卫衣与黑框眼镜的半身插画肖像',
      no: 'PHOTO NO.001',
      skin: 'self3d',
      voice: 101013,          // 兜底：D1 没配或离线预览时用
      label: '男版'
    },
    female: {
      img: 'images/avatar-female.png',
      alt: '温柔斯文版女性插画肖像——黑发马尾、方框眼镜、橙色衬衫',
      no: 'PHOTO NO.002',
      skin: 'female3d',
      voice: 101001,
      label: '女版'
    }
  };

  function defaultFromData() {
    var hero = window.SITE_DATA && window.SITE_DATA.hero;
    if (hero && (hero.gender === 'male' || hero.gender === 'female')) return hero.gender;
    return 'male';
  }

  function initial() {
    var qs = new URLSearchParams(location.search).get('gender');
    if (qs === 'male' || qs === 'female') return qs;
    return defaultFromData();
  }

  function setAvatar(g) {
    var m = MAP[g];
    var idcard = document.getElementById('idcardPhoto');
    var about = document.getElementById('aboutPhoto');
    var no = document.getElementById('aboutPhotoNo');
    if (idcard) { idcard.src = m.img; idcard.alt = m.alt; }
    if (about) { about.src = m.img; about.alt = m.alt; }
    if (no) no.textContent = m.no;
  }

  function apply(g, opts) {
    if (!MAP[g]) return;
    var silent = !!(opts && opts.silent);
    document.documentElement.setAttribute('data-gender', g);
    window.CP_GENDER = g;
    window.CP_GENDER_VOICE = MAP[g].voice;   // 离线兜底；线上音色仍以 /api/voice?gender= 为准
    setAvatar(g);
    if (window.CPAI_SKINS) window.CPAI_SKINS.use(MAP[g].skin, silent);
    if (!silent && window.AIVoiceCloud && typeof window.AIVoiceCloud.reloadVoice === 'function') {
      window.AIVoiceCloud.reloadVoice();
    }
  }

  /* 图片由 main.js 异步渲染，等它写完再覆盖 */
  function applyAfterRender(g) {
    var tries = 0;
    (function wait() {
      var idcard = document.getElementById('idcardPhoto');
      if ((idcard && idcard.getAttribute('src')) || tries++ > 120) apply(g, { silent: true });
      else setTimeout(wait, 30);
    })();
  }

  /* 后台配置：与 main.js 的 API_BASES 同一套线路规则。
     github.io 是纯静态站，/api/gender 本地必然 404；逐个尝试，拿到 JSON 才采用。 */
  function cloudBases() {
    var host = location.hostname || '';
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(host)) return [''];
    if (/\.github\.io$/i.test(host)) return ['https://qing-wander.pages.dev'];
    return ['', 'https://qing-wander.pages.dev'];
  }

  function loadCloud() {
    var qs = new URLSearchParams(location.search).get('gender');
    if (qs === 'male' || qs === 'female') return;   // 预览参数优先，不被后台配置覆盖
    var bases = cloudBases();
    (function next(i) {
      if (i >= bases.length) return;
      fetch(new URL(bases[i] + '/api/gender', location.href).href, { credentials: 'omit' }).then(function (r) {
        var ct = r.headers.get('content-type') || '';
        if (!r.ok || ct.indexOf('application/json') < 0) return next(i + 1);
        return r.json().then(function (d) {
          if (d && d.ok && (d.gender === 'male' || d.gender === 'female')) apply(d.gender, { silent: true });
          else next(i + 1);
        }, function () { next(i + 1); });
      }, function () { next(i + 1); });
    })(0);
  }

  /* 控制台/外部调用入口（调试用；公开站不挂任何 UI 入口） */
  window.setGender = function (g, opts) { apply(g, opts); };
  window.toggleGender = function () {
    apply(window.CP_GENDER === 'female' ? 'male' : 'female');
  };

  applyAfterRender(initial());
  loadCloud();
})();
