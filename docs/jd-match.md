# 岗位匹配 JD MATCH · 调研、方案与实施记录

> 文档定位：本文件是「岗位匹配」视图的**单一设计依据与实施台账**。调研结论、方案决策、接口契约、
> 实现进度、验证记录与待处理事项都在这里；后续代码迭代必须与本文对齐，冲突时先改文档再改代码。
> 全站「还没做的事」只在 [TODO.md](TODO.md) 一处登记，本文 §5 为其概要并相互回链。
>
> 版本：v2（2026-11-17）· 状态：**代码完成并本地验证，云函数待重新部署** · 作者：陈培胜
> 变更：v1 为初版实施说明；v2 并入调研结论、选型决策、进度与待办，成为完整专题文档。

---

## 0. 结论摘要（先看这四条）

1. **功能定位**：JD 匹配是「让招聘方在 3 分钟内做出判断的那一步」——招聘方粘贴在招岗位 JD，
   得到一张对照表：每条要求落在哪段经历、缺口在哪、面试能顺着问什么。它同时是
   **「用站内 Agent 能力证明 Agent 能力」的活演示**，比任何技能标签都有说服力。
2. **零新增后端**：复用问答助手的同一台腾讯云 CloudBase 云函数（`POST /chat`）与同一份
   37 段档案切片知识库，靠 `mode: "jd"` 分流；限流、白名单、日志、脱敏全部继承。
3. **当前进度（2026-11-17）**：前端视图与云函数分支均已开发完成并通过本地验证；
   **上线唯一硬前置是重新部署云函数 `functions/tencent`**，否则线上仍是旧版，
   前端会提示「后端云函数还是旧版本（不含 JD 匹配）」。
4. **未验证边界**：本地无 `AI_API_KEY`，端到端使用桩（mock）响应；真实模型的输出质量、
   约束遵循率与延迟分布需部署后实测（验收清单见 §6.3）。

---

## 1. 调研结论（为什么做 JD 匹配）

### 1.1 需求来源（2026-11-16 站长 AI 调研）

对作品集项目做过一轮「哪个功能最值得做」的 AI 调研，核心结论：作品集当前缺的不是展示，
而是**招聘方视角的决策效率**——招聘方（或站长自己）把岗位 JD 粘进来，输出一张对照表：
JD 逐条需求 → 对应经历 / 项目的哪条证据覆盖了它 → 哪些是缺口 → 面试可追问的点。
它复用现有 `/chat` RAG 端点和 `functions/tencent/` 知识库，不用新后端，
且是「用 Agent 能力证明 Agent 能力」最好的实证。

调研同时明确了四个代价 / 风险，并全部落入实现（见 §1.3）：

| 调研风险 | 结论 |
|---|---|
| JD 文本要限长（截到 1500 字左右） | 否则输入 token 成本失控且模型抓不住重点 |
| 输出必须约束成固定结构 | 不然模型会写散文，对照表无法渲染 |
| 必须接上现有两级限流 | 否则容易被人刷额度（长文本 + 整表输出，单次成本是问答的数倍） |
| 「做得浅就会显得花哨」 | 证据必须可回溯到档案切片原文，缺口照实列，不做粉饰 |

### 1.2 备选方案对比与选型

调研给出两个候选，比较后选定 JD 匹配：

| 方案 | 内容 | 成本 | 说服力 | 结论 |
|---|---|---|---|---|
| **JD 匹配** | 招聘方贴 JD → 逐条对照表（证据 / 缺口 / 追问点） | 云函数一个分支 + 前端一个区块 | 强：可交互、可验证、面试直接话题 | ✅ **本期实现** |
| 招聘方速览模式 | 一个开关把整站切成 30 秒版：隐藏装饰、只留量化战绩和三个项目结论 | 一天以内 | 中：仍是静态展示 | 暂缓，登记进 [TODO.md](TODO.md) T12 思考池 |

### 1.3 调研要求 → 实现映射

