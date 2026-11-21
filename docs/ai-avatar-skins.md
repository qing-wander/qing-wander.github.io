# 右下角 AI 助手 · 3D 角色皮肤系统（设计 + 实施 + 迭代）

> 文档定位：本文件是 `shenge-work.github.io` 右下角 AI 问答助手**视觉层**的单一依据。记录「方形按钮 → 可切换 3D 角色」的完整演进：方案调研、技术选型、9 款皮肤架构、实施踩坑、验证结果，以及后续迭代方向。
>
> 它是 `docs/ai-assistant-survey.md`（RAG 问答后端）的**姊妹篇**：那份管"答什么"，这份管"长什么样"。两份互补，不重叠。
>
> 版本：v1（2026-11-10）· 状态：已上线 · 作者：陈培胜
>
> **⚠️ 2026-11-19 现状变更**：皮肤系统已收敛为**仅保留「个人形象 3D」（`self3d`）一款**，其余 11 款（含 3D 机器人/狐狸/档案机甲/纸质精灵、SVG 猫宠/看板娘/桌宠、AI 立绘、2D 个人形象、数字人）已从 `SKINS` 删除并清理资源，换肤入口自动隐藏。本文的「9 款皮肤」章节保留为历史演进记录。当前的制作流水线、技术参数、已知限制与后续优化清单见 **[docs/pet-self3d-pipeline.md](pet-self3d-pipeline.md)**。

---

## 0. 结论摘要（先看这四条）

1. **全站本没有 three.js**，右下角就是个 `<button class="ai-fab">` + CSS 画的方框。所以"不想重开发 3D 角色"这个约束天然成立——所有方案都不需要手写一行 three.js。
2. **选型落地为 `<model-viewer>` Web Component + 官方示例 GLB**：一个 HTML 标签 + `autoplay animation-name` 就有待机动画，动画是现成的 API 调用（`mv.animationName = 'Wave'`）。
3. **做了 9 款可切换皮肤**（3 款真 3D GLB + 5 款本地 SVG + 1 款 AI 生成立绘），右键/双击/长按/快捷键可换，`localStorage` 记忆，**问答逻辑（`js/main.js`）一行没改**。
4. **默认皮肤是 3D 机器人**，首次进入页面主动挥手打招呼并自我介绍「我是 AI 简历问答助手」，角色完全取代了原方框、无边框悬浮在页面上。

---

## 1. 背景与目标

### 1.1 痛点

- 原右下角是纯 CSS 方形 FAB 按钮（约 130×45 px），写"简历问答"，很不起眼。
- 用户希望换成「AI 数字人 / AI 宠物」，最好待机时有动作，且**不重新开发 three.js 3D 角色**。
- 角色进入页面时用户很懵，不知道它是干嘛的，需要主动自我介绍。

### 1.2 目标（本会话完成）

- 找到一个好看的现成数字人/宠物素材，替换方框按钮。
- 待机时有动作、有活动。
- 支持多款皮肤切换（右键/双击/长按/快捷键）。
- 默认 3D，首次进入主动打招呼。

### 1.3 非目标（明确不做）

- 不接入实时数字人 SaaS（D-ID / HeyGen LiveAvatar）——按分钟计费、需 API Key、WebRTC 视频流，与静态站 RAG 冲突。
- 不引入 Live2D / Rive / Petfolio 的外部 runtime 与社区模型——规避版权与境内 CDN 问题（见第 3 节）。
- 不改动问答后端（CloudBase RAG）的任何逻辑。

---

## 2. 技术选型：为什么是 model-viewer + 官方 GLB

### 2.1 候选方案对比

