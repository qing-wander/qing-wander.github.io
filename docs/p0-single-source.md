# P0 实施记录：单一真相源 + 留言板设备隔离

> 状态：代码已落地（2026-11-19），线上生效前需要跑一次 D1 迁移并配置 `DEVICE_HASH_PEPPER`。
> 规划文档：[cloudflare-rag-admin-plan.md](./cloudflare-rag-admin-plan.md)

## 1. 一句话

`resume.html` 不再手写，它是 **`data/site-data.json` → `resume`** 经模板渲染的产物；留言板从「全站公开墙」改成「按设备隔离的私密留言本」，后台可看全部设备。

## 2. 数据分层（谁是真源）

| 层 | 存什么 | 是不是权威 |
|---|---|---|
| **Git（`data/*.json` + `templates/`）** | 简历与主页内容、主题 token、模板 | **是**。所有内容改动只改这里 |
| `resume.html` / `data/site-data.js` | 构建产物 | 否，自动生成，禁止手改 |
| D1 `portfolio-db` | 留言设备/留言、访问计数、限流、后续的问答日志/草稿/审计 | 运行时状态，非内容权威 |
| Vectorize | 简历切片的向量索引 | 否，从 Git 重建的派生索引 |
| R2 | PDF、简历变体 HTML | 否，可重建的产物 |

判断标准：**删掉整库还能从 Git 重建的，就不算真相源。**

## 3. P0 产物清单

```
data/site-data.json            新增 resume 块（基本信息 / 简介 / 工作 / 项目 / 技能 / 教育）
data/site-data.js              自动快照（已剔除 resume，主页不再多下载 17KB）
templates/resume.template.html CSS / 弹窗 / 打印 JS / 布局，只留 5 个占位
scripts/render_resume.mjs      生成器（--check 漂移比对 / --stdout 调试）
scripts/validate_content.mjs   结构 + 锁定字段 + 两页预算 + 漂移校验
.github/workflows/content-build.yml  CI：手改生成物或超预算直接红
images/edu-verify-qr.png       学信网二维码（从 72KB 内联 base64 外置成文件）
```

`resume.html`：122KB → 50KB（二维码外置 + 去重），**除顶部生成说明与二维码 src 外，与改动前逐字一致**（已用 `git show HEAD:resume.html` 做过全量 diff）。

## 4. 日常改稿流程

```bash
# 1. 只改数据（不要碰 resume.html）
vim data/site-data.json

# 2. 重新生成 + 刷新主页快照
node scripts/render_resume.mjs
python3 scripts/sync_site_data.py

# 3. 自检（结构、锁定字段、两页预算、漂移）
node scripts/validate_content.mjs

# 4. 只想确认有没有漂移，不写盘
node scripts/render_resume.mjs --check
```

CI（`.github/workflows/content-build.yml`）在 push / PR 上跑同样三件事，**任何手改 `resume.html` 都会被判红**。

## 5. resume 数据结构与 AI 改动边界

```jsonc
"resume": {
  "meta":    { "title", "description", "maxPages": 2 },
  "basics":  { "editable": "manual", "name", "role", "avatar", "lines": [[{label,value|href}]] },
  "summary": { "editable": "ai", "html" },
  "experience": [{ "id", "company", "companyNote", "role", "period",
                   "lock": ["company","companyNote","role","period"],
                   "bullets": [{ "id", "html" }] }],
  "projects":   [{ "id", "name", "url", "subtitle", "period", "lead",
                   "lock": ["name","url","period"],
                   "bullets": [{ "id", "html" }] }],
  "skills":     [{ "id", "name", "main", "sub" }],
  "education":  { "editable": "manual", "school", "note", "period",
                  "bullets": [{ "id", "html" }],
                  "verify": { "label", "code", "tip", "qrImage" } }
}
```

| 层级 | 字段 | 谁能改 |
|---|---|---|
| **L0 锁定** | 公司名 / 任职时间 / 项目名 / 项目链接 / 学校 / 专业 / 学历 / 学信网验证码 / 所有数字事实 | 只有人。`lock` 数组声明，AI 生成时作为硬约束注入 |
| **L1 微调** | 基本信息（`basics.lines`）、教育 bullet | 后台人工配置；AI 只能在 `resume.micro` 里做措辞级微调，不得增删事实 |
| **L2 可改写** | 个人简介、工作 bullet、项目 lead/bullet、技能行 | AI 按 JD 改写，但必须保留 bullet `id`，改写结果另存「简历变体」，不覆盖主版本 |

