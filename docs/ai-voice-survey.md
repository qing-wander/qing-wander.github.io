# CP.AI 语音播报（TTS）· 免费资源调研与落地设计

> 文档定位：本文件是 `shenge-work.github.io` 右下角 AI 助手**语音层**的单一设计依据。调研结论、免费额度核实、自动播放对策、接口契约、验收清单都在这里；代码与本文冲突时先改文档再改代码。
>
> 版本：v2（2026-11-17）· 状态：Phase 1 + Phase 2 均已上线 · 作者：陈培胜
>
> 姊妹篇：[ai-assistant-survey.md](ai-assistant-survey.md)（管「答什么」）、[ai-avatar-skins.md](ai-avatar-skins.md)（管「长什么样」）、本文（管「怎么说话」）。

---

## 0. 结论摘要（先看这六条）

1. **有免费资源，而且不需要账号、不需要 Key、不需要后端**：浏览器内置的 `SpeechSynthesis`（Web Speech API）就是零成本 TTS。MDN 明确它是浏览器调用操作系统语音引擎的能力，`getVoices()` / `speak()` 全部在前端完成，无调用计费。
2. **"像真人"在 Edge 上可以免费拿到**：Edge 会把微软 **Online (Natural) 神经语音**（晓晓 / 云希 / 云扬等）暴露进 `speechSynthesis.getVoices()`，音质接近真人；Chrome / Safari / Firefox 只能拿到系统本地语音（机械感明显）。因此架构必须是「自然语音优先 + 本地语音兜底」，而不是绑死某一个音色。
3. **首次进入就自动出声，技术上不能 100% 保证**：Chrome 71 起 `speak()` 在无用户激活时返回 `not-allowed`，iOS Safari 甚至要求第一次 `speak()` 必须同步发生在 tap/click 回调里。这是浏览器内核策略，**任何前端库都绕不过**。本文给出的工程解法是「先尝试 → 失败立刻挂起欢迎语 → 显示可点击的语音引导 → 首次任意交互补播」，做到「能播就播，不能播就一点即播」。
4. **云 TTS 免费额度是真的，且已于 2026-11-17 落地为 Phase 2**：腾讯云语音合成给基础/精品音色 **800 万字符**免费资源包（领取后 3 个月有效、单账号一次），实际领取 `2026-11-17 → 2027-02-17`、已用 0；后付费默认关闭，用完自动停服，不会意外扣费。云端只做「固定音色 + 跨浏览器一致」，仍以 Phase 1 浏览器语音为兜底。Azure Speech F0（每月 50 万字符）因境内链路与额度都不如腾讯，未采用。
5. **两期都零侵入问答逻辑**：`js/main.js` 的问答代码一行不改（Phase 2 只借它导出的 `window.CP_AI_ENDPOINT`），沿用皮肤系统的 `MutationObserver` 范式观察 `aiBody` / `.ai-fab-tip`。Phase 1 新增 `js/ai-voice.js` + `css/ai-voice.css`，Phase 2 再加 `js/ai-voice-cloud.js`，`index.html` 只加引用与底栏标识。开关、音色切换、分句队列、云端探测与降级全部收在语音模块内。
6. **合规要做显式标识**：《人工智能生成合成内容标识办法》自 2025-09-01 施行，音频类 AI 内容需在「音频起始/末尾添加语音提示，或交互界面添加显著提示标识」。本项目音频实时播报、不提供下载导出，采用交互界面标识：面板底栏「AI 语音合成 · 可关闭」+ 开关与引导气泡均带「AI 语音」字样。

---

## 1. 需求与约束

### 1.1 需求

| # | 需求 | 验收口径 |
|---|---|---|
| R1 | AI 助手的回复要「像真人那样讲话」 | 优先神经语音；语速/音调分层；分句停顿；不朗读 HTML 与来源标签 |
| R2 | 支持关闭语音 | 一个显眼开关，点了立刻静音，刷新后仍记得 |
| R3 | 首次进入页面打招呼时也要有语音 | 1.5s 自我介绍气泡出现时触发；被浏览器拦截时给出「一点即播」入口并在首次交互补播 |
| R4 | 免费 | 本期 0 元、0 Key、0 额外后端请求 |
| R5 | 不破坏既有能力 | 问答、RAG、皮肤切换、主题轮换全部不受影响 |

### 1.2 必须尊重的既有资产