| 方案                                             | 待机动画          | 授权           | 集成成本            | 结论            |
| ---------------------------------------------- | ------------- | ------------ | --------------- | ------------- |
| **`<model-viewer>` + Khronos/three.js 官方 GLB** | ✅ 开箱即用，多段可切   | CC0 / MIT 干净 | 1 个 HTML 标签     | ✅ **主方案**     |
| Rive / Lottie 2D 角色                            | ✅ 状态机 idle 循环 | 社区文件授权不一     | 需 runtime       | ⚠️ 用本地 SVG 等效 |
| 网页桌宠（Petfolio / webmeji）                       | ✅ 随机走/跳/爬墙    | MIT / 公有领域   | 1 行脚本           | ⚠️ 本地等效       |
| Live2D 看板娘                                     | ✅ 呼吸/眨眼/跟随    | **灰色**（游戏拆包） | 1 行脚本           | ❌ 版权 + 风格冲突   |
| AI 生成 3D（混元/图片转 3D）                            | ❌ **静态网格无骨骼** | 自有           | 生成 + 绑骨 + 转 GLB | ⚠️ 仅作立绘       |
| 实时数字人 SaaS                                     | ✅ 唇形同步        | 商用 API       | 重构 + 按分钟付费      | ❌ 不划算         |

### 2.2 关键发现：AI 生成 3D 的致命短板

WorkBuddy 内置的 3D 生成能力（`buddy-multimodal-generation` 的 `3d` 命令）产出的是**静态网格 + 贴图，没有骨骼、没有待机动画**。要动起来得补 Mixamo 自动绑骨（只支持 T-pose 人形、只导 FBX/DAE、中国区账号受限），成本高、返工风险大。

**结论**：现成 GLB（自带骨骼动画）远优于 AI 生成 3D。AI 生成只用于**透明底立绘**（第 8 款皮肤），配 CSS 呼吸浮动。

### 2.3 选定的模型

| 模型                    | 大小     | 自带动画                                  | 授权              | 用途       |
| --------------------- | ------ | ------------------------------------- | --------------- | -------- |
| `RobotExpressive.glb` | 456 KB | Idle / Wave / ThumbsUp / Dance 等 14 段 | CC0 / MIT       | 机器人、混合皮肤 |
| `Fox.glb`             | 160 KB | Survey / Walk / Run                   | CC0 + CC-BY 4.0 | 狐狸皮肤     |

来源：`KhronosGroup/glTF-Sample-Assets`、`mrdoob/three.js` 官方示例。

---

## 3. 架构设计

### 3.1 分层与职责

```
┌────────────────────────────────────────────┐
│ index.html（只加两行引用）                    │
│  css/ai-skins.css   js/ai-skins.js          │
└──────────────┬─────────────────────────────┘
               │
   ┌───────────▼────────────┐
   │ .ai-stage 角色舞台（fixed）│  ← 透明悬浮，无边框
   │  .ai-stage-actor         │
   │    model-viewer / SVG    │  ← 皮肤渲染层
   │  .ai-stage-name 名字标签  │
   │  .ai-stage-menu-btn ◈    │
   └───────────┬────────────┘
               │ MutationObserver 观察 aiPanel / aiBody
   ┌───────────▼──────────────────────────┐
   │ 原 aiFab（视觉隐藏，DOM 保留）          │  ← JS 仍程序化 .click()
   │ js/main.js 问答逻辑（零改动）           │
   └──────────────────────────────────────┘
```

### 3.2 核心机制：状态联动不碰 main.js

角色状态 `idle / thinking / answer / greet / click` 通过 **MutationObserver** 观察原有 DOM 变化驱动：

| 触发      | 观察点                                 | 角色动作                  |
| ------- | ----------------------------------- | --------------------- |
| 打开面板    | `aiPanel.hidden` 变化                 | `greet`（Wave 挥手）      |
| 打字中     | `aiBody` 出现 `.ai-typing`            | `thinking`（站立/踱步）     |
| 回答完     | `.ai-typing` 消失                     | `answer`（ThumbsUp 比赞） |
| 主动打招呼气泡 | `aiFab.parentNode` 出现 `.ai-fab-tip` | `greet`（Wave）         |

这样 `js/main.js` 的问答、自动打招呼、埋点**完全不需要改**，角色皮肤是纯叠加层。

### 3.3 皮肤契约

每款皮肤是一个工厂函数，返回统一接口：

