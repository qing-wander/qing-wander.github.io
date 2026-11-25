# 个人作品集・Cloudflare 后端 / RAG / 管理后台・规划与技术选型

> 版本：v1（2026-11-19）
> 状态：现行（规划 + 落地记录）· 最后核对 2026-11-23
> 定位：把「在线简历 + AI 问答 + JD 匹配 + 动态简历 + 管理后台 + 可观测」收敛成一套可落地的架构，
> 并回答「Cloudflare 免费资源够不够」。
> 现状基线以仓库当前代码为准；额度以 2026-11-19 官方文档核对为准，上线前建议再复核一次。
> 相关既有文档：
>
> [cloudflare-free-resources.md](cloudflare-free-resources.md)
>
> 、
> [ai-assistant-survey.md](ai-assistant-survey.md)
>
> 、
>
> [jd-match.md](jd-match.md)
>
> 、
> [observability-and-cms.md](observability-and-cms.md)
>
> 、
>
> [TODO.md](TODO.md)



***

## 0. 结论先行（TL;DR）



1. **Cloudflare 能提供免费后端，而且这套个人站点的量级完全够用。**

   Pages Functions + D1 + Vectorize + Workers AI + R2 + KV + Analytics Engine + AI Gateway

   都有免费额度；按「100 次问答 / 天 + 5 个 JD / 天 + 2,000 PV / 天」估算，主要额度占用在 25% 以内。

2. **真正的地基不是 Cloudflare，而是「唯一真相源」。**

   当前主页读 `data/site-data.json`，`resume.html` 却是 1,108 行硬编码 HTML，两边已经出现措辞与要点不一致；

   必须先把简历内容抽回一份结构化数据，再由它生成主页、简历、知识库、主题。

3. **AI 不能直接 “生成一份简历 HTML” 就上线。**

   正确做法是：AI 只在**已校验的事实单元**里做选择、排序、改写，输出带 `source_id` 的 JSON；

   再由确定性模板渲染 HTML/PDF。公共简历默认仍是完整、稳定、可打印的版本。

4. **RAG 采用「D1 FTS5 关键词 + Vectorize 语义向量」混合检索。**

   知识库只有 60–100 个原子切片，纯向量不是最优；混合检索 + 可选 rerank + 数字校验，

   才能同时做到「答得准」和「不编造」。

5. **管理后台独立成一个 Pages 项目**（`shenge-work-admin.pages.dev`），

   用 GitHub OAuth + D1 会话，不依赖自有域名；主站不暴露任何 admin 代码。

6. **两个真实的限制要提前接受：**

* `*.pages.dev` 共享域不支持 Cloudflare Access，管理后台必须自己做鉴权；

* Workers 免费版每次请求只有 10ms CPU、全账号 100,000 请求 / 天；RAG 编排若压不住，\$5 / 月 的

  Workers Paid 是最划算的保险。

1. **分五期做，不要一次性大爆炸**：P0 单一真相源 → P1 RAG 后端 → P2 JD + 动态简历 →

   P3 管理后台 → P4 可观测与问题提炼。P0 不做，后面全是返工。

2. **第一步**：先把你当前工作区里 `resume.html` 的未提交改动固化为基线，

   再把 34 条经历 / 项目要点抽进 `data/site-data.json`，跑通「改 JSON → 生成 resume.html」的闭环。

3. **留言板「按 MAC 隔离」在网页端做不到。** 浏览器没有读取 MAC 的 API，MAC 还会被手机随机化；

   正确做法是「随机设备 ID + 服务端哈希」做**尽力而为的设备隔离**，管理后台看全部设备。

   这会把留言板从 “公开墙” 变成 “每台设备自己的私密留言本”，文案要同步改。

4. **动态简历不重排页面。** 沿用 `resume.html` 同一套布局 / CSS，只允许 AI 在字段边界内选材与改写；

   基本信息、教育、公司名、时间、数字是锁定或仅微调；A4 两页是硬上限，由内容预算 + Playwright 页数校验兜底。

5. **不需要把主流 Agent SDK 当基座。** 这个项目是 “有边界的流水线”（检索、JD 拆解、变体生成），

   不是自主 Agent；直接接模型 API + 自建编排 / 校验更稳、更省、更好调。SDK 留到未来多步工具调用时再引入。



***

## 1. 现状基线（读代码后的结论）



| 资产                           | 现状                                                                                                                     | 判断                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `data/site-data.json`        | 35 KB，含 hero/about/objective/education/experience/projects/works/skills/awards/contact/wall；经历 13 条要点、项目 21 条要点、作品 6 个 | 已经是事实上的主页数据源，但**不覆盖简历全文**             |
| `data/site-data.js`          | 由 JSON 生成的 `window.SITE_DATA` 快照，供 `file://` 本地预览                                                                      | 可继续保留为生成物                             |
| `resume.html`                | 122 KB、1,108 行，经历 / 项目 / 技能 / 教育全部硬编码；当前工作区还有未提交的埋点改动（13 行）                                                            | **第二份真相源**，与 JSON 已漂移                 |
| `knowledge/chunks.json`      | 37 个切片，来源 `data/site-data.json`                                                                                        | 切片覆盖不全（站点功能、JD、主题等没进库）                |
| `knowledge/vectors.json`     | TF-IDF char-bigram，1,200 维稀疏                                                                                           | 不是语义向量；同义问法召回弱                        |
| `functions/tencent/index.js` | 腾讯云 CloudBase 云函数：问答 + JD 匹配 + TTS；模型 `hy3`                                                                            | 现有主力后端，境内可达；可作为迁移期 fallback           |
| `functions/api/*`            | Pages Functions：访问计数、留言墙、简历转发                                                                                          | Cloudflare 侧已有真实落地经验                  |
| `functions/api/wall.js`      | 当前留言墙**全站公开**，按 IP 限流，管理员 token 删除                                                                                     | 新需求要改成设备隔离 + 后台管理；网页拿不到 MAC           |
| `db/schema.sql`              | `portfolio-db`：counters / visitors / wall\_messages / rate\_limits                                                     | D1 迁移已验证，可继续扩表                        |
| `js/analytics.js`            | Umami Cloud + Microsoft Clarity，ID 已填                                                                                  | 可观测已有前端底座                             |
| `css/style.css`              | 4 套主题（archive /blueprint/newsprint /noir），仅主页生效                                                                        | 简历页固定一套样式，主题未打通                       |
| 部署                           | GitHub Pages 主站 + `shenge-work.pages.dev` 备站，push 即构建                                                                  | `pages.dev` 境内可达；`workers.dev` 曾实测不可达 |

### 1.1 六个必须正视的发现



1. **简历与主页已经漂移。** 同一段 Lessie 经历，简历里是 FDE 定制、邮箱预热、达人飞轮等要点，

   主页 JSON 里是另一组 13 条要点；措辞、数量、强调点都不完全一致。这不是 “风格差异”，

   而是同一事实的两份手写副本。

2. **知识库不是语义向量。** 当前是 TF-IDF 稀疏向量 + 关键词打分，问「他带过团队吗」这类同义问题

   召回不稳定；T15 里也登记了「语义向量」待办。

3. **现有后端不在 Cloudflare。** Cloudflare 目前只承担静态托管、计数、留言墙、发信；

   AI 问答 / JD 匹配在腾讯云。迁移不是 “从零开始”，而是 “把已验证的检索 / 提示词 / 限流逻辑换运行时”。

4. `pages.dev`**&#x20;是可用入口，**`workers.dev`**&#x20;不是。** 既有实测已经证明后者境内 8 秒超时；

   新后端必须挂在 Pages 项目的 `/api/*` 上，不要新开 `*.workers.dev`。

5. `resume.html`**&#x20;有未提交改动。** 当前工作区 `git status` 显示 `M resume.html`，

   内容是简历转发链路的埋点（`data-analytics` 与 `dlTrack`）。P0 开工前先提交或另存基线，

   否则生成器一跑就会把这些改动覆盖掉。

6. **留言墙现在是全站公开的。** `functions/api/wall.js` 直接把 `wall_messages` 全表分页返回，

   新需求要改成 “按设备隔离、后台看全部”；这是产品语义变化，不只是加一个字段。网页也拿不到 MAC，

   只能用随机设备 ID 做尽力而为的隔离。



***

## 2. 需求拆解与验收口径



| 编号  | 需求              | 交付物                                                | 验收口径                                               |
| --- | --------------- | -------------------------------------------------- | -------------------------------------------------- |
| R1  | Cloudflare 免费后端 | Pages Functions + D1 + Vectorize + Workers AI + R2 | 月度账单 \$0；额度看板可解释；超限有降级                             |
| R2  | 简历全量切块入向量库      | 结构化切片 + 1024 维向量 + 元数据 + 版本                        | 60–100 个原子切片；每个切片可回链到原文；重建幂等                       |
| R3  | 简历问答精准回答        | `/api/chat` SSE + 引用 + 拒答策略                        | 30 题金标集 hit@3 ≥ 90%；无 unsupported 数字；p95 < 8s      |
| R4  | JD 匹配           | `/api/jd/match` 结构化对照表                             | 每条要求有证据或明确缺口；分数可复现；JD 原文不入库                        |
| R5  | 唯一真相源 + AI 动态简历 | 一份 canonical JSON；确定性模板；变体 JSON                    | 改 JSON 一处，主页 / 简历 / 知识库同时变；变体 100% 通过 schema 与事实校验 |
| R6  | 管理后台            | 独立 admin 站：内容、模型、提示词、主题、KB、QA 洞察                   | 登录→改草稿→预览→发布→回滚闭环；密钥不出服务端                          |
| R7  | 可观测与埋点          | 事件表 + 看板 + 告警 + 周报                                 | PV/UV、问答、JD、下载、主题切换全链路可查；延迟 < 1 分钟                 |
| R8  | 用户问题采集与提炼       | 匿名化问答日志 + 聚类 / 标签 + 内容缺口建议                         | Top 问题、未答问题、低分问题可筛选；可一键转 FAQ 草稿                    |
| R9  | 主题风格管理          | 主题 token + 预览 + 发布                                 | 主页 / 简历同一套 token；对比度校验；打印样式不被破坏                    |
| R10 | 成本可控            | provider 抽象 + 配额 + 缓存 + 限流                         | 单次问答可估算成本；超额自动降级 / 熔断                              |
| R11 | 留言板设备隔离 + 后台管理  | 设备 ID、私密留言本、后台全设备视图                                | 同设备可见、异设备不可见；后台可看全部 / 删除 / 屏蔽；清缓存即新设备（需告知）         |
| R12 | 模块级模型与提示词配置     | 全局默认 + 模块覆盖 + prompt 版本                            | 每个 AI 模块可独立选模型 / 提示词；支持继承、测试、评测、回滚                 |
| R13 | Agent SDK 决策    | 直连模型 API + 自建流水线                                   | 当前不引 Agent SDK；保留 provider/pipeline 抽象，未来可加        |



***

## 3. 总体架构



```
                         ┌──────────────────────────────────────────────┐
                         │  GitHub Pages（主站，境内可达）                 │
                         │  index.html / resume.html（生成物）            │
                         │  js/ai-chat.js  js/jd-match.js  js/analytics.js│
                         └───────────────┬──────────────────────────────┘
                                         │ 同域/跨域白名单，前端不带任何 Key
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Cloudflare Pages Functions（shenge-work.pages.dev）                          │
│  /api/chat         问答：检索 → 生成 → 引用 → 数字校验 → 脱敏日志              │
│  /api/jd/match     JD 拆解 → 逐条召回 → 覆盖判定 → 分数/缺口/追问点            │
│  /api/resume/tailor 变体生成 → schema/事实校验 → 模板渲染 → 分享页/PDF          │
│  /api/wall         设备隔离留言：X-Device-Id → 只返回本设备；后台可看全部        │
│  /api/events       埋点写入 Analytics Engine / D1 聚合                         │
│  /api/config       公开配置：默认主题、功能开关、模型别名（不含密钥）            │
└───────┬───────────────────────┬───────────────────────┬─────────────────────┘
        │                       │                       │
        ▼                       ▼                       ▼
┌───────────────┐     ┌──────────────────┐     ┌────────────────────────────┐
│ D1 portfolio-db│     │ Vectorize        │     │ Workers AI / AI Gateway     │
│ 业务表 + FTS5  │     │ resume-kb (1024d)│     │ GLM-4.7-flash / bge-m3      │
│ 日志/配置/版本 │     │ 元数据过滤 + 版本 │     │ rerank / fallback provider  │
└───────────────┘     └──────────────────┘     └────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  GitHub Actions（构建链）                                                     │
│  data/site-data.json → 校验 → 生成 site-data.js / resume.html / KB            │
│                     → embed（bge-m3）→ upsert Vectorize + D1                 │
│                     → 回归评测 → commit 生成物 → Pages/GitHub Pages 部署       │
└─────────────────────────────────────────────────────────────────────────────┘

                         ┌──────────────────────────────────────────────┐
                         │  Admin（独立 Pages 项目）                       │
                         │  shenge-work-admin.pages.dev                  │
                         │  GitHub OAuth → D1 session → /api/admin/*      │
                         │  内容/模型/提示词/主题/KB/QA 洞察/配额看板       │
                         └───────────────┬──────────────────────────────┘
                                         │ GitHub Contents API（仅源文件）
                                         ▼
                                   data/site-data.json
```