| 调研要求 | 落地方式 | 依据 |
|---|---|---|
| JD 限长 ~1500 字 | 前后端双重拦截：前端 `maxlength` + 提交校验；后端 30–1500 字，越界 400 | §3.2 |
| 固定结构输出 | 提示词写死 JSON schema（`prompt.js JD_JSON_SCHEMA`）+ 服务端 `parseJDAnswer()` 白名单校验，解析失败整次拒绝（502） | §3.3.2 |
| 接上两级限流 | 继承问答的全局限流（20 次/分、200 次/天），另设 JD 独立额度（10 分钟 4 次 / 20 次/天） | §3.3.3 |
| 做得实、不花哨 | 证据 `src` 只认上下文中真实的切片 id，认不出就丢弃；covered 无证据自动降级 partial；每条证据带与原文的重合度 | §3.3.2 |

---

## 2. 现状基线与选型决策

### 2.1 现状基线（必须尊重的既有资产）

| 资产 | 现状 | 对 JD 匹配的影响 |
|---|---|---|
| `functions/tencent/`（CloudBase 云函数） | 已承载问答：CORS 白名单、TF-IDF 检索、两级限流、`chat_logs` 落库、脱敏 | 加 `mode` 分流，不新增函数、不加环境变量 |
| `knowledge/`（37 段切片） | 与函数内 `kb/` 同源，`scripts/build_kb.py` 构建 | JD 匹配直接复用；**JD 本身不进知识库**（一次性输入） |
| `retrieve()` | 与 `build_kb.py` 严格同口径的 char-bigram TF-IDF | 逐条需求复用同一检索，不引入第二条链路 |
| 前端架构 | 原生 HTML / ES5 / IIFE，Neo-brutalism 设计体系（`--paper/--ink/--orange` 变量 + 四主题） | `jd-match.js`、`jd-match.css` 全部沿用既有变量与组件形态 |
| `js/main.js` 第 11 节 | AI 问答助手，端点集中在 `AI_CONFIG.endpoint` | 端点经 `window.CP_AI_ENDPOINT` 传递，前端不重复硬编码 |

### 2.2 关键决策记录

| ID | 决策 | 理由 |
|---|---|---|
| D-J1 | **复用 `/chat` 加 `mode` 字段，不新建云函数** | 部署面最小；白名单、限流、日志、脱敏免费继承；旧客户端向后兼容（缺 `mode` 走原问答流程） |
| D-J2 | **逐条需求检索 + 合并加权，不用整段 JD 单查询** | 多主题 JD（职责 + 要求混排）会被最长主题主导，逐条 + 去重 + 加权更均衡 |
| D-J3 | **召回按切片类型加权：项目/经历 ×1.0、技能 ×0.8、个人概要 ×0.55、证书 ×0.45、教育 ×0.4、联系 ×0.1** | 对照表要的是「可验证的证据」不是自我介绍；同等相关度下项目与经历优先 |
| D-J4 | **证据 id 白名单：`src` 认不出对应切片就丢弃该条证据；covered 无证据自动降为 partial** | 宁缺毋滥，杜绝模型伪造出处；「敢列缺口」比「满分表」更有说服力 |
| D-J5 | **JD 不套用问答的敏感词/越界拦截，只拦提示注入** | JD 里出现「薪资/外包/到岗」是正常文档内容，按敏感词拦截会全部误杀；提示注入是唯一会改写系统规则的东西 |
| D-J6 | **注入检查放在额度扣减之前** | 被拦截的恶意请求不应占用访客的本日次数 |
| D-J7 | **模型输出解析失败整次拒绝（502 `parse_failed`），不做半截表降级** | 半截对照表比失败更误导；前端引导重试即可 |
| D-J8 | **评分固定为 0–100 覆盖度 + 五档 verdict 枚举** | 「覆盖度」可解释、可校验；明确不是录用概率，避免误导招聘方 |

---

## 3. 技术方案

### 3.1 交互流程