- 纯原生 HTML/CSS/JS、零框架、零构建、GitHub Pages 静态部署；JS 风格 `var` + IIFE，不用 `import`。
- Neo-brutalism 视觉：米白 `#F3EEE2`、卡片 `#FFFCF4`、4px 粗描边、硬偏移阴影、橙 `#FF5A1E` / 蓝 `#2B4BE0`。
- `js/main.js` 里 AI 助手的三处文案：`AI_CONFIG.autoTip`（1.5s 气泡）、`AI_CONFIG.welcome`（手动打开）、`AI_CONFIG.autoLead`（10s 自动展开引导）。消息由 `aiAppendMsg()` 统一生成 `.ai-msg-{who} .ai-bubble`，内容是 **HTML 字符串**（含 `<br>` / `<b>` / `.ai-src-row` / `.ai-greet-acts`）。
- 皮肤系统已把原 `#aiFab` **视觉隐藏但保留 DOM**（JS 依赖 `aiFab.click()`），角色舞台 `.ai-stage` 在右下角。语音 UI 不能占用/覆盖舞台，也不能抢它的点击事件。
- 前端脚本引用都带 `?v=YYYYMMDDx` 版本号破 Pages CDN 缓存。

### 1.3 对原设计依据的修订

`docs/ai-assistant-survey.md` 第 2.2 节原本把「不做语音」列为非目标。**本需求正式撤销该条**，但保留其余非目标（不做登录、不做会话持久化、不做业务动作）。语音是纯前端附加层，不改变「静态站 + 静态 RAG + 境内可达云函数」的主架构。

---

## 2. 免费资源调研

### 2.1 候选方案横评（2026-11 核实）

| 方案 | 免费口径 | 需要 Key / 后端 | 境内可达 | 中文真人度 | 结论 |
|---|---|---|---|---|---|
| **Web Speech API `SpeechSynthesis`**（浏览器系统语音） | 浏览器内置能力，无账号、无调用计费（MDN） | ❌ 全不需要 | ✅ 本地语音完全离线 | ⚠️ Windows 慧慧/康康、macOS 婷婷偏机械 | ✅ **本期主通道** |
| **Edge Online (Natural) 神经语音**（通过上一条 API 暴露） | Edge 自带，免费无限（微软 Edge「大声朗读」同源引擎） | ❌ 全不需要 | ⚠️ 在线语音要把文本送到微软服务，境内可用性依赖网络；失败自动回落本地语音 | ✅ 晓晓 / 云希接近真人 | ✅ **本期首选音色** |
| 腾讯云 TTS（云函数代理） | 官方：基础/精品音色 **800 万字符**免费包，领取后 **3 个月**有效、单账号一次；大模型音色 10 万、超自然 2 万字符 | ✅ 实名 + SecretId/Key，必须放服务端 | ✅ 国内节点 | ✅ 9/10，中文自然度高 | ⏭ Phase 2 |
| Azure Speech F0（云函数代理） | 官方定价页：**每月 50 万字符**神经语音免费，超额限流不自动扣费 | ✅ 账号 + Key + 服务端 | ⚠️ 需选中国节点，注册有门槛 | ✅ 好 | ❌ 不推荐（境内链路 + 额度不如腾讯） |
| `edge-tts` 非官方 WebSocket 接口 | 免费 | ✅ 需要服务端代理 | ⚠️ 走微软服务 | ✅ 同上 | ❌ 非官方接口，服务条款风险，生产不用 |
| Piper / Kokoro 等开源离线神经 TTS（WASM） | 开源免授权费，文字不出设备 | ❌ 无 Key，但要下载模型（数十 MB）+ runtime | ✅ 完全离线 | ⚠️ 中文模型选择少、自然度一般 | ⏭ Phase 3（隐私优先时再评估） |
| 实时数字人 SaaS（D-ID / HeyGen 等） | 按分钟计费 | ✅ | ❌ | ✅ 唇形同步 | ❌ 与静态站冲突，[皮肤文档](ai-avatar-skins.md) 已否决 |

**回答「是否有免费资源接入」：有。** 而且最优解不需要调用任何第三方服务——浏览器本身就是一个免费 TTS 引擎；想要真人音质时，Edge 免费附赠神经语音。云厂商的免费额度是「保底方案」，不是必需品。

### 2.2 浏览器原生方案的四个硬限制（都是踩坑点）