**两条链路要分清：**



* **公开链路**只读：静态页 + 问答 / JD / 变体 / 埋点；不暴露管理 API。

* **管理链路**只写草稿与配置，发布时落到 Git；D1 不是内容真相源，Git 才是。



***

## 4. 唯一真相源设计（P0，最优先）

### 4.1 canonical 数据模型

继续用 `data/site-data.json` 作为唯一手写源（不另起 `career.json`，避免迁移期两份文件）。

在现有结构上增加简历专用块，并把 “要点” 从 HTML 字符串升级成可校验的事实单元：



```
{
  "schema_version": "2.0",
  "person": { "nameCn": "陈培胜", "nameEn": "CHEN PEISHENG", "role": "AI Agent 工程师",
              "email": "hi@chenpeisheng.cn", "github": "shenge-work",
              "portfolio": "chenpeisheng.cn", "location": "深圳",
              "years": 5, "age": 29, "availability": "随时到岗" },

  "resume": {
    "headline": "AI Agent 工程师 / AI 应用开发工程师",
    "summary": "红杉系初创 + 金融头部 AI 主力……",
    "section_order": ["summary", "experience", "projects", "skills", "education"],
    "experience": [
      {
        "id": "exp-comein",
        "company": "深圳进门财经科技股份有限公司",
        "companyShort": "进门财经",
        "role": "Agent 工程师",
        "period": "2026.01 — 2026.07",
        "endReason": "组织架构调整",
        "audience": ["ai", "backend", "infra"],
        "bullets": [
          {
            "id": "exp-comein-b1",
            "text": "主导 AI 金融投研工作台核心基建：Agent 基座与多租户云沙箱……",
            "tags": ["agent", "sandbox", "multi-tenant"],
            "metrics": [],
            "priority": 1,
            "audience": ["ai", "infra"]
          }
        ],
        "stack": ["Python", "AgentScope", "QwenPaw / OpenCode", "Flink"]
      }
    ],
    "projects": [ /* 同构：id / title / role / period / bullets[] / stack / links */ ],
    "skills": { "groups": [ /* name / level / years / evidence_ids */ ] },
    "education": { /* 学校 / 专业 / 时间 / 奖学金 / 验证码 */ }
  },

  "features": [
    { "id": "feature-wall", "title": "留言墙", "text": "Pages Function + D1 + Turnstile……",
      "tags": ["cloudflare", "d1", "turnstile"] }
  ],

  "faq": [
    { "id": "faq-gap", "question": "空窗期/离职原因", "answer": "……", "audience": ["hr"] }
  ],

  "facts": [
    { "id": "fact-lessie-30", "value": "30", "unit": "%", "label": "搜索精准度提升",
      "sourceId": "exp-lessie-b1" }
  ],

  "theme": { "default": "archive", "allowVisitorSwitch": true }
}
```

**三条硬规则：**



1. **HTML 不进 JSON。** 要点用纯文本 + `tags/metrics`，强调样式由渲染器决定；

   这样同一份文本可以进知识库、进简历、进 JD 匹配，不会出现 `<strong>` 标签污染检索。

2. **每个要点有稳定&#x20;**`id`**。** `exp-comein-b1` 这种 ID 一旦发布就不改；排序、隐藏、改写都引用它。

3. **数字进&#x20;**`metrics`**&#x20;或&#x20;**`facts`**。** AI 回答 / 变体里出现的数字必须能在被引用要点里找到，

   否则校验失败。

### 4.2 生成链（一份数据，四个产物）



```
data/site-data.json（唯一手写源）
   │
   ├─ validate_content.mjs         JSON Schema + 语义校验（ID 唯一、数字有来源、联系方式白名单）
   ├─ render_index.mjs             可选：首屏 SSG（先保持现状运行时渲染）
   ├─ render_resume.mjs            → resume.html（确定性模板，保留现有 CSS/JS/打印样式）
   ├─ build_kb.py / build_kb.mjs   → knowledge/chunks.json + embeddings
   └─ build_themes.mjs             → css/themes.generated.css（或 data/themes.json）
```



* `resume.html` 顶部加注释：`<!-- AUTO-GENERATED from data/site-data.json; do not edit -->`

* `data/site-data.js` 继续由 `scripts/sync_site_data.py` 生成，保持 `file://` 预览。

* 生成器不要引入前端框架；继续用原生 HTML/CSS/JS，模板用 Node 字符串函数或轻量模板即可。

* 保留现有 `resume.html` 的打印 CSS、黑白模式、长图导出、转发弹窗与埋点，不要重写视觉。

### 4.3 防漂移（CI 闸门）



1. **禁止手改生成物**：CI 重新生成后 `git diff --exit-code`，有差异就失败。

2. **内容校验**：所有 bullet 的 `id` 唯一；`sourceId` 必须存在；`metrics` 数字与正文一致；

   `contact` 只允许公开字段；简历 section 不缺项。

3. **文本回归**：P0 首次生成后，把生成结果与当前 `resume.html` 做纯文本 diff；

   允许标签 / 空白差异，不允许文案缺失或数字变化。

4. **截图回归**：桌面 / 手机 / A4 打印三张截图对比；可用本地 Playwright，不必进 CI。

### 4.4 发布、版本与回滚



* **草稿**：管理后台写 D1 `content_drafts`，不碰 Git；可预览、可丢弃。

* **发布**：校验通过后，后台调用 GitHub Contents API **只提交源文件**（`data/site-data.json`、

  `data/themes.json`）；CI 生成 `resume.html`、知识库、快照并提交生成物。

* **回滚**：内容以 Git commit 为准，`git revert` 即可；知识库按 `kb_version` 回切，不需要重建历史。

* **审计**：谁、何时、改了哪些字段、发布 commit 是什么，写 `audit_logs`。

### 4.5 P0 迁移步骤（建议按顺序）



1. 先提交 / 另存当前 `resume.html` 的未提交埋点改动，作为视觉与文案基线。

2. 写一次性抽取脚本：从 `resume.html` 抽出经历、项目、技能、教育、个人简介，

   人工核对后写入 `data/site-data.json` 的 `resume` 块；同时补 `features` 与 `faq`。

3. 把现有 `experience[].points` / `projects[].points` 归一成 `bullets[]`（保留兼容字段，逐步切换）。

4. 写 `scripts/render_resume.mjs`：先做「模板 = 当前 HTML + 占位符」，逐个 section 替换，

   每替换一块就跑一次文本 / 截图 diff。

5. 写 `scripts/validate_content.mjs` 与 `.github/workflows/content-build.yml`。

6. 验收：`node scripts/render_resume.mjs --check` 退出 0；手改 `resume.html` 会被 CI 拒绝；

   改一条 JSON 要点，主页与简历同时变化。

> **不要**
>
> 在 P0 里顺手改视觉、改文案风格或重写简历。P0 的目标是 “等价迁移”，不是 “顺便美化”。

### 4.6 数据分层：Git 是内容真相源，D1 是运行时状态

“唯一真相源”是**逻辑概念**，不是“所有数据都塞进一个数据库”。每类数据只有一个权威副本，
D1 / Vectorize / R2 里的是派生索引或运行状态：

| 数据 | 存放位置 | 角色 |
|---|---|---|
| 简历 / 主页内容 | Git：`data/site-data.json` | **权威源**，人工编辑、diff、回滚 |
| 主题 token | Git：`data/themes.json` | **权威源**，发布后生成 CSS |
| `resume.html` / `site-data.js` / KB 切片 | Git：生成物 | 由源生成，禁止手改 |
| 管理后台草稿 / 版本 / 审计 | D1：`content_drafts` / `content_versions` / `audit_logs` | 工作状态与审计，不替代 Git |
| 留言设备 / 留言 | D1：`wall_devices` / `wall_messages` | 运行时状态 |
| 问答日志 / 模型调用 / JD / 变体元数据 | D1 | 运行时状态与统计 |
| KB 切片 / FTS5 | D1：`kb_chunks` / `kb_fts` | 检索索引（派生） |
| 向量 | Vectorize | 语义索引（派生） |
| PDF / 变体 HTML | R2 | 文件对象，D1 只存 key/元数据 |
| 访问事件 | Analytics Engine + D1 聚合 | 遥测，不是内容源 |
| 功能开关 / 默认主题 | D1 `config` + KV 缓存 | 运行时配置 |

**为什么简历内容不放 D1 当唯一源：**

- 公开页和简历是**构建期生成**的静态文件，D1 是运行时 SQL，不负责托管 HTML；
- Git 天然有 diff、review、revert、blame，内容改动可审、可回滚；D1 行级历史要自己造；
- CI 可以在没有数据库连接时完成校验、生成、预览；D1 挂了不影响静态站打开；
- D1 免费单库 500 MB、单次 50 查询，适合状态/日志/索引，不适合当 CMS 的唯一文件库；
- “唯一源”若放 D1，后台一改就直接影响线上，缺少 Git 这层发布闸门。

**D1 里会有简历数据吗？会，但都是派生副本：**

- `kb_chunks` 存切片，供关键词检索与后台查看；
- `content_versions` 存发布快照，供审计/预览；
- `resume_variants` 存变体 JSON 与 page_count；
- 这些都可以从 `site-data.json` 重建，**删了不影响内容权威性**。

如果以后要把后台做成“数据库即 CMS”，也可以让 D1 当权威源，再定时导出 JSON 到 Git 供构建；
但那是另一种架构，代价是发布链路、回滚和离线预览都会变复杂。当前不建议。



***

## 5. RAG 设计（P1）

### 5.1 切片：原子证据，而不是整段简历



| 切片类型       | 示例 ID                   | 内容                      | 数量级   |
| ---------- | ----------------------- | ----------------------- | ----- |
| 个人定位       | `me-01`                 | 姓名 / 角色 / 年限 / 一句话定位    | 2–3   |
| 经历要点       | `exp-comein-b1`         | 公司 + 角色 + 时间 + 一条成果     | 13–20 |
| 项目要点       | `proj-lessie-p1`        | 项目 + 角色 + 一条成果          | 21–30 |
| 技能组        | `skill-agent`           | 技能组 + 代表证据              | 6–10  |
| 教育 / 证书    | `edu-main` / `award-01` | 学校 / 专业 / 奖学金 / 验证码     | 3–5   |
| 站点功能       | `feature-wall`          | 留言墙 / 语音 / JD / 主题的工程实现 | 5–8   |
| FAQ / 敏感问题 | `faq-gap`               | 空窗期、离职、薪资、到岗的标准话术       | 5–10  |



* 每片 150–350 字；前缀带上下文：`【公司 · 角色 · 时间】`。

* 每片元数据：`section / entity_id / entity_type / tags / audience / visibility / lang / kb_version / source_path`。

* 联系方式只保留公开邮箱 / GitHub；手机号不进知识库（沿用 `build_kb.py` 的隐私闸门）。

* 切片 ID 稳定，不因排序变化而变；新增内容只追加。

### 5.2 向量化与索引



* **embedding**：`@cf/baai/bge-m3`，1024 维，多语言，适合中英混排技术词。

* **Vectorize index**：`resume-kb`，`dimensions=1024`，`metric=cosine`。

* **元数据**：上面那组字段；查询时按 `visibility=public`、`kb_version=<active>` 过滤。