```
招聘方粘贴 JD（≤1500 字）
        │
        ▼
POST /chat  { mode: "jd", jd: "..." }        ← 与问答同一个端点，靠 mode 分流
        │
        ├─ 来源白名单 → 问答全局限流 → 注入拦截 → JD 独立额度（10 分钟 4 次 / 20 次/天）
        ├─ 拆需求（按行 / 分号，去序号，最多 14 条）
        ├─ 逐条 TF-IDF 召回 37 段档案切片 → 合并去重 → 项目/经历加权 → 取 6 段
        ├─ 约束提示词（固定 JSON schema + 只准引用 context）
        └─ 解析 + 白名单校验 → 返回结构化 match
        │
        ▼
前端渲染：评分卡 → 覆盖/部分/缺口统计 → 5 列对照表 → 复制 Markdown
```

前端文件：

| 文件 | 职责 |
|---|---|
| `index.html` `#jd` | SEC.03 区块结构（表单 / 空态三步骤 / 结果舞台）；导航第 03 项，后续编号顺延至 12 |
| `js/jd-match.js` | IIFE 无依赖：三个示例 JD、提交与超时、错误文案映射、四态渲染、Markdown 导出 |
| `css/jd-match.css` | 全部走 `--paper/--ink/--orange` 变量，四种主题（archive/blueprint/newsprint/noir）自动跟随 |
| `js/main.js` | 挂载点：`heroCta` 增加「JD 匹配」入口按钮；导航 `sections` 数组加入 `jd`；`window.CP_AI_ENDPOINT` 暴露端点（`jd-match.js` 惰性读取，不依赖脚本顺序） |

### 3.2 接口契约

#### 请求

```http
POST /chat
Content-Type: application/json
Origin: https://shenge-work.github.io

{ "mode": "jd", "jd": "岗位：AI Agent 工程师……" }
```

| 字段 | 约束 |
|---|---|
| `mode` | 固定 `"jd"`；缺省时按原有问答流程处理（旧客户端零影响） |
| `jd` | 30–1500 字，越界直接 400 |

#### 成功响应（200）

```json
{
  "ok": true,
  "mode": "jd",
  "match": {
    "overall": { "score": 78, "verdict": "匹配", "summary": "两句话总体判断" },
    "stats": { "covered": 4, "partial": 2, "gap": 1 },
    "rows": [
      {
        "req": "JD 需求点（≤80 字）",
        "status": "covered | partial | gap",
        "evidence": [
          { "src": "proj-p02-03", "title": "lessie.cn AI 人脉搜索引擎｜…", "point": "证据原文摘要", "ground": 0.62 }
        ],
        "gap": "partial / gap 时说明差在哪；covered 为空串",
        "probe": "面试追问点（≤70 字）"
      }
    ]
  },
  "sources": [{ "id": "proj-p02-03", "title": "…", "score": 0.42 }],
  "meta": { "jd_chars": 486, "requirements": 7, "recalled": 6, "latency_ms": 8420 }
}
```

#### 错误码

| HTTP | error | 前端表现 |
|---|---|---|
| 400 | `bad_request` | 直接展示服务端文案（太短 / 超长 / 含指令性内容） |
| 429 | `rate_limited` | 「请求有点急，等十几秒再试」 |
| 429 | `jd_quota` | 「每人 10 分钟 4 次」+ 邮箱兜底 |
| 502 | `parse_failed` | 「模型这次没按结构输出，再点一次通常就好」 |
| 200 | `no_match`（`ok:false`） | 档案里没有与 JD 相关的切片，建议换岗位 |
| 500 | `server_misconfig` | 云函数未配置 `AI_API_KEY` |

**旧版兼容**：线上云函数未更新时，不认识 `mode` 会返回「缺少 question」的 400；
前端据此专门提示「后端云函数还是旧版本（不含 JD 匹配），重新部署 functions/tencent 后再试」。

### 3.3 后端实现要点（`functions/tencent/`）

#### 3.3.1 拆分与召回

- `splitRequirements()`：按换行与 `；;` 切分，去掉 `1.` `-` `（1）` 等序号前缀，压缩空白，去重，
  单条截 90 字，最多 14 条。