```js
create(host) -> {
  setState(s),   // idle / thinking / answer / greet / click
  destroy()      // 清理 timer / listener
}
```

9 款皮肤共用这一个契约，`activate(id)` 统一调度：销毁旧实例 → 创建新实例 → 更新名字标签 → 写 localStorage。

### 3.4 为什么保留原 aiFab（不 display:none）

原方框 `.ai-fab` 不能 `display:none`，因为问答面板、打招呼气泡都靠 JS 程序化 `aiFab.click()` 触发，删了会失效。正确做法是**视觉隐藏但保留 DOM**：

```css
body.has-ai-skin .ai-fab {
  visibility: hidden; opacity: 0; pointer-events: none;
}
```

`.ai-fab-tip` 气泡是 `position:fixed` 独立定位，不依赖 aiFab 的 rect，所以隐藏后气泡仍正常。

---

## 4. 9 款皮肤清单

| # | id          | 名称             | 类型         | 待机/状态动作                            |
| - | ----------- | -------------- | ---------- | ---------------------------------- |
| 1 | `robot3d`   | 机器人 ROBOT      | 真 3D GLB   | Idle 循环，思考→站立，答完→ThumbsUp，点击→Jump  |
| 2 | `fox3d`     | 狐狸 FOX         | 真 3D GLB   | Survey 环顾，思考→Walk，打招呼→Run（侧面平视不自转） |
| 3 | `archive3d` | 档案机甲 ARCHIVE  | 真 3D GLB   | Idle 待机，思考→Standing，答完→ThumbsUp，点击→Jump |
| 4 | `cpbot`     | CP.AI 档案机器人    | 本地 SVG     | 呼吸、眼睛扫描、天线摆动、状态灯                   |
| 5 | `cat2d`     | 猫宠 NYAN        | 本地 SVG     | 6s 呼吸循环 + 尾巴/耳朵/眨眼/抬爪              |
| 6 | `live2d`    | 看板娘 ARCHIVIST  | 本地 SVG     | 分层视差、眨眼、发丝、口型                      |
| 7 | `deskpet`   | 桌宠 SHIMEJI     | 本地 SVG     | 随机走/坐/跳/挥手，可拖拽                     |
| 8 | `generated` | 专属形象 GENERATED | AI 立绘      | 透明底 PNG + CSS 呼吸浮动                 |
| 9 | `talking`   | 实时数字人 LIVE     | 本地 SVG     | 呼吸、口型、声波波形                         |

**菜单唤起方式**：右键角色 · 双击角色 · 长按 550ms（手机）· 点 ◈ 按钮 · 按 `S` 键。数字 `1–9` 直接切换。

---

## 5. 资源与授权

| 资源                                        | 大小     | 授权              | 说明              |
| ----------------------------------------- | ------ | --------------- | --------------- |
| `assets/skins/models/RobotExpressive.glb` | 456 KB | CC0 / MIT       | three.js 官方示例   |
| `assets/skins/models/Fox.glb`             | 160 KB | CC0 + CC-BY 4.0 | Khronos glTF 示例 |
| `assets/skins/vendor/model-viewer.min.js` | 960 KB | Apache-2.0      | 空闲懒加载，非阻塞       |
| `assets/skins/generated.png`              | 136 KB | 自有              | AI 生成立绘，已抠背景    |
| `assets/skins/preview.png`                | 120 KB | 自有              | 9 款皮肤总览图        |
| `assets/skins/models/Xbot-ivory.glb`      | 2.8 MB | Mixamo（经 three.js 示例分发） | 档案人偶，已入库未接入 |
| `assets/skins/models/Soldier.glb`         | 2.1 MB | 同上              | 先锋士兵，备选        |
| `assets/skins/models/Michelle.glb`        | 3.1 MB | 同上              | Y2K 女孩，彩蛋（无 idle） |

> 2026-11-19 新增的 4 个 3D 人物资产的逐个体盘点、实拍与接入片段，见 `docs/3d-character-library.md`。

