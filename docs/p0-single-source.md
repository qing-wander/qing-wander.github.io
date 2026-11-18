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
| GET | `/api/wall?limit&offset` | 只返回本设备 `status='visible'` 的留言 |
| GET | `/api/wall?peek=1` | 本设备总数 + 最新一条（轮询用） |
| POST | `/api/wall` | 绑定当前设备写入；被拉黑设备返回 403 |
| DELETE | `/api/wall` + `X-Admin-Token` | 站长应急删除 |
| GET | `/api/admin/wall/devices` | 设备列表（留言数 / 最近活跃 / 状态） |
| GET | `/api/admin/wall/messages` | 全部留言，可按 `device_hash` / `status` 过滤 |
| GET | `/api/admin/wall/export` | 导出 CSV（留言 + 设备两段） |
| POST | `/api/admin/wall/messages/<id>/status` | `{status:"hidden"｜"visible", note}` |
| POST | `/api/admin/wall/devices/<hash>/block` | `{blocked:true｜false, note}` |

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

地址：**https://shenge-work-admin.pages.dev** · 独立 Pages 项目，与公开站共用同一个 D1 `portfolio-db`。

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

- 口令登录 → HMAC-SHA256 签名的 `pa_sess` cookie（HttpOnly / Secure / SameSite=Lax，12 小时）
- 登录限流：同 IP 15 分钟 8 次，落 `rate_limits` 表
- 写操作三重校验：SameSite + `X-Admin-Request: 1` 自定义头 + Origin 同源
- 会话签名不建表，零存储成本；换 GitHub OAuth 时只改 `functions/api/auth/login.js`，
  `isAdmin()` 的判定换成语种即可
- 应急通道：`X-Admin-Token == WALL_ADMIN_TOKEN` 仍可用（脚本/自检走这条）

### 接口

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/auth/login` | 口令换 cookie |
| POST | `/api/auth/logout` | 清 cookie |
| GET | `/api/auth/me` | 前端判断登录态 |
| GET | `/api/stats` | PV / UV / 24h UV / 设备数 / 留言数 / 今日新增 / 隐藏 / 拉黑 |
| GET | `/api/devices` | 设备台账（首见、最近活跃、留言数、最近一条、状态） |
| GET | `/api/messages` | 留言审核（按设备 / 状态 / 关键词过滤） |
| POST | `/api/messages/status` | 隐藏 / 恢复 |
| POST | `/api/devices/block` | 拉黑 / 解封 |
| GET | `/api/export` | 导出 CSV（留言 + 设备两段） |

### 部署与密钥

```bash
cd admin && npx wrangler pages deploy --branch main
```

项目密钥（已配置）：`ADMIN_PASSWORD`、`ADMIN_SESSION_SECRET`、`WALL_ADMIN_TOKEN`。
本地值存在仓库根的 `.secrets.local`（已 gitignore），后台开发用 `admin/.dev.vars`。

## 8. 未做 / 待办

- [x] 后台 UI（设备台账 + 留言审核 + CSV 导出）
- [x] 真页数校验（无头 Chrome 打 PDF 数页数，CI 拦住 >2 页）：`scripts/check_resume_pages.mjs`
      —— 实测当前 resume.html 打出来正好 2 页
- [ ] RAG：切片（按 bullet id）、Vectorize 索引、问答、JD 匹配、动态简历变体
- [ ] 跨设备查看（设备绑定码）
- [ ] `resume.micro` 微调流水线（L0 锁定字段注入提示词）