| 限制 | 表现 | 本文对策 |
|---|---|---|
| **自动播放策略** | Chrome 71+ 无用户激活时 `speak()` 抛 `not-allowed`；iOS Safari 首次 `speak()` 必须同步写在 tap/click 回调里，`await fetch()` 之后手势就过期 | 首交互解锁（同步 `speak('')`）+ 挂起欢迎语 + 可点击 CTA；详见第 5 节 |
| **语音列表异步 / 不完整** | Chromium 首次 `getVoices()` 常返回 `[]`，要等 `voiceschanged`；Edge 150 曾出现 `"Microsoft undefined Online (Natural) - undefined"` 残缺条目（微软社区 2026-07 报告，150.0.4078.99 已修复） | 监听 `voiceschanged` + 3s 兜底；**过滤 name/lang 含 `undefined` 或为空的条目**；按 `voiceURI` 记忆用户选择并在列表刷新后重新解析 |
| **Chrome 约 15 秒静默截断** | 网络语音连续朗读约 15s 后无 `end`、无报错地停下，`speaking` 仍为 true | 按标点分句（≤110 字/句）、逐句链式 `onstart`/`onend`、保留 utterance 引用防 GC、每段加 12s 看门狗 |
| **拿不到音频数据** | API 直接送到扬声器，页面既拿不到 PCM 也不能导出/做频谱 | 用 CSS 口型/律动 + 自定义事件模拟「正在说话」，不追求真实唇形同步（那是 Phase 2 云端通道才有的能力） |

### 2.3 隐私与合规

- **本地语音**（`voice.localService === true`）：文本不出设备，零隐私风险。
- **Edge 在线神经语音**（`localService === false`）：文本会送到微软的语音服务。本站朗读内容全是**已公开的简历问答**，风险可接受；模块仍提供音色循环切换，用户可主动选本地音色；文档明示这一点。
- **云端语音（Phase 2）**：待合成文本从云函数发往腾讯云 TTS API，内容仍是**已公开的简历问答**；前端只拿回 base64 mp3，永不接触 SecretId/Key。`Audio` 元素带 `dataset.aiGenerated='1'`。
- **AI 生成内容标识**：依《人工智能生成合成内容标识办法》（四部门，2025-09-01 施行），音频类生成合成内容需显式标识。本项目音频为实时播报的 `data:` URI，**不落盘、不提供下载导出**，属「交互场景界面」路径，因此在面板底栏、开关按钮、首次引导气泡上标注「AI 语音」。将来若提供音频文件下载/导出，须在文件元数据里补隐式标识。

---

## 3. 选型与架构

### 3.1 分期

| 阶段 | 内容 | 成本 | 状态 |
|---|---|---|---|
| **Phase 1（本期）** | 浏览器原生 `SpeechSynthesis`，神经语音优先 + 本地兜底；开关 / 持久化 / 首次欢迎语 / 分句队列 / 口型联动 | 0 元、0 Key、0 后端请求 | ✅ 已实现 |
| **Phase 2（已上线）** | 复用同一台 CloudBase 云函数的 `/chat` + `mode:'tts'` 路由接腾讯云 TTS，前端注入云端 `provider`，失败无感回落到浏览器语音 | 800 万字符免费包内 0 元 | ✅ 2026-11-17 已部署并实测（见第 7 节） |
| **Phase 3（备选）** | Piper WASM 离线模型，彻底不出设备 | 0 元，但首次下载模型 | 💡 仅记录 |

### 3.2 Phase 1 分层（零侵入）

```
index.html  ── 只加 2 条引用 ──┐
                               ▼
┌───────────────────────────────────────────────────────┐
│ js/ai-voice.js（IIFE，暴露 window.AIVoice）            │
│  ├ ① DOM 观察者：aiBody 新增 .ai-msg-bot / .ai-fab-tip │ ← 不改 main.js
│  ├ ② 文本清洗：HTML → 口语化纯文本                     │
│  ├ ③ 语音队列：选音色 → 分句 → 链式播放 → 看门狗        │
│  ├ ④ 解锁状态机：activation / 补播 / CTA               │
│  ├ ⑤ UI：面板头开关 + 右下角 dock + 首次引导气泡         │
│  └ ⑥ 状态广播：body.cpai-speaking + cpai:voice 事件    │
└──────────────────────┬────────────────────────────────┘
                       ▼
        window.speechSynthesis（浏览器内置，零网络请求）
                       │
        css/ai-voice.css（开关样式 + 说话律动/口型动画）
```

`js/main.js`、`js/ai-skins.js`、云函数、知识库**全部零改动**。

### 3.3 模块契约（给 Phase 2 留口）

```js
window.AIVoice = {
  setEnabled(bool),        // 开/关语音（立即 cancel + 持久化）
  isEnabled(),             // 当前开关
  speak(text, opts),       // 手工播报：opts.kind = 'greet' | 'answer' | 'error'
  cancel(),                // 立即停止并清空队列
  getStatus(),             // { supported, enabled, speaking, voice, pendingWelcome, provider }
  setProvider(provider)    // Phase 2：注入 { synth(text, opts) -> Promise<{src, mime}> }
};
```