全部本地化，离线可用。5–7、9 号皮肤为**本地 SVG 等效实现**，未引入 Live2D/Rive/Petfolio 的外部 runtime，规避版权与境内 CDN 不稳。

---

## 6. 实施踩坑记录（都是实测才知道的）

1. **classic script 里动态 `import()` 必须用绝对 URL**：`new URL(path, document.baseURI).href`，裸相对 specifier 会报 `Failed to resolve module specifier`。
2. **AI 出图的"透明背景"是假的**：ImageGen 的 `transparent` 实际把棋盘格画进了 RGB（alpha 全 255）。用从四边 BFS 的连通域抠图（判定 `max-min<18 且 min>188`）才拿到真透明，顺带去掉右下角水印。
3. **SVG 动画元素要统一 `transform-box: fill-box`**，否则 origin 在浏览器间不一致。
4. **Fox 相机角度**：`90deg 80deg` 且关闭 auto-rotate 才是正常侧面站立；Robot 用 `175%→270%` 距离避免自转/透明舞台裁切。
5. **透明舞台下 3D 模型会裁切**：去掉背板后模型占满全高，需要拉远 `camera-orbit` 距离（robot3d 270%、fox3d 200%、archive3d 200%）并减小 fov。
6. **素材下载通道**：本机 `raw.githubusercontent.com` 与 `cdn.jsdelivr.net` 不可达，`unpkg.com` / `registry.npmjs.org` 可达；GLB 走 `api.github.com/repos/.../contents/...` + `Accept: application/vnd.github.raw`。
7. **脚本缓存会骗人**：GitHub Pages CDN 会吐旧 JS，前端脚本要加 `?v=YYYYMMDD` 版本参数（详见 ai-assistant-survey.md 13.6）。

---

## 7. 主动性打招呼（首次进入即自我介绍）

用户反馈 3D 角色进入页面时很懵，需要主动自我介绍。方案：

| 时间点  | 动作                                  |
| ---- | ----------------------------------- |
| 1.5s | 气泡出现「👋 我是 AI 简历问答助手，点我直接问～」（此时角色可能还是 SVG 占位） |
| 2.6s | 无气泡时（回访）头顶浮出「点我问 · CP.AI」标签，11s 自动收起       |
| ~4s  | 首屏 load + 空闲后才拉 3D 组件与 GLB（合计近 1.8MB），不再和首屏抢带宽 |
| 6–8s | 模型就绪，切到骨骼入场动画（挥手 → 待机）              |
| 10s  | 仍未搭理才展开面板，递上 3 个快捷入口                |

**关键参数**（`js/main.js` 的 `AI_CONFIG`）：

- `autoTip`: `'👋 我是 AI 简历问答助手，点我直接问～'`
- `autoTipAhead`: `8500`（气泡在 `autoDelay - autoTipAhead = 1.5s` 冒出）
- `autoDelay`: `10000`（展开面板时刻）
- `autoCooldown`: `30 * 60 * 1000`（30 分钟冷却，避免每次刷新骚扰）

**设计取舍**：保留渐进式（先气泡自我介绍 → 不搭理才展开面板），而非一进页面硬弹大面板；保留 30 分钟冷却，真正"首次进入"（新会话）一定打招呼。

---

## 8. 验证结果（本机 Edge + playwright-core + http.server）

| 检查项              | 结果                           |
| ---------------- | ---------------------------- |
| 默认皮肤             | 机器人 ROBOT（3D，`loaded=true`）✅ |
| 舞台背景/边框/阴影       | 全透明 / none / none ✅          |
| 原方框按钮            | `visibility:hidden`、不可点击 ✅   |
| 单击角色开面板          | ✅ 即时响应（已去掉 230ms 双击判定）        |
| 男女形象切换（含镜头档位）    | ✅ 桌面 / 移动端各一套 `orbit`           |
| 面板打开时角色让位        | ≥1600px 横移；≤1599px 淡出 ✅        |
| 首次进入打招呼（气泡+挥手）   | ✅ 时序符合第 7 节                  |
| 390px 移动端横向溢出    | 无 ✅                          |
| 控制台报错            | 0 ✅                          |