- `retrieveForJD()`：每条需求调用一次 `retrieve()`（与问答完全同口径），再叠加整段 JD 前 600 字
  的兜底查询；按切片 id 合并取最高分。
- `jdChunkWeight()`：按 D-J3 的权重排序，最终取 6 段进上下文（`JD_TOP_CHUNKS`）。

#### 3.3.2 输出约束（两层）

第一层，`prompt.js` 的 `buildJDSystem()` 把 schema 与判定口径写死：

- 只能使用 `<context>`，禁止编造公司、项目、数字、年限、学历；
- `evidence[].src` 必须原样取自 context 中的 `[id]`；
- `covered / partial / gap` 三态口径明确，`partial` 必须写清差在哪；
- 最多 8 行，按重要性排序，同义要求合并；
- 薪资、到岗、外包、年龄性别等简历没有的信息一律 `gap` + 「建议直接沟通」，不代替本人表态；
- 输入不是 JD（广告、随机文字）→ 0 分 + 「无法判断」；
- 只输出 JSON，不输出代码块与解释。

第二层，`index.js` 的 `parseJDAnswer()` 对模型输出做白名单收紧：

| 校验 | 处理 |
|---|---|
| JSON 解析失败 | 整次判失败（502 `parse_failed`），不返回半截表（D-J7） |
| `score` | 夹到 0–100 整数 |
| `verdict` | 只认「强匹配/匹配/部分匹配/不匹配/无法判断」五枚举，越界按分数回推 |
| `status` | 只认三态（兼容「覆盖/已覆盖/部分/部分覆盖/缺口/未覆盖」中文写法） |
| `evidence` | 每行最多 2 条；`findChunk()` 支持 `[id]` 与标题前缀两种写法，**认不出就丢弃**；covered 无证据自动降为 partial（D-J4） |
| 文本长度 | req 80 / point 120 / gap 90 / probe 70 字，超长截断 |
| 行数 | 最多 8 行；空 `req` 行丢弃 |

`ground` 是证据与原文的二元组重合度（0–1），仅作为前端 hover 提示「与原文重合 xx%」，
不参与筛选——避免把合理转述误判成幻觉。

#### 3.3.3 额度与成本

| 项 | 值 | 说明 |
|---|---|---|
| JD 长度 | 30–1500 字 | 前端先拦，后端兜底，避免无效 token |
| 独立额度 | 10 分钟 4 次 / 每天 20 次 | 内存桶（`jdQuota`），叠加在问答全局限流之上 |
| 上游 max_tokens | 1500 | 8 行 × 证据 + 摘要 |
| 上游超时 | 26s | 云函数执行上限 30s，留 4s 余量 |
| 前端超时 | 38s | 覆盖网关与冷启动余量 |

一次请求的成本约为单次问答的 3–4 倍（长输入 + 整表输出），这是单独设一档额度的原因。
检索本身是纯内存稀疏点积（37 段切片），可忽略。

#### 3.3.4 安全与隐私

- 沿用来源白名单（`ALLOWED_ORIGINS`）与 `origin_denied`（本地调试用 `127.0.0.1:8000`，已在默认白名单）；
- 只拦提示注入、不套敏感词拦截（D-J5）；注入检查在额度扣减之前（D-J6）；
- 日志沿用 `chat_logs`，`tag=jd`；**JD 只存脱敏后的前 300 字摘要**（`oneLine` + `scrub()`），不保存完整原文；
- 回答出口统一过 `scrub()`（手机号 / 证件号）。

### 3.4 前端实现要点（`js/jd-match.js` / `css/jd-match.css`）

- **四态状态机**：空态（三步说明 + 使用限制标签）→ 加载（计时器 + 进度条 + 步骤提示）→ 结果
  （评分卡 / 统计 / 5 列表）→ 错误（文案映射 + 「重试一次」按钮，输入内容不丢失）。