* **写入**：CI 离线调用 Cloudflare Workers AI REST API 生成向量，再 `wrangler vectorize insert`

  或 REST upsert；同时把切片写入 D1 `kb_chunks`，供后台查看与关键词检索。

* **版本**：向量 ID 用 `v2:exp-comein-b1`，元数据带 `kb_version=2026-11-19.1`；

  新版本先建、评测通过后切 `active_kb_version`，旧版本保留一天再清理。

### 5.3 混合检索



```
问题
 ├─ 归一化 + 意图识别（contact / experience / project / skill / gap / salary / jd）
 ├─ 词面召回：D1 FTS5（中文先切 bigram 再入索引，避免分词器差异）Top 10
 ├─ 语义召回：Vectorize query Top 10（metadata: visibility=public, kb_version=active）
 ├─ RRF 融合：score = Σ 1/(60 + rank)
 ├─ 可选 rerank：bge-reranker-base 取 Top 12 → Top 6（JD 模式默认开，聊天模式按需）
 └─ 上下文构造：每片带 [C1] 标签 + 公司/角色/时间 + 原文，预算 ≤ 4,000 字
```



* **为什么混合**：知识库小，向量对 “精确名词 / 公司名 / 数字” 不如词面；词面对同义问法又不如向量。

* **为什么 rerank 只给 JD**：聊天要控延迟；JD 逐条判定，值得多 100–300ms。

* **FTS5 注意**：D1 支持 FTS5，但中文分词不要赌默认 tokenizer；用 `text_tokens` 存

  “我 们 团 队” 式的 bigram 串，`tokenize='unicode61'`，稳定且可复现。

### 5.4 生成与防幻觉

**输出契约**（聊天流式返回文本，结束时附结构化元数据）：



```
{
  "answer": "……",
  "citations": ["exp-comein-b1", "proj-lessie-p1"],
  "confidence": "high|medium|low",
  "refused": false,
  "reason": "insufficient_context|off_topic|sensitive"
}
```

**四层闸门：**



1. **输入侧**：长度 > 300 字拒绝；命中 “写代码 / 翻译 / 扮演 / 忽略以上指令” 等意图直接固定话术；

   与简历无关的问题不进模型。

2. **检索侧**：Top1 分数低于阈值且词面命中 <2 个 bigram → 不生成，直接 “简历里没写这块”。

3. **生成侧**：系统提示词要求 “只依据 context、引用数字必须一致、薪资 / 外包 / 到岗不承诺”。

4. **输出侧**：抽取回答中的数字 / 公司名 / 时间，逐个在 `citations` 对应切片里校验；

   不通过则重写一次，仍不通过就降级为 “依据如下，建议直接沟通”。

**回答风格**：4 句话内、120 字左右、先结论后证据；末尾一行 “依据：公司・项目 / 要点”。

**UI**：首次打开标注 “AI 助手，回答基于简历内容自动生成”；每条回答可展开引用与反馈（有用 / 没用）。

### 5.5 评测（上线闸门）



* **金标集**：30–50 题，覆盖个人定位、四段经历、三个项目、技能、教育、联系方式、空窗期、

  薪资 / 外包 / 到岗、JD 相关、完全无关、提示词注入。

* **指标**：


  * `hit@3`：正确切片是否进前三；

  * `faithfulness`：回答中的事实是否都能在引用切片找到（可用 LLM judge + 人工抽检）；

  * `refusal_correct`：该拒答的是否拒答；

  * `p95_latency`、`fallback_rate`、`cost_per_answer`。

* **门禁**：hit@3 ≥ 90%、unsupported 数字 = 0、无关问题拒答 = 100%、p95 < 8s。

  不达标不切 `active_kb_version`。

* **回归**：每次改 prompt / 模型 / 切片 / 排序，CI 跑同一套金标集，结果写 `eval_runs`。

### 5.6 免费额度下的容量



* Vectorize 计费按 `(存储向量数 + 查询次数) × 维度`，**不按 topK 放大**。

  1024 维、80 个切片时：`(80 + Q) × 1024 ≤ 30,000,000` → 约 **2.9 万次查询 / 月（约 960 次 / 天）**。

* 100 次问答 / 天 + 5 个 JD / 天（每个 JD 8 条要求）= 140 次检索 / 天 ≈ 4,200 次 / 月，

  占免费额度约 **14%**。

* Workers AI 免费 10,000 neurons / 天；GLM-4.7-flash 按 $0.0605/M 输入 + $0.40/M 输出估算，

  一次 1.5k 输入 + 300 输出约 19 neurons；100 次问答 + 5 个 JD 约 2,500 neurons，

  占 **25% 左右**（上下文更长时按 35% 估）。

* 结论：个人站正常流量下免费额度很宽裕；真正的红线是 **>900 次检索 / 天** 或 **>500 次问答 / 天**，

  到那时再考虑 \$5 / 月 Workers Paid。



***

## 6. JD 匹配与动态简历（P2）

### 6.1 JD 匹配流程



```
JD 原文（≤1500 字，前端截断）
 ├─ 归一化 + 哈希（只存 hash 前 10 位，原文不入库）
 ├─ LLM 结构化拆解：role / level / must_have[] / nice_to_have[] / domain / keywords / years
 ├─ 每条要求单独混合检索 Top 5（metadata 过滤 + 版本）
 ├─ 证据判定：full / partial / gap + evidence_ids + 理由
 ├─ 评分：must 70% + nice 30%；full=1, partial=0.5, gap=0
 ├─ 输出：requirement / evidence / coverage / gap / probe（面试追问点）
 └─ 缓存：sha256(jd_norm + kb_version + model + prompt_version)，TTL 30 天
```

**为什么逐条检索**：整段 JD 一个向量会把 “必须” 和 “加分” 混在一起，也无法解释 “哪条没覆盖”。

逐条检索才能产出招聘方真正想看的「要求 → 经历 → 缺口 → 追问点」对照表。

### 6.2 动态简历生成

**不是让模型写 HTML，而是让模型产出 “选材单”**：



```
{
  "target_role": "AI Agent 工程师",
  "summary": { "text": "……", "source_ids": ["me-01", "exp-lessie-b1"], "fact_ids": ["fact-lessie-30"] },
  "sections": [
    {
      "type": "experience",
      "items": [
        {
          "source_id": "exp-comein",
          "bullets": [
            { "source_id": "exp-comein-b1", "text": "……", "fact_ids": [] }
          ]
        }
      ]
    }
  ],
  "skill_order": ["agent", "rag", "backend", "data"],
  "omitted": [{ "source_id": "exp-zhou", "reason": "与目标岗位相关性低" }]
}
```

**生成约束：**



* 只能从 canonical `bullets` 里选；可改写措辞，但必须保留 `source_id`；

* 公司、任职职位、时间、学历不可改；目标岗位 headline 属于 L1 微调；

* 数字只能来自 `metrics/facts`；

* 技能只能重排 / 强调，不能新增；

* 总长度：A4 **≤2 页**（硬上限）；每段要点按 6.4.2 的内容预算执行；

* 输出 JSON Schema 校验 + 事实校验 + 与完整简历的 diff。

**渲染：**



* 确定性模板 `templates/resume-tailored.html`，与公共简历共用 CSS / 打印样式；

* 变体 JSON 存 D1，HTML 可按需渲染；PDF 正式产物用 GitHub Action + Playwright 生成后放 R2，

  浏览器打印只作预览；Playwright 同时负责数页数（≤2 页才允许发布 / 下载）；

* 分享链接：`/r/<slug>`，`noindex`，默认 90 天过期；可选访问码；

* 公共 `/resume.html` 永远是完整版，不被 AI 变体覆盖。

### 6.3 边界与风险



* **不承诺**：薪资、外包、到岗时间、签证等，仍走固定话术，不写进变体。

* **不删历史**：可以降低老经历权重，但不能篡改时间线；`omitted` 记录原因，后台可审。

* **不伪造**：JD 里出现但简历没有的技能，只能进 “gap”，不能进变体。

* **可回滚**：变体发布前在后台做 diff；不满意就丢弃 JSON，不影响公共简历。

### 6.4 字段级改动边界与 A4 两页硬上限

#### 6.4.1 三层权限（不是所有字段都交给 AI）



| 层级        | 字段                                                         | AI 权限                 | 代码校验                            |
| --------- | ---------------------------------------------------------- | --------------------- | ------------------------------- |
| **L0 锁定** | 姓名、邮箱、GitHub、电话、公司全称 / 简称、任职起止、项目名、学校、专业、学位、教育起止、证书、所有数字事实 | **完全不可改**             | 与 canonical 逐字段比对；不一致直接拒绝       |
| **L1 微调** | 目标岗位 headline、联系方式展示顺序、教育相关课程 / 奖项的取舍与顺序、section 顺序        | 只能选、排序、强调；不能新增 / 改写事实 | 值必须来自枚举 / 源字段；顺序白名单             |
| **L2 灵活** | 个人简介、工作经历 bullet、项目 bullet、技能分组顺序与强调                       | 可选、可排序、可改写措辞          | 必须带 `source_id`；数字 / 公司 / 时间回查源 |

**关键区分：**



* “基本信息 / 教育经历微调” 不是让 AI 改姓名、学校、时间，而是让它决定**目标岗位标题怎么写、**

  **哪些课程 / 奖项更相关、联系方式和 section 怎么排**。

* 工作经历里的公司名、任职时间、项目名属于 L0；AI 只能改 bullet 的取舍与措辞。

* 技能只能从 canonical 技能表里选、分组、排序、加粗，不能凭空加 “Kubernetes 精通”。

#### 6.4.2 两页内容预算（5 年经验）

固定 A4、页边距 14mm、正文 10.5pt、行高 1.45；页头 / 页脚不随 AI 变。建议上限：



| 模块      | 上限                       | 说明                              |
| ------- | ------------------------ | ------------------------------- |
| 基本信息    | 3 行                      | 姓名 / 目标岗位 / 联系方式                |
| 教育经历    | 2 行                      | 学校 / 专业 / 学位 / 时间；课程 / 奖项最多 1 行 |
| 个人简介    | 2–3 行 / 120–180 字        | 只放与 JD 最相关的定位                   |
| 工作经历    | 3 家公司、每家 2–3 条、总计 ≤9 条   | 5 年经验通常 3 段；更早的合并或降权            |
| 项目经历    | 2–3 个项目、每个 1–2 条、总计 ≤5 条 | 优先 JD 必须项证据                     |
| 专业技能    | 6–10 项、2 行               | 按 JD 相关度排序，不堆列表                 |
| 奖项 / 证书 | 1–2 行                    | 不相关可省略                          |

**超页处理顺序**：先删最低优先级的项目 bullet → 再删最低优先级的工作 bullet → 再压缩简介 →

最后才动技能。每次只删一条、重渲染、重测页数，最多 3 轮；仍超 2 页就**拒绝发布**并提示站长，

不允许 AI 为了塞内容改字号 / 页边距 / 布局。

#### 6.4.3 落地方式



* `resume_variants` 存 `content_budget`（各模块条数 / 字数）与 `page_count`；

* 生成后先跑 JSON Schema + L0/L1/L2 校验，再跑确定性模板渲染；

* **严格页数用 Playwright 在 CI / 异步任务里量**（`page.pdf()` 后数页数），

  浏览器直接打印只能算 “预览”，不能作为 2 页保证；

* 超过 2 页的变体不生成分享链接 / PDF，后台显示 “需删减”；

* 模板只替换文本、显隐、顺序，**不改 DOM 结构、CSS、字号、页边距**。

#### 6.4.4 提示词与代码的关系

提示词里要写清楚 “公司名 / 时间 / 学历 / 数字不可改、只能引用 source\_id、A4 两页”，

但**提示词不是边界，validator 才是边界**。模型改了 L0 字段，代码拒绝并重试；

重试仍失败就报错，不把脏数据渲染出去。



***

## 7. 管理后台（P3）

### 7.1 形态



* **独立 Pages 项目**：`shenge-work-admin.pages.dev`，与主站同仓库不同构建目录（如 `admin/`）。

* 技术栈：React + TypeScript + Vite + Tailwind + shadcn/ui + TanStack Query + ECharts + CodeMirror。

* API：Pages Functions + Hono + Zod；与主站共用 `portfolio-db`，但只挂 admin 路由。

* 不依赖自有域名；`*.pages.dev` 可用。未来买了域名，再在前面加 Cloudflare Access 做第二层。

