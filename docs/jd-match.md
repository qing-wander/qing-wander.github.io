# 岗位匹配 JD MATCH · 调研、方案与实施记录

> 文档定位：本文件是「岗位匹配」视图的**单一设计依据与实施台账**。调研结论、方案决策、接口契约、
> 实现进度、验证记录与待处理事项都在这里；后续代码迭代必须与本文对齐，冲突时先改文档再改代码。
> 全站「还没做的事」只在 [TODO.md](TODO.md) 一处登记，本文 §5 为其概要并相互回链。
>
> 版本：v3（2026-11-17 夜）· 状态：**已上线，线上端到端验收完成**（仅预览子域 CORS / 日志查库 / 真机需人工） · 作者：陈培胜
> 变更：v1 为初版实施说明；v2 并入调研结论、选型决策、进度与待办；v3 记录实际上线与线上验收，
> 并更正「云函数待重新部署」这一过时结论——实测线上早已是含 JD + TTS 的合并版。

---

## 0. 结论摘要（先看这四条）

1. **功能定位**：JD 匹配是「让招聘方在 3 分钟内做出判断的那一步」——招聘方粘贴在招岗位 JD，
   得到一张对照表：每条要求落在哪段经历、缺口在哪、面试能顺着问什么。它同时是
   **「用站内 Agent 能力证明 Agent 能力」的活演示**，比任何技能标签都有说服力。
2. **零新增后端**：复用问答助手的同一台腾讯云 CloudBase 云函数（`POST /chat`）与同一份
   37 段档案切片知识库，靠 `mode: "jd"` 分流；限流、白名单、日志、脱敏全部继承。
3. **当前状态（2026-11-17 夜，已上线）**：云函数侧早已部署含 `mode:'jd'` 的合并版——
   线上包内 `index.js` 与本地 `functions/tencent/index.js` 逐字节一致，且同时保留 `mode:'tts'`，
   不需要再重部署；静态侧由 commit `7c7b5e1` 推送后 GitHub Pages / Cloudflare Pages 自动构建，
   两个域名的 `#jd` 区块与 `jd-match.js/css` 均 200。**v2 里「上线唯一硬前置是重新部署云函数」
   的判断是错的**，实际缺的只是把本地静态文件提交推送。
4. **线上验收结论**：三个示例 JD 真实模型全部按固定结构出表（6.0–8.6 秒，快于预期），
   证据 `src` 100% 命中 37 段真实切片；`jd_quota` 额度、注入拦截不占额度、CORS、问答/TTS
   回归与 1440/390px 前端渲染均通过。仅剩「预览子域 CORS」「`chat_logs` 查库」「移动端真机」
   三项需人工，详见 §4.3 / §5。

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

### 4.2.1 线上实测（2026-11-17，真实模型，已通过）

静态与后端均已上线后，用生产域名与合法 Origin 直探线上 `/chat`：

```bash
curl -s -X POST https://resume-ai-d9g7zghnxda2ee2cb-1307508155.ap-shanghai.app.tcloudbase.com/chat -H 'Content-Type: application/json' -H 'Origin: https://shenge-work.github.io' -d '{"mode":"jd","jd":"岗位职责：负责企业级 AI Agent 平台架构设计…"}'
```

- 返回 `{"ok":true,"mode":"jd",...}`，**真实 hy3 遵循 JSON schema**，无 `parse_failed`；
- `overall.score=75` / `verdict=匹配`，4 条 `rows` 齐全（`covered 2 / partial 1 / gap 1`），
  证据 `src` 为真实切片 id（`proj-p02-01`、`proj-p02-04`）、`ground` 0.93–1.0，
  缺口与追问点均有内容；`sources` 与 `stats` 一致；
- 回归：`{"mode":"tts",...}` → 200，问答 `{"question":...}` → 200，既有链路未受影响；
- 生产首页 200，含 `#jd` 区块与 `js/jd-match.js?v=20261117a`、
  `css/jd-match.css?v=20261117a`、`js/ai-voice*.js?v=20261117c` 引用（Pages 已构建）；
- 仓库 `functions/tencent/index.js` 为 **JD + TTS 合并版**（两套路由共存），
  `index.js` / `prompt.js` / `tts.js` / `server.js` 四个文件 `node --check` 全过。

**v3 线上验收记录（并行会话，详见 §0 第 4 条）**：三个示例 JD 真实模型全部按固定结构出表
（6.0–8.6 秒，快于预期 8–20s），证据 `src` 100% 命中 37 段真实切片；`jd_quota` 额度、
注入拦截不占额度、CORS、问答 / TTS 回归与 1440 / 390px 前端渲染均通过。本轮独立探测
（上面的 curl）与之一致。