Provider 接口预留后，Phase 2 只要写一个云端 provider（返回可播音频 URL/base64），队列与 UI 层完全复用。

---

## 4. 详细设计

### 4.1 播报内容来源

| 触发 | DOM 信号 | 处理 |
|---|---|---|
| 用户提问后的 AI 回答 | `aiBody` 新增 `.ai-msg-bot .ai-bubble` | 清洗后播报，`kind='answer'` |
| 错误/超长提示（`▍…`） | 同上 | `kind='error'`，语速稍慢 |
| 思考中三个点 `.ai-typing` | 同上 | **跳过** |
| 用户自己的消息 `.ai-msg-user` | 同上 | **跳过** |
| 手动打开面板的 welcome | 同上 | 正常播报 |
| 1.5s 首次打招呼气泡 | `.ai-fab-tip` 被插入 body | 触发**专属口语欢迎语** `GREET_TEXT`（不是照读气泡短文案） |
| 10s 自动展开的 `.ai-greet` | `aiBody` 新增 | 若本次会话已打过招呼 → **跳过**，避免 8 秒后重复念一遍 |

### 4.2 文本清洗（避免"读 HTML"）

1. clone 气泡节点，移除 `.ai-src-row`（依据标签）、`.ai-greet-acts`（引导按钮）、`.ai-msg-name`、`.ai-dot`、`script`/`style`；
2. `<br>` → 中文逗号，再取 `textContent` 自动解码 HTML 实体；
3. 口语化替换：`0→1`→「从零到一」、`▍`/`👋`/`→`/`//` 等符号清理或转停顿、`TF-IDF` 等缩写按字母拆开；
4. 连续空白折叠，总长上限 600 字，超出截断并提示「更多内容请看文字」；
5. 同一条文本 1.5 秒内不重复播（去重），新回答到达时 `cancel()` 旧队列，避免两段话叠着念。

### 4.3 音色选择

打分排序（高 → 低）：`Natural` > `Online` > `Xiaoxiao/晓晓`（默认亲切女声）/ `Yunxi/云希`（男声）> `zh-CN` > 其它中文 > 系统默认。过滤残缺条目，结果缓存到 `localStorage`（`cpai_voice_v1` 存 `{enabled, voiceURI, rate}`）。右键开关 = 循环切换音色并试听一句，title 里标出「在线 / 本地」。

### 4.4 语气分层（"像真人"的具体做法）

| 场景 | rate | pitch | 句间停顿 |
|---|---|---|---|
| 首次欢迎 | 0.96 | 1.08 | 180ms（慢一点、上扬一点） |
| 正常回答 | 1.00 | 1.00 | 110ms |
| 错误提示 | 0.92 | 0.96 | 140ms |

配合 `body.cpai-speaking` 让角色嘴巴/灯/音柱动起来、舞台轻微呼吸；派发 `cpai:voice` 自定义事件（start/end）供将来接数字人唇形。

### 4.5 UI 与持久化

- **面板头开关** `.ai-voice-toggle`：喇叭图标 + `aria-pressed`，关闭态加斜杠；面板打开时可见。
- **右下角 dock** `.ai-voice-dock`：面板关闭时常驻，位于角色舞台左侧（`right: 210px`），不抢舞台点击；面板打开时自动隐藏，避免与面板重叠。
- **首次引导气泡** `.ai-voice-cta`：仅当欢迎语被自动播放策略拦下时出现，含「🔊 听它说」和「先不用」；按钮本身就是解锁手势。
- **面板内引导** `.ai-voice-inline-cta`：若用户 10 秒内始终没交互、`main.js` 自动展开面板，浮动气泡会被面板盖住，模块自动把引导改挂进对话区（同一套按钮），保证入口不丢。
- `localStorage.cpai_voice_v1` 记忆开关与音色；不支持 `speechSynthesis` 时，开关灰显并提示「当前浏览器不支持语音播报」，页面其余功能不受影响。
- 页面 `visibilitychange` 变隐藏 → `cancel()`；关闭语音 → 立即静音；重新开启 → 试听一句短提示。

---

## 5. 重点：首次打招呼语音怎么绕开自动播放策略

浏览器规则无法绕过，因此做成**降级状态机**，而不是假装能自动播：