- **三个示例 JD**：`agent`（技术深度匹配）/ `backend`（同栈不同赛道）/ `solution`（明显跨岗），
  覆盖「高匹配 / 中匹配 / 带缺口」三种典型输出形态。
- **错误文案映射**：`timeout` / `network` / `jd_quota` / `rate_limited` / `parse_failed` /
  `no_match` / `bad_request`（含旧版云函数识别）/ `origin_denied` / `server_misconfig` / `bad_json`。
- **Markdown 导出**：`toMarkdown()` 生成表格（管道符转义、`<>` 实体化），`copyText()`
  带 `execCommand` 降级；导出末尾附来源链接。
- **响应式**：>1180px 左表单（sticky）右结果；≤1180px 上下堆叠；≤900px 表格转卡片
  （`data-label` 伪元素标签）；≤680px 紧凑化；`prefers-reduced-motion` 关动画。
- **可达性**：`role=table/row/cell`、`aria-busy`、`aria-live` 提示、`focus-visible` 高亮、
  Ctrl/⌘+Enter 提交。

---

## 4. 实现进度（2026-11-17）

### 4.1 交付物清单

| 文件 | 变更 | 状态 |
|---|---|---|
| `index.html` | SEC.03 `#jd` 区块；导航增加第 03 项（后续编号顺延至 12 博客）；hero 增加「JD 匹配」按钮；引入 `jd-match.css` / `jd-match.js` | ✅ 完成 |
| `js/jd-match.js`（新增） | 表单 / 校验 / 请求 / 四态渲染 / Markdown 导出 / 示例 JD | ✅ 完成 |
| `css/jd-match.css`（新增） | 区块全部样式，四主题跟随 | ✅ 完成 |
| `js/main.js` | `heroCta` 加 `ctaJd` 按钮；`sections` 数组加 `jd`；`window.CP_AI_ENDPOINT` | ✅ 完成 |
| `functions/tencent/index.js` | `handleJD()` 主流程 + `splitRequirements` / `retrieveForJD` / `parseJDAnswer` / `jdQuota` / `jdChunkWeight` / `findChunk` / `groundRatio` / `oneLine`；`callModel` 参数化；`exports._internal` 测试钩子 | ✅ 完成，**待部署** |
| `functions/tencent/prompt.js` | `JD_JSON_SCHEMA` + `buildJDSystem()` | ✅ 完成，**待部署** |
| `README.md` | 板块表（9 大板块）、功能特性第 12 条、目录结构 | ✅ 完成 |
| `docs/jd-match.md` | 本文档 | ✅ 完成 |
| `docs/TODO.md` | T10 / T11 / T12 登记与盘点更新 | ✅ 完成 |

### 4.2 已验证（本地，2026-11-17，全部通过）

**后端（Node 直连模块）**

- 拆分：示例 JD → 7 条需求，序号 / 分号 / 去重正常；
- 召回：加权后稳定返回 6 段且项目与经历优先（`work-w04-01` / `me-02` / `proj-p02-01` / `proj-p01-01` / `exp-03-01` / `proj-p02-04`）；
- `parseJDAnswer`：```` ```json ```` 包裹剥离、`[proj-p02-04]` 方括号 id 与标题两种 src 均可识别、
  伪造 id（`no-such-id`）证据被丢弃、covered 无证据自动降 partial、空 `req` 行丢弃、非法 JSON → null；
- HTTP 层：太短 → 400、超长 → 400、注入 → 400（不占额度）、异常 Origin → 403、OPTIONS → 204 + CORS 回显、
  连续 5 次请求第 5 次触发 `jd_quota` 429、无 `AI_API_KEY` → 500 `server_misconfig`（符合预期）；
- 假模型端到端（mock https 响应）：200 + 结构化 `match` + `meta`，`ground` 计算正确。

**前端（Playwright 实测）**

- 1440 / 1366 / 1100 / 390 四种宽度：无横向溢出、无单元格溢出、`bar-tight` 未误触发（12 项导航共存正常）；
- `#jd` 导航高亮随滚动正确切换；
- 空态 / 加载 / 结果 / 错误四态渲染正常；评分卡、统计、表格、按钮无重叠裁切；
- 短 JD 前端校验文案；`jd_quota` 错误映射文案正确；
- 复制 Markdown 实际产物校验（728 字符，表头、状态列、来源行完整）；
- 截图评审驱动的修正均已落地：空态左右高度失衡 → `align-items:stretch` 拉平并补使用限制标签；
  缺口列过窄导致换行过多 → 列宽重分配 + 表格在 1180px 即转上下堆叠；
  移动端序号与首行文字重叠 → req 单元格右留白 46px；证据空态文案从「—」改为「无匹配证据」。