---

## 9. 后续迭代方向（思考）

### 9.1 体验层（优先级高，成本低）

- **语音播报**：回答时用浏览器 TTS（`speechSynthesis`）读出答案，配合机器人 Wave 动画，更像"会说话的数字人"。零后端、零 Key，成本趋近 0。
- **口型同步**：机器人回答时让模型播放"说话"动画段（RobotExpressive 有 `Talking` 类动画可挖），或给 SVG 皮肤做更细腻的口型。
- **情绪状态**：根据回答内容（含"抱歉/失败"关键词）切到不同表情动画（沮丧/开心），而非只有 idle/answer 两种。

### 9.2 能力层（中等成本）

- **点击互动彩蛋**：多次点击机器人触发不同动作（当前只有 Jump），加个动作轮换。
- **待机活动池**：狐狸/机器人 idle 太久时随机触发一次小动作（现在是固定循环），避免"站桩"感。
- **桌宠全局活动**：把 deskpet 皮肤做成真正能在页面里走动、爬墙的桌宠（当前限制在舞台内）。

### 9.3 工程层（高价值，长期）

- **皮肤市场/外置皮肤包**：把皮肤定义抽成 JSON 配置，支持 `assets/skins/*/manifest.json` 动态加载，第三方可贡献皮肤，无需改 JS。
- **AI 生成立绘工作流固化**：把第 8 款的"生成 → 抠图 → 压缩 → 替换 generated.png"流程脚本化（`scripts/build_avatar.py`），换形象一键完成。
- **性能监控**：3D GLB 的加载耗时、WebGL 兼容性埋点，接入现有 `js/analytics.js`，识别低端设备自动降级 SVG。

### 9.4 决策待办

- **是否上语音 TTS**：收益（更像数字人）vs 成本（移动端 autoplay 限制、无声音设备），需先小范围验证。
- **狐狸 vs 机器人的默认选择**：机器人动画丰富（14 段），狐狸更可爱。当前默认机器人，可 A/B 看访客留存。
- **30 分钟冷却是否缩短/去掉**：若发现"首次进入打招呼"对引导对话有帮助，可缩短冷却或改为按会话。

---

## 附录 A：文件清单（本会话新增/改动）

```
新增：
  css/ai-skins.css            # 皮肤系统全部样式
  js/ai-skins.js              # 皮肤系统逻辑（工厂 + 舞台 + 菜单 + 状态联动）
  assets/skins/models/        # Fox.glb / RobotExpressive.glb
  assets/skins/vendor/        # model-viewer.min.js
  assets/skins/generated.png  # AI 生成专属立绘
  assets/skins/preview.png    # 9 款皮肤总览图

改动：
  index.html                  # 引入 ai-skins.css/js，版本号 v=20261110d
  js/main.js                  # AI_CONFIG.autoTip 文案 + autoTipAhead 时机
```

## 附录 B：本地验证命令

```bash
# 起本地预览（3D 需 http，不能用 file://）
python3 -m http.server 8899
# 打开 http://127.0.0.1:8899/index.html

# 控制台调试入口
window.CPAI_SKINS.list()      # 列出 9 款皮肤
window.CPAI_SKINS.use('fox3d')# 切换
window.CPAI_SKINS.menu()      # 打开菜单
window.CPAI_SKINS.current()   # 当前皮肤 id
```

## 附录 C：参考依据

- `<model-viewer>` 官方文档与动画示例：<https://modelviewer.dev/examples/animation>
- Khronos glTF 示例资产：<https://github.com/KhronosGroup/glTF-Sample-Assets>
- three.js 官方示例模型：<https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf>
- 姊妹篇（问答后端）：`docs/ai-assistant-survey.md`
- 补篇（人物资产盘点）：`docs/3d-character-library.md`


---

## 10. 2026-11-21 视觉与加载优化（已落地）