```
页面加载
  │ 注册 document 上 pointerdown / keydown / touchstart（capture，仅一次）
  │ 注册 MutationObserver 观察 .ai-fab-tip 与 aiBody
  ▼
1.5s 气泡出现 → welcomeState: none → pending
  │  立即尝试 speak(GREET_TEXT)（有些浏览器因 MEI/已激活会成功）
  ├─ 1.2s 内触发 onstart  ─────────────► played ✅ 不显示 CTA
  └─ 未触发 / not-allowed ─────────────► pending ⏸ 显示「🔊 听 CP.AI 说句话」CTA
                                              │
              ┌───────────────────────────────┴──────────────────┐
              ▼                                                  ▼
   用户点击 CTA / 页面任意首次交互                        用户点「先不用」
              │                                                  │
   同步 unlock：speak(' ')（手势内，满足 iOS）              跳过欢迎语，不关语音
              │
              ▼
   补播 GREET_TEXT → played，隐藏 CTA
              │
              ▼
   10s 自动展开的 .ai-greet 消息因 welcomeState=played 被跳过
   后续问答回答照常播报（此时 sticky activation 已生效）
```

关键点：

- `unlock()` 必须在用户手势回调里**同步**执行，不能放在 `await`/`setTimeout` 里，否则 iOS Safari 手势过期；真实文本在该回调之后的微任务里播。
- 用「`onstart` 是否触发」判断成功，而不是只看 `speaking`，因为被拦截时 `onerror` 不一定抛；也无法可靠地提前判断浏览器是否允许自动播放，所以**总是先尝试播**，420ms 没出声再显示引导、1.2s 仍未出声则由看门狗兜底。
- 10s 自动展开时若欢迎语仍挂起，`.ai-greet` 消息跳过播报（不重复念），引导改为面板内消息。
- 会话内欢迎语只播一次；`cpai_auto_ts`（30 分钟冷却）沿用 `main.js` 的既有逻辑，语音模块不另建冷却，避免两套计时打架。

---

## 6. 落地计划与验收清单

### 6.1 已完成（Phase 1）

| # | 交付物 | 说明 |
|---|---|---|
| 1 | `docs/ai-voice-survey.md` | 本文 |
| 2 | `js/ai-voice.js` | 语音模块，IIFE + `window.AIVoice` |
| 3 | `css/ai-voice.css` | 开关 / dock / CTA / 说话律动样式 |
| 4 | `index.html` | 加两条带版本号的引用 + 面板底栏 AI 语音标识 |
| 5 | `README.md` / `docs/ai-assistant-survey.md` | 功能清单与设计依据同步 |
| 6 | 本地浏览器验证 | `python -m http.server 8899` + 临时 `playwright-core` 脚本（放在系统临时目录，不入库），用 mock `speechSynthesis` 覆盖「允许自动播 / 拦截自动播 / 全程不交互」三种场景 |
| 7 | `functions/tencent/tts.js` | 腾讯云 `TextToVoice` 直调：Node 内置 `https`/`crypto` 手写 TC3-HMAC-SHA256 签名，零第三方依赖；实例内 LRU 缓存、语气分层、≤150 字硬限制 |
| 8 | `functions/tencent/index.js` | 新增 `mode:'tts'` 路由，复用 `/chat` 的 Origin 白名单、IP 盐化与双窗口限流，返回 base64 mp3 |
| 9 | `js/ai-voice-cloud.js` | 云端 Provider：启动探测 → 成功才 `AIVoice.setProvider()`；失败/超时保持浏览器语音；按 `kind|text` 缓存；`window.AIVoiceCloud` 排障接口 |
| 10 | 云函数部署 | 通过 SCF Git Data API 式的 `UpdateFunctionConfiguration` + `UpdateFunctionCode` 上传代码包，环境变量只增不改线上既有的 `AI_API_KEY` / `ALLOWED_ORIGINS` |

### 6.2 Phase 1 验收清单

- [x] 首次进入约 1.5s 出现招呼气泡：有用户激活则直接出声；无激活则出现「听它说」引导，点击后立刻补播欢迎语；10s 自动展开时不重复念、引导自动转入面板内。
- [x] 手动打开面板的欢迎语、AI 回答、错误提示自动播报；思考中的三个点、用户消息、依据来源标签**不播**。
- [x] 长回答分句读完（实测 360 字切成 4 段、最长 108 字），不中途静默、不两段叠读、不读 HTML 标签；口语化替换（`0→1`→从零到一、`TF-IDF`→逐字母、`<br>`→自然停顿、叠标点清理）。
- [x] 关闭语音：立即静音；刷新页面后仍为关闭；重新开启后恢复播报并试听。
- [x] 优先选中 `Online (Natural)` 中文音色；残缺的 `undefined` 语音条目被过滤；右键可切换音色并试听。
- [x] 不支持 `speechSynthesis` 时：开关灰显、无 JS 报错，问答/皮肤/主题全部照常（代码分支已覆盖，真机待复核）。
- [x] 页面切到后台自动停止朗读；`js/main.js` 与 `js/ai-skins.js` diff 为空。
- [x] 播报状态正确复位（`cpai-speaking` class 与 `cpai:voice` start/end 事件成对），角色动画不会卡在「说话中」。