每个 bullet 都有稳定 `id`（`proj-comein-03`、`exp-lessie-02`…）：RAG 切片、后台 diff、变体对比都靠它，**AI 输出必须带 id 回填，禁止整段重排**。

**两页预算**（5 年经验，PDF 硬上限 2 页）：

| 项 | 上限 | 当前 |
|---|---|---|
| 正文可见字符 | 3800（>92% 告警） | 3665 |
| 工作 bullet | 10 | 8 |
| 项目 bullet | 16 | 14 |
| 技能分组 | 6 | 5 |
| 个人简介 | 220 字 | — |

`validate_content.mjs` 超限直接报错。真正的页数由后续 Playwright 打印校验兜底（P1）。

## 6. 留言板：从公开墙到设备留言本

### 为什么不是 MAC 地址

网页读不到 MAC：浏览器没有这个 API，手机 MAC 还会随机化，同一设备还可能有 Wi-Fi/蓝牙/以太网多个 MAC。「按 MAC 隔离」在 Web 端无法按字面实现，所以用等价方案：

```
前端：crypto.randomUUID() → localStorage['cp_device_id'] → 请求头 X-Device-Id
服务端：HMAC-SHA256(DEVICE_HASH_PEPPER, device_id) 前 32 位 hex → device_hash 入库
```

库里**不存原始 device_id**，库被拖走也还原不出某台设备，也就无法伪造别人的留言本。

### 语义边界（必须让用户知道）

- 这是**隐私分区**，不是安全认证：`device_id` 可被伪造；
- 清缓存 / 隐身模式 / 换浏览器 = 新设备，旧留言看不到；
- 同一人的手机 + 电脑 = 两台设备，各看各的；
- 旧留言（迁移前）统一归 `device_hash='legacy'`，公开端读不到，**只在后台可见**；
- 跨设备查看需要一个「设备绑定码」或登录，属于 P2。

### 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/wall?limit&offset` | 只返回本设备 `status='visible'` 的留言，每条附 `replies` 对话 |
| GET | `/api/wall?peek=1` | 本设备总数 + 最新一条 + `latestReply`（最新站长回复时间，轮询提示用） |
| POST | `/api/wall` | 绑定当前设备写入；被拉黑设备返回 403 |
| POST | `/api/wall` + `{replyTo, text}` | 在本设备某条留言下评论 / 追问，校验设备归属，独立限流 |
| DELETE | `/api/wall` + `X-Admin-Token` | 站长应急删除（唯一保留的令牌接口，级联删回复） |

> **2026-11-21 起旧后台接口 `/api/admin/wall/*` 已下线。** 设备台账、留言审核、CSV 导出
> 全部走后台（会话鉴权，见 `admin/`）：`/api/admin/devices`、
> `/api/admin/messages`、`/api/admin/messages/status`、`/api/admin/messages/reply`、`/api/admin/devices/block`、`/api/admin/export`。
> 保留 `DELETE /api/wall` 只为应急删除单条，避免静态令牌长期持有全站读权限。
>
> **现状（2026-11-25）**：后台已并入主站 `chenpeisheng.cn`（`/admin` 控制台、`/login` 登录、`/api/admin/**` 接口，
> 守卫在 `functions/_middleware.js`）；下文独立 Pages 项目 `shenge-work-admin.pages.dev` 为历史部署，仅保留作回滚。
>
> **2026-11-23 起增加 `wall_replies` 表**（迁移 `db/migrations/2026-11-23-wall-replies.sql`）：
> 一条留言可挂多条 `author=owner`（站长后台回复）与 `author=visitor`（访客评论），
> `device_hash` 与留言一致，公开端按留言所属设备读取，隐私模型不变。站长回复只经后台
> `POST /api/messages/reply` 写入，公开端只读；后台支持「待回复 / 已回复」筛选、`focus`
> 直达与回复删除。访客评论会邮件通知站长，站长回复不发邮件（匿名无收件地址）。

无设备头时返回 `reason: "device_required"` 且**不带任何正文**，前端显示「本设备拿不到存储权限」。

### 存储

```sql
wall_devices   device_hash PK, first_seen, last_seen, post_count, ua, status(active|blocked), note
wall_messages  + device_hash, status(visible|hidden), admin_note, updated_at
```

裁剪改为两层：**每设备最多 20 条**（只滚掉自己的旧留言）+ **全站兜底 500 条**。原版「全站只留 100 条」在设备隔离后会误删别人的留言，已废弃。

### 上线步骤（按顺序，缺一不可）