**逐项明细（可复核，2026-11-17 夜 ~ 11-18 00:08）**

① 三个示例 JD，真实模型全部 `200 / ok:true`，无一次 `parse_failed`：

| 示例 | score / verdict | rows | 覆盖/部分/缺口 | 证据数 | 非法 src | ground | 服务端耗时 |
|---|---|---|---|---|---|---|---|
| `agent` 技术深度匹配 | 72 / 匹配 | 7 | 3 / 3 / 1 | 11 | 0 | 0.86–1.0 | 7.66s |
| `backend` 同栈不同赛道 | 35 / 部分匹配 | 8 | 0 / 5 / 3 | 5 | 0 | 0.87–1.0 | 6.01s |
| `solution` 明显跨岗 | 45 / 部分匹配 | 8 | 2 / 4 / 2 | 6 | 0 | 0.94–1.0 | 8.29s |

三份输出均满足五档 `verdict`、0–100 整数分、1–8 行、三态 `status`、
`covered` 行必有证据、`sources` 稳定 6 段、`meta` 齐全；`ground` 0.86–1.0，
说明证据白名单与原文重合度校验在真实模型下都生效。

② 边界、安全与回归（线上直探）：

| 用例 | 结果 |
|---|---|
| JD < 30 字 / 1620 字 | 均 400 `bad_request`（超长回显当前字数） |
| 含「忽略以上指令」 | 400 注入拦截，且不占额度（被拦后仍能连跑 4 次正常请求） |
| 10 分钟窗口内第 5 次 | 429 `jd_quota`，文案含「10 分钟 4 次」与邮箱兜底 |
| 非法 Origin / `OPTIONS` 预检 | 403 `origin_denied` / 204 + `Access-Control-Allow-Origin` 正确回显 |
| 非 JD 气象新闻 | 200、`score=0` + `verdict=无法判断`，摘要说明「并非岗位 JD」（3.4s） |
| 问答 / TTS 回归 | 200 `ok:true`（回答 134 字 / 合法 base64 MP3） |

③ 生产前端（Edge headless，生产域名）：

- GitHub Pages 与 Cloudflare Pages 首页均含 `id="jd"` 及两个 `?v=20261117a` 资源引用，
  `js/jd-match.js` / `css/jd-match.css` / `js/main.js` 均 200；
- **真实点击「AI Agent 工程师」示例 → 8.79 秒出表**（score 72 / 7 行 / 3 项统计），
  Markdown 导出 1405 字符；空态 / 加载 / 结果 / 错误四态均可用，错误态保留已填 JD（334 字）；
- 1440 / 390px 横向溢出均为 0，`window.CP_AI_ENDPOINT` 正常暴露，**0 个 JS `pageerror`**。

④ 版本一致性：线上部署包 `resume-ai-chat.zip` 内 `index.js` / `prompt.js` / `tts.js` /
`server.js` 与本地 `functions/tencent/` **逐字节相同**，同时含 JD 与 TTS 两套路由；
四个 JS `node --check` 全过，仓库 `main` 已是同一份合并版。

### 4.3 未验证（仅剩 3 项人工复核，不阻塞使用）

| 项 | 说明 |
|---|---|
| 预览子域 CORS | `*.shenge-work.pages.dev` 通配是否随新函数生效（关联 [TODO.md](TODO.md) T5） |
| `chat_logs` 查库 | 确认 `tag=jd` 有落库行且 `q` 为 ≤300 字脱敏摘要（函数侧已验证日志输出格式） |
| 移动端真机 | 本轮用 390px 视口模拟，未覆盖真机 WebView |

---

## 5. 待处理事项（详情见 TODO.md，此处为概要）

| ID | 事项 | 状态 | 优先级 |
|---|---|---|---|
| T10 | 上线收尾：推送 JD 静态文件 + 云函数 `mode:jd` 生效 | `已完成（2026-11-17）` | — |
| T11 | JD 匹配端到端验收（仅剩预览子域 CORS / 日志查库 / 真机 3 项人工复核） | `进行中（2026-11-17）` | 低 |
| T12 | JD 匹配迭代池（缓存 / 分享链接 / PDF 导出 / 追问直达 / 招聘方速览模式） | `思考池` | 低 |

**T10 已完成，勿重复上线**（2026-11-17 线上实测）：

1. **静态发布**：`7c7b5e1` 已推送到 `origin/main` 并同时触发 GitHub Pages /
   Cloudflare Pages 自动构建，两个生产域名首页均含 `#jd` 区块及
   `js/jd-match.js?v=20261117a` / `css/jd-match.css?v=20261117a` 引用，三个静态资源 200；
   语音脚本引用完好。