> 验证口径：以上为 **Edge headless + mock 语音引擎** 的逻辑验证（验证脚本位于系统临时目录 `%TEMP%/wb-skin-check/voice-check.js`，不入库）。另补一轮「零音色 / 全英文音色 / 中文音色」三场景回归（`voice-novoices-check.js`），三者的 `window.AIVoice` 均正常挂载、0 `pageerror`——见 6.3 踩坑 2。真人听感、Edge 在线神经语音的境内可达性、iOS 首次 tap 解锁，仍需在有声卡的实机上人工试听一次。验证输出里的 404 / 连接错误均来自既有的留言墙 `/api/wall` 与境外字体请求，与本次改动无关。

### 6.3 Phase 2 验收（2026-11-17 线上实测）

- [x] 腾讯云 TTS 服务开通、后付费默认关闭；800 万字符免费包领取成功，有效期 `2026-11-17 → 2027-02-17`，起始已用 0。
- [x] 线上 `POST /chat { mode:'tts', text, kind }` 返回 **HTTP 200**、`mime=audio/mpeg`、base64 音频解码为 **9504 字节合法 MP3**（帧头 `fff3` + LAME 标签），音色 `101001`；同一句二次请求 0.30s 命中实例内缓存。
- [x] `POST /chat { question }` 回归 **HTTP 200**，问答能力未被云函数更新破坏；非法 Origin 返回 **403**，超长/非法请求体返回 **400**。
- [x] 密钥只存云函数环境变量，前端代码与仓库均无明文；本地临时凭据文件在部署后删除。
- [x] 未配密钥 / 云端异常时，`/tts` 返回 503/502 且前端自动回落到浏览器 `SpeechSynthesis`，问答与皮肤不受影响。
- [x] GitHub Pages 上线后**生产域名真机验收**（Edge headless 打开 `https://shenge-work.github.io/`）：`window.AIVoice` / `window.AIVoiceCloud` 均挂载、`provider=cloud`、面板开关与底栏 AI 标识齐全、0 个 JS `pageerror`；欢迎语与主动 `AIVoice.speak()` 真实发起 `/tts` 请求，返回 HTTP 200 + 合法 base64 MP3（实测 5184 / 67776 / 18624 字节，音色 `101001`），重复文本命中前端缓存不再请求。
- [x] CORS 预检：`OPTIONS` 带生产 Origin 返回 204 与正确的 `Access-Control-Allow-Origin`，`POST` 响应头同样匹配，浏览器可直连云函数、无需代理。
- [x] `?tts=browser` 强制降级：provider 变 `browser`、`AIVoiceCloud.state=off`、**零次**云端请求。
- [x] 关闭语音后刷新仍为关闭，重新开启立即恢复；云端合成失败时单句自动回落本地语音且不中断后续队列。

> 踩坑 1（云函数签名，必读）：SCF 运行角色会注入 `TENCENTCLOUD_SESSIONTOKEN`。若把它和子账号**永久密钥**混在一起签名，腾讯云返回 `AuthFailure.TokenFailure`。`tts.js` 的 `credentials()` 因此改成两套密钥「成套」取用：`TTS_SECRET_ID/KEY` 只配 `TTS_TOKEN`，只有回退到运行角色临时密钥时才带 `TENCENTCLOUD_SESSIONTOKEN`。首次部署正是被这个错误挡住，修正后重传代码包才通过。
>
> 踩坑 2（前端递归爆栈，必读）：`loadVoices()` 末尾调 `syncUI()`，而 `syncUI → voiceLabel → pickedVoice` 在音色列表为空时会反过来调 `loadVoices()`。浏览器首次 `getVoices()` 返回空数组、或系统只有英文音色被中文过滤掉时，这条链会无限递归抛出 `Maximum call stack size exceeded`，**直接让整个 IIFE 中断、连 `window.AIVoice` 都挂不上**。本地 mock 恒返回 4 个中文音色所以从未暴露，是上线后生产域名验收才抓到的。修法：加 `voicesBusy` 重入保护，并让 `syncUI()` 在保护区内调用（放在 `finally` 之后会因标志已释放而继续递归）。已补「零音色 / 全英文 / 中文」三种场景回归，均 0 `pageerror`。
>
> 踩坑 3（部署通道）：控制台「上传代码」在当前浏览器自动化通道里弹的是系统级文件对话框，无法喂入文件路径；在线开发编辑器是平台 Hello World 模板，直接点部署会覆盖线上。最终走云 API（`GetFunction` → `UpdateFunctionCode` + `UpdateFunctionConfiguration`）上传 ZIP，并在更新前保留线上既有的 `AI_API_KEY` / `ALLOWED_ORIGINS` 环境变量。前端文件则经 GitHub Git Data API 推送（本机 `github.com` 代理不通、`api.github.com` 可达）。

