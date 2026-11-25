# 前端 React 化重构 · 落地方案

> 版本：v1.2（2026-11-26）
> 状态：**执行中** —— M0 已上线（提交 7478ee7），M1 代码完成待发布；各阶段实况见文末[里程碑日志](#里程碑日志)。
> 评审已通过并启动执行；决策点 D1–D9 均按默认建议拍板；执行中按方案推进，任何方向性变更须更新估算并注明版本。
> 变更记录：v1.2 新增里程碑日志（M0/M1 实况）；v1.1 新增 §5.8 移动端与触屏适配策略（现状盘点落表、测试矩阵细化到各里程碑验收）、风险 R11/R12、附录 A.7 移动端专项清单，估算含真机走查电池。
---

## 目录

1. [背景与目标](#1-背景与目标)
2. [现状盘点](#2-现状盘点)
3. [要不要做：动机与代价的诚实评估](#3-要不要做动机与代价的诚实评估)
4. [技术选型评估](#4-技术选型评估)
5. [目标架构](#5-目标架构)
6. [迁移策略与分阶段计划](#6-迁移策略与分阶段计划)
7. [风险评估与缓解](#7-风险评估与缓解)
8. [可维护性评估](#8-可维护性评估)
9. [工作量估算](#9-工作量估算)
10. [决策点清单](#10-决策点清单)
11. [附录 A：功能迁移对照清单](#附录-a功能迁移对照清单)
12. [附录 B：技术选型速查版本表](#附录-b技术选型速查版本表)
13. [里程碑日志](#里程碑日志)

---

## 1. 背景与目标

### 1.1 项目现状一句话

一个**真实在用**的求职作品集：零框架纯静态前端（原生 HTML/CSS/ES5 IIFE）+ 跑在 Cloudflare 边缘的后端（Pages Functions + D1 + Vectorize + Workers AI）+ 腾讯云 TTS 兜底。内容数据驱动（单一真相源 → 生成器 → CI 漂移检查），正式域 `chenpeisheng.cn`，GitHub Pages 保留为纯静态备份线路。

### 1.2 为什么现在提 React 重构

前端代码量与复杂度在 2026 年内翻了数倍：

| 维度 | 早期 | 现在（2026-11） | 趋势 |
| --- | --- | --- | --- |
| 站点页面 | 1 页（index） | 9 个入口页 + admin 后台 | 继续增加（school、admin 均为近期新增） |
| 前端 JS | ~1,500 行单文件 | **16 个模块 9,275 行**，main.js 单文件 2,245 行 | 持续膨胀 |
| CSS | ~800 行 | 9 个文件 **10,315 行**（style.css 2,678 / company-profile.css 1,250） | 持续膨胀 |
| 交互子系统 | 无 | AI 数字分身（皮肤/语音/3D 舞台/JD 模式）、留言墙、自动投递、学历核验、私密佐证、分享卡、全景图、访问统计 | 仍在新功能在途 |
| 前端依赖 | 0 | 0（vendor 两份：html2canvas、model-viewer） | — |

`main.js` 已出现典型的「巨石模块」症状：渲染层/交互层/AI 面板/留言墙 600+ 行全部塞在一个 IIFE 里靠分节注释区分；`window.CP_*`（CP_AI_ENDPOINT / CP_JD_UI / CompanyProfile …）成为跨文件隐式契约，调用方靠注释纪律而非类型系统保证一致。

### 1.3 重构目标（按优先级）

1. **G1 可维护性**：把「HTML 字符串拼接 + 手动 innerHTML + 事件委托」的渲染层，改为组件化 + TypeScript 类型约束；跨模块契约（数据形状、API 出入参、store 状态）全部类型化。
2. **G2 工程能力展示**：作品集本身就是求职名片，现代 React 工程化（组件分层、构建链、测试、CI 质量门）与站内 AI/RAG 故事互为印证，这是**本重构对求职目标最直接的价值**。
3. **G3 复用收敛**：主页「工作经历卡」与简历页、公司档案抽屉/独立页、学校档案之间存在大量近似 DOM 结构，组件化天然消除。
4. **G4 测试可行性**：现有纯函数测试（29 文件）只覆盖后端逻辑与解析器；渲染与交互逻辑基本裸奔，React 生态（RTL + Playwright）补齐。

### 1.4 非目标（不可变约束，验收时逐条核对）

| # | 不变量 | 说明 |
| --- | --- | --- |
| N1 | **视觉零变化** | Neo-brutalism 纸感设计、四主题（archive/blueprint/newsprint/noir）、全部动效逐像素等价（允许实现方式变化，不允许观感变化） |
| N2 | **后端零改动** | `functions/`、`worker/`、`functions/tencent/`、D1/KV schema、全部 `/api/*` 契约不动；React 只替换静态资源层 |
| N3 | **URL 100% 保留** | `index` / `resume.html` / `jd.html` / `company.html?c=` / `school.html` / `work/*.html` / `admin` / `login` 已被对外投递（简历/邮件/名片），一个都不能换 |
| N4 | **功能零丢失** | 附录 A 清单 40+ 项逐一迁移，含彩蛋（EOF 三连击风格控制台、性别切换热区） |
| N5 | **性能基线不降** | 主页在 4G/中端安卓下 Lighthouse Performance ≥ 现状值（M0 先采基线，见 §6）；resume 打印/PDF 链路不回归 |
| N6 | **数据链不变** | D1 `site_content` 动态路由 `/data/<file>` + 仓库脱敏快照 fallback 的双层模型、CI 漂移检查语义保留（实现可换，闸门不撤） |

> 明确接受的损失（无法两全，需用户知情）：**双击 `file://` 直接打开的零构建特性将不复存在**——React 构建产物依赖 HTTP 服务器加载模块。替代：`node scripts/dev-api-server.mjs`（已有）+ 新增 `npm run dev` 一键预览。

---

## 2. 现状盘点

> 完整口径见 README；这里只列与重构直接相关的部分，数据为 2026-11-25 实测。

### 2.1 页面清单与角色

| 页面 | 行数(HTML) | 渲染方式 | 复杂度 | 迁移难度 |
| --- | --- | --- | --- | --- |
| `index.html` | 551 | 骨架静态 + main.js 数据驱动渲染 10 板块 | ★★★★★（AI 面板/留言墙/分享卡/蛇图/彩蛋全在此） | 高 |
| `resume.html` | 1,723 | **纯生成物**：`templates/resume.template.html` ← `data/site-data.json` 经 `render_resume.mjs` 产出；ATS 友好 + A4 打印 + 自动投递 | ★★★★（打印 CSS、深链锚点、PDF 资产） | 高（特殊） |
| `jd.html` | 227 | 自带轻量壳 + `jd-match.js`（517 行，IIFE） | ★★★ | 中 |
| `company.html` | 234 | 壳 + `company-profile.js`（1,218 行）抽屉/独立页双形态共用 `renderPanel` | ★★★★（快照、打印、深链 `#company=`） | 中高 |
| `school.html` | 201 | 壳 + `school-profile.js`（812 行）+ **默认加锁**（secure-access 635 行：申请→审批→签名解锁） | ★★★★ | 中高 |
| `work/portfolio.html` | 509 | 生成物：`work-detail.template.html` ← `work-details.json` | ★★ | 低 |
| `404.html` | 86 | 纯静态 | ★ | 低 |
| `admin`（/admin, /login） | 独立 1,033 JS + 475 CSS | 原生 JS 单页，构建时注入 `dist/admin` | ★★★★（统计/设备/留言/问答/KB/配置/导出） | **中（收益最大）** |

### 2.2 前端 JS 模块（16 个，9,275 行）

| 模块 | 行数 | 职责 | 迁移去向（目标组件树） |
| --- | --- | --- | --- |
| `main.js` | 2,245 | 数据层（fetch+快照兜底）、全站渲染、12 节交互（菜单/滚动高亮/进场/计数/技能条/模态/彩蛋/分享卡/AI 面板/留言墙/视口自适应） | `sections/*`（10 板块组件）+ `features/*`（wall/share/toc）+ `lib/data` |
| `company-profile.js` | 1,218 | 抽屉+独立页双形态渲染、徽章填充、产品橱窗、全景、打印 | `features/company/`（Drawer 页面组件化） |
| `ai-skins.js` | 917 | 3D 角色舞台、皮肤系统、角色↔面板联动 | `features/ai/stage/` |
| `school-profile.js` | 812 | 学校档案（与 company 同构） | `features/school/` |
| `ai-voice.js` / `ai-voice-cloud.js` | 740+281 | 语音播报双通道（浏览器 TTS / 腾讯云） | `features/ai/voice/` |
| `secure-access.js` | 635 | 学历核验申请-审批-签名解锁 | `features/secure-access/` |
| `jd-match.js` | 517 | JD 表单/请求/结果渲染/导出/重试；对外暴露 `CP_JD_UI` 复用 | `features/jd/` |
| `cp-panorama.js` | 470 | 360° 全景拖拽 | `features/company/Panorama*` |
| `company-social.js` | 287 | 档案浏览/点赞/评论 | `features/company/social/` |
| `ai-stage-link.js` | 241 | 角色↔面板↔页面元素联动描边 | `features/ai/stage-link/` |
| `visitor-count.js` / `analytics.js` | 214+211 | 复古里程表、埋点 | `lib/` hooks |
| `asset-cdn.js` | 167 | 资源路径→COS 直链改写 | `lib/asset-url`（构建期+运行时双轨） |
| `print-preview.js` / `gender-switch.js` / `ai-panel-ux.js` | 112+110+98 | 打印预览对比、性别形象切换、面板分栏 UX | 各自小组件/hook |

### 2.3 关键跨文件契约（React 化时必须收编或兼容）

| 契约 | 生产者 → 消费者 | 处置 |
| --- | --- | --- |
| `window.SITE_DATA`（JSON 快照） | `data/site-data.js` → main.js 兜底 | 改为模块 import + fetch 兜底 hook |
| `window.CP_AI_ENDPOINT` / `API_BASES` | main.js → jd-match/ai-voice | 收进 `lib/api/client.ts`（多线路逻辑逐字保留） |
| `window.CP_JD_UI` | jd-match.js → main.js 面板 JD 模式 | 同 bundle 后改为直接 import；保留 window 挂载一段时间防外链引用 |
| `window.CompanyProfile.{render,get,open,…}` | company-profile.js → main.js / company.html | 组件 props + Context 替代 |
| `data-theme` + `prefers-reduced-motion` | style.css ↔ 多模块 | **原样保留**（纯 CSS 契约，与 React 无关） |
| `data-cp` / `data-cp-quick` 属性 + 事件委托 | main.js 渲染 ← company-profile.js 委托 | React onClick 替代 |
| `#company=xxx` 深链（含 PDF 内超链接） | resume.html PDF → company.html | 路由 query 解析组件化 |
| Turnstile / model-viewer / html2canvas 全局脚本 | index.html `<script>` | admin 之外保留全局加载（库本身不 React 化，包一层 React 组件） |

### 2.4 构建与 CI（重构后需要对接的管道）

```
git push ─┬─▶ Cloudflare Pages 自动构建
          │     Build: bash scripts/pages-build.sh → dist/
          │     （根 HTML 自动收集 + CSS/JS/data/images 拷贝 + fallback 快照 + admin 注入 + 硬校验缺文件即失败）
          ├─▶ GitHub Actions × 4：tests（29 文件）/ content-build（漂移）/ sync-site-data（快照）/ contributions（热力图每日）
          └─▶ GitHub Pages（main 根目录直发，纯静态备份线路）
```

前端 React 化的产物必须仍然能被 `pages-build.sh` 的**硬校验清单**（§构建脚本 ⑥ 段）与漂移闸门接收——这不是约束障碍，而是质量资产：新构建链输出对齐即可复用全部闸门。

---

## 3. 要不要做：动机与代价的诚实评估

重构方案文档如果只讲收益就是提案书。先给反方观点：

### 3.1 反方（维持零框架的理由）

1. **性能优势是真实的**：现状零运行时、零水合，首屏不依赖 JS；React 无论怎么优化都要背 ~45KB gzip（react+react-dom 19）+ 水合成本。
2. **「零框架」本身是作品集叙事的一部分**：README 开头即以此为卖点（"没有前端框架的静态站，长出了一整套边缘后端"）；改成 React 后这个差异化故事消失（但可替换为「React 19 + Astro + 边缘后端」的新叙事，不必然是损失）。
3. **单人维护 + 功能在途**：另一会话仍在持续开发（admin 功能、私密佐证……），长迁移期双轨并存，合并成本高。
4. **file:// 双击可开**：给非技术的人看简历的兜底场景消失。

### 3.2 正方（重构的理由）

1. **复杂度已越过零框架的舒适区**：9275 行 JS 里 4000+ 行是手写 DOM 字符串 + innerHTML + 手动事件绑定/解绑。每加一个板块都要在 main.js 挖坑；「板块显隐 + 编号自适应」这类本应是配置的横切逻辑（2026-11-25 提交 89649d5 + 1a352fc 的实现过程即是证据）写成了互相咬合的 DOM 手术。
2. **隐式契约已经出血**：`ground`/`ratio` 字段名不一致导致重合度恒 0%（11-22 实际修过的线上 bug）、`href="#jd"` 缓存事故、`CP_JD_UI` 惰性依赖——都是缺类型契约的代价，TypeScript 能在编译期消灭这一整类问题。
3. **测试基本只能测纯函数**：`tests/` 29 个文件几乎全是后端/解析器测试；渲染与交互（占代码量 70%+）回归靠人肉点。React RTL 把这部分纳入自动化。
4. **同构模块的三份拷贝**：company-profile / school-profile / 经历卡是一套「档案页」概念的三个手写变体，组件化天然归一。
5. **对求职目标而言，React 工程是硬通货**：简历定位「AI Agent 工程师（偏前端交付）」，作品集全站 React 19 + TS + 边缘后端的组合，比零框架更能向 HR/技术面证明工程宽度。**这一条与 G2 对应，是本次重构的第一性动机，应以工程师视角认真做，而不是赶工时作秀。**

### 3.3 结论

**建议执行，但按「渐进式、零切换风险」的路线执行**（见 §6）：旧站持续在线服务，React 版在同仓库 `react/` 或独立 Pages 预览项目并行发育，逐页替换、逐页验收，任何阶段可放弃且旧站无损。同时以 §1.4 N1–N6 不变量作为每阶段验收门，防止「重构=重写=换皮」的失控。

> 需要**明确否决**的一种做法：一次性大爆炸重写整个站点（哪怕是新分支）。对一个每天有真实访客、承载在途求职进度的站点，冻结三四周重写再切流，风险与收益完全不成比例。

---

## 4. 技术选型评估

### 4.1 硬约束（由部署形态决定，先划死）

1. 生产是 **Cloudflare Pages**：静态资产 + Pages Functions（Worker 运行时，非 Node）。任何需要长驻 Node 服务器的方案（Next.js 自托管、 SSR with Node APIs）直接排除或需经适配层。
2. GitHub Pages 备份线路只能发**纯静态文件**（无 Functions，前端 API 直指 `shenge-work.pages.dev`——现有 `API_BASES` 机制已处理，需保留）。
3. `functions/` 目录被 Pages 自动编译，**重构不得移动/改名**（N2）。
4. 单文件 25MiB 上限；`dist/` 构建产物结构与硬校验清单见 §2.4。

### 4.2 候选方案对比

| 维度 | A. Vite + React SPA（多入口 MPA） | B. React Router v7 framework mode | C. TanStack Start | D. **Astro 6 + React islands（推荐）** | E. Next.js |
| --- | --- | --- | --- | --- | --- |
| 渲染模式 | 纯 CSR | SSR/SSG/SPA 可选（Cloudflare 官方模板） | SSR/SSG（Workers 部署） | **默认 SSG，按岛水合**，可选 SSR | SSR/RSC 为主 |
| 首屏/SEO | ✗ 白屏期，SEO 需预渲染插件补救 | ✓ SSG/SSR | ✓ | ✓✓ 静态 HTML 直出，最优 | ✓ |
| 与「多独立 HTML 页」现状同构度 | 中（Vite MPA 多入口，每页仍是一个 html） | 低（单入口树结构，URL 要靠 rewrite 对齐） | 低 | **高（一页一 .astro 一 URL，N3 天然满足）** | 低 |
| 性能基线保持（N5） | ✗ 全量水合，主页必受影响的板块太多 | △ 需细调 | △ | ✓✓ 90% 内容零 JS，只水合交互岛 | ✗/△ 框架运行时+RSC 传输 |
| resume.html 生成器/打印链路 | △ 手工改造深 | △ | △ | ✓ 构建期即产出完整静态 HTML，ATS/打印语义不变 | △ |
| React 代码占比 | 100% | 100% | 100% | **85–95%**（.astro 仅作极薄页面壳与数据装配层） | 100% |
| React 19 / Compiler | ✓ | ✓ | ✓ | ✓（islands 内完整 React） | ✓ |
| 部署到 Cloudflare Pages | ✓ 直觉简单 | △ 需 Workers SSR 适配（@react-router/cloudflare） | △ Workers 适配 | ✓✓ **静态直出零适配**；Cloudflare 2026-01 收购 Astro，一等公民待遇 | ✗ 需 @cloudflare/next-on-pages 转译层，与 Pages Functions 并存复杂 |
| 迁移渐进度 | ✗ 整站换入口 | ✗ 路由树一次性接管 | ✗ | ✓✓ **页面级替换**：未迁移页保持现状同仓共存 | ✗ |
| admin 后台迁移 | 一致 | 一致 | 一致 | 一致（admin 可选整页 `client:only="react"`） | 一致 |
| 团队单人熟悉成本 | 低（React 常识） | 中 | 中高 | 中（Astro 概念 1-2 天上手，本质是模板壳） | 中 |
| 主要风险 | SEO/性能回退、预渲染维护 | Workers SSR 生态边角问题 | 生态相对年轻 | 岛间共享状态需 nanostores 模式约束 | 完全不适配本部署形态 |

**排除项**：E（Next.js）对「纯静态 Pages + Functions」形态的适配是五案中最差，排除；C（TanStack Start）类型安全最优但与现有 URL/静态形态对齐成本高，且生态仍在快速变动，不作为主案（其 **TanStack Query / Router 库层面**仍会在方案 D 中作为库使用）；B（React Router v7 framework）适合「整个站就是应用」的场景，本站 90% 是内容展示，SSR 运行时属于过度供给，排除主案。

### 4.3 推荐组合（主方案）

```
Astro 6（页面壳 + 构建期数据装配 + 静态输出）
  └── React 19.x + TypeScript（页面内整页组件树，承载全部 UI 实现）
        ├── TanStack Query v5（服务端态：/api/chat、wall、visits、jd、company-social…）
        ├── nanostores/@nanostores/react（跨岛轻量状态：主题、面板开关、AI store）★Astro 官方推荐
        ├── react-hook-form + zod（表单：投递、留言、核验申请、admin 编辑）
        ├── @tanstack/react-form 可选替代（admin 复杂表单再定）
        └── 现有 CSS 变量主题系统原样迁移（见 §5.5）
工具链：Vite 8（Astro 内置）/ Vitest + React Testing Library（单元）/ Playwright（E2E 视觉回归）
```

**为什么不是「纯 Vite + React」**：对齐 N3（URL 逐字保留）与 N5（性能基线）时，SPA 要补的预渲染、多入口配置、与 `functions/` 共存的构建编排，最终会重新发明 Astro 的页面层，且性能预算仍然守不住。Astro 的 .astro 文件在本方案中**只有十几行**（frontmatter 装配数据 + `<Page client:load />`），React 占绝对主体——满足「前端用 React 重构」的实质，同时白送 SSG/性能/URL 同构。

**React 组件占比说明**：所有可视化输出（DOM 结构、交互逻辑、状态）100% 由 React 函数组件实现；.astro 承担的是「路由文件+数据装配+资源声明」这层薄壳，类比 Next.js 的 `page.tsx` 外框但更薄。这个定位要向评审者讲清楚，避免「Astro 重构 ≠ React 重构」的误读。

### 4.4 备选组合（若决策点 D2 选择「纯 React 大一统」）

```
Vite 8 + React 19 + TypeScript（react 官方模板）
  ├── react-router v7（library mode，数据路由）
  ├── Vite 多入口：index / resume / jd / company / school / portfolio 每页保留独立 .html（N3）
  ├── vite-plugin-prerender 或 prerender 内建：构建期预渲染六入口（SEO 补救）
  ├── 其余选型同主方案（Query/nanostores/rhf+zod）
  └── 代价：全量水合 → 主页性能预算重谈（N5 只能放宽到「FCP 不降、TTI 允许 +300ms」）
```

> 主案与备选的**组件代码 100% 互斥可移植**：组件树、hooks、store、API client 不含任何框架壳知识，切壳成本 < 1 天。这是刻意的设计边界（见 §5.1 目录结构），即使 M2 后反悔换备选方案，已完成工作量不报废。

---

## 5. 目标架构

### 5.1 目录结构（monorepo 单包，避免 over-engineering）

```
.
├── astro.config.mjs           # Astro 6：integrations: [react()]，outDir 对齐 dist/
├── package.json / pnpm-lock.yaml / tsconfig.base.json
├── src/
│   ├── layouts/
│   │   └── SiteShell.astro    # <html> 骨架、字体、主题引导脚本、Turnstile、全局 CSS
│   ├── pages/                 # == URL 契约（N3），一文件一旧 URL
│   │   ├── index.astro               #  → <HomePage />          （水合策略见 §5.4）
│   │   ├── resume.astro              #  → <ResumePage />        (SSG 输出全文，打印链路 §6-M4)
│   │   ├── jd.astro                  #  → <JdPage />
│   │   ├── company.astro             #  → <CompanyPage />       # ?c=<id>
│   │   ├── school.astro              #  → <SchoolPage />
│   │   ├── work/portfolio.astro      #  → <PortfolioPage />
│   │   └── 404.astro
│   ├── components/            # 纯 React（无框架壳依赖，主备案可移植的保证）
│   │   ├── sections/          # 主页 10 板块：Hero / About / Experience / Projects / Skills / Wall …
│   │   ├── company/           # Drawer / Panel / ShowCase / Panorama / Social …
│   │   ├── school/            #
│   │   ├── jd/                # Form / Stage / ResultTable / EvidenceExcerpt …
│   │   ├── wall/              # 留言墙 + 追问线程
│   │   ├── share/             # 分享卡（html2canvas 包一层）
│   │   └── ui/                # Tag / Pill / Lamp / Toast / Modal（Neo-brutalism 基元）
│   ├── features/ai/           # Panel / Stage(3D) / Voice / Skins / StageLink / JD-mode
│   │   └── store.ts           # nanostores 岛间状态
│   ├── lib/
│   │   ├── api/               # client.ts（API_BASES 多线路逐字迁移）+ 各端点 query hooks + zod schema
│   │   ├── data/              # useSiteData / useCompanyProfiles / 快照兜底
│   │   ├── theme.ts / asset-url.ts / gender.ts / print.ts
│   │   └── vendor/            # model-viewer / html2canvas React 包装组件
│   ├── styles/                # review §5.5：现有 9 个 CSS 文件平移进 src/styles/
│   └── content/               # 仅类型与 zod schema；真相源仍是 data/*.json（N6）
├── data/                      # ★ 保持原位不动（脱敏真相源 + 快照 + CI 闸门对接点）
├── functions/ worker/ db/     # ★ 原样（N2）；构建时 pages-build.sh 复制进 dist
├── admin/                     # M1 迁移：admin/public → src/pages/admin.astro + features/admin/
├── scripts/                   # 现有生成器改造（见 §6 各阶段）；pages-build.sh 演进
└── tests/                     # 现有 29 文件保留 + e2e/（Playwright）+ react 单测就近放置
```

要点：

- **不用 pnpm workspace/monorepo**：单包足够，多包是给「多应用」准备的，这里只有一个 web 应用。
- **`data/` 与 `src/content/` 的关系**：不引入 Astro Content Collections 管理简历数据——现有「JSON 真相源 + 生成器 + 漂移闸门」是已验证的资产（N6），Astro 只在页面层 import JSON。
- **组件树可移植边界**：`components/` `features/` `lib/` 下**禁止 import astro 模块**（ESLint 规则强制），保证主备方案切换与未来退路。

### 5.2 路由与 URL 映射（N3 对照表）

| 现 URL | 现实现 | 新实现 | 备注 |
| --- | --- | --- | --- |
| `/` | index.html | `pages/index.astro` | 逐板块见迁移计划 |
| `/resume.html` | 生成物 HTML | `pages/resume.astro` SSG | URL 带 `.html`，Astro 需 `build.format: 'file'` 输出同名文件 |
| `/jd.html` | 独立页 | `pages/jd.astro` | 同上 |
| `/company.html?c=x` | 壳+JS 渲染 | `pages/company.astro` + React query 解析 | 深链 `#company=` 旧链接兼容（301 或同页解析） |
| `/school.html` | 同上+加锁 | `pages/school.astro` | secure-access 是运行时行为，SSG 不冲突 |
| `/work/portfolio.html` | 生成物 | `pages/work/portfolio.astro` | render_work_details 生成器退役，Astro 直接吃 work-details.json |
| `/admin` `/login` | build 注入 | `pages/admin.astro` `pages/login.astro` | pages-build.sh 注入段调整为直接产物 |
| `/404.html` | 静态 | `pages/404.astro` | — |

### 5.3 状态与数据分层

```
┌─ 服务端态（TanStack Query，按 key 缓存/重试/失效）
│    /data/site-data /data/company-profiles /data/school-profiles /data/people
│    /api/wall /api/visits /api/chat(qa) /api/jd /api/company-social …
│    每个端点：queryKey 工厂 + zod 出参校验 + staleTime 语义对照现有实现
├─ 客户端全局态（nanostores）——跨岛/跨组件共享
│    $theme $aiPanelOpen $aiMode $gender $stageLinkTarget
│    （对应现有 window 层隐式全局，唯一可信源，localStorage 持久化对齐）
├─ 组件局部态（useState/useReducer）
└─ URL 态（Astro params + 历史查询参数）—— c=/gender= 等保留
```

**快照兜底加载顺序逐字保留**：`fetch(/data/<file>)` 失败 → 构建产物 fallback → `window.__SNAPSHOT__`（构建期内联的脱敏快照）。三层数据可用性是现有站点在 D1 未配置域名下不白屏的关键（N6）。

### 5.4 水合策略（性能预算落到页面）

| 页面/岛 | 指令 | 理由 |
| --- | --- | --- |
| `index` 的 10 板块壳 | `client:visible` | 进视口水合，等价现有 reveal 懒启动 |
| AI 面板 + 3D 舞台 | `client:idle` | 不阻塞 LCP；3D 资源按后台套装配置懒取 |
| 留言墙表单/列表 | `client:visible` | — |
| 分享卡生成器 | `client:media="print"` 之外的按钮触发动态 import | html2canvas 只在点击时加载 |
| `jd.html` / `company` / `school` | `client:load` | 页面主体即应用 |
| `resume` | **构建期纯静态**，仅投递表单与打印预览两岛水合 | ATS/打印不回归的关键 |
| `admin` | `client:only="react"` | 登录态 SPA |

### 5.5 样式策略：CSS 变量主题系统原样保留

- **不引入 Tailwind**。现有 10.3k 行 CSS 的价值在「设计即代码」：CSS 变量 + data-theme 四主题 + 打印媒体查询是资产不是负债，Tailwind 重写是纯成本且必然破坏 N1 像素等价。
- 平移方式：`css/*.css` → `src/styles/*.css` 原文件拷入，组件内类名**保持现有类名不变**（`.exp-card` `.cp-product` 等继续使用，不转 CSS Modules）。理由：类名已被打印 CSS、后台注入、第三方程式引用；且「全局类名 + BEM 风格」与 React 组件化并不冲突（组件自带样式收拢在自己的 .css）。
- 按组件收拢为新文件的组织原则：迁移板块时顺手把该板块样式从 `style.css`(2678 行) 拆到 `sections/experience.css` 之类的局部文件再 import——只做物理拆分，不改任何选择器与值。
- **版本号查询串问题自然消亡**：Vite/Astro 内容寻址产物（`main.[hash].js`）替代手工 `?v=20261125x` bump，11-22 的「旧缓存导致 hero 按钮失效」一类事故从机制上根除。

### 5.6 API 客户端与类型契约

- `lib/api/client.ts`：迁移 `API_BASES`（本地/github.io/pages.dev 三态）+ 每用户限流提示、`mode:tts` 转发、错误码→人话文案表（现有 `errorText` 逐字对照迁移）。
- 出入参 zod schema 的**真相源**：`functions/api/*.js` 的 JSDoc 注释（其中 jd.js/chat.js 已有结构注释）。M2 起每迁移一个端点，同步把该 schema 提炼为 zod，测试断言与 `tests/*.test.mjs` 现有断言共用样例。
- 不引入 openapi 代码生成（Functions 不是 openapi 形态，手写 zod 更快更准）。

### 5.7 后台（admin）与登录

admin 是本次重构**单位收益最高**的部分：原生 JS 1,033 行的多 tab 控制台（统计/设备/留言/问答看板/KB 状态/配置/导出），表格、表单、轮询密集，恰好是 React + TanStack Query 的甜蜜区（轮询 `refetchInterval`、失效 `invalidateQueries` 替代手写 setInterval 状态机）。列为 M1 试点（§6）。

### 5.8 移动端与触屏适配策略

移动端与桌面是**并列的一等验收档**，不是「适配检查项」。先落实现状盘点（全部为 2026-11-25 代码实测），再定迁移处置：

| 维度 | 现状（实测） | 迁移处置 |
| --- | --- | --- |
| 响应式断点 | **15+ 个碎片断点**（`max-width: 680px` 主力×11 处，另有 640/620/560/760/768/720/899/900/980/1024 及 min-width 组合），CSS 平面内手工维护 | 逐像素等价平移（N1），**本重构不整合断点**；断点收敛为 M5 之后的独立债务项（动到它 = 全站视觉重验） |
| 响应式 JS | `syncResponsiveGuard`（main.js 尾部）：顶栏导航按几何测量逐项退让→全藏才收汉堡菜单，绑定 resize/load/fonts.ready 三源重算；另维护 `--vw-real`（排除 Windows 滚动条的真实视口宽） | 移植为 `useResponsiveGuard` hook：**测量与类名变更仍在 DOM 层同步完成（refs 直改 class，不走 React state）**，useLayoutEffect + ResizeObserver + fonts.ready 触发——避免「测量→setState→重测」渲染循环，保留「复位→裁决→复测」防抖动语义 |
| 触屏手势 | 4 处 Pointer Events：全景拖拽（`passive:false`）、档案灯箱拖拽、桌宠拖拽、语音手势解锁（pointerdown/touchstart 双监听） | 抽象 `usePointerDrag` hook 复用四处；Pointer Events 原样保留（目标浏览器全兼容，不写 touch 回退层）；`passive:false` 语义逐处对齐（防拖拽时误触页面滚动） |
| hover 守卫 | `@media (hover:hover)` 仅 style.css 有（9 处）；company/school/jd 等文件的 `:hover` 无守卫 → 触屏设备首点会触发一次粘滞 hover 态 | **原样保留**（N1 行为等价：这是现状怪癖不是迁移 bug）；记录进已知怪癖清单，与断点整合同阶段治理 |
| viewport 声明 | 各页两种等价写法混用（`initial-scale=1` / `=1.0`）；无 `viewport-fit=cover`，全站无 safe-area 使用 | 统一为单一写法（行为零变化）；布局依赖 safe-area 的现状不存在，保持不引入 |
| iOS/滚动表现 | `100vh/100vw`（灯箱、AI 面板）+ `--vw-real` JS 补偿；`-webkit-backdrop-filter` / `-webkit-overflow-scrolling` / `-webkit-tap-highlight-color`；面板开时 `body.ai-panel-open` 驱动角色退位（多断点 scale 连锁） | 全部原样平移（含未列出的其余 -webkit- 前缀）；`100vh→dvh` 改造列为观察项——iOS 地址栏收展跳动是**现状已有行为**，迁移期改它反违反 N1 |
| PWA | manifest.json（standalone、zh-CN、双尺寸图标）已配置；**无 service worker**（无离线能力） | manifest + 图标在构建链中原样进 `dist/` 根；不新增 SW（离线能力不在本重构范围） |
| 移动性能预算 | 无独立预算，靠 Lighthouse 移动档兼看 | 岛水合对中低端机收益大于桌面（CPU/内存/网络预算更紧）；**Lighthouse 以移动档（4G 节流）为主验收档**，桌面档兼顾 |

**测试矩阵（各里程碑验收硬性要求，缺档不得合入）**：

| 层 | 工具/设备 | 覆盖 |
| --- | --- | --- |
| 仿真快照（CI） | Playwright device descriptors（iPhone 12 / Pixel 5 / iPad Mini） | 全页视觉快照：4 主题 × 390 / 680 / 768 / 1024 四档视口（覆盖主力断点 680 与面板锁 760 附近） |
| 仿真交互（CI） | Playwright `hasTouch` + 手势 API | A.7 手势专项：全景/灯箱拖拽、滚动锁、汉堡菜单、面板开合 |
| 真机走查（人工电池） | iOS Safari + 微信内置浏览器 + Android Chrome（各一台真机） | M1/M3/M4 验收日执行：主题切换、AI 面板全流、JD 提交、分享卡下载、简历投递；微信内置浏览器重点看 webview 差异（输入键盘顶起/长按选择/TTS 可用性） |

---

## 6. 迁移策略与分阶段计划

### 总原则

1. **`main` 分支永远可上线**：旧静态站与 React 产物在仓库内共存（旧页面保留原位），`pages-build.sh` 按页面粒度混排两套产物，迁移一页、混排一页、上线一页。不设"切换日"。
2. **每阶段完成即独立有价值**，中断不产生半成品风险（半完成页面 = 该页仍是旧版，零影响）。
3. **每阶段必过验收**：N1（视觉快照 Playwright toMatchSnapshot 全页对比，**含移动视口**）+ N4（该页功能清单人工+自动走查，**含触屏专项**）+ N5（Lighthouse 移动档为主对比）三项绿才能合入 main。

### M0 脚手架与基线（0.5 天）

- 采性能基线：对 `index/resume/jd/company` 在 4G 节流 + 1440/390 双视口跑 Lighthouse 存档（`tests/e2e/baseline/`，后续每阶段对比）；**移动档为主档**。
- 视觉基线：Playwright 全页截图存档（四主题 × 主页面 × **390/680/768/1024 四档视口**，含 `hasTouch` 设备描述符一档）；触屏手势基线（全景/灯箱拖拽录屏或事件序列断言）。
- 引入 Astro 6 + React 19 + TS + ESLint（含 §5.1 可移植边界规则）+ Vitest；`pnpm dev` 起 Astro，`pnpm build` 产出与 `pages-build.sh` 对接的 `dist/` 兼容目录结构。
- `pages-build.sh` 增加 `REACT_MIGRATED_PAGES` 清单（初值空），实现新旧混排编译；manifest.json/图标进 dist 根的 PWA 链路接入。
- **验收**：空壳 React 页 `/work/portfolio.html`（最简单页）线上预览可访问、Lighthouse 与旧版持平。

### M1 admin 后台 + login（2–3 天）★试点

- 范围：`admin/public/*` → `features/admin/` + `pages/admin.astro` `pages/login.astro`；全部 tab 组件化；`functions/api/admin/**` 不动。
- 顺带完成：zod schema 首批（auth/config/messages/qa/stats）、TanStack Query 轮询与失效模式定型、CSV 导出原样。
- **为什么先做 admin**：与旧站零共享组件（不绑视觉基线压力）、价值密度最高、且旧 admin 不下线，可并行双开对照一周，验证新栈在真实维护节奏下的手感后再决定整体推进节奏。
- **验收**：admin 功能清单逐项走查（登录三通道、每 tab、导出）；Playwright 登录态 E2E；平板视口（768/1024）快照（admin 以桌面/平板为主战场，手机档保可读不保全操作）。

### M2 独立页三件套（3–4 天）

- `jd.html`：表单/示例/结果/证据展开/重试/打印样式/`CP_JD_UI` 对接（AI 面板 JD 模式跳转预填链回归测试）。
- `company.html`：抽屉（在 index 语境）+ 独立页双形态——本页迁移必须与 M3 hero 联动测试 `data-cp` 整卡点开、`#company=` 深链、品牌印章、产品橱窗、全景、social、打印。
- `school.html`：同构逻辑 + secure-access 加锁流（申请→邮件审批→签名 URL→解锁）。
- `404.html`。
- **验收**：三页四主题视觉全绿（含 390/680 移动档快照）；公司/学校档案全部数据字段渲染快照对比；JD mock 全链路（沿用现有 e2e 脚本思路）；**触屏专项：全景与灯箱 Pointer 拖拽、拖拽中页面不误滚（passive:false 语义）**。

### M3 index 主页（4–5 天）★最大单体

- 顺板块迁移（组件树一次搭好，板块逐个搬）：HERO/关于我/求职意向/教育 → 工作经历/项目作品（模态框）/个人作品 → 专业技能/获奖 → 联系方式+蛇图 → 留言墙 → 分享卡 → 彩蛋（EOF 控制台、性别热区）→ visitor 里程表/埋点。
- `main.js` 的窗口观察器（滚动高亮/进场/计数/技能条）分别组件化或抽象 `useInView`/`useCountUp` hooks；`prefers-reduced-motion` 分支逐字保留。
- AI 面板（`features/ai/`）：面板壳/QA/JD 双模式/证据展开/语音双通道/皮肤舞台联动 `ai-stage-link`。**最难交互全在此，安排在板块骨架全部稳定后动工**；保留 `window.CP_JD_UI` 一个版本周期。
- **验收**：40+ 项功能清单（附录 A 主页节）全量走查 + 四主题全页快照 + 移动端 390/760 仿照走查 + Lighthouse 持平；**真机电池首次执行**（iOS Safari + 微信内置 + Android Chrome：顶栏导航退让→汉堡、AI 面板滚动锁与角色退位、3D 舞台加载、微信 webview 键盘顶起场景）★。

### M4 resume.html 生成链改造（2–3 天）★特殊工程

- 现状：`templates/resume.template.html` + `render_resume.mjs` 字符串模板 → `resume.html`（CI 逐字漂移比对）。
- 新态：`pages/resume.astro` 在**构建期** import `data/site-data.json` 渲染完整静态 HTML（等价模板引擎职责由 React 组件在 SSG 中完成）；打印 CSS、A4 分页、ATS 文本序、`#company=` 链接、PDF 资产、/api/resume-pdf 云端注入手机号逻辑不变。
- `render_resume.mjs` 退役路径：其「漂移闸门」职责转移给新的 `scripts/check-stale-build.mjs`（对比 git 内生成物与 Astro build 输出），CI 闸门语义保留（N6）；模板文件删除。
- 自动投递岛（表单/预览/PoW challenge/附件）水合。
- **验收**：新旧 resume.html DOM 快照对比（允许 hash 类名差异的白名单）；无头 Chrome 打印 PDF 逐页对比；投递 E2E（mock resend）；`check_resume_pages.mjs` 两页预算仍绿；移动端简历投递/分享卡下载入口不回归（真机电池收尾轮）。

### M5 收尾与旧代码下线（1–2 天）

- 删除 `js/main.js` 及未迁移旧模块、旧 HTML 壳、`_*.html` 探针；`pages-build.sh` 混排清单收敛为纯 React 产物。
- functions/data 动态路由的 fallback 快照指向新构建产物复核（N6 数据三层兜底回归）。
- GitHub Pages 备份线路验证（`API_BASES` 指向 pages.dev 的降级链路）。
- README/文档台账全面改写（「零框架」叙事 → 新架构叙事），CHANGELOG 记录重构里程碑。
- **验收**：全站 N1–N6 总验收（含移动端全档）+ 连续一周线上无回归观察。

### 时间线汇总

| 阶段 | 内容 | 估算 | 累计 |
| --- | --- | --- | --- |
| M0 | 基线+脚手架（含移动基线） | 0.5d | 0.5d |
| M1 | admin 试点 | 2–3d | ~3d |
| M2 | jd/company/school/404（含触屏专项） | 3–4d | ~7d |
| M3 | index 全量 + AI 面板（含首轮真机电池） | 4–5d | ~12d |
| M4 | resume 生成链（含真机收尾） | 2–3d | ~15d |
| M5 | 收尾下线+验收（含移动全档） | 1–2d | **~16 个工作日**（含缓冲约 19–22d） |

单人夜间/周末节奏 ≈ 4–6 个自然周。期间旧站持续在线，无任何冻结；移动端真机电池（§5.8 矩阵）在 M3/M4/M5 验收日执行。

---

## 7. 风险评估与缓解

| # | 风险 | 概率 | 影响 | 缓解措施 |
| --- | --- | --- | --- | --- |
| R1 | **功能回归**：40+ 交互项（尤其 AI 面板皮肤/语音/舞台联动三向耦合）迁移遗漏或行为偏差 | 高 | 高 | M0 功能清单冻结为附录 A 基线；每页迁移建立 Playwright 用例并对照走查；AI 面板旧版与新版在预览域并行两周双开；`window.CP_*` 契约保留一个版本周期 |
| R2 | **视觉回归**：水合时序差导致闪烁/位移（CLS）、打印排版漂移 | 中 | 高 | 「HTML 由 SSG 直出 + 类名/结构与旧版一致」使水合前 DOM 即最终形态（几乎无 CLS 源）；四主题全页截图对比进 CI；resume 无头打印 PDF 逐页 diff |
| R3 | **性能回退**：岛水合策略失误、Query 过度拉取 | 中 | 中高 | N5 基线 M0 存档；每阶段 Lighthouse 对比入验收；水合策略表（§5.4）逐岛落实到组件；分享卡等重组件动态 import |
| R4 | **并行开发冲突**：迁移期间另一会话继续在旧文件上加功能（admin/私密佐证均在途） | 高 | 中 | 迁移页面级隔离：被迁移页面先在旧版冻结（只改 React 侧），新旧差异由混排机制即时同步；admin 在 M1 完成、冲突窗口最小 |
| R5 | **URL/SEO 断链**：Astro 默认输出目录式 `/resume/` 与旧 `/resume.html` 不一致；搜索引擎收录波动 | 中 | 中高 | `build.format:'file'` 强制同名文件输出；迁移前抓取全站入链（简历 PDF 内深链）建立映射表逐条验证；sitemap.xml 保留；观察 GSC 抓取统计 4 周 |
| R6 | **file:// 双击场景消失** | 确定 | 低 | 已在 §1.4 声明为接受损失；`npm run dev` / `本地预览.command`（改为起 dev server）双通道替代 |
| R7 | **构建链复杂化**：node_modules 进仓库体积与 Pages 构建时长上升；依赖供应链风险 | 中 | 中 | lockfile + GitHub Actions 每周 Dependabot（安全更新）；pages-build.sh 增量缓存；CI 时长阈值告警；核心依赖收敛为 8 个运行时依赖以内 |
| R8 | **Astro 次要版本 breaking**：Astro 6 仍在快速演进（2026 年初大版本） | 中 | 中 | 构建产物纯静态、锁定次版本 + 升级窗口测试；最坏情况按 §4.4 备选切纯 Vite（组件代码 100% 可移植） |
| R9 | **半途而废的沉没成本** | 中 | 中 | 每阶段独立有价值（§6 原则 2）；中断时已迁移页面照常线上运行，旧页面继续服务，无回滚成本 |
| R10 | **`functions/` 误伤**：构建编排变更导致 API 404 / 中间件失效 | 低 | 极高 | N2 红线：不改 functions/ 任何路径；pages-build.sh 的 functions 复制段保持不变；E2E 含每个 API 端点冒烟 |
| R11 | **触屏/移动行为漂移**：手势 `passive` 语义、滚动锁时序、粘滞 hover、100vh 在 iOS 地址栏下的表现、微信 webview 差异 | 中 | 中高 | 手势与滚动锁逻辑逐行移植不改语义；Playwright `hasTouch` 手势 E2E 进 CI（§5.8 矩阵）；真机电池 M3/M4 走查；已知怪癖清单（粘滞 hover 等）对照旧行为验收而非「顺手修复」 |
| R12 | **`useResponsiveGuard` 移植引入渲染循环或测量抖动**（测量→setState→重渲染→重测） | 中 | 中 | 锚定 DOM 层实现：refs 直改 class 不走 React state；useLayoutEffect 内同步完成全部测量与裁决；对 resize/load/fonts.ready 三触发源做回归测试（含字体加载后顶栏复算） |

---

## 8. 可维护性评估

### 8.1 收益（定性+量化）

| 收益 | 现状痛点 | 迁移后 |
| --- | --- | --- |
| 类型安全 | `ground/ratio` 字段名不一致的线上 bug 类 | zod + TS 编译期拦截；API/数据契约单点定义 |
| 复用 | 公司/学校/经历卡三套同构手写 DOM | 一套 ProfilePage 组件族三处实例化（预计净删 1,500+ 行） |
| 测试 | 只能测纯函数（占代码 30% 不到） | RTL 组件测试 + Playwright E2E + 现有 node:test 并存，覆盖率可观测 |
| 变更定位 | 「改个板块要读 main.js 800 行上下文」 | 板块=目录，模块边界物理化 |
| 状态管理 | window 全局 + 隐式契约 + 手写 loading/error 分支 | 单一模式（Query + nanostores），心智模型收敛 |
| 缓存事故 | 手工 `?v=` bump 忘更导致线上旧 JS（11-22 实例） | 内容寻址 hash 产物，机制性根除 |
| 依赖显性化 | vendor 脚本无版本锁定 | package.json + lockfile，可审计可升级 |

### 8.2 代价（诚实清单）

| 代价 | 程度 | 说明 |
| --- | --- | --- |
| 构建步骤 | 必然 | 本地改一行看结果从「刷新」变为「HMR（更快）」，但首次 clone 要 `pnpm i`；Pages 构建时长 +30–60s |
| 依赖维护 | 中 | React/Astro/Vite/Query 每年 2–4 次主版本更新节奏；单人维护需接受季度升级任务 |
| 技术栈门槛 | 中 | 协作者（或未来的 AI 会话）需懂 React 三件套；本仓库 AI 辅助开发比例高，React 知识在 LLM 上训练最充分，实际门槛**低于**现有 9k 行自研约定 |
| 包体积 | 低 | 现状 16 个 JS 模块原始 464KB / gzip 约 138KB；岛化后总传输量相仿（每岛摊薄 + 按需懒载），但**阻塞首屏渲染的关键路径 JS** 从 16 文件串行下载降为 1–3 个入口岛 |
| Astro 壳层认知 | 低 | .astro 只承担 15 行级别的页面装配；为控制这一层不再增肥，规定「业务逻辑禁止写在 .astro frontmatter 之外超过 20 行」 |

### 8.3 长期演进空间

- React 19 Compiler（自动 memo）免配置受益；
- Server islands / Astro Actions 等新能力与 Cloudflare 边缘深度整合（收购后的路线图红利）；
- 组件库沉淀：Neo-brutalism UI 基元（§5.1 ui/）可独立成 npm 包，作为作品集的「次级作品」；
- 与 admin 的 CMS 化方向（docs/observability-and-cms.md）正交叠加：React 化的后台是 CMS 化的前置条件。

### 8.4 判断

在「单人 + AI 辅助 + 求职展示 + 功能仍在增长」的具体语境下，React 化的净收益为正；且最大两项代价（构建步骤、file:// 消失）在用户已明确接受重构方向的前提下属于已支付成本。**可维护性上真正的收益不是代码行数减少，而是「类型契约 + 物理模块边界 + 自动化回归」三件套——这三者在零框架方案里补强的成本高于迁移成本。**

---

## 9. 工作量估算

> 单位：人日（专注工作日，含自测；不含等待 CI/预览部署的挂钟时间）。基于 §2 盘点的实际行数与 §6 任务分解。

| 工作包 | 估算 | 依据 |
| --- | --- | --- |
| M0 基线+脚手架 | 0.5 | 配置为主；含移动四档视觉/手势基线采集 |
| M1 admin+login | 2–3 | 1,508 行 + 8 个 API 域 + 3 登录通道回归（平板档快照） |
| M2 jd/company/school/404 | 3–4 | 3,078 行 JS 的功能域 + 触屏拖拽专项 |
| M3 index+AI 面板 | 4–5 | main.js 2,245 行 + ai-* 系 2,269 行，交互密度最高 + 首轮真机电池 |
| M4 resume 生成链 | 2–3 | 模板 997 行 + 打印链路 + 漂移闸门重实现 + 真机电池收尾 |
| M5 收尾下线+文档 | 1–2 | 删旧+README 改写+总验收（含移动全档） |
| 小计 | 12.5–18.5 | |
| +缓冲（E2E 补课、视觉细抠、缓存策略调优、**真机问题回流修复**） | 3–4 | Playwright 设备矩阵维护 + 三浏览器真机问题修复窗口 |
| **总计** | **15.5–22.5 人日** | 周末节奏约 4–6 个自然周 |

若中途只完成 M1+M2（admin+独立页）即停：已得约 40% 的可维护性收益（价值最高的两块），旧站其余部分零风险继续运行。这是渐进路线的退路价值。M3 及之后的真机电池每轮约 0.5 天，已计入对应阶段估算。

---

## 10. 决策点清单

以下开放项建议在 M0 启动前拍板，默认值已给出：

| # | 决策点 | 选项 | 默认建议 |
| --- | --- | --- | --- |
| D1 | 页面壳框架 | A. Astro 6 + React（主案） / B. 纯 Vite + React SPA（备选 §4.4） | A |
| D2 | TypeScript 严格度 | strict 全开（含 noUncheckedIndexedAccess） / 常规 strict | 严格全开（一次性支付成本） |
| D3 | 包管理器 | pnpm / npm | pnpm（磁盘与安装速度，Pages 支持良好） |
| D4 | React 版本跟随策略 | 锁 19.x 次版本（季度评估升） / 跟最新 | 锁定+季度窗口 |
| D5 | 单元测试框架 | Vitest（与 Vite 同生态） | Vitest + RTL；node:test 保留给纯函数层 |
| D6 | 旧版双开观察期 | admin 双开 1 周 / 不双开直接切 | 双开 1 周（R1 缓解） |
| D7 | 预览环境 | react 分支推 Pages preview URL / 独立 Pages 项目（react.chenpeisheng.cn 内网域） | 独立 Pages 项目（隔离生产配置与 D1 绑定） |
| D8 | `?v=` 查询串清理 | 迁移完成的页面立即享受 hash 产物；未迁移页面保留旧机制 | 照默认执行 |
| D9 | 移动真机电池来源（§5.8 矩阵） | 现有 iPhone + Android 模拟器先行 / Android 真机借用或购置 | 先 iPhone（Safari + 微信内置）+ Android 模拟器；Android 真机在 M3 首轮电池前到位（二手千元机即可） |

---

## 附录 A：功能迁移对照清单（验收基线）

> 逐项迁移、逐项勾验。标记 ★ 为「特别容易遗漏项」。

### A.1 全站通用
- [ ] 四主题切换与记忆（noir 反色微调规则）
- [ ] `prefers-reduced-motion` 降级
- [ ] 字体加载策略（媒体打印 onload 技巧）
- [ ] 移动端菜单 + 导航滚动高亮 + SEC 编号自适应（89649d5 + 1a352fc 后的最新行为）
- [ ] 板块按数据显隐/空态隐藏 ★
- [ ] visitor 复古里程表（翻牌数字/闪烁点 + /api/visits）
- [ ] 埋点（analytics.js 全事件）★
- [ ] Toast 体系
- [ ] 404 页
- [ ] GitHub Pages 备份线路降级（API_BASES）
- [ ] 资源 COS 重写（asset-cdn）★构建期与运行时双轨
- [ ] 蛇图热力图（contributions.json + 主题适配）
- [ ] 分享卡竖版/方形实时绘制下载 ★
- [ ] EOF 三连击彩蛋（风格控制台）★
- [ ] 性别切换（热区/G 键/window.setGender + 全站形象联动）★

### A.2 AI 数字分身
- [ ] FAB/角色舞台唤起、面板开合
- [ ] QA 模式：流式/非流式渲染、追问、复制
- [ ] 依据展开切片原文（互斥/aria）
- [ ] JD 模式：示例 chips、结果卡、「打开完整对照」跳转预填（sessionStorage）★
- [ ] 断连自动重试 + 人话错误文案
- [ ] 语音：浏览器 TTS 与云 TTS 双通道探测降级、后台音色配置联动 ★
- [ ] 3D 舞台：皮肤系统、glb 懒载、展示套装后台开关 ★
- [ ] 角色↔面板↔页面元素描边联动（ai-stage-link）★
- [ ] 招呼语后台配置（/api/greeting）

### A.3 独立页
- [ ] jd：字数统计/示例/提交/重试/结果表/证据展开/重合度/Markdown 导出/打印 CSS
- [ ] company：抽屉与独立页双形态、`?c=`/`#company=` 深链、印章 logo、速览行、产品橱窗（截图卡/字标兜底/本人参与徽章）、高管轮播、360 全景、social 三件套、打印退化、D1 数据源
- [ ] school：档案渲染 + secure-access 申请/审批/签名/限时解锁全流 ★
- [ ] work/portfolio：案例详情（数据驱动 + 打印）

### A.4 resume.html
- [ ] 两页 A4 版式 + 分页预算（check_resume_pages）
- [ ] ATS 文本序与结构
- [ ] 打印（彩色/黑白省墨）+ 打印预览对比图（color/bw × 2 页）
- [ ] 公司名超链接（PDF 内可点 + hover 橙色 + 抽屉）
- [ ] 云端手机号注入（/api/resume-pdf，KV 真实 PDF）★
- [ ] 自动投递全流：表单校验、PoW challenge、发送前预览、PDF/ZIP 附件
- [ ] 发简历到邮箱按钮 + Reply-To

### A.5 留言墙
- [ ] 设备 ID HMAC 隔离、分页、追问线程、站长回复展示
- [ ] Turnstile 显式渲染与未通过降档 ★
- [ ] 提交限流文案与倒计时

### A.6 admin（/admin /login）
- [ ] 三通道登录（邮箱验证码/微信扫码/小程序）+ 会话
- [ ] 概览统计、设备台账与封禁、留言审核回复、问答看板（空召回率/聚类/trend）★
- [ ] 站点数据编辑（写 D1→5 分钟生效→KB 自动重建）★
- [ ] KB 状态与重建、主题/音色/提示词/招呼语配置、展示套装开关
- [ ] CSV 导出（BOM 头）
- [ ] 预览环境 D1/KV 隔离（6ab177d 行为保真）★

### A.7 移动端与触屏专项（依据 §5.8 测试矩阵逐步验收）
- [ ] 顶栏导航几何退让 → 全藏收汉堡菜单全链（含字体加载后 fonts.ready 复算）★
- [ ] 汉堡菜单开合、展开后导航入口完整
- [ ] AI 面板 ≤760px body 滚动锁 + 关闭解锁 + `ai-panel-open` 角色退位缩放连锁 ★
- [ ] 全景图/档案灯箱/桌宠 Pointer 拖拽，拖拽时页面不误滚（`passive:false` 逐处对齐）★
- [ ] 触屏首点粘滞 hover 与旧行为一致（已知怪癖，不修复只对照）
- [ ] 100vh 灯箱/面板在 iOS Safari 地址栏收展下与旧版一致（不引入 dvh）
- [ ] 面板/抽屉内滚动不穿透到页面（overscroll 边界）
- [ ] `--vw-real` Windows 滚动条补偿在桌面窄窗口/缩放/翻译变长场景下不横向裁切
- [ ] viewport meta 统一写法后各页移动端缩放行为零变化
- [ ] manifest / PWA 安装入口不回归（无 SW 维持现状）
- [ ] 真机电池三浏览器（iOS Safari/微信内置/Android Chrome）：键盘顶起、长按选择、浏览器 TTS 可用性、分享卡保存到相册 ★

---

## 附录 B：技术选型速查版本表（截至 2026-11）

| 依赖 | 版本 | 角色 | 备注 |
| --- | --- | --- | --- |
| React | 19.2 | UI | Compiler 1.0 已稳定可开（babel-plugin-react-compiler） |
| Astro | 6.x | 页面壳/SSG | Astro 技术公司于 2026-01 被 Cloudflare 收购，保持开源治理 |
| Vite | 8（Astro 内置） | 构建 | Rolldown 内核 |
| TypeScript | 5.x | 类型 | strict 全开 |
| TanStack Query | v5 | 服务端态 | 轮询/失效/乐观更新 |
| nanostores | 0.11+ | 岛间状态 | Astro 官方推荐模式 |
| react-hook-form + zod | 最新稳定 | 表单 | 与 API schema 同源复用 |
| Vitest + RTL | 最新稳定 | 单元/组件 | node:test 保留纯函数层 |
| Playwright | 最新稳定 | E2E/视觉回归 | 快照对比 N1 验收载体 |
| model-viewer | 现有 vendor 版本 | 3D | 保持 vendor 不 npm 化 |
| html2canvas | 现有 vendor 版本 | 分享卡 | 保持 vendor |

---

## 里程碑日志

> 执行实况追加区：每阶段完成后记录交付物、与方案的偏差（含原因）、验收数据与遗留项。日期均为自然日。

### M0 · 脚手架与基线 —— ✅ 已完成上线（2026-11-26，提交 7478ee7）

- **交付**：Astro 6.4.8 + React 19.3.1 + TS strict 全开（含 noUncheckedIndexedAccess）+ ESLint 9 可移植边界规则（`src/{components,features,lib}` 禁止 import astro，给 §4.4 纯 Vite 备选留退路）+ Vitest/RTL；build/test/lint/check 四绿。
- **混排机制**：pages-build.sh 新增 `REACT_MIGRATED_PAGES` 段，清单可逐页追加；`none` 一键回退旧行为；岛资源引用完整性硬校验。
- **空壳验证页**：/work/portfolio.html（真相源 import 装配 + 岛水合验证 + RTL 组件测试），已上线且水合验证通过。
- **基线**：Lighthouse 线上 4 页 × 移动/桌面 8 份入 `tests/e2e/baseline/lighthouse/`——index 移动档 55 分 / LCP 25.3s / FCP 22.2s（Google Fonts 外链为主因），是 M3 的主优化对照；视觉基线 64/64（4 页 × 4 主题 × 390/680/768/1024，390 含 hasTouch）清单 + sha1 入库。
- **顺手修复**（迁移盘点中发现的自迁站以来即存在的线上 404）：manifest.json 从未进 dist（PWA 安装断链）与 work/ 目录从未进 dist（作品卡链接 404），均已进拷贝清单 + 硬校验。

### M1 · admin 后台 + login —— 🔄 代码完成，待提交发布（2026-11-26）

- **交付**：
  - `src/lib/api/admin.ts`：27 个 admin 端点 zod 契约 + 类型化 client（X-Admin-Request CSRF、401 统一跳 login），配套契约快照测试。
  - `src/features/admin/`：AdminApp 壳（统计 9 卡 + 8 tab + 刷新/退出 + `?focus=` 邮件直达）与 8 个 tab（设备封禁/留言审核含行内回复+⌘Enter/问答看板含趋势柱/主题+套装+模块配置/语音套装+音色+试听/站点数据 JSON 编辑器+KB 重建/变体生成/动画台）+ queries.ts（全部 hooks，写操作精确 invalidate）+ toast（含 `window.__adminToast` 兼容）。
  - `src/features/login/`：三通道（邮箱验证码两步流含冷却倒计时 / 微信扫码或公众号 / 小程序码 1.5s×40 轮询）、错误文案表逐字迁移、safeNext 防开放重定向、openid 引导提示。
  - `scripts/pages-build.sh`：`react_src()` 路径映射 + login 双副本；`scripts/dev-api-server.mjs`：补齐 27 个 admin 路由（接线上同套 handlers）与静态映射。
- **与方案的偏差（已定案）**：
  1. §5.7 原定的「admin 走 Astro 岛」不可行——`functions/_middleware.js` 对 /admin 的 CSP `script-src 'self'` 禁内联，而岛水合需要内联 bootstrap。改用页面 body 内 `<script>`（Astro 打包为 hash 外链文件）引导 SPA：产物 0 内联脚本，CSP 合规，login 同样处理。
  2. 迁移中发现旧 login 真实 bug：发码接口返回的掩码邮箱（`de***@…`）被回填进 verify 请求导致 403；React 版改用原始输入修复。
  3. anim-console.js（477 行）按方案原样桥接：渲染旧版同 id/class 的 DOM 骨架，进 tab 时动态加载 `/admin/assets/anim-console.js` 调 `window.AnimConsole.init()`，M5 再定去留。
- **验收**：单元/组件测试 11/11；Playwright E2E **24/24**（三通道登录全流、8 tab 逐项走查、保存文案写路径、退出、768/1024 平板快照）；既有 node:test 289/289 基线不回归；内容漂移链 4 项全绿（render_resume / sync_company_profiles / render_work_details / validate_content）；build/test/lint/check 四绿。
- **未决**：admin/login 尚未加入 pages-build.sh 的 `REACT_MIGRATED_PAGES` 生产清单（待确认 D6 双开节奏：建议先双开观察一周再切）。

---

*文档维护：本方案是活文档，随 M0–M5 推进在本文档内以「里程碑日志」形式追加实况记录；重大方向变更须更新 §9 估算并注明版本。*

> AI生成