#### 7.1.1 独立项目 vs 同站 `/admin`：推荐独立项目

| 维度 | 独立 Pages 项目（推荐） | 同站 `/admin` + 账号 |
|---|---|---|
| 安全隔离 | 后台 JS 不进公开站 bundle；独立 origin/cookie/CSP；公开站 XSS 碰不到后台会话 | 后台 HTML/JS 公开可下载；同 origin；一个公开站 XSS 可能摸到后台接口 |
| 鉴权 | GitHub OAuth 回调在 admin origin；`__Host-` 会话 cookie 只属于后台 | 同 origin 方便，但静态 `/admin` 必须由 Function 先鉴权再吐 HTML，否则直接访问就绕过了 |
| 入口 | 直接记书签，或页脚一个低调的“管理”链接 | `/admin` 路径；所谓“隐匿入口”只是障眼法，不是安全边界 |
| SEO/抓取 | 后台全站 `noindex`，与公开站完全分开 | 也能 `noindex`，但同站更容易被误抓/误收录 |
| 构建 | 公开站继续零构建；admin 独立 React 构建 | 一个构建；公开站会被迫带上 admin 依赖，部署耦合 |
| 故障半径 | admin 部署失败不影响主站；主站发布也不影响后台 | 一次坏部署可能同时打挂公开页和后台 |
| 运维 | 两个项目、同一仓库、共享 D1/GitHub Actions | 一个项目，少一个 URL；但路由/权限/缓存更复杂 |
| 成本 | 第二个 Pages 项目仍免费；构建次数共享 500/月 | 相同 |
| 未来域名 | `admin.shenge-work.com` + Access，边界清晰 | 主域 `/admin` + Access 路径规则，配置更绕 |

**结论：同一仓库，两个 Pages 项目。**

> **状态：已采用（2026-11-19）**。后续实施按本节执行，不再回退到同站 `/admin` 方案。

```
公开站：chenpeisheng.cn / shenge-work.pages.dev
后台：  shenge-work-admin.pages.dev
共享：  D1 portfolio-db、GitHub 仓库、构建脚本、设计 token
```

* 公开站默认**不放管理入口**；需要时在页脚放一个 `管理` 链接（`rel="nofollow"`，后台 `noindex`）。
* 后台的 OAuth、会话、`/api/admin/*` 都只挂在 admin 项目；公开站不包含任何 admin 代码。
* 不要用“隐藏路径”当安全措施；真正的边界是**服务端会话校验 + 独立 origin**。
* 如果坚持同站：`/admin` 必须由 Pages Function 在返回 HTML 前校验会话，且静态 `/admin/index.html`
  不能被直接访问；没有自有域名/Access 时，这套路由很容易配漏，不推荐。

#### 7.1.2 后台项目落地清单（已按此形态执行）

1. **Cloudflare Pages 项目** `shenge-work-admin`，Git 连接同一仓库，构建根目录 `admin/`，
   输出 `admin/dist/`；Functions 放 `admin/functions/`。
2. **D1 绑定**：在 admin 项目里绑定同一个 `portfolio-db`，变量名 `DB`；不新建第二套库。
3. **GitHub OAuth App**：回调填 `https://shenge-work-admin.pages.dev/api/admin/auth/callback`；
   只允许 `shenge-work` 账号。
4. **环境变量/Secret**：`GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`、`ADMIN_GITHUB_LOGIN`、
   `SESSION_PEPPER`、`DEVICE_HASH_PEPPER`；密钥只在 Pages 环境变量，不落库、不进前端。
5. **路由边界**：`admin/functions/api/admin/*` 全部先过会话中间件；公开站 `functions/api/*` 不提供
   任何 admin 路由。
6. **SEO/缓存**：admin 全站 `X-Robots-Tag: noindex` / `robots.txt` disallow；公开站 sitemap 不包含后台。
7. **入口**：默认只记书签；如需入口，公开站页脚加 `管理` 链接（`rel="nofollow"`），不放进主导航。
8. **验收**：未登录访问后台任意页面/接口 → 401 或跳 OAuth；登录后能读 D1；
   公开站产物 `grep` 不到 admin 代码、密钥、内部 API 路径。

### 7.2 模块清单



| 模块           | 能做什么                                                                | 关键约束                                  |
| ------------ | ------------------------------------------------------------------- | ------------------------------------- |
| 总览 Dashboard | PV/UV、问答量、成功率、p50/p95、JD 数、下载 / 联系点击、配额                             | 数据延迟 < 1 分钟；只读                        |
| 内容管理         | 结构化编辑基本信息 / 教育 / 经历 / 项目 / 技能 / FAQ/features；草稿 / 预览 / 发布 / 版本 diff | 基本信息与教育默认手动配置；AI 仅 `resume.micro` 可微调 |
| 简历工作室        | 默认简历 section 顺序、要点取舍、主题、PDF 预览；变体列表；L0/L1/L2 权限与 2 页预算              | 公共简历与变体分离；超页拒绝发布                      |
| RAG 运维       | 切片列表、检索测试（query → top chunks + 分数）、重建、版本切换、评测结果                     | 重建是蓝绿流程，不直接覆盖 active                  |
| 模型配置         | provider/model/ 别名 / 温度 /max tokens / 优先级 / 预算 / 限流；fallback 顺序     | 密钥只在 Worker secret；后台只能选别名，不能查看       |
| 提示词管理        | 版本化 prompt、A/B、发布、回滚                                                | 发布前必须跑金标集                             |
| QA 洞察        | 问题列表、筛选、聚类、未答 / 低分、反馈、转 FAQ 草稿、导出 CSV                               | 默认脱敏；90 天保留                           |
| JD 与变体       | 匹配历史、分数、缺口、变体预览 / 下载 / 删除                                           | JD 原文不落库，只留 hash 与摘要                  |
| 留言板管理        | 全设备列表、每设备留言线程、关键词 / 时间筛选、删除、屏蔽、导出、统计                                | 后台可见全部；访客只可见本设备；不展示原始 IP              |
| 主题工坊         | 颜色 / 字体 / 边框 / 阴影 token；主页 + 简历双预览；对比度检查；发布默认主题                     | 打印样式强制黑白，不受主题影响                       |
| 可观测          | 事件流、错误、健康检查、配额、告警规则                                                 | 只读；敏感字段脱敏                             |
| 设置与审计        | 管理员、会话、feature flags、数据保留期、审计日志                                     | 最小权限；操作留痕                             |

### 7.3 鉴权（没有域名也能做）



* **GitHub OAuth App**：回调 `https://shenge-work-admin.pages.dev/api/auth/callback`；

  只允许 GitHub 账号 `shenge-work`（可加白名单）。

* **会话**：登录成功生成 32 字节随机 token，D1 存 `sha256(token)`；

  Cookie 用 `__Host-admin_session`，`HttpOnly + Secure + SameSite=Lax + Path=/`；7 天过期，可主动吊销。

* **CSRF**：所有写请求校验 `Origin` + double-submit token；不依赖 CORS。

* **限流**：登录 5 次 / 10 分钟 / IP；管理 API 60 次 / 分钟；失败写审计。

* **可选**：登录页加 Turnstile；后台全站 `noindex`；`robots.txt` 禁止。

* **未来**：有域名后加 Cloudflare Access（50 用户内免费），OAuth 仍保留为第二层。

### 7.4 发布链（Git 是真相源）



```
后台保存草稿 → D1 content_drafts
   → 校验（schema + 事实 + 链接 + 隐私）
   → 预览（同一渲染器，iframe）
   → 发布：GitHub Contents API 提交 data/site-data.json / data/themes.json
   → GitHub Actions：生成 resume.html + site-data.js + KB + embeddings
   → commit 生成物（[skip ci]）→ Pages / GitHub Pages 自动部署
```



* GitHub token 用 **fine-grained PAT**，只给目标仓库 `Contents: Read/Write`；

  存 Worker secret，不落 D1 明文；可随时吊销。

* 若不想给后台写权限：P3a 先做 “只读看板 + 导出 JSON”，P3b 再加发布。

* 生成物 commit 要带 `[skip ci]` 或在工作流里判断 actor，避免无限循环。

* 发布频率高时注意 Pages 免费 500 次构建 / 月；合并多次改动再发布。

### 7.5 核心数据表（建议）



| 表                                                      | 用途                                                     |
| ------------------------------------------------------ | ------------------------------------------------------ |
| `content_drafts` / `content_versions`                  | 草稿、发布版本、diff、Git commit                                |
| `kb_chunks` / `kb_fts` / `kb_versions`                 | 切片、FTS5 索引、版本与状态                                       |
| `qa_logs`                                              | 脱敏问题 / 回答 / 引用 / 分数 / 延迟 / 模型 /token/ 成本 / 反馈          |
| `llm_calls`                                            | 每次模型调用：provider/model/tokens/latency/cost/cache/status |
| `jd_matches`                                           | JD hash、角色、分数、requirements JSON、kb\_version、耗时         |
| `resume_variants`                                      | 变体 JSON、slug、R2 key、过期时间、浏览量                           |
| `wall_devices` / `wall_messages`                       | 设备标识哈希、留言线程、状态、后台备注                                    |
| `themes`                                               | 主题 token、状态、发布人 / 时间                                   |
| `model_configs` / `module_configs` / `prompt_versions` | 模型、模块覆盖、提示词版本                                          |
| `eval_cases` / `eval_runs`                             | 金标集、每次评测指标                                             |
| `question_clusters` / `insights`                       | 问题聚类、内容缺口、周报                                           |
| `admin_users` / `admin_sessions` / `audit_logs`        | 管理员、会话、审计                                              |
| `event_rollups` / `config`                             | 每日聚合、功能开关 / 默认主题                                       |

> D1 免费版单库 500 MB、单次请求 50 条查询；后台看板不要 N+1，按天预聚合。

### 7.6 API 轮廓

**公开：** `POST /api/chat`、`POST /api/jd/match`、`POST /api/resume/tailor`、

`GET /api/resume/variant/:slug`、`POST /api/events`、`GET /api/config`、`GET /api/health`；

`GET/POST /api/wall`（按 `X-Device-Id` 只返回本设备，管理删除走 admin）。

**管理：** `/api/admin/auth/github`、`/callback`、`/logout`；

`/api/admin/dashboard`、`/content/*`、`/kb/*`、`/models/*`、`/prompts/*`、

`/qa/*`、`/jd/*`、`/wall/*`、`/themes/*`、`/audit/*`、`/settings/*`。

**约定：** 所有写接口 Zod 校验；返回 `{ok, data, error, request_id}`；

错误不暴露内部堆栈；每个请求带 `request_id`，贯穿 D1/AI Gateway / 日志。

### 7.7 安全清单



* 密钥只在 Worker secret / GitHub secret；前端产物 `grep` 不得出现 `sk-`、`Bearer`。

* 后台预览的模型输出按 Markdown 渲染，必须经 DOMPurify；不要 `dangerouslySetInnerHTML` 原始 HTML。

* 管理 API 全部鉴权 + CSRF + 限流 + 审计；不做 “隐藏 URL 即安全”。

* 资源上传：限制 MIME / 大小；R2 key 随机化；不执行用户上传内容。

* 依赖：锁定版本；`npm audit` 进 CI；后台不引不必要的 SDK。

* 备份：D1 Time Travel 7 天（免费）+ `scripts/backup-d1.sh` 每日快照；Git 保存内容。

### 7.8 留言板：设备隔离与管理

#### 7.8.1 先把 MAC 这件事说清楚



* **网页读不到 MAC 地址。** 浏览器没有开放 MAC 的 API；MAC 属于链路层标识，网页沙箱拿不到。

* 手机 / 平板普遍启用 **MAC 随机化**；同一设备还可能有 Wi-Fi / 蓝牙 / 以太网多个 MAC，浏览器一个都拿不到。

* 因此 “跟着 MAC 走” 在 Web 端**无法按字面实现**。可行的是：



```
device_id = crypto.randomUUID()        // 128 位随机，首次访问生成
存储：localStorage['cp_device_id']      // 同浏览器持久
传输：X-Device-Id 请求头
服务端：device_hash = HMAC-SHA256(DEVICE_HASH_PEPPER, device_id)
```