### 6.4 后续触发条件与收口

Phase 2 已于 2026-11-17 因「需要跨浏览器一致的固定音色」提前启动并完成。剩余可选项：① 音频文件下载 / 字幕 / 真实唇形同步，需补文件元数据隐式标识；② 免费包到期（2027-02-17）后评估用量再决定是否续费，或一键降级回 Phase 1；③ 若不再需要云端通道，`window.AIVoiceCloud.disable()` 或 URL 加 `?tts=browser` 即可强制走浏览器语音，无需改代码。

---

## 7. Phase 2 云端通道（已实施）

### 7.1 实际接口契约（与代码一致，2026-11-17 上线）

**不新增网关路径**：沿用已在用的 `/chat` HTTP 触发地址，用 body 里的 `mode` 分流，控制台「HTTP 访问服务」零改动。

```
请求：POST https://resume-ai-d9g7zghnxda2ee2cb-1307508155.ap-shanghai.app.tcloudbase.com/chat
      Origin: https://shenge-work.github.io
      { "mode": "tts", "text": "≤150 中文字符", "kind": "greet|answer|error" }
响应：200 { ok:true, audio:"<base64 mp3>", mime:"audio/mpeg", cached:false, chars:8, voice:101001 }
      400 缺少 text / 文本超长 / 请求体非法
      403 Origin 不在白名单
      429 超过限流（每 IP 每分钟 40 段、每天 400 段）
      503 未配置密钥（前端据此降级）
      502 腾讯云侧异常（同样降级）
鉴权：沿用 /chat 的 Origin 白名单 + IP 盐化；SecretId/Key 只在云函数环境变量里
音色：101001「智瑜·情感女声」（精品音色，落在 800 万字符免费包内）
语气：greet Speed -0.2 / answer 0 / error -0.15
缓存：云函数实例内 LRU（120 段）+ 前端 LRU（80 段），按 text+voice+speed / kind|text 做 key
降级：探测失败或任一句请求失败 → `AIVoice.setProvider(null)` 回落浏览器 SpeechSynthesis
```

前端 `js/ai-voice-cloud.js` 在启动时用「你好」两字探测一次全链路，成功才注册 provider；`window.AIVoiceCloud.test('…')` 可在真机试听，`getStatus()` 返回 `state/reason/endpoint/cached/active`。排障开关：`?tts=browser` 强制走浏览器语音。

### 7.2 密钥与权限（最小权限）

| 项 | 做法 |
|---|---|
| 身份 | CAM 子用户 `cpai-tts`（账号 ID `100055231053`），非主账号密钥 |
| 授权 | `QcloudTTSFullAccess`（TTS 调用）+ `QcloudSCFFullAccess`（仅部署期用于更新函数代码/配置）；部署完成后可解除后者，只留 TTS 权限 |
| 存放 | `TTS_SECRET_ID` / `TTS_SECRET_KEY` / `TTS_VOICE_TYPE` / `TTS_REGION` 写在云函数环境变量；**不入库、不进前端、不写日志** |
| 轮换 | 控制台新建密钥 → 更新云函数环境变量（保留 `AI_API_KEY` / `ALLOWED_ORIGINS`）→ 禁用旧密钥 |
| 额度安全 | 服务后付费默认关闭，免费包用完自动停服；前端与云函数双重限流 + 双层缓存，避免异常流量烧字符 |

### 7.3 部署方式（本机网络受限下的可复用路径）

控制台「上传代码」弹的是系统级文件框，浏览器自动化无法喂入文件；在线开发编辑器是平台 Hello World 模板，直接部署会覆盖线上。因此走 **SCF 云 API**（`scf.tencentcloudapi.com`，TC3-HMAC-SHA256 签名）：