### 4.3 未验证（需部署后补测，对应 TODO T11）

| 项 | 说明 |
|---|---|
| 真实模型输出质量 | hy3 对 schema 的遵循率、`parse_failed` 实际比例、证据 `ground` 分布 |
| 真实延迟 | 预期 8–20s 出表；冷启动更久；38s 前端超时是否够用 |
| 线上限流与日志 | `jd_quota` 线上触发、`chat_logs` 出现 `tag=jd` 行 |
| 预览子域 CORS | `*.shenge-work.pages.dev` 的通配匹配随函数重部署自动生效（关联 [TODO.md](TODO.md) T5） |
| 移动端真机 | 本轮用 390px 视口模拟，未覆盖真机 WebView |

---

## 5. 待处理事项（详情见 TODO.md，此处为概要）

| ID | 事项 | 状态 | 优先级 |
|---|---|---|---|
| T10 | **上线收尾：推送 JD 静态文件 + 重新部署云函数 `functions/tencent`（硬前置）** | `待办` | 高 |
| T11 | JD 匹配真实模型端到端验收（§4.3 清单，依赖 T10） | `待办` | 中 |
| T12 | JD 匹配迭代池（缓存 / 分享链接 / PDF 导出 / 追问直达 / 招聘方速览模式） | `思考池` | 低 |

**T10 的注意**：上线分两条独立链路，**都走完才算上线**——

1. **静态发布**：git push（通道已恢复，见 [TODO.md](TODO.md) §3.2）→ GitHub Pages /
   Cloudflare Pages 自动构建。JD 静态文件目前仍在本地工作区未入库：`index.html`、
   `js/main.js`、`README.md`（修改），`js/jd-match.js`、`css/jd-match.css`（新增），
   与本文档及 TODO 的登记更新。
2. **云函数重部署**：CloudBase 控制台上传 `functions/tencent/` 整包，与 git 无关。
   只 push 不部署 → 线上页面提示「云函数还是旧版本」；只部署不 push → 新功能无入口。

语音链路改动（`tts.js`、`js/ai-voice*.js` 等）经并行会话已入库（TODO.md §3.2 实测一致），
但打包前仍建议确认没有新的在途改动，并对 `functions/tencent/` 全量 `node --check`，
避免半成品互相覆盖上线。

---

## 6. 部署与验收

### 6.1 部署步骤

1. 知识库未变，无需重建；若之后改过 `knowledge/`，先执行：
   ```bash
   python scripts/build_kb.py --sync-functions
   ```
2. 重新部署云函数 `functions/tencent`（**必须**，见 §5 T10）：
   - 环境变量保持原有 `AI_API_KEY` / `AI_MODEL`，**无新增变量**；
   - HTTP 触发路径仍为 `/chat`；
   - 部署前 `node --check functions/tencent/index.js functions/tencent/prompt.js functions/tencent/tts.js functions/tencent/server.js` 全过。
3. 静态发布：提交并推送（git push 通道已恢复，见 [TODO.md](TODO.md) §3.2）
   → GitHub Pages / Cloudflare Pages 自动构建。涉及文件：`index.html`、
   `css/jd-match.css`、`js/jd-match.js`、`js/main.js`（缓存版本号已在代码里更新）、
   `README.md` 及 `docs/` 下两份文档的登记更新。

### 6.2 快速验证