* 这代表 “**一台设备 = 一个浏览器配置**”，不是物理硬件：


  * 清缓存 / 隐身模式 / 换浏览器 = 新设备；

  * 同一人的手机 + 电脑 = 两台设备；

  * 设备 ID 可被脚本伪造，所以它是**隐私隔离**，不是安全认证。

* 如果以后要求 “同一个人跨设备看到同一份留言”，再加 “设备绑定码 / 邮箱 magic link”，

  不要试图用 MAC 解决。

#### 7.8.2 产品语义要改



* 留言板从 “全站公开墙” 改成 “**本设备私密留言本**”：只显示当前设备自己发的留言。

* 首页文案同步改：`匿名可选 · 仅本设备可见`，并说明 “清除浏览器数据 / 换设备后看不到历史”。

* 提供 “重置本设备” 按钮：清除 `cp_device_id` 并生成新 ID；旧设备记录仍留在后台。

* 管理员后台看到**所有设备**的留言；可按设备查看线程。

* 旧留言没有 `device_hash`，迁移到 `legacy` 设备桶，**只在后台可见**，不暴露给任意新设备。

* 可选增强：站长回复（只对该设备可见）、设备未读标记、设备屏蔽。

#### 7.8.3 数据模型



```
CREATE TABLE IF NOT EXISTS wall_devices (
  device_hash TEXT PRIMARY KEY,          -- HMAC，不存原始 device_id
  label       TEXT,                      -- 如“设备 a1b2”，后台可改
  first_seen  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  blocked     INTEGER NOT NULL DEFAULT 0,
  ua_class    TEXT,                      -- mobile/desktop/bot，粗分类
  ip_hash     TEXT                       -- 盐化，不存明文 IP
);

-- 老表增量迁移（新库直接按最终结构建）
ALTER TABLE wall_messages ADD COLUMN device_hash TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE wall_messages ADD COLUMN status TEXT NOT NULL DEFAULT 'visible'; -- visible/hidden/deleted
ALTER TABLE wall_messages ADD COLUMN admin_note TEXT;
ALTER TABLE wall_messages ADD COLUMN updated_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_wall_device_created
  ON wall_messages(device_hash, created_at DESC);
```



* 列表按 `device_hash + created_at` 过滤；`peek` 也只 peek 本设备。

* **裁剪要按设备**：现有 `trim()` 保留全站最新 100 条，设备隔离后会误删其他设备的留言；

  改成 “每设备最多 N 条（如 50）+ 全站总上限”，只裁当前设备。

* `DEVICE_HASH_PEPPER` 必须稳定保存；轮换会导致所有设备 ID 重新映射，需提前迁移。

* 管理员按 `wall_devices.last_seen` 排序，能看到设备数量、留言量、最近活跃。

* 删除用软删除 `status='deleted'`，后台可恢复；导出默认脱敏。

#### 7.8.4 API 变化



| 接口                                         | 变化                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `GET /api/wall`                            | 必带 `X-Device-Id`；只返回该设备留言；`peek` 同；缺 ID 返回空列表 + `device_required`  |
| `POST /api/wall`                           | 必带 `X-Device-Id`；服务端哈希后入库；限流按 `device_hash + ip_hash`；Turnstile 保留 |
| `DELETE /api/wall`                         | 公开端不再提供；删除走 `/api/admin/wall/messages/:id`                         |
| `GET /api/admin/wall/devices`              | 全设备列表：label、消息数、首末次、blocked                                        |
| `GET /api/admin/wall/messages`             | 按设备 / 时间 / 关键词 / 状态筛选；分页                                           |
| `POST /api/admin/wall/messages/:id/status` | hidden/deleted/visible，写审计                                         |
| `POST /api/admin/wall/devices/:hash/block` | 屏蔽设备；该设备后续 POST 返回 403                                             |
| `GET /api/admin/wall/export`               | CSV/JSON，默认脱敏                                                      |



* CORS 允许头增加 `X-Device-Id`；`Vary: Origin` 保留。

* 后台接口全部走 admin 会话 + CSRF + 限流，不再用单一 `WALL_ADMIN_TOKEN`；

  老 token 可保留 7 天做应急，之后吊销。

* 公开端不提供 “按 id 删除”，避免任意人删别人留言。

#### 7.8.5 迁移顺序



1. 新增 `wall_devices` 与 `wall_messages` 字段（先迁移，不改 API）。

2. 后端 GET/POST 支持 `X-Device-Id`，旧数据归 `legacy`。

3. 前端生成 / 读取 `cp_device_id`，所有 wall 请求带 header；改文案。

4. 后台加上设备列表 / 线程 / 删除 / 屏蔽 / 导出。

5. 用两台设备 / 两个浏览器实测：A 设备发留言，B 设备看不到；后台两台都能看到。

6. 兼容性：`file://` 预览仍关闭留言墙；本地 API server 也要支持 header。

#### 7.8.6 边界



* 这是 “**尽力而为的设备隔离**”：能挡住普通访客互相看到，挡不住有意伪造 device\_id 的人。

* 如果留言包含敏感信息，前端要提示 “不要留隐私信息”；后台仍按最小权限访问。

* 真要做 “强隔离 / 跨设备身份”，必须上登录（GitHub OAuth / 邮箱 magic link），

  那就不是留言板，而是 “访客账户” 了，建议放到 P5 再评估。



***

## 8. 可观测与问答分析（P4）

### 8.1 事件模型



| 事件                                      | 触发               | 关键属性                                         |
| --------------------------------------- | ---------------- | -------------------------------------------- |
| `page_view`                             | 首屏               | page, theme, referrer, device                |
| `section_view`                          | 板块进入视口           | section                                      |
| `project_open`                          | 项目弹窗             | project\_id                                  |
| `resume_download` / `resume_print`      | 下载 / 打印          | format, theme                                |
| `contact_click`                         | 邮箱 / GitHub / 电话 | channel                                      |
| `ai_open` / `ai_question` / `ai_answer` | 助手               | session, topic, citations, latency, fallback |
| `ai_feedback`                           | 有用 / 没用          | answer\_id, rating                           |
| `jd_submit` / `jd_result`               | JD               | role, score, requirements\_count             |
| `resume_tailor` / `variant_download`    | 动态简历             | variant\_id, target\_role                    |
| `theme_switch`                          | 切换主题             | from, to                                     |
| `wall_post`                             | 留言               | ok/error                                     |



* 前端统一走 `window.portfolioTrack`，新增 `/api/events`（`sendBeacon`，失败不阻塞页面）。

* 服务端补 `ip_hash`、`country`、`ua_class`、`origin`；**不存原始 IP / 邮箱 / 手机号**。

* 高频事件写 Analytics Engine（100k 数据点 / 天，3 个月保留）；业务事件写 D1；

  每日 cron 聚合到 `event_rollups`，看板优先读聚合表。

* 后端错误与请求链：Workers Logs（20 万条 / 天、3 天）做即时排查；

  `request_id` 同时写入 D1 `llm_calls`/`errors`，长期留存与看板走 D1。

### 8.2 看板指标



* **流量**：PV/UV、来源、设备、主题分布、板块停留。

* **AI**：打开率、提问率、回答成功率、拒答率、fallback 率、p50/p95、平均 token / 成本、反馈好评率。

* **JD**：提交数、平均分、覆盖分布、Top 缺口、从 JD 到变体 / 下载的转化。

* **内容**：Top 问题、未答问题、低分问题、内容缺口、FAQ 命中。

* **系统**：错误率、4xx/5xx、D1 读写、Vectorize 查询、Workers AI neurons、配额预警。

### 8.3 问题采集与提炼



1. **采集**：`qa_logs` 存脱敏问题、回答、引用、top1 分数、fallback、延迟、模型、token、反馈。

2. **清洗**：手机号 / 邮箱 / 身份证替换；超长截断；疑似注入打 `suspect`；原始 IP 只存盐化 hash。

3. **聚类**：每周 GitHub Action 导出匿名问题，`bge-m3` 向量 + HDBSCAN 聚类；

   或低流量时直接 LLM 批量打标（意图 / 主题 / 情绪 / 是否可答）。

4. **提炼**：生成 `insights`：

* Top 20 真实问题；

* 未答 / 低分问题 → 建议补哪段内容；

* JD 高频要求 vs 简历缺口；

* 访客最关心的项目 / 技能（面试预演清单）。

1. **闭环**：后台一键把高频问题转成 `faq` 草稿 → 发布 → 重建 KB → 下次可答。

2. **周报**：每周一生成 Markdown / 邮件；可选推送到飞书。

### 8.4 隐私与合规



* 公开页面注明 “对话会匿名记录用于改进回答”，并提供关闭入口（本地开关）。

* 留言板设备 ID 只存 HMAC，不存原始值；提供 “重置本设备”；后台不展示原始 IP。

* 原始问题文本默认保留 90 天；30 天后只保留聚合 / 聚类结果；可配置更短。

* 日志表仅管理端可读；导出默认匿名化；D1 备份加密 / 不入 Git。

* JD 原文不入库，只存 hash 与结构化摘要；简历转发邮箱不写日志。

* 删除机制：后台支持按 session / 时间段删除；D1 Time Travel 与快照按保留期清理。

### 8.5 告警



* Cron 每 15 分钟：`/api/health`、5xx 率、p95、D1 写入、Vectorize 查询、neurons 估算。

* 阈值：错误率 > 5%、p95 > 10s、日 neurons > 80%、Vectorize > 80%、D1 写入 > 80%。

* 通知：Resend 邮件（现有）；可选飞书 Webhook。

* 熔断：超限自动切关键词检索 + 固定话术，不把额度打爆。



***

## 9. 主题系统

### 9.1 目标



* 主页 4 套主题继续保留；简历页也吃同一套 token，不再固定死。

* 管理后台可视化调 token，预览主页 + 简历，发布默认主题；访客仍可切换。

* 打印 / PDF 强制黑白高对比，不受屏幕主题影响。

### 9.2 设计



```
{
  "id": "archive",
  "name": "Archive",
  "colors": { "paper": "#F3EEE2", "card": "#FFFCF4", "ink": "#141311",
              "inkSoft": "#4A463F", "accent": "#FF5A1E", "accent2": "#2B4BE0",
              "green": "#1FA658" },
  "fonts": { "display": "'Noto Sans SC'", "body": "'Noto Sans SC'", "mono": "'Space Mono'" },
  "border": { "width": "3px", "style": "solid" },
  "shadow": { "x": "6px", "y": "6px", "blur": "0", "color": "var(--ink)" },
  "radius": "0px"
}
```



* 生成 `:root[data-theme="..."]` CSS 变量；页面只引用变量，不写死颜色。

* 主题工坊：颜色选择器、字体下拉、边框 / 阴影 / 圆角滑杆；实时 iframe 预览；

  WCAG AA 对比度检查；保存草稿 / 发布。

* 默认主题存 `config`，公开 API 返回；访客切换存 localStorage，优先于默认。

* 简历变体默认跟随公共简历主题；**AI 不得改主题 / 布局**；后台可统一换主题，打印样式单独覆盖。



***

## 10. Cloudflare 免费资源盘点（2026-11-19 核对）

### 10.1 能用的免费资源