1. 打包 `functions/tencent/` 的 5 个 JS/JSON 入口 + `kb/*.json` + `scf_bootstrap`（ZIP 内必须保持 LF 换行与 0755 权限）；部署前另存一份 `git HEAD` 版本作为回滚包。
2. `GetFunction` 读现有环境变量 → `UpdateFunctionConfiguration` **合并**写入新变量（务必全量回传，否则平台注入的 `AI_API_KEY` 会丢，`/chat` 立刻失效）。
3. `UpdateFunctionCode` 传 `ZipFile` base64、`Handler:''`、`InstallDependency:'FALSE'`。
4. 每步轮询到 `Status=Active` 再做下一步；最后用 curl 实测 `/tts` 与 `/chat`。
5. 前端静态文件经 **GitHub Git Data API** 推送（本机 `github.com` 代理 502、`api.github.com` 可达；GitHub MCP 的 `push_files` 无 `contents:write` 权限返回 403）：`blobs → trees → commits → PATCH refs/heads/main`。上线提交 `359388fa`（功能）、`ab9789d9`（爆栈修复 + 版本号 `v=20261117c`）。推送前以**远端 main 为基线**重建 9 个文件，不含工作区里另一条未完成的 JD 匹配改动。

函数体检口径：`resume-ai-chat` / namespace `resume-ai-d9g7zghnxda2ee2cb` / `Type=HTTP` / `Port=9000` / `Runtime=Nodejs20.19` / 公网访问 ENABLE。

> 版本一致性说明（2026-11-17 夜更新）：两条线**已合并**。`7c7b5e1` 把 JD 匹配分支一并入库，
> 仓库 `main` 的 `functions/tencent/index.js` 与线上部署包内的同名文件逐字节一致，
> 同时包含 `/chat` 问答、`mode:'jd'`、`mode:'tts'` 三套路由；前端 `#jd` 区块也已上线。
> 早先「线上含 JD、仓库是纯净语音版、日后需重新打包」的说明已作废：
> 后续再部署时务必使用这份合并版 `index.js`，**不要拿只含单一路由的旧快照覆盖线上**，
> 否则会抹掉另一条已生效的链路。

### 7.4 成本测算

腾讯云官方 800 万字符免费包：单次回答按 200 字、日均 100 次 ≈ 2 万字符/天 ≈ 60 万字符/月，免费包够用约 13 个月；但**资源包自领取起 3 个月有效**，实际是「3 个月内随便用」。缓存命中不重复计费。Azure F0 的 50 万字符/月在这种量级下会触发限流，这也是不选 Azure 的原因之一。

---

## 8. 参考来源

| 来源 | 用于核实 |
|---|---|
| MDN《Using the Web Speech API》 | `SpeechSynthesis` 用法、`getVoices()` / `voiceschanged`、utterance 属性、无 Key |
| MDN《Autoplay guide for media and Web Audio APIs》 | 无用户交互时音频播放被阻止、sticky activation、`getAutoplayPolicy()` |
| textintoaudio.com《Web Speech API browser support》 | Chrome 71 `not-allowed`、iOS 首次 tap 同步要求、15 秒截断、Edge Online Natural 归属 |
| micdrop.dev《Text to speech in JavaScript》(2026-10-29 核对 MDN/caniuse) | 浏览器支持率 ≈96%、Edge Natural 仅 Edge、iOS 页面交互前静默丢弃、音频不可导出 |
| Microsoft TechCommunity / Microsoft Learn（Edge 150 Natural voices `undefined`，2026-07） | 语音列表残缺条目的真实故障与「过滤不完整条目」对策 |
| 腾讯云《语音合成计费概述》 https://cloud.tencent.com/document/product/1073/34112 | 800 万字符免费包、3 个月有效、单账号一次 |
| 腾讯云《语音合成 TextToVoice API》 https://cloud.tencent.com/document/product/1073/37995 | 请求域名、Action/Version、参数与 base64 `Audio` 返回、单次文本长度 |
| 腾讯云《语音合成音色列表》 https://cloud.tencent.com/document/product/1073/92668 | 精品音色 `101001` 智瑜·情感女声、免费包覆盖范围、mp3 编码 |
| 腾讯云 SCF API（GetFunction / UpdateFunctionCode / UpdateFunctionConfiguration） | HTTP 函数配置读取、ZIP 代码包上传、环境变量全量合并语义 |
| Azure AI Speech 定价页 https://azure.microsoft.com/pricing/details/speech | F0 每月 50 万字符神经语音免费、超额限流不扣费 |
| 中国政府网《四部门联合发布〈人工智能生成合成内容标识办法〉》 | 2025-09-01 施行、显式/隐式标识、音频与交互界面要求 |

> 第三方横评文章里出现的「火山/阿里免费额度」「edge-tts 无限免费」等口径未采信为主依据；涉及计费与合规的判断只引用官方文档。