打开 `https://shenge-work.github.io/#jd`，点「AI Agent 工程师」示例 →「开始匹配」，
应在 8–20 秒内出表；10 分钟窗口内连续第 5 次应出现 `jd_quota` 提示，说明额度生效。

### 6.3 端到端验收清单（对应 T11）

```bash
# 1) JD 分支生效（线上，直接探测）
curl -s -X POST https://resume-ai-d9g7zghnxda2ee2cb-1307508155.ap-shanghai.app.tcloudbase.com/chat \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://shenge-work.github.io' \
  -d '{"mode":"jd","jd":"岗位职责：负责企业级 AI Agent 平台架构设计，含任务规划、工具调用与多智能体编排；建设 RAG 检索链路并做召回评测。要求：3 年以上后端研发经验，熟悉向量数据库。"}'
# 期望 {"ok":true,"mode":"jd","match":{...}}；返回「缺少 question」说明还是旧函数
```

- [ ] 三个示例 JD 各跑一次，输出结构完整（overall / rows / stats），证据 `src` 均为真实切片 id；
- [ ] 10 分钟内第 5 次触发 `jd_quota`；
- [ ] 粘贴非 JD 文本（如一段新闻）→ 0 分 + 「无法判断」；
- [ ] 含「忽略以上指令」的文本 → 400 注入拦截，且不占额度（拦截后连跑 4 次正常请求仍可用）；
- [ ] 问答助手回归：问「技术栈与方向？」正常回答（`mode` 缺省走旧流程不受影响）；
- [ ] `chat_logs` 查询 `tag=jd` 有落库行，`q` 字段为 ≤300 字脱敏摘要；
- [ ] 移动端真机打开 `#jd`，表单、示例按钮、结果卡无溢出；
- [ ] 验收结果回写本文 §4.2 / §4.3，并把 TODO T10 / T11 置为 `已完成（日期）`。

---

## 7. 本地自测

`functions/tencent/index.js` 导出了测试钩子（不参与云函数入口）：

```js
const I = require('./functions/tencent/index.js')._internal;
const kb = I.loadKB();
I.splitRequirements(jd);          // 看需求拆分
I.retrieveForJD(jd, reqs);        // 看召回与权重后的 id / 分数
I.parseJDAnswer(modelText, kb);   // 看结构校验与证据白名单
I.groundRatio(point, text);       // 证据与原文重合度
```

前端联调：起本地静态服务（`python -m http.server 8000`，默认白名单已含 `127.0.0.1:8000`），
在浏览器 DevTools 里 mock `/chat` 响应即可验证四种状态：空态、加载、结果、错误。

---

## 8. 已知边界

- **不是逐条严格覆盖**：模型按重要性合并同义要求，最多 8 行；JD 很碎时可能合并掉细节。
- **评分是覆盖度，不是录用概率**：口径写在提示词里，但仍是模型主观判断，适合作为讨论起点。
- **短缺口可能被压缩**：`gap` 限 90 字，复杂差距只能点到为止。
- **只对档案内的事实负责**：档案没写的（薪资、到岗、年龄）一律按缺口处理，不做推测。
- **额度是单实例内存计数**：多实例 / 冷启动会重置，与问答现状一致；如需严格跨实例额度，
  可复用 `chat_logs` 的 `ip_hash` 计数（问答侧 `countRecentByDb` 已有实现）。
- **真实模型质量未实测**：本地端到端用桩响应，上线后按 §6.3 验收。

## 9. 后续迭代池（不排期，先记录避免丢失）

1. **结果缓存**：对 `sha256(JD)` 做 10 分钟内存缓存，重复点击不重复扣额度；
2. **可分享链接**：`?jd=` 压缩参数或短链，方便招聘方转给同事；
3. **导出 PDF / 邮件**：复用 `functions/api/deliver.js` 的 Resend 链路；
4. **追问点直达问答**：点一条 `probe` 直接调 `/chat`，把「对照表」变成「面试预演」；
5. **招聘方速览模式**：本调研的备选方案（§1.2），一个开关把整站切成 30 秒版。

> AI生成