2. **云函数**：部署语音链路时上传的 `functions/tencent/` 整包已同时含 JD 与 TTS 路由，
   线上 `POST /chat {mode:"jd"}` 用真实 hy3 返回 `ok:true` 与完整 `match`（见 §4.2.1），
   **无需再次重部署**；问答与 TTS 回归均 200。

`HEAD == origin/main`，工作区干净；`functions/tencent/` 四个 JS `node --check` 全过。
后续若再次打包部署，务必使用 JD + TTS 合并版 `index.js`，不要用只含单一路由的旧快照，
避免覆盖线上已生效的另一条链路。

---

## 6. 部署与验收

### 6.1 部署步骤（2026-11-17 已执行完毕，保留作回滚 / 再部署参考）

> 当前状态：T10 已完成，静态与云函数均已上线并实测通过（§4.2.1）。**下面第 2、3 步不需要重跑。**
> 如确需再次部署，务必使用 JD + TTS 合并版代码，并全量回传环境变量
> （漏 `AI_API_KEY` 会导致 `/chat` 失效，见 [TODO.md](TODO.md) §3.2）。

1. 知识库未变，无需重建；若之后改过 `knowledge/`，先执行：
   ```bash
   python scripts/build_kb.py --sync-functions
   ```
2. ~~重新部署云函数 `functions/tencent`（必须）~~ → **已完成**：现网函数 `mode:"jd"` 实测可用，
   环境变量保持 `AI_API_KEY` / `AI_MODEL`，HTTP 路径 `/chat`，四个 JS `node --check` 全过。
3. ~~静态发布：提交并推送~~ → **已完成**：`7c7b5e1` 已推送并触发 Pages 构建，涉及
   `index.html`、`css/jd-match.css`、`js/jd-match.js`、`js/main.js`、`README.md` 与 `docs/` 文档。

### 6.2 快速验证（已执行）

线上直探 `POST /chat {mode:"jd"}` 返回 `ok:true` + 完整结构化 `match`（score 75、4 条 rows、
真实证据 id 与追问点），`{"mode":"tts"}` 与问答均 200；生产首页含 `#jd` 与全部资源引用。
浏览器侧（v3 验收）：三个示例 JD 全部出表（6.0–8.6 秒），`jd_quota` 第 5 次提示、
注入拦截不占额度、1440 / 390px 四态渲染均通过；**生产域名真实点击示例 8.79 秒出表**
（score 72 / 7 行，Markdown 1405 字符，0 个 JS 错误），非 JD 新闻返回 0 分「无法判断」。
剩余三项人工复核见 §4.3。

### 6.3 端到端验收清单（对应 T11）

```bash
# 1) JD 分支生效（线上，直接探测）
curl -s -X POST https://resume-ai-d9g7zghnxda2ee2cb-1307508155.ap-shanghai.app.tcloudbase.com/chat \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://shenge-work.github.io' \
  -d '{"mode":"jd","jd":"岗位职责：负责企业级 AI Agent 平台架构设计，含任务规划、工具调用与多智能体编排；建设 RAG 检索链路并做召回评测。要求：3 年以上后端研发经验，熟悉向量数据库。"}'
# 期望 {"ok":true,"mode":"jd","match":{...}}；返回「缺少 question」说明还是旧函数
```

- [x] 三个示例 JD 各跑一次，真实模型按固定结构出表（6.0–8.6s），证据 `src` 100% 命中真实切片 id（§4.2.1）；
- [x] 10 分钟内第 5 次触发 `jd_quota`；
- [x] 粘贴非 JD 文本（气象新闻）→ 200、`score=0` +「无法判断」（服务端 3.4s）；
- [x] 生产域名真实点击示例 → 8.79 秒出表，Markdown 导出 1405 字符、0 个 JS `pageerror`；
- [x] 含「忽略以上指令」的文本 → 400 注入拦截，且不占额度；
- [x] 问答助手回归：`{"question":...}` → 200；另 `{"mode":"tts"}` → 200；
- [x] 1440 / 390px 四态渲染与 Markdown 导出；
- [x] T10 置为已完成并回写 §4.2.1 / §5；T11 剩余项完成后再把 T11 置为 `已完成（日期）`。
- [ ] 预览子域 `*.shenge-work.pages.dev` 的 CORS 通配（关联 [TODO.md](TODO.md) T5）；
- [ ] `chat_logs` 查询 `tag=jd` 有落库行，`q` 字段为 ≤300 字脱敏摘要；
- [ ] 移动端真机打开 `#jd`，表单、示例按钮、结果卡无溢出。

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