| 产品                            | 免费额度（关键项）                                                               | 在本项目里的用法                                 | 结论                     |
| ----------------------------- | ----------------------------------------------------------------------- | ---------------------------------------- | ---------------------- |
| **Pages**                     | 静态请求 / 带宽不限；500 次构建 / 月；20,000 文件；单文件 ≤25 MiB                           | 主站备线、admin 站、静态资源                        | 够用                     |
| **Pages Functions / Workers** | 100,000 请求 / 天（全账号共享）；10ms CPU / 请求；50 子请求 / 请求；3MB 脚本                  | `/api/chat`、JD、变体、事件、admin API           | 够用，重活可能需 \$5           |
| **D1**                        | 5 GB 总量；单库 500 MB；500 万行读 / 天；10 万行写 / 天；10 个库；单次 50 查询；7 天 Time Travel | 配置、日志、切片、JD、变体、审计、聚合                     | 够用                     |
| **Vectorize**                 | 3,000 万 queried dims / 月；500 万 stored dims；100 索引；≤1536 维；元数据 10 KiB    | 简历语义检索                                   | 够用（约 2.9 万查询 / 月）      |
| **Workers AI**                | 10,000 neurons / 天；超出 \$0.011 / 千 neurons                               | bge-m3 embedding、GLM-4.7-flash 回答、rerank | 够用（约 25–35%）           |
| **KV**                        | 1 GB；10 万读 / 天；**1,000 写 / 天**                                          | 配置 / 主题缓存、会话（写少）                         | 够用，别拿它写日志              |
| **R2**                        | 10 GB-month；100 万 Class A / 月；1,000 万 Class B / 月；出站免费                  | PDF / 变体 HTML、图片、备份                      | 够用；公开访问建议走 Function 代理 |
| **Queues**                    | 1 万 operations / 天；24h 保留                                               | 可选：异步重建 / 批量 embedding                   | 够用，但首版可不上              |
| **Durable Objects**           | 仅 SQLite；10 万请求 / 天；13,000 GB-s / 天；5 GB                                | 可选：实时限流 / 单点状态                           | 够用，D1 已够               |
| **Analytics Engine**          | 10 万数据点写 / 天；1 万读查询 / 天；3 个月保留                                          | 前端 / 后端事件、看板                             | 够用                     |
| **Workers Logs**              | 20 万条日志 / 天；保留 3 天                                                      | 后端错误、请求追踪、`request_id` 排查                | 够用，长期留存落 D1            |
| **AI Gateway**                | 核心功能免费；免费版 10 万条日志总量                                                    | LLM 缓存 / 限流 / 日志 /fallback               | 够用，注意日志上限              |
| **Turnstile**                 | 无限验证；20 widget                                                          | 登录 / 留言 / 问答防刷                           | 够用                     |
| **Access**                    | 50 用户内免费                                                                | 有域名后保护 admin                             | **现在用不了**（需自有域）        |
| **AI Search（原 AutoRAG）**      | 开放 beta：2 万查询 / 月、10 万文件                                                | 可选托管 RAG                                 | 可用，但本期不选（见 11.1）       |

### 10.2 按目标流量的容量测算

假设：2,000 PV / 天、100 次问答 / 天、5 个 JD / 天、20 次简历下载 / 天、10 次发布 / 月。



| 资源               | 估算用量                                            | 免费额度                          | 占比    |
| ---------------- | ----------------------------------------------- | ----------------------------- | ----- |
| Workers 请求       | 约 2,500 / 天（事件 2k + 问答 100 + JD 10 + admin 200） | 100,000 / 天                   | 2.5%  |
| D1 写             | 约 500 / 天（问答日志 2 行 + JD 2 行 + 审计 / 配置）          | 100,000 / 天                   | 0.5%  |
| D1 读             | 约 1,000 / 天（检索 3 次 / 问 + admin）                 | 500 万 / 天                     | 0.02% |
| Vectorize 查询     | 140 / 天 ≈ 4,200 / 月                             | 30,000,000 dims / 月（约 2.9 万次） | 14%   |
| Workers AI       | 约 2,500 neurons / 天                             | 10,000 / 天                    | 25%   |
| Analytics Engine | 2,500 点 / 天                                     | 100,000 / 天                   | 2.5%  |
| R2               | 约 0.2 GB / 月（PDF / 图片）                          | 10 GB-month                   | 2%    |
| Pages 构建         | 10 / 月                                          | 500 / 月                       | 2%    |
| KV 写             | 发布时几次 / 月                                       | 1,000 / 天                     | \~0%  |

**结论：正常个人站流量下，免费额度很宽裕；不需要为了 “省额度” 牺牲架构。**

### 10.3 什么时候会不够



| 信号                 | 阈值                  | 处理                                       |
| ------------------ | ------------------- | ---------------------------------------- |
| 问答量                | > 500 次 / 天         | 开缓存、限制每会话题数、考虑 \$5 Workers Paid          |
| Vectorize 查询       | > 900 次 / 天（1024 维） | 降 TopK / 加关键词优先 / 升级付费（\$0.01 / 百万 dims） |
| Workers AI neurons | > 8,000 / 天         | 切外部 provider、缩短上下文、限制 JD 条数              |
| Workers 请求         | > 80,000 / 天        | 事件采样、静态化、升级付费                            |
| D1 写               | > 80,000 / 天        | 事件改 AE、批量写、升级付费                          |
| AI Gateway 日志      | 接近 100,000 条        | 采样 / 关闭全量日志，D1 为主                        |
| Pages 构建           | > 400 / 月           | 合并发布、改手动触发                               |

### 10.4 不免费 / 容易误判



* **Cloudflare Images**：图片压缩 / 裁剪是付费产品；图片优化放构建期或客户端，不要指望免费。

* **Workers Paid**：\$5 / 月起，解锁 5 分钟 CPU、无限请求、更多模型；**不是必须**，但是最便宜的保险。

* **Access**：免费 50 用户，但 `*.pages.dev` 共享域不支持；必须有自有域名。

* **Server-side PDF**：Workers 不适合跑 headless Chrome；预览用浏览器打印，正式 PDF/2 页校验走 GitHub Action + Playwright，产物放 R2。

* **Workers AI 部分模型**：Kimi K2.6 / GLM-5.2 等已要求 Paid；免费版用 GLM-4.7-flash / Gemma 4 等。

* `r2.dev`**&#x20;公开域**：官方明确非生产用；要公开访问就绑自定义域，或用 Worker 代理。



***

## 11. 技术选型

### 11.1 选型表



| 层         | 选择                                                                               | 备选                                            | 理由                                              |
| --------- | -------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| 公开前端      | 现有原生 HTML/CSS/JS（ES5/IIFE）+ 新增 `js/ai-chat.js`                                   | React/Vue                                     | 打印、SEO、首屏、零构建是现有优势；不要为了聊天引框架                    |
| 管理前端      | React + TS + Vite + Tailwind + shadcn/ui + TanStack Query + ECharts + CodeMirror | Vue 3 / 原生                                    | 后台表单 / 表格 / 图表复杂；React 生态最省时间；admin 独立构建，不影响主站  |
| API 框架    | Hono + Zod + TypeScript on Pages Functions                                       | 原生 `onRequest`                                | 路由 / 中间件 / 校验统一；体积小；Workers 原生                  |
| 数据库       | D1 + Drizzle ORM（FTS5 用原生 SQL）                                                   | 原生 SQL / Neon                                 | D1 免费够用；Drizzle 类型与迁移；FTS5 虚拟表用 raw migration   |
| 向量库       | Cloudflare Vectorize                                                             | Qdrant Cloud / Supabase pgvector / Pinecone   | 同平台零网络跳转、免费额度够、元数据过滤；知识库小，外部库收益为负               |
| Embedding | `@cf/baai/bge-m3`（1024 维）                                                        | 智谱 embedding-3 /bge-small-zh                  | 多语言、中英混排、免费额度内；离线 / 在线同模型，避免向量空间不一致             |
| Rerank    | `@cf/baai/bge-reranker-base`（JD 默认，聊天可选）                                         | 不 rerank                                      | 逐条判定值得多 100–300ms；聊天优先控延迟                       |
| LLM       | Workers AI `@cf/zai-org/glm-4.7-flash` 默认                                        | 智谱 GLM / DeepSeek / 现有 hy3                    | 免费版可用、131k 上下文、中文与工具调用；provider 抽象 + fallback   |
| LLM 网关    | Cloudflare AI Gateway                                                            | 直连                                            | 缓存、限流、日志、fallback、成本观测；免费核心功能                   |
| AI 编排     | 自建 typed pipeline + provider adapter                                             | LangGraph / OpenAI Agents SDK / Vercel AI SDK | 当前是有边界流水线；避免 SDK bundle / 锁定，把 SDK 留到未来多步 Agent |
| 鉴权        | GitHub OAuth + D1 session                                                        | Clerk/Auth0 / 邮件魔法链                           | 无域名可用；单人站长足够；不引第三方账号体系                          |
| PDF       | 浏览器打印预览 + CI Playwright 出正式 PDF                                                  | Browser Rendering                             | 2 页硬校验必须在服务端量页数；浏览器打印不作为保证                      |
| CI/CD     | GitHub Actions + Pages Git 集成                                                    | 本地脚本                                          | 公开仓库免费；已有 build-kb /sync 流水线可扩展                 |
| 图表        | ECharts（自托管）                                                                     | Chart.js / Recharts                           | 看板图表类型多；自托管避免 CDN                               |
| 测试        | Vitest（Worker 逻辑）+ Playwright（页面）+ RAG 金标集                                       | 仅手工                                           | 检索 / 校验 / 鉴权必须有单测；页面三尺寸截图                       |
| 可观测       | Umami + Clarity（现有）+ AE + D1 + AI Gateway                                        | Sentry                                        | 不重复造轮子；后端指标自己留，前端行为用现成                          |

### 11.2 为什么不是 Cloudflare AI Search / AutoRAG



* 开放 beta 免费 2 万查询 / 月、10 万文件，听起来很香；但：


  * 切片、元数据、混合检索、逐条 JD 召回的可控性不足；

  * beta 期结束后的定价不确定；

  * 数据同步与后台可解释性弱，难以做 “检索测试 / 版本回切”；

  * 本项目知识库只有 60–100 片，自建成本很低，工程叙事也更强。

* **建议**：把它列为 P5 的对照实验；主链路仍自建。

### 11.3 为什么不是外部向量库



* Qdrant Cloud / Supabase / Pinecone 免费层都有，但：


  * 多一个服务、多一把 Key、多一次网络跳转；

  * 免费层常有休眠 / 容量 / 索引限制；

  * 本项目的检索规模（<100 片、<1000 查询 / 天）用 Vectorize 足够；

  * Workers 内绑定 Vectorize 的延迟与运维优势明显。

### 11.4 为什么不是 `*.workers.dev`



* 既有实测：`workers.dev` 境内 8 秒超时不可达；`pages.dev` 可用。

* 新后端挂在 Pages 项目的 `/api/*`，与站点同域；主站跨域走现有白名单。

* 不要为了 “独立 Worker 更清爽” 把 API 搬到 `workers.dev`，那会让 HR 打不开。

### 11.5 为什么 admin 独立项目



* 主站 bundle 保持纯静态、零后台代码；攻击面更小。

* admin 可以独立构建、独立限流、独立 noindex；主站不受 admin 依赖影响。

* 共用同一个 D1 与同一套 GitHub 仓库；不需要复制数据。

### 11.6 依赖清单（建议）



* 运行时：`hono`、`zod`、`drizzle-orm`（+ `drizzle-kit` dev）、`jose` 或 WebCrypto HMAC。

* admin：`react`、`react-dom`、`react-router`、`@tanstack/react-query`、`echarts`、

  `@uiw/react-codemirror`、`diff`、`dompurify`、`marked`、`tailwindcss`、`shadcn/ui`。

* 测试：`vitest`、`@playwright/test`。

* 构建：`vite`、`typescript`、`eslint`。

* 原则：公开站 0 新依赖；admin 依赖只进 admin 构建；Worker 依赖控制在 1 MB 内。

### 11.7 每个模块的模型与提示词配置

**结论：需要，但按 “模块” 配置，不按 “每个字段” 配置。** 一个模块 = 一类任务 + 一套提示词 +

一个默认模型；模块内再按字段做 L0/L1/L2 权限控制。

建议的模块键：



| module\_key         | 作用                  | 默认模型              | 提示词要点                          |
| ------------------- | ------------------- | ----------------- | ------------------------------ |
| `chat.answer`       | 简历问答                | GLM-4.7-flash     | 只依据 context、带引用、不知道就拒答         |
| `jd.parse`          | JD 结构化拆解            | GLM-4.7-flash     | 输出 must/nice/domain/years JSON |
| `jd.match`          | 逐条匹配与缺口解释           | GLM-4.7-flash     | 每条给 evidence/gap/probe，不打分幻觉   |
| `resume.summary`    | 个人简介改写              | GLM-4.7-flash     | 2–3 行、只选最相关事实                  |
| `resume.experience` | 工作经历 bullet 取舍 / 改写 | GLM-4.7-flash     | 公司 / 时间锁定、bullet 带 source\_id  |
| `resume.project`    | 项目经历取舍 / 改写         | GLM-4.7-flash     | 项目名锁定、数字回查 facts               |
| `resume.skills`     | 技能排序 / 分组 / 强调      | GLM-4.7-flash     | 只能从技能表选，不新增                    |
| `resume.micro`      | 基本信息 / 教育微调         | GLM-4.7-flash     | 只改 headline / 顺序 / 课程奖项取舍      |
| `qa.label`          | 用户问题打标 / 聚类         | GLM-4.7-flash（批量） | 主题 / 意图 / 可答性，不读隐私             |
| `insight.summarize` | 周报 / 洞察生成           | GLM-4.7-flash     | 只基于统计与匿名问题，不编结论                |