```bash
# 1. 老库补列（新库跳过，直接 schema.sql 即可）
npx wrangler d1 execute portfolio-db --remote \
  --file=db/migrations/2026-11-19-wall-device-isolation.sql

# 2. 配环境变量（Cloudflare Pages → shenge-work → Settings → Variables and Secrets）
#    DEVICE_HASH_PEPPER = <32 字节以上随机串，务必保存好；换了等于所有设备重新分区>
#    已有 WALL_ADMIN_TOKEN 保持不变

# 3. 部署（绑定与变量改动都要重新部署才生效）
git push

# 4. 自检（本地先跑一遍更保险）
node scripts/dev-api-server.mjs            # 本地 8877
./scripts/wall-check.sh http://127.0.0.1:8877 --post --admin-token=local-admin-token
./scripts/wall-check.sh --post --admin-token=$WALL_ADMIN_TOKEN   # 线上
```

`wall-check.sh` 现在自带隔离契约验收：`W0` 无设备头不泄露正文、`W10c` 对照设备读不到、`W15` 写入后另一设备仍为 0、`W17/W18` 后台接口有/无令牌。

## 7. 管理后台（已上线）

> **现状（2026-11-25）**：后台已并入主站，控制台 `/admin`、登录 `/login`、接口 `/api/admin/**`，
> 与公开站共用同一个 D1 `portfolio-db`。下文「独立 Pages 项目 `shenge-work-admin.pages.dev`」
> 是早期部署形态，`admin/wrangler.toml` 保留作回滚，线上已由仓库根 `functions/` 接管。

### 结构

```
admin/
  wrangler.toml            name=shenge-work-admin，D1 绑定 DB，输出目录 public
  public/                  静态页面（登录 + 控制台，无框架、无构建）
  functions/api/           auth / stats / devices / messages / export
  lib/admin.js             会话签名、鉴权、限流、CSV —— 放在 functions 外，
                           否则 Pages 会把每个 .js 当成路由入口
```

### 鉴权（过渡方案，OAuth 可后接）

- 口令登录 → HMAC-SHA256 签名的 `pa_sess` cookie（HttpOnly / Secure / SameSite=Lax，30 天免登录）
- 登录限流：同 IP 15 分钟 8 次，落 `rate_limits` 表
- 写操作三重校验：SameSite + `X-Admin-Request: 1` 自定义头 + Origin 同源
- 会话签名不建表，零存储成本；换 GitHub OAuth 时只改 `functions/api/admin/auth/login.js`，
  `isAdmin()` 的判定换成语种即可
- 应急通道：`X-Admin-Token == WALL_ADMIN_TOKEN` 仍可用（脚本/自检走这条）

### 接口

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/admin/auth/login` | 口令换 cookie |
| POST | `/api/admin/auth/logout` | 清 cookie |
| GET | `/api/admin/auth/me` | 前端判断登录态 |
| GET | `/api/admin/stats` | PV / UV / 24h UV / 设备数 / 留言数 / 今日新增 / 隐藏 / 待回复 / 拉黑 |
| GET | `/api/admin/devices` | 设备台账（首见、最近活跃、留言数、最近一条、状态） |
| GET | `/api/admin/messages` | 留言审核（设备 / 状态 / 待回复 / 关键词 / `focus` 直达，每条附对话） |
| POST | `/api/admin/messages/status` | 隐藏 / 恢复 |
| POST | `/api/admin/messages/reply` | 站长回复某条留言（写 `author=owner`） |
| DELETE | `/api/admin/messages/reply` | 删除一条回复（误发 / 审核） |
| POST | `/api/admin/devices/block` | 拉黑 / 解封 |
| GET | `/api/admin/export` | 导出 CSV（留言 + 设备两段） |

### 部署与密钥

```bash
cd admin && npx wrangler pages deploy --branch main
```

项目密钥（已配置）：`ADMIN_PASSWORD`、`ADMIN_SESSION_SECRET`、`WALL_ADMIN_TOKEN`。
本地值存在仓库根的 `.secrets.local`（已 gitignore），后台开发用 `admin/.dev.vars`。

## 7.5 RAG 切片（词面层已落地）

`scripts/build_rag_chunks.mjs` 从 `data/site-data.json` 切出 **42 片**（约 7.2 千字），
产物 `rag/chunks.json` + `rag/kb-chunks.seed.sql`（D1 种子）。

- **切片 id 就是 bullet id**（`exp-inmen-01` / `proj-comein-03`），内容改写不会让 id 漂移，
  回答里的引用能精确回链到 `source_path`（`data/site-data.json#/resume/projects/0/bullets/2`）。
- 元数据按规划落地：`kind / section / entity_id / entity_type / tags / visibility / lang / kb_version / source_path`。
  `kb_version` 由内容哈希生成（`kb-5f9004b7`），内容一变版本就变，天然带版本语义。