| 项 | 改动 |
| --- | --- |
| 取景 | 桌面 `orbit` 男 82% / 女 88%，窄屏男 88% / 女 108%；人物可视高度 154px → ~195px（占舞台 43% → 55%） |
| 落地感 | `shadow-intensity=0.55` + `shadow-softness=1`，另加 `.ai-stage-ground` 椭圆柔影（仅 3D 皮肤、模型 load 后显示） |
| 入口 | 新增 `.ai-stage-hint`「点我问 CP.AI」：2.6s 浮出、11s 收起，hover/focus 再显；与打招呼气泡互斥，不会叠在头顶 |
| 移动端 | 舞台 196×252 → 116×156，避免压住档案卡正文；hint/ground 各自缩一档 |
| 让位 | 面板打开时，≥1600px 才横移 `right:418px`；780–1599px 改为淡出（横移会落进正文） |
| 加载 | 3D 组件与 GLB 改为页面 `load` + 空闲后（≈4s）加载，回退兜底 2.6s；点击角色可插队 `instance.boot()` |
| 交互 | 移除双击/右键/长按/S 皮肤菜单监听（已由性别切换接管）与 230ms 点击判定，单击即时开面板 |
| 无障碍 | `aria-label` 改为「点击打开问答」；`prefers-reduced-motion` 下不 autoplay、停在待机首帧 |

已知未做（后续已在 §11 补齐）：思考（thinking）时若角色处于坐姿仍保持坐姿，缺少“在想”的肢体反馈。

---

## 11. 2026-11-21 思考态（已落地）

角色在待机 10s 后会自动盘腿坐，而问答触发思考时原来仍保持坐姿、一动不动，看不出「在算」。本轮补齐：

| 项 | 实现 |
| --- | --- |
| 起身 | `applySeq('thinking')` 命中 `sit/lay` 时先 `toIdle(false)` 站起；思考期间 `clearSit()`，久坐计时不会中途把角色按回去 |
| 复位 | 回答结束（`answer`）后 `armSit()` 重新接上 10s 久坐计时，不会一直杵着 |
| 可见反馈 | 舞台加 `.is-thinking`：头顶浮出「···」小气泡（`.ai-stage-think`，三点错峰跳动）、整体 `scale(1.022) translateY(-2px)` 前倾、`ai-mv-bob` 呼吸从 3.6s 提速到 2.2s；同时压掉 `.ai-stage-hint`，两者不叠加 |
| 剪辑 | `clips.thinking` 已指向 `'Think'`；`pickClip()` 检查 `availableAnimations`，GLB 里没有该剪辑时回退 `Idle` |

**给 Mixamo 新动画留的口子**：把导出剪辑命名为 `Think` 再替换 `assets/skins/models/*Rigged.glb` 即可自动生效，不用改代码；替换后记得把 `js/ai-skins.js` 里 `file: 'MaleRigged.glb?v=...'` 的版本号也改一下，否则浏览器会用旧缓存。

| 验证 | 结果 |
| --- | --- |
| 坐着 → 提问 | 起身，`anim=Idle`，`.ai-stage-think` opacity 0.97，hint 0 |
| 持续思考 13s | 仍站立（不会中途坐回去） |
| 回答结束 | `.is-thinking` 移除，11s 后重新坐下 |
| 移动端 390px | 气泡在头顶上方约 40px，未压头部 |


---

## 12. 女性角色接入 Think 骨骼动画（2026-11-21）

Mixamo 导出的 `Thinking.fbx`（16MB，4.23s / 30fps / 128 帧 / 28 根骨骼）已并进女性成品 GLB，男性模型暂缺，仍走 `Idle` + 头顶气泡的兜底。

### 12.1 为什么不是 Blender 重导

成品 `FemaleRigged.glb` 是 Draco + WebP 压过的（842KB），用 Blender 重新导出会把网格和贴图整条链路重做一遍。改为**只往 glTF 的 `animations` 数组追加通道**，其余字节原样保留，文件 842KB → 905KB（Think 段 54KB）。

### 12.2 三个必须知道的坑