**配置层级：**



```
全局默认（provider/model/预算）
   └─ 模块覆盖（module_configs：model/temperature/max_tokens/prompt_id/fallback/enabled）
        └─ 单次请求覆盖（仅后台“测试”用，不开放给公开端）
```



* 每个模块可独立选模型、温度、max tokens、fallback 顺序、日预算；

* 提示词版本化：`prompt_versions` 存 `module_key + version + text + status`；

  发布前跑该模块的样例 / 金标集，通过才切 `active`；

* `qa_logs` / `llm_calls` 记录 `module_key + model + prompt_version`，方便归因 “是模型变差还是提示词变差”；

* 后台 UI：模型下拉只显示**别名**（如 `fast-default`、`strong-fallback`），

  密钥只在 Worker secret，后台看不到、也不能填；

* 支持 “继承全局”，避免 10 个模块各配一遍；只有确实需要不同模型时才覆盖；

* 预算：模块级 `daily_budget` + 全局熔断；超预算自动切 fallback 或关键词模式；

* 不建议把 “每个 bullet” 做成独立模型配置 —— 那是配置爆炸，不是能力。

* **embedding 模型不做模块配置**：固定 `bge-m3`（1024 维），与索引绑定；换模型必须重建全库，

  不能在后台随手切。

**哪些模块不需要模型配置：**



* L0 锁定字段（姓名、公司名、时间、学历、数字）不调用模型；

* 教育 / 基本信息默认只走 `resume.micro`，后台可关闭 “允许 AI 微调” 开关；

* 公共 `resume.html` 的完整版不经过 AI，只有变体才调用模块。

### 11.8 是否需要主流 Agent SDK 作为基座

**结论：当前不需要把 Agent SDK 当基座；用 “模型 API + 自建 typed pipeline” 更合适。**

Agent SDK 是编排层，不是后端基座；它不会自动解决检索精度、事实校验、A4 两页、权限这些问题。



| 任务                        | 需要 Agent SDK 吗 | 原因                           |
| ------------------------- | -------------- | ---------------------------- |
| 简历 RAG 问答                 | 不需要            | 检索 + 一次生成 + 引用校验，2–3 步       |
| JD 结构化拆解                  | 不需要            | 单次 structured output         |
| JD 逐条匹配                   | 不需要            | 固定循环：拆要求 → 检索 → 判定 → 汇总      |
| 按 JD 生成简历                 | 不需要            | 受约束生成 + schema / 事实校验 + 模板渲染 |
| 用户问题聚类 / 周报               | 不需要            | 批量打标 + 统计，离线任务               |
| 未来 “求职 Agent”（多步工具、投递、跟进） | 可能需要           | 长流程、工具调用、人工确认，另起服务           |

**不引 SDK 的理由：**



* 这些流程是**有边界的流水线**，不是开放式自主 Agent；用 SDK 反而增加不确定性；

* Workers 免费版 10ms CPU、3MB 脚本；LangChain/LangGraph 这类依赖会显著增加冷启动与 bundle；

* Agent SDK 的强项是 tool calling /memory/multi-step /human-in-loop，本项目暂时用不到；

* 检索、校验、评测必须自己掌控；SDK 换不掉这些核心工作。

* **RAG 也不需要 LangChain / LlamaIndex**：60–100 片的混合检索，自己写 D1 FTS5 + Vectorize + RRF

  更短、更快、更容易调；引框架反而多一层抽象。

**建议的 “Agent-ready” 结构（不锁 SDK）：**



```
ai/providers/     Workers AI、智谱、DeepSeek、腾讯 hy3 的统一 adapter
ai/pipelines/     chat / jdParse / jdMatch / resumeVariant / qaLabel
ai/schemas/       Zod：回答、JD、变体、引用
ai/prompts/       版本化提示词
ai/evals/         金标集与回归
ai/gateway/       AI Gateway 缓存/限流/日志/fallback
```



* 公开端只调 `runPipeline(name, input)`，不直接散落 `env.AI.run`；

* 以后要上 LangGraph JS / OpenAI Agents SDK / Claude Agent SDK，

  把 `ai/pipelines` 里的某个流程包成 tool/worker 即可，不需要重写数据层；

* 如果只是要流式输出 / 结构化输出，`Vercel AI SDK` 可以作为轻量客户端库，

  但不要把整个站点的后端都押在它上面。

**一句话**：先把 “数据 + 检索 + 校验 + 评测” 做扎实；Agent SDK 是以后做 “求职自动化” 时的事，

不是现在做 “简历问答” 的前提。



***

## 12. 风险与对策



| 风险                  | 后果                | 对策                                                         |
| ------------------- | ----------------- | ---------------------------------------------------------- |
| 两份数据继续漂移            | 主页 / 简历 / 问答互相矛盾  | P0 生成器 + CI 漂移闸门；禁止手改生成物                                   |
| AI 编造数字 / 项目        | 求职信誉受损            | `source_id` + `metrics/facts` + 输出侧数字校验 + 拒答               |
| 模型 / 额度不可用          | 问答 429 / 超时       | provider 抽象 + fallback（Tencent hy3 / 智谱 / DeepSeek）+ 关键词降级 |
| Workers 10ms CPU 不够 | 请求 1102 / 超时      | 上下文瘦身、避免重库、流式；必要时 \$5 Paid                                 |
| Vectorize 最终一致      | 新内容刚发布检索不到        | 蓝绿版本 + 评测后切 active + 后台状态提示                                |
| 中国网络可达性             | HR 打不开 / 问答失败     | 固定 `pages.dev`；手机 4G 实测；保留腾讯云 fallback                     |
| 管理后台被扫              | 内容 / 配置泄露         | 独立站 + GitHub OAuth + CSRF + 限流 + 审计 + noindex              |
| GitHub token 泄露     | 仓库被改              | fine-grained PAT、仅单仓库、Worker secret、可吊销、审计                 |
| 问答日志含 PII           | 隐私风险              | 脱敏、IP hash、JD 不落原文、90 天保留、可删除                              |
| 留言板设备隔离被误解为 “强隐私”   | 访客以为安全，实际可伪造      | 文案明确 “仅本设备可见、清缓存即丢失”；敏感内容提示；强隔离上登录                         |
| 设备 ID 被清 / 换浏览器     | 访客看不到历史，以为丢数据     | 前端说明；可选设备绑定码；后台仍保留记录                                       |
| 动态简历超 2 页           | PDF 不专业 / 被筛      | 内容预算 + 逐条删减 + Playwright 页数校验；超页拒绝发布                       |
| AI 改动锁定字段           | 公司 / 时间 / 学历被改，失信 | L0 字段代码级比对；提示词只做第一层                                        |
| 主题破坏打印              | PDF 不可用           | 打印样式强制黑白；主题只作用屏幕；截图回归                                      |
| 过度建设                | 三周做不完             | 按 P0→P4 分期；每期有可验收产物；P3a 先只读                                |



***

## 13. 分期路线图

> 按 1 人估算，含自测，不含大改文案 / 视觉精修。实际以你的节奏为准。



| 阶段               | 目标          | 主要产出                                                            | 验收                                                        | 预估    |
| ---------------- | ----------- | --------------------------------------------------------------- | --------------------------------------------------------- | ----- |
| **P0 单一真相源**     | 消灭两份简历      | `resume` 数据块、`render_resume.mjs`、`validate_content.mjs`、CI 漂移检查 | 改 JSON 一处，主页 / 简历同变；文本 diff 无缺失；手改生成物被 CI 拒绝              | 1–2 天 |
| **P1 RAG 后端**    | 语义检索 + 精准问答 | D1 表、Vectorize 索引、bge-m3、混合检索、`/api/chat`、30 题金标集               | hit@3 ≥90%；unsupported 数字 0；p95 <8s；无关拒答 100%；fallback 可用 | 3–5 天 |
| **P2 JD + 动态简历** | 招聘方视角闭环     | `/api/jd/match`、变体 JSON、字段级 L0/L1/L2 校验、模板渲染、分享页 / PDF 两页守卫、缓存  | 5 个真实 JD 可复现；每条要求有证据 / 缺口；变体 100% 通过校验；无新事实；PDF ≤2 页      | 4–5 天 |
| **P3 管理后台**      | 可运营         | 独立 admin 站、OAuth、内容 / 模型 / 提示词 / 主题 / KB/QA/ 留言板模块、发布 / 回滚      | 登录→草稿→预览→发布→回滚闭环；留言板全设备视图；密钥不出服务端；审计可查                    | 5–7 天 |
| **P4 可观测与洞察**    | 知道谁在问什么     | `/api/events`、AE/D1、看板、聚类 / 周报、告警                               | 事件 1 分钟内可见；Top 问题 / 未答 / 低分可筛；周报可读；脱敏通过                   | 2–3 天 |
| P5 可选            | 锦上添花        | AI Search 对照、A/B 主题、多语言、邮件订阅、飞书日报                               | 按需                                                        | —     |

**依赖关系**：P0 → P1 → P2；P3 可在 P1 后并行；P4 依赖 P1/P3。

**建议节奏**：先做 P0 + P1 的垂直切片（10 个问题跑通），再扩到 30 题，再上 JD / 后台。



***

## 14. 决策点与默认假设



| 决策                        | 默认建议                                   | 说明                                       |
| ------------------------- | -------------------------------------- | ---------------------------------------- |
| 是否保留 `site-data.json` 文件名 | 保留，扩展 `resume` 块                       | 避免迁移期两份文件；以后可再改名 `career.json`           |
| LLM 默认                    | Workers AI GLM-4.7-flash               | 免费版可用；中文 / 上下文 / 工具调用均衡                  |
| 迁移期 fallback              | 保留现有腾讯云 `hy3`                          | 先双跑 2–4 周，按评测与可达性再下线                     |
| Admin 托管                  | **已定：独立 `shenge-work-admin.pages.dev`** | 同一仓库、两个 Pages 项目；共享 D1；不采用同站 `/admin` |
| 发布方式                      | GitHub Contents API + fine-grained PAT | 若担心写权限，先做只读 / 导出                         |
| 公共简历电话                    | 暂时保留                                   | 公开简历留电话便于 HR；后续可改 “点击显示 / 二维码” 降爬取       |
| 域名                        | 继续暂缓                                   | 不影响本期；有域名后再接 Access/Email Routing/R2 公开域 |
| 预算                        | 目标 $0/月；预留 $5 / 月                      | 只有触发 CPU / 请求 / 模型限制才升级                  |
| 流量假设                      | 2,000 PV / 天、100 问答 / 天、5 JD / 天       | 超过 5 倍再重新算额度                             |
| 留言板隔离                     | 设备 ID + 服务端哈希，非 MAC                    | 网页拿不到 MAC；清缓存 = 新设备；强隔离需登录               |
| 旧留言处理                     | 归 `legacy`，仅后台可见                       | 不改写成某个新设备的历史                             |
| 动态简历页数                    | A4 ≤2 页，硬性拒绝超页                         | 内容预算 + Playwright 页数校验；不靠浏览器打印保证         |
| 基本信息 / 教育                 | 后台手动为主，AI 仅 `resume.micro`             | 学校 / 专业 / 时间 / 姓名 L0 锁定                  |
| 模块级模型配置                   | 按 8–10 个模块配置，不按字段                      | 全局默认 + 模块覆盖 + prompt 版本                  |
| Agent SDK                 | 暂不引入                                   | 直连 API + typed pipeline；未来多步工具再评估        |



***

## 15. 建议的第一步（今天就能开始）



1. **固化基线**：先把当前 `resume.html` 的未提交埋点改动提交（或另存 `docs/baseline/`），

   确保 P0 不会覆盖。

2. **抽数据**：把简历 5 个 section 的 34 条要点抽进 `data/site-data.json` 的 `resume` 块，

   每条给 `id/tags/metrics`；同时补 `features` 与 `faq`。

3. **跑生成**：写 `scripts/render_resume.mjs`，先做等价模板；跑文本 / 截图 diff。