- 隐私闸门：联系方式只放邮箱 / GitHub / 博客 / 常驻城市，手机号永不进库（CI 断言）。
- 索引形态：`kb_chunks`（正表）+ `kb_fts`（FTS5，`tokenize='unicode61'`，写入端已切好 bigram，
  中文不赌分词器）。

检索自测（无向量库也能测）：

```bash
node scripts/rag_query.mjs --q "云沙箱 多租户隔离"        # 看单条召回
node scripts/rag_query.mjs --golden tests/golden-queries.json   # 金标集 hit@3
```

当前金标集 20 题：加章节意图兜底后 **hit@1 95% / hit@3 100%**（门禁 90%），无关问题（天气 / 写代码 / 电影 / 薪资 / 空窗期 / 外包）全部零召回。
两道闸门：查询命中 < 2 个 token 不返回（避免「深圳」这种地名把整页经历拉出来）；
命中章节意图（经验 / 项目 / 学历 / 联系 / 技能）时放宽到 1 并加小权重，防止口语问法空召回。

## 8. 未做 / 待办

- [x] 后台 UI（设备台账 + 留言审核 + CSV 导出）
- [x] 真页数校验（无头 Chrome 打 PDF 数页数，CI 拦住 >2 页）：`scripts/check_resume_pages.mjs`
      —— 实测当前 resume.html 打出来正好 2 页
- [x] 语义层：`@cf/baai/bge-m3`（1024 维）向量化 42 片 → Vectorize `resume-kb` 已入库（42 条，id 带版本前缀 `kb-5f9004b7:`），`node scripts/rag_embed.mjs --query "…"` 可做语义自检
- [x] 混合检索接口 `/api/kb`（D1 FTS5 BM25 + Vectorize cosine，RRF k=60 融合，cosine 地板 0.55）已上线，**semantic=true**（语义路走 Worker `resume-kb-api`，见 7.7）
- [x] `/api/chat`：检索 → 空召回短路 → llama-3.3-70b 生成 → 返回 citations + 落 qa_logs（实测 1.7s / 5.2s；公司全称原样保留）
- [x] `/api/chat` 与页面问答框对接（endpoint 已切，接口兼容 `{question}` / `sources`）
- [x] JD 匹配搬到 Cloudflare：`/api/jd` + `/api/chat?mode=jd`，混合检索逐条召回 + 一次 LLM 判定
      —— Agent JD 83/100（高度匹配）、财务 JD 22/100（差距较大，3 缺口），2.1-2.3s
- [x] RAG 切片（按 bullet id）+ D1 词面索引 + 金标集 hit@3 闸门：`rag/`、`scripts/build_rag_chunks.mjs`、`tests/golden-queries.json`
- [ ] 未排期的增强项（rerank 重排、动态简历变体、跨设备查看、`resume.micro` 微调流水线）已统一登记
      [TODO.md T24](TODO.md)（思考池），本文件不再另起清单。