1. **骨骼旋转空间不同**：FBX 的骨骼旋转是骨骼局部空间，glTF 节点旋转是父节点空间，直接搬运会让模型塌成一团（实测全程软成一坨）。
   解法：拿同一角色的旧动作反推每根骨骼的常量四元数 `qc = q_glb * inverse(q_fbx)`，再对 Think 逐帧左乘。本站结果是 **只有 Hips 差 −90°X**，其余 27 根都是单位四元数。
   用 `Sit` 做交叉验证：预测 vs 实际 **中位误差 0.44°，p95 4.04°，最大 9.03°**（误差主要来自两者采样率不同）。
2. **只搬 rotation**：FBX 的 bones 位移单位是厘米、glTF 是米，而且 Root Motion 会让角色走出舞台，所以丢掉了 position/scale 轨道。副作用是髋部没有上下起伏，肉眼几乎看不出。
3. **accessor 索引顺序**：建 sampler 时必须先取 `output` 的 accessor 索引，再调建时间轴的函数；否则字典求值顺序会让 `output` 指到时间轴上，表现为 Hips 通道的"四元数"其实是秒数、单帧骨骼输出全 0。

### 12.3 复现步骤

```bash
# 1) 浏览器里把 FBX 转成轨道 JSON（three.js FBXLoader，只取 quaternion 轨道）
#    片段见 tools/character-pipeline/add_fbx_anim_to_glb.py 头部注释
# 2) 反推校正 + 注入（--ref-* 用于算常量校正并交叉验证）
python3 tools/character-pipeline/add_fbx_anim_to_glb.py \
  --glb  assets/character-views/model/female/FemaleRigged_before_think.glb \
  --tracks Thinking_tracks.json --name Think \
  --ref-glb assets/character-views/model/female/FemaleRigged_before_think.glb \
  --ref-anim Idle --ref-tracks Idle_tracks.json \
  --ref-check Sit --ref-check-tracks Sit_tracks.json \
  --out FemaleRigged_think.glb
# 3) 校验 + 替换
npx -y @gltf-transform/cli@latest inspect FemaleRigged_think.glb
```

女性成品：`assets/skins/models/FemaleRigged.glb`（`?v=20261121U`）。原文件在 git HEAD 里可随时回滚，中间产物不入库；源 FBX 在 `assets/character-views/model/female/mixamo-downloads/Thinking.fbx`，按 12.3 可重新生成。

### 12.4 有真实动画后调了什么

| 项 | 处理 |
| --- | --- |
| 双重动作 | 舞台加 `.is-think-anim`（仅当 `availableAnimations` 里真有 `Think`）：取消人工前倾 `scale(1.022)`，并关掉 `ai-mv-bob` 整体浮动 —— 否则骨骼动画在晃、整块模型又在浮，双脚会离地 |
| 气泡 | 头顶「···」保留：小舞台上远看仍需要一个"在算"的信号；位置从 `top:104` 上移到 `86px`（女性头顶比男性高约 20px），移动端 `22px` |
| 起身 | 坐着被提问仍先起身再播 Think；思考期间清掉久坐计时，答完再接回 |
| 时长 | 4.23s 整段循环，首尾接缝 0.01°，不需要裁切（裁到 1.07–2.73s 反而有 5.35° 的跳变） |

### 12.5 顺手修的两个 bug

- 入场挥手（`intro`）期间就提问，`thinking` 会被丢掉：新增 `settle()`，入场/一次性动作结束后若 `state` 是 `thinking`/`answer` 就补上（`greet` 不补，否则会重播一遍挥手）。
- `activate()` 切皮肤后残留 `is-think-anim`，已一并清掉。

| 验证 | 结果 |
| --- | --- |
| 女性坐下 → 提问 | 起身，`anim=Think`，`bob:none`，`is-think-anim` 生效 |
| 持续思考 5s 以上 | 一直播 Think，不会中途坐回 |
| 回答结束 | 回 `Idle`，11s 后重新坐下 |
| 男性（无 Think 剪辑） | `anim=Idle` 兜底，`bob` 仍是 `skMvBob`，气泡照常 |
| 移动端 390px | Think 正常，气泡在头顶上方约 12px |