4. **上闸门**：写 `validate_content.mjs` + `content-build.yml`，让 “手改 resume.html” 直接失败。

5. **再做 RAG**：P0 验收通过后，建 Vectorize 索引，跑 10 个问题的垂直切片；

   不要先做后台，否则会在错误的数据模型上堆 UI。



***

## 附录 A・D1 表结构（建议）



```
-- 内容版本（Git 是真相源，这里存草稿/审计/回滚索引）
CREATE TABLE IF NOT EXISTS content_drafts (
  id TEXT PRIMARY KEY, base_commit TEXT, payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS content_versions (
  id TEXT PRIMARY KEY, git_commit TEXT, payload TEXT NOT NULL,
  published_at INTEGER NOT NULL, published_by TEXT
);

-- 留言板设备隔离（老库迁移见 7.8.5，勿直接重复 ALTER）
CREATE TABLE IF NOT EXISTS wall_devices (
  device_hash TEXT PRIMARY KEY,
  label TEXT,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  ua_class TEXT,
  ip_hash TEXT
);
CREATE TABLE IF NOT EXISTS wall_messages (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  device_hash TEXT NOT NULL DEFAULT 'legacy',
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible',
  admin_note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wall_device_created
  ON wall_messages(device_hash, created_at DESC);

-- 知识库
CREATE TABLE IF NOT EXISTS kb_versions (
  version TEXT PRIMARY KEY, model TEXT, dim INTEGER, chunk_count INTEGER,
  status TEXT NOT NULL, created_at INTEGER NOT NULL, activated_at INTEGER
);
CREATE TABLE IF NOT EXISTS kb_chunks (
  version TEXT NOT NULL, chunk_id TEXT NOT NULL, section TEXT, entity_id TEXT,
  title TEXT, text TEXT NOT NULL, tags TEXT, audience TEXT, visibility TEXT DEFAULT 'public',
  source_path TEXT, hash TEXT, PRIMARY KEY (version, chunk_id)
);
CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(
  chunk_id UNINDEXED, version UNINDEXED, text_tokens, tokenize='unicode61'
);

-- 问答/模型调用
CREATE TABLE IF NOT EXISTS qa_logs (
  id TEXT PRIMARY KEY, ts INTEGER NOT NULL, session_hash TEXT, ip_hash TEXT,
  question TEXT, normalized TEXT, answer TEXT, citations TEXT,
  top_score REAL, fallback INTEGER DEFAULT 0, latency_ms INTEGER,
  model TEXT, module_key TEXT, prompt_version TEXT, tokens_in INTEGER, tokens_out INTEGER, cost REAL,
  origin TEXT, feedback INTEGER, flagged INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_qa_ts ON qa_logs(ts);
CREATE TABLE IF NOT EXISTS llm_calls (
  id TEXT PRIMARY KEY, ts INTEGER NOT NULL, request_id TEXT, provider TEXT, model TEXT,
  module_key TEXT, prompt_version TEXT, tokens_in INTEGER, tokens_out INTEGER, cost REAL,
  latency_ms INTEGER, cache_hit INTEGER DEFAULT 0, status TEXT
);
CREATE TABLE IF NOT EXISTS error_logs (
  id TEXT PRIMARY KEY, ts INTEGER NOT NULL, request_id TEXT, route TEXT,
  status INTEGER, code TEXT, message TEXT, stack TEXT, ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_error_ts ON error_logs(ts);

-- JD / 变体
CREATE TABLE IF NOT EXISTS jd_matches (
  id TEXT PRIMARY KEY, ts INTEGER NOT NULL, jd_hash TEXT NOT NULL, jd_role TEXT,
  score INTEGER, requirements TEXT, kb_version TEXT, model TEXT,
  latency_ms INTEGER, cache_hit INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS resume_variants (
  id TEXT PRIMARY KEY, ts INTEGER NOT NULL, jd_match_id TEXT, slug TEXT UNIQUE,
  payload TEXT NOT NULL, content_budget TEXT, page_count INTEGER,
  html_r2_key TEXT, pdf_r2_key TEXT, expires_at INTEGER, views INTEGER DEFAULT 0
);

-- 主题 / 配置 / 评测 / 洞察
CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY, name TEXT, tokens TEXT NOT NULL, status TEXT DEFAULT 'draft',
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS model_configs (
  id TEXT PRIMARY KEY, provider TEXT, model TEXT, alias TEXT, params TEXT,
  priority INTEGER, enabled INTEGER DEFAULT 1, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS module_configs (
  module_key TEXT PRIMARY KEY, model_alias TEXT, prompt_id TEXT,
  temperature REAL, max_tokens INTEGER, fallback TEXT,
  daily_budget REAL, enabled INTEGER DEFAULT 1, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS prompt_versions (
  id TEXT PRIMARY KEY, name TEXT, version TEXT, text TEXT, status TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS eval_cases (
  id TEXT PRIMARY KEY, question TEXT, expected_chunks TEXT, category TEXT, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY, ts INTEGER, kb_version TEXT, model TEXT, prompt_version TEXT,
  metrics TEXT, status TEXT
);
CREATE TABLE IF NOT EXISTS question_clusters (
  id TEXT PRIMARY KEY, ts INTEGER, label TEXT, count INTEGER, examples TEXT,
  avg_score REAL, unanswered_rate REAL
);
CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY, ts INTEGER, type TEXT, title TEXT, body TEXT,
  severity TEXT, status TEXT DEFAULT 'open'
);

-- Admin
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY, github_login TEXT UNIQUE, role TEXT DEFAULT 'owner', created_at INTEGER
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY, user_id TEXT, token_hash TEXT UNIQUE, ip_hash TEXT, ua TEXT,
  created_at INTEGER, expires_at INTEGER
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, ts INTEGER, actor TEXT, action TEXT, target TEXT,
  diff TEXT, ip_hash TEXT
);
```

> 建表后可复用现有 
>
> `rate_limits`
>
> ；事件明细优先写 Analytics Engine，D1 只存每日聚合。



***

## 附录 B・公开 / 管理 API 轮廓



| 方法       | 路径                                       | 说明                                                               |
| -------- | ---------------------------------------- | ---------------------------------------------------------------- |
| POST     | `/api/chat`                              | SSE；`{question, session_id, mode}` → `meta/delta/citations/done` |
| POST     | `/api/jd/match`                          | `{jd}` → `{role, score, requirements[], meta}`；JD 原文不入库          |
| POST     | `/api/resume/tailor`                     | \`{jd\_match\_id                                                 |
| GET      | `/api/resume/variant/:slug`              | 返回 HTML（可选 `?download=pdf`）                                      |
| POST     | `/api/events`                            | `sendBeacon`；事件 + 属性，服务端补哈希                                      |
| GET      | `/api/config`                            | 默认主题、开关、模型别名（无密钥）                                                |
| GET      | `/api/health`                            | 依赖检查：D1/Vectorize/AI/ 配置                                         |
| GET      | `/api/wall`                              | `X-Device-Id`；只返回本设备留言；`peek=1` 同                                |
| POST     | `/api/wall`                              | `X-Device-Id`；设备哈希入库；限流 + Turnstile                              |
| GET      | `/api/admin/wall/devices`                | 全设备列表 / 筛选 / 统计                                                  |
| GET      | `/api/admin/wall/messages`               | 按设备 / 时间 / 关键词 / 状态查全部留言                                         |
| POST     | `/api/admin/wall/messages/:id/status`    | visible/hidden/deleted                                           |
| POST     | `/api/admin/wall/devices/:hash/block`    | 屏蔽设备                                                             |
| GET      | `/api/admin/wall/export`                 | CSV/JSON，默认脱敏                                                    |
| GET      | `/api/admin/auth/github`                 | 跳转 GitHub OAuth                                                  |
| GET      | `/api/admin/auth/callback`               | 换 token、建会话、重定向                                                  |
| POST     | `/api/admin/content/draft`               | 保存草稿                                                             |
| POST     | `/api/admin/content/validate`            | schema + 事实 + 链接校验                                               |
| POST     | `/api/admin/content/preview`             | 返回渲染 HTML（iframe）                                                |
| POST     | `/api/admin/content/publish`             | 提交 GitHub 源文件 + 触发构建                                             |
| GET      | `/api/admin/content/versions`            | 版本 /commit/diff                                                  |
| POST     | `/api/admin/kb/reindex`                  | 触发重建（CI / 队列）                                                    |
| GET      | `/api/admin/kb/test`                     | 检索测试：query → chunks + 分数                                         |
| GET      | `/api/admin/dashboard`                   | 聚合指标                                                             |
| GET      | `/api/admin/qa`                          | 问题列表 / 筛选 / 分页                                                   |
| GET      | `/api/admin/insights`                    | 聚类 / 缺口 / 周报                                                     |
| GET/POST | `/api/admin/models`、`/prompts`、`/themes` | 配置 / 版本 / 发布                                                     |
| GET      | `/api/admin/audit`                       | 审计日志                                                             |



***

## 附录 C・参考（2026-11-19 核对）



* Workers 限制：[https://developers.cloudflare.com/workers/platform/limits/](https://developers.cloudflare.com/workers/platform/limits/)

* Workers 定价：[https://developers.cloudflare.com/workers/platform/pricing/](https://developers.cloudflare.com/workers/platform/pricing/)

* D1 定价：[https://developers.cloudflare.com/d1/platform/pricing/](https://developers.cloudflare.com/d1/platform/pricing/)

* D1 限制：[https://developers.cloudflare.com/d1/platform/limits/](https://developers.cloudflare.com/d1/platform/limits/)

* D1 FTS5：[https://developers.cloudflare.com/d1/reference/database-commands/](https://developers.cloudflare.com/d1/reference/database-commands/)

* Vectorize 定价：[https://developers.cloudflare.com/vectorize/platform/pricing/](https://developers.cloudflare.com/vectorize/platform/pricing/)

* Vectorize 限制：[https://developers.cloudflare.com/vectorize/platform/limits/](https://developers.cloudflare.com/vectorize/platform/limits/)

* Workers AI 定价：[https://developers.cloudflare.com/workers-ai/platform/pricing/](https://developers.cloudflare.com/workers-ai/platform/pricing/)

* Workers AI 免费模型变更：[https://developers.cloudflare.com/changelog/post/2026-07-28-models-require-workers-paid/](https://developers.cloudflare.com/changelog/post/2026-07-28-models-require-workers-paid/)

* bge-m3：[https://developers.cloudflare.com/workers-ai/models/bge-m3/](https://developers.cloudflare.com/workers-ai/models/bge-m3/)

* GLM-4.7-flash：[https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/)

* bge-reranker-base：[https://developers.cloudflare.com/workers-ai/models/bge-reranker-base/](https://developers.cloudflare.com/workers-ai/models/bge-reranker-base/)

* Analytics Engine 定价：[https://developers.cloudflare.com/analytics/analytics-engine/pricing/](https://developers.cloudflare.com/analytics/analytics-engine/pricing/)

* AI Gateway 定价：[https://developers.cloudflare.com/ai-gateway/pricing/](https://developers.cloudflare.com/ai-gateway/pricing/)

* R2 定价：[https://developers.cloudflare.com/r2/pricing/](https://developers.cloudflare.com/r2/pricing/)

* Queues 定价：[https://developers.cloudflare.com/queues/platform/pricing/](https://developers.cloudflare.com/queues/platform/pricing/)

* Durable Objects 定价：[https://developers.cloudflare.com/durable-objects/platform/pricing/](https://developers.cloudflare.com/durable-objects/platform/pricing/)

* Pages Functions 绑定：[https://developers.cloudflare.com/pages/functions/bindings/](https://developers.cloudflare.com/pages/functions/bindings/)

* Pages Functions 配置：[https://developers.cloudflare.com/pages/functions/wrangler-configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration)

* Turnstile：[https://developers.cloudflare.com/turnstile/](https://developers.cloudflare.com/turnstile/)

* Cloudflare AI Search（原 AutoRAG）beta 说明：[https://blog.cloudflare.com/ai-search-agent-primitive](https://blog.cloudflare.com/ai-search-agent-primitive)



***

> 维护约定：本文件是「Cloudflare RAG + 管理后台」的单一设计依据；额度、接口、表结构变化时先改本文再改代码。
> 待办落到 
>
> [TODO.md](TODO.md)
>
> ，不要在本文件里堆未排期事项。