> 早期方案「给 Pages 项目挂 `[ai]` / `[[vectorize]]` 绑定」已被替代：`AI` / `VECTORIZE` 绑定在
> KB Worker（`worker/kb/`）上，Pages 不支持这两类绑定，见 README [系统架构](../README.md#系统架构)。

### 7.6 `/api/kb` 线上验证（2026-11-19）

```
GET https://shenge-work.pages.dev/api/kb?q=云沙箱 多租户隔离&top=3
→ semantic=false, count=3  skill-02 / proj-comein-01 / proj-comein-03

GET .../api/kb?q=他几年经验 什么学历&top=3
→ count=2  edu-verify / me-03（意图赦免生效）

GET .../api/kb?q=今天深圳天气
→ count=0, empty=true（前端直答「简历里没写这块」）
```

语义路怎么通：Pages 项目的 `deployment_configs` 不支持 Workers AI / Vectorize 绑定（API 里根本没这两个 key，只能 Dashboard 点），
所以把这两个绑定放进独立 Worker `resume-kb-api`（`worker/kb/`，`wrangler.toml` 里 `[ai]` + `[[vectorize]]`），
`/api/kb` 在服务端拿 `KB_TOKEN` 调它。浏览器不直连 workers.dev，所以境内不可达不影响。

### 7.7 混合检索实测（semantic=true）

```
他懂不懂多租户隔离和沙箱 → skill-02 + proj-comein-01（两路一致，RRF 并列 0.0325）
他会不会写高并发网关   → skill-05
他几年经验 什么学历    → me-03(experience) + edu-verify(education)  ← 意图赦免
他会 Kubernetes 吗     → count=0（简历里没有，闸门挡掉）
今天深圳天气           → count=0
```

相似度处理：bge-m3 在这批语料上分数挤在 0.42–0.53（无关问题也有 0.50），
绝对值不可靠 → 先卡地板 0.42 去底噪，再只留与冠军差 ≤0.04 的梯队，最后交给覆盖闸门判相关性。

### 7.8 JD 匹配（Cloudflare 版）

```
POST /api/chat  {"mode":"jd","jd":"…"}     或  POST /api/jd  {"jd":"…"}
→ {match:{overall:{score,verdict,summary}, stats:{covered,partial,gap},
          rows:[{req,status,evidence:[{point,title,id}],gap,probe}]},
   meta:{requirements,recalled,judge:"model"|"auto",ms}}
```

链路：拆需求点（去序号/去重、丢「任职要求」这类标题行）→ 逐条混合检索（闸门放宽到 1，JD 要召回不要精筛）
→ 一次 LLM 调用判完所有需求点（covered / partial / gap，片段带 id）→ 失败回退确定性判定 → 打分。

**为什么最终用模型判定**：先试了纯词面判（覆盖率 / IDF 加权 / 稀有词 df≤3），
在这份 42 片的小语料上 df 完全不可靠（`审计` 只出现 1 次也被当专业词，`企业` df=2 却占了高权重），
同一份 Agent JD 分数在 21 → 48 → 72 → 28 → 55 之间反复横跳；财务 JD 一度被抬到 44/55 分。
改成「一次调用 + 严格 JSON」后：Agent JD 83（5 覆盖 / 3 部分 / 0 缺口），财务 JD 22（0 覆盖 / 2 部分 / 3 缺口）。

确定性判定保留为兜底（`meta.judge='auto'`），词频表 `kb_terms`（1610 词，随切片重建）也保留，
后续 rerank 与「缺口推荐补材料」还会用。

### 7.9 按 JD 生成简历变体（P2 第一步：选材）

```bash
node scripts/plan_variant.mjs   --jd jd.txt --slug agent-2026   # 选材单
node scripts/render_variant.mjs --slug agent-2026               # 渲染变体
HTML_PATH=variants/agent-2026.html node scripts/check_resume_pages.mjs --info  # 页数
```

选材逻辑：JD 当查询在 42 片切片里跑 BM25，按 `score ≥ 最高分 × 0.15` 保留；
每段经历保底 2 条、最多 3 条 bullet，项目最多留 4 个、每个最多 3 条（2 页版面预算）。

**为什么选材和改写拆两步**：选材是可控的（同一 JD → 同一份单子，可 diff 可审），
改写交给 AI 单独一步，失败了只影响措辞，不会动到公司名/时间这类 L0 字段。

**铁律由代码兑现，不靠提示词**：变体复用 `templates/resume.template.html`（样式零差异），
渲染前后逐字段比对 `basics / education / 公司全称 / 岗位名 / 起止时间 / 项目名`，
任一处变化直接 `exit 2` 并且不产出文件；有经历被删空也会红掉。

实测（Agent JD）：22 → 16 条 bullet，项目 3/3，变体 PDF **2 页**，L0 全部未变。
**技能重排（纯算法）**：技能组 id 就是切片 id（skill-01…05），选材单里按 JD 命中度排好序，
渲染时只换顺序、文案一个字不改。Agent JD 下顺序变为 `数据与中间件 → 开发语言 → Agent 框架 → Agent 工程化 → AI 驱动编程`。

**简介改写（模型 + 四道护栏）**：`scripts/rewrite_summary.mjs --slug <name>`
调用 llama-3.3-70b 只改 `resume.summary.html`，护栏全部由代码判：
① 数字守恒（输出里的数字必须全部来自原文，出现新数字直接拒收）
② 篇幅 ≤220 字
③ 英文术语保留率 ≥70%（防止把 Agent/RAG 写成中文）
④ **语义块召回 ≥60%**：原文按 `；，、` 切块逐块算 bigram 覆盖，定位短语（如「红杉系初创 + 金融头部 AI 主力」）被删掉就红掉。

实测踩到的坑：第一版只查数字+英文，模型把「红杉系初创 + 金融头部 AI 主力」整段删了但检查全绿；加了语义块召回后拒收，第二版保住该短语（155 字）。

合并：`render_variant` 自动读 `variants/<slug>.summary.json`，只接受纯文本（标签全转义）且 ≤220 字，
超了或为空就沿用原文简介。实测变体仍 **2 页**，L0 校验通过。