---

## 13. 角色 ↔ 面板「语义联动」v2（2026-11-21）

### 13.1 这一版解决什么

上一版角色只承担两件事：入口按钮 + 状态灯（打字中=thinking，答完=answer 播一次动作）。面板一开，780–1599px 直接淡出 —— 而这正好是笔记本的主流宽度，等于多数访客从来没看到"角色在回答"。这一版把它改成**发言人**，面板文字是**字幕**。

| 层级 | 改动 | 文件 |
| --- | --- | --- |
| 空间 | 面板展开时不再淡出，缩小后贴到面板左缘（900/1200/1600 三档） | `css/ai-skins.css` §让位 |
| 节拍 | 语音真出声时头顶换音波条（`body.cpai-speaking` 已有轻度律动，这里补可见信号） | `css/ai-stage-link.css` / `js/ai-stage-link.js` |
| 语义 | 回答命中站内区块 → 角色头顶递「去看看」小票，点击才滚动 + 描边落点 | 同上 |
| 边界 | 不自动滚动、不自动开区块；移动端与 `.ai-panel.is-max` 一律不出现 | `js/ai-stage-link.js` |

### 13.2 让位几何（实测值，1440×813 视口）

| 视口 | 缩放 | 舞台视觉尺寸 | 右缘 → 面板左缘 |
| --- | --- | --- | --- |
| ≥1600 | .78 | 218×281 | 8px |
| 1200–1599 | .68 | 190×245 | 8px |
| 900–1199 | .58 | 162×209 | 8px |
| <900 | 隐藏 | — | 面板已占大半屏 |

- `right: 412px` = 面板右距 18 + 面板宽 386 + 8 间隙；`bottom: 18px` 与面板底齐平，`transform-origin: right bottom`。
- 面板打开期间 `pointer-events: none`：此时点角色等于 `aiFab.click()`，会把面板关掉，属误触。
- 整体缩放会把 `.ai-stage-think` 压到 5px 字，已用 `scale(1.7)` + `transform-origin: 50% 100%` 反向抵消。

### 13.3 指路路由表

先看**问题**（意图最明确），问题没命中再看**回答**里关键词出现 ≥2 次，避免答案正文随便提一句"项目"就弹票。命中后仍要求：面板已开、视口 ≥900、目标元素存在、非错误回答（`▍` 开头不弹）、非 JD 结果卡。

| 问题关键词 | 落点 |
| --- | --- |
| 项目 / 作品 / 案例 / 系统 / 落地 | `#projects` |
| 经历 / 公司 / 任职 / 离职 / 年限 | `#experience` |
| 技能 / 技术栈 / 框架 / 会什么 | `#skills` |
| 教育 / 学历 / 学校 / 毕业 | `#education` |
| 证书 / 奖项 / 荣誉 | `#awards` |
| JD / 岗位 / 匹配 / 招聘 | `#jd` |
| 联系 / 邮箱 / 电话 / 约面试 | `#contact` |

小票停留 9s，点击才滚动（`scrollIntoView` smooth，落点偏移交给 `html` 已有的 `scroll-padding-top: 84px`），落点描边是独立 `.cp-spot-frame` 浮层，只框目标上部 ≤360px，不往 section 塞伪元素。

### 13.4 验证

| 检查项 | 结果 |
| --- | --- |
| 1920 / 1440 / 1024 / 900 四档让位 | 舞台右缘与面板左缘恒为 8px，底边与面板齐平 |
| 800px | 舞台隐藏、票 `display:none` |
| 问题「你主导过哪些项目？」+ 项目型回答 | 票出现，文案「去项目区看证据 / P-01 ~ P-05 · 业务与结果」，右缘 1028 不压面板（1036） |
| 问题「你好，你是谁？」+ 自我介绍回答 | 不弹票（无关键词命中） |
| `window.CPAI_STAGE_LINK.demo('projects')` | 手动递票，用于调试视觉 |
