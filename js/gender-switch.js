/* ════════════════════════════════════════════════════════════
   性别套装切换：头像 + 3D 模型 + AI 语音音色一起换
   - 套装映射只放非个人静态资源路径与音色兜底值；线上音色由 D1
     admin_config.ai_voice_male / ai_voice_female 决定，后台可改。
   - 入口：页面左下角可见按钮；键盘 G；控制台 window.setGender()
   - 默认性别取站点数据 hero.gender（云端可改），访客本地选择优先。
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var STORE = 'cp_gender_v2';
  var MAP = {
    male: {
      img: 'images/portrait.jpg',
      alt: '陈培胜——橙色连帽卫衣与黑框眼镜的半身插画肖像',
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

  function saved() {
    var qs = new URLSearchParams(location.search).get('gender');
    if (qs === 'male' || qs === 'female') return qs;
    try {
      var v = localStorage.getItem(STORE);
      if (v === 'male' || v === 'female') return v;
    } catch (e) {}
    if (window.CPAI_SKINS && window.CPAI_SKINS.current() === 'female3d') return 'female';
    var hero = window.SITE_DATA && window.SITE_DATA.hero;
    if (hero && (hero.gender === 'male' || hero.gender === 'female')) return hero.gender;
    return 'male';
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
    try { localStorage.setItem(STORE, g); } catch (e) {}
    document.documentElement.setAttribute('data-gender', g);
    window.CP_GENDER = g;
    window.CP_GENDER_VOICE = MAP[g].voice;   // 离线兜底；线上音色仍以 /api/voice?gender= 为准
    setAvatar(g);
    if (window.CPAI_SKINS) window.CPAI_SKINS.use(MAP[g].skin, silent);
    var btn = document.getElementById('genderToggle');
    if (btn) btn.textContent = '切到' + MAP[g === 'female' ? 'male' : 'female'].label;
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

  /* 可见切换按钮：左下角，和站点粗野主义风格一致 */
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'genderToggle';
  btn.title = '切换形象与语音套装（头像 / 3D 模型 / 音色）';
  btn.setAttribute('aria-label', '切换形象与语音套装');
  btn.style.cssText = 'position:fixed;left:12px;bottom:12px;' +
    'padding:5px 10px;border:2px solid #141311;border-radius:0;' +
    'background:#FFFCF4;color:#141311;font:11px/1.4 var(--font-mono, monospace);' +
    'cursor:pointer;z-index:99999;box-shadow:3px 3px 0 #141311;';
  btn.textContent = '切换套装';
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    apply(window.CP_GENDER === 'female' ? 'male' : 'female');
  });
  document.body.appendChild(btn);

  /* 键盘 G：同样的切换（输入框内不响应） */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'g' && e.key !== 'G') return;
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    apply(window.CP_GENDER === 'female' ? 'male' : 'female');
  });

  /* 控制台/外部调用入口 */
  window.setGender = function (g, opts) { apply(g, opts); };
  window.toggleGender = function () {
    apply(window.CP_GENDER === 'female' ? 'male' : 'female');
  };

  applyAfterRender(saved());
})();
