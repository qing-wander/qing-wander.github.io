# Cloudflare 免费资源盘点与落地记录

> 文档定位：记录「这个作品集站到底用得上 Cloudflare 哪些免费资源」的评估结论，
> 以及 2026-11-19 把访问计数、留言墙从 KV 迁到 D1 的实际改动与验收。
> 待办状态以 [TODO.md](TODO.md) 为唯一台账（本文对应 T16）；部署链路见
> [cloudflare-pages-deploy.md](cloudflare-pages-deploy.md)。

**最近更新：2026-11-19**（首次盘点 + T16 落地；同日追加 T17：留言墙接入 Turnstile 人机校验
+ D1 备份脚本，线上已验收）。

---

## 0. 一句话结论

站点的 Cloudflare 用量已经接近免费额度的「合理上限」：Pages 托管 + Functions + KV，缺的不是产品，
而是**一个自有域名**（因支付问题暂缓）。本轮把两处真实的额度瓶颈（KV 1,000 写/天、
第三方计数不可靠）改到 D1 上解决，全程未依赖域名。

---

## 1. 免费额度盘点（2026-11-19 核对官方文档）

| 产品 | 免费额度 | 本站用法 | 结论 |
|---|---|---|---|
| **Pages** | 静态请求与带宽不限；500 次构建/月；20,000 文件；单文件 ≤25MB；100 个自定义域 | 备链路托管（`shenge-work.pages.dev`），GitHub push 自动构建 | 够用，余量很大 |
| **Pages Functions** | 随 Workers 免费额度 | `/api/wall`、`/api/deliver`、`/api/visits` | 够用 |
| **Workers** | 100,000 请求/天（全账号共享）；10ms CPU/请求；100 个脚本 | 仅 `worker/` 里的计数 Worker（**未部署**） | 够用 |
| **KV** | 1GB；100,000 读/天；**1,000 写/天** | 仅 `SITE_KV` 给 deliver 做发信限额 | 写额度是硬瓶颈，已把大头迁走 |
| **D1** | 5GB 总量；单库 500MB；5,000,000 行读/天；**100,000 行写/天**；10 个库 | 新增 `portfolio-db`：计数、留言、限流 | 够用，写额度是 KV 的 100 倍 |
| **Durable Objects** | **免费计划已可用**（仅 SQLite 后端）：5GB / 500 万行读/天 / 10 万行写/天 | 暂未使用 | 代码注释里「需付费计划」是过期认知，已修正见 §3.4 |
| **R2** | 10GB 存储；100 万次写 + 1000 万次读/月；**出站免费** | 未使用 | **公开访问必须绑自定义域**：`r2.dev` 子域明确「非生产用」，有可变速率限制（秒级几百请求就 429）、带宽会被压、且不支持缓存/WAF，无域名前当不了图床 |
| **Cloudflare Registrar** | 成本价、无溢价、免费 WHOIS 隐私 | 未使用（无域名） | **被支付问题卡住** |
| **Email Routing** | 免费收信转发、无限别名 | 未使用（无域名） | 被域名卡住 |
| **Zero Trust Access** | 50 用户内免费 | 未使用 | 需自有域名才能保护 Pages 站 |
| **Turnstile** | 免费：**无限验证**、20 个 widget、每 widget 10 hostname，可独立使用（不必接 Cloudflare 网络） | 留言墙 POST 人机校验（2026-11-19 接入，见 §7） | **已用**，且是唯一「免费 + 不用域名 + 有真实安全收益」的产品 |
| **Web Analytics** | 免费、无 Cookie | 未使用（已有 Umami + Clarity） | 重复，不建议加 |
| **Cloudflare Tunnel** | 免费 | 未使用 | 本地联调需要外网时可用 |

不免费、容易误判的：**Cloudflare Images**（图片压缩/裁剪是付费产品，免费版无额度）、
**Workers AI**（有每日 Neuron 额度但中文质量与成本不可控，不适合替现有 RAG）。

---

## 2. 盘点时发现的三处真相（评估依据）

1. **自建计数从未上线**。`worker/index.mjs` + KV `VISITS`（id `78ccba…`）早就建好了，但
   `js/visitor-count.js` 注释写着 `workers.dev 域名在境内被墙，实测超时`，所以前端一直走
   第三方 `abacus.jasoncameron.dev`。KV `VISITS` 实测**全空**，印证从未被调用。
2. **第三方计数其实已经不可靠**。2026-11-19 实测
   `GET https://abacus.jasoncameron.dev/get/shenge-portfolio/visits` 返回
   `{"error":"Failed to get data. Try again later."}`，取不到任何历史值。
3. **两个 KV namespace 都是空的**（`site-kv` 与 `VISITS` 全空，`wall-check.sh` 曾 11/11 通过
   但测试留言已被清），因此迁库**无需迁移任何历史数据**。
   线上留言墙当时 `total:0`，与空库一致。

---

## 3. 本轮落地：计数与留言墙迁到 D1（T16）

### 3.1 为什么不是「绑自建域名」

原方案是给 Worker 绑 `visits.你的域名` 让自建计数复活，但域名需要付款，站长 2026-11-19 明确
**支付问题未解决、暂不购买域名**。因此改用等价方案：

> **把计数接口放到 Pages 项目自己的 `/api/visits`**。
> `shenge-work.pages.dev` 本来就是既有可用链路（README 明确写「国内访客只访问 pages.dev」），
> 函数与站点同域，既不依赖 `workers.dev`（境内被墙），也不依赖任何自有域名。

`github.io` 主站调用时是跨域，按既有白名单放行 CORS（`ALLOWED_ORIGINS` 已含 github.io）。

### 3.2 改动清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `db/schema.sql` | 新增 | `counters` / `visitors` / `wall_messages` / `rate_limits` 四表，幂等可重跑 |
| `functions/api/visits.js` | 新增 | `GET/POST /api/visits`，D1 存取，IP 限流 60 次/小时 |
| `functions/api/wall.js` | 改写 | KV 单条 JSON 数组 → D1 表；真 SQL 分页；并发不再互相覆盖 |
| `js/visitor-count.js` | 改写 | 默认 `provider: 'pages'`；`abacus` / `worker` 保留为可切换备选 |
| `scripts/dev-api-server.mjs` | 改写 | 加 `node:sqlite` 的 D1 适配层；新增 `/api/visits` 路由；`SEED` 改写 D1 |
| `scripts/wall-check.sh` | 改写 | 诊断文案 `kv_guide` → `db_guide`；识别 `db_not_bound` |
| `wrangler.toml` | 新增 | 根目录声明 `DB`(D1) 与 `SITE_KV`(KV)，仅供本地 wrangler 命令 |
| `worker/wrangler.toml` | 注释 | 标明「备用实现、当前未启用」及启用条件 |
| `.gitignore` | 补充 | 忽略 `.wrangler/`（本地 D1 模拟缓存） |

**没有改的**：`functions/api/deliver.js` 仍用 KV 做发信限额。理由是它的写量可控
（每封 3 写、日上限 30 封 ≈ 90 写/天），动线上发信链路的收益远小于风险。

### 3.3 数据表与关键设计

```sql
counters   (name PK, value)                     -- 'total' / 'visitors' 两行汇总
visitors   (id PK, first_seen, last_seen)        -- 180 天未活跃自动清理
wall_messages (seq AUTOINCREMENT, id UNIQUE, name, text, created_at)
rate_limits (bucket, window, count, expires_at, PRIMARY KEY(bucket, window))
```

- **计数原子性**：`UPDATE counters SET value = value + 1 ... RETURNING value`，
  不再有 KV「读改写非原子」的漂移。
- **限流原子性**：`INSERT ... ON CONFLICT DO UPDATE ... WHERE count < :limit RETURNING count`，
  未达上限才自增，被拒请求不写库、不会把访客永久锁死。**实测**：limit=2 时连续三次结果为
  `1`、`2`、`空行`（第三次被拒），行为正确。
- **踩过的坑（已修）**：访客去重最初写成 `INSERT ... ON CONFLICT DO UPDATE`，
  该写法即使 ID 已存在也会执行一次 UPDATE，`meta.changes` 恒为 1，会让「新访客」判断永远成立、
  `visitors` 随每次 PV 增长。已改为 `INSERT OR IGNORE` + 单独刷新 `last_seen`，本地与线上均验证
  同一访客第二次访问 `isNew:false`、`visitors` 不变。

### 3.4 一个过期认知的修正

`worker/index.mjs` 与旧 `wall.js` 的注释都写着「要严格精确得换 Durable Objects（付费计划）」。
实测官方文档：**Durable Objects 免费计划已可用**（仅限 SQLite 存储后端，
5GB / 500 万行读/天 / 10 万行写/天）。本轮没上 DO，是因为 D1 已满足需求且 SQL 分页更直接；
但以后做「实时在线人数」这类强一致单点状态时，可以直接用免费 DO，不必以为要付费。

### 3.5 部署与绑定（已执行）

```bash
# 1) 建库并建表（远端）
npx wrangler d1 create portfolio-db            # database_id: 022be169-a84e-4791-b2f2-ee4f9c4f17c8
npx wrangler d1 execute portfolio-db --remote --file=db/schema.sql

# 2) Pages 生产环境加 D1 绑定（variable name 必须是 DB）
#    PATCH /accounts/<id>/pages/projects/shenge-work
#    body: {"deployment_configs":{"production":{"d1_databases":{"DB":{"id":"022be169…"}}}}}
#    实测该 PATCH 是「合并」语义：SITE_KV 与 ALLOWED_ORIGINS / RESEND_API_KEY / RESEND_FROM 全部保留。

# 3) 推代码即部署（GitHub 集成主链路）
git push origin main                            # 427a12d → 部署 427a12db success
```

**注意**：预览环境（`<commit>.shenge-work.pages.dev`）**没有绑 D1**，行为与改动前一致
（留言墙 `open:false`）。不要为了预览去绑生产库，会污染真实数据。

### 3.6 验收记录

本地（`PORT=8878 node scripts/dev-api-server.mjs`，node:sqlite 内存库）：

| 项 | 结果 |
|---|---|
| POST 新访客 | `{"isNew":true,"total":1,"visitors":1}` |
| POST 同访客 | `{"isNew":false,"total":2,"visitors":1}` ✅ 去重生效 |
| POST 第二访客 | `visitors:2` |
| 非法 id | `400` |
| 留言提交 / 重复提交 | `201` / `{"duplicate":true,...}` |
| IP 限流（3 次窗口） | 第 4 次 `429` |
| peek / 分页 | 字段与 total 正确 |
| 单测 + 全量语法 | `node --test` 18/18 通过；所有 js/mjs `node --check` 通过 |

线上（`https://shenge-work.pages.dev`，2026-11-19）：

| 项 | 结果 |
|---|---|
| `GET /api/visits` | `200 {"ok":true,"total":0,"visitors":0}`（D1 未绑会返回 503 `db_not_bound`） |
| `POST /api/visits` ×2（同 id） | `total 1→2`、`visitors 1→1` ✅ |
| 非法 id / 非白名单 Origin | `400` / `403` |
| `GET /api/wall`、`?peek=1` | `open:true, messages:[], total:0`（证明 D1 绑定生效） |
| 主站静态文件 | `shenge-work.github.io/js/visitor-count.js` 已含 `provider: 'pages'` |
| 测试数据清理 | `visitors` / `rate_limits` 删除、`counters` 归零；复查 `total:0, visitors:0` |

> 留言墙**未在生产做 POST 验收**：线上未配置 `WALL_ADMIN_TOKEN`（见 TODO T6），
> 测试留言会永久留在公开墙面且删不掉。留言写入链路的验证在本地完成。

---

## 4. 域名缺口（暂缓，不是 bug）

站长 2026-11-17 已决定暂不配域名，2026-11-19 补充原因是**支付问题未解决**。
一个域名能同时解锁以下六件事，等支付方式就绪后按此顺序做：

| # | 动作 | 收益 |
|---|---|---|
| 1 | Registrar 买域名（成本价） | 地基 |
| 2 | Pages 绑自定义域 | 访问路径更稳、可备案、可套国内 CDN |
| 3 | Worker 绑 `visits.` 子域 | 自建计数可直接切回 `provider:'worker'`（D1 方案已是等价替代，非必需） |
| 4 | Zero Trust Access 保护管理端 | `*.pages.dev` 共享域不支持 Access，必须自有域名 |
| 5 | Resend 验证发信域名 | `/api/deliver` 从「只能发给自己」变成能发给任意 HR（TODO T1） |
| 6 | Email Routing | `hi@你的域名` 免费转发，投简历更体面 |

---

## 5. 回滚方案

按成本从低到高：

1. **只切前端（30 秒）**：`js/visitor-count.js` 里 `provider` 改回 `'abacus'`，计数立刻回到第三方；
   留言墙不受影响（它不依赖前端切换）。
2. **留言墙回滚**：`git revert 427a12d` 并 push，`wall.js` 回到 KV 版本。
   注意回滚后 KV 里仍是空库，行为与改动前一致（`open:true, total:0`）。
3. **彻底停用 D1**：Pages 项目 Settings → Functions → 删除 `DB` 绑定。
   此时 `visits` 返回 503 `db_not_bound`，`wall` 返回 `open:false, reason:db_not_bound`
   ——前端都会优雅降级（计数显示示例数字并注明「暂不可用」），不会报错白屏。
4. D1 库本身可以保留不删（5GB 免费额度，空库不消耗）。

---

## 6. 什么时候会再撞额度

| 场景 | 当前上限 | 触发信号 |
|---|---|---|
| 计数写入 | D1 10 万行写/天（≈ 10 万 PV/天） | 计数器不涨、`/api/visits` 返回 `db_error` |
| 留言提交 | D1 10 万行写/天 + 应用层 50 条/天 | 提交返回 429 |
| 发信限额（KV 残留） | KV 1,000 写/天 | 与计数无关，量级极小，基本不会撞 |
| Pages 构建 | 500 次/月 | 频繁 push 时注意，日常够用 |
| D1 存储 | 5GB（单库 500MB） | 留言裁剪 100 条 + 访客 180 天清理，实际只有几 MB |

按个人站流量估算，**这些额度十年也撞不到**，唯一真实的历史瓶颈（KV 1,000 写/天）已解除。

---

## 7. 留言墙人机校验（Turnstile，T17）

### 7.1 为什么选它，以及为什么先实测

清单里能同时满足「免费 + 不需要域名 + 有真实收益」的只有 Turnstile。留言墙原来只靠 IP 限流
（每 IP 10 分钟 3 条），代理池一刷就会写脏数据。

按项目既有规矩，**先实测再上线**（深圳本机，2026-11-19 04:5x）：

| 目标 | 结果 |
|---|---|
| DNS `challenges.cloudflare.com` | 104.18.95.41 / 104.18.94.41 |
| `turnstile/v0/api.js` 直取 | 302（正常，版本化跳转），0.65s |
| 跟随跳转到 `turnstile/v0/b/<hash>/api.js` | **200，86 KB，0.94s**，内容为 turnstile 脚本 |
| 连续 5 次 | 5/5 返回 200，耗时 1.07–1.25s |
| `siteverify`（服务端调用） | 400（参数无效属正常响应），0.57s |

结论：境内可用。**宽带与手机端均已实测通过**（手机端见 §7.6）。

### 7.2 widget 配置

| 项 | 值 |
|---|---|
| 名称 | `shenge-work-portfolio` |
| sitekey | `0x4AAAAAAGHnx0m992aGGpUJ`（公开值，写在前端无害） |
| secret | 只存 Pages 环境变量 `TURNSTILE_SECRET`（`secret_text` 类型） |
| mode | `managed`（大多数真人无感通过） |
| hostname | `shenge-work.github.io` / `shenge-work.pages.dev` / `localhost` |

免费版**不支持"任意 hostname"**，必须预先登记域名。预览部署（`<commit>.shenge-work.pages.dev`）
因此不在白名单里——但预览环境本来就没绑 D1（留言墙 `open:false`），不影响。

### 7.3 两档额度（核心设计）

| 情况 | 走的档位 | 额度 |
|---|---|---|
| 校验通过 | 正常档 `wall:ip:` / `wall:day` | 每 IP 10 分钟 3 条；全站每日 50 条 |
| 未带 token / 校验失败 | 严格档 `wall:ip:strict:` / `wall:day:strict` | 每 IP **每小时 1 条**；全站每日 **10 条** |
| 未配置 secret | 正常档 | 与接入前完全一致（向后兼容） |

两档用不同 bucket 名，避免刷子把正常访客的每日额度吃光。

**刻意 fail-open**：Turnstile 脚本哪天被墙或加载失败，widget 保持隐藏、提交不带 token，
留言仍然可用，只是降到严格档。宁可少挡一点刷子，也不能让正常访客彻底留言不了。
前端还会在 429 且 `verifyRequired:true` 时自动 `reset` widget，让访客能重新验证。

### 7.4 部署方式（不要整体 PATCH）

secret 用**单点写入**，别去 PATCH 整个 `deployment_configs`：

```bash
printf '%s' "$(cat /tmp/ts_secret.txt)" | npx wrangler pages secret put TURNSTILE_SECRET --project-name shenge-work
```

写入后复查：`env_vars` 里 `RESEND_API_KEY` 与 `TURNSTILE_SECRET` 两个 `secret_text` 都在，
`DB`(D1) 与 `SITE_KV`(KV) 绑定都在（已核对通过）。

**诊断标志**：`GET /api/wall` 现在多回一个布尔 `turnstile`（只报"是否已配置"，不暴露密钥）。
线上实测 `"turnstile":true`，说明 secret 已注入函数运行时。

### 7.5 验收记录

本地（`PORT=8878 node scripts/dev-api-server.mjs`）：

| 场景 | 结果 |
|---|---|
| 未配 secret，连发 4 条 | 201 / 201 / 201 / **429**（原额度，与改动前一致） |
| `TURNSTILE_SECRET=test`，不带 token 连发 | 201 / **429 `verifyRequired:true`** |
| 带假 token | **429**（校验失败 → 严格档） |

线上（`https://shenge-work.pages.dev`）：

| 项 | 结果 |
|---|---|
| 页面已带脚本与容器 | grep 命中 2 处（`challenges.cloudflare.com/turnstile` + `wallTurnstile`） |
| `GET /api/wall` | `"turnstile":true` |
| 无 token：IP-A 第 1 条 / 第 2 条 | 201 / **429 `verifyRequired:true, retryAfter≈2741s`** |
| 无 token：IP-B 第 1 条 | 201（新 IP，独立计数，符合设计） |
| 假 token | 429 |
| 测试数据 | 已清理，`total:0`（真实访问计数未动） |

### 7.6 两个踩坑 + 验证闭环

1. **部署后 Functions 生效慢于静态文件**。第一次测「无 token 连发」，第 1、2 条都 201
   （等于走了正常档），因为边缘还在跑旧函数；等部署 success 后约 2 分钟再测才正常。
   **教训**：验 Functions 行为，不能只看静态文件已更新。
2. **出口 IP 双栈切换会让严格档"看起来失效"**。复测时第 3 条又 201，查
   `SELECT bucket,count FROM rate_limits` 才发现有两个不同 IP hash
   （`a750973d2c829429`、`dceb71d4ffc05954`），IPv4 与 IPv6 各算一个 IP，各自允许 1 条。
   **这不是 bug**，是测试方法的假象；对真实访客影响有限（双栈最多给 2 条），且有
   `wall:day:strict`（每日 10 条）兜底。
3. **已补验（2026-11-19 05:20）**：站长在浏览器里真实发了一条留言，库里随即出现
   `wall:ip:6f85b7cf692090a9` 与 `wall:day`（**都不带 strict 前缀**），说明
   「渲染 widget → 拿 token → siteverify 通过 → 走正常档」这条完整链路成立，
   留言同时正常入库（`wmwmml7td31d0p`，11 字）。此前 curl 只能验证"未带 token 会降档"，
   这一条补上了"带真 token 会放行"的另一半。

**手机端复核（2026-11-19，已通过）**：站长用手机打开 `https://shenge-work.pages.dev/#wall`，
小组件正常显示，说明 `challenges.cloudflare.com` 在**移动网络**下同样可达，
不存在「境内只有宽带能加载 Turnstile」的顾虑。至此可达性、校验通过、未通过降档三条全部实测闭环。

---

## 8. D1 备份（T18）

`scripts/backup-d1.sh`：

```bash
./scripts/backup-d1.sh                  # 备份 portfolio-db
./scripts/backup-d1.sh portfolio-db     # 指定库
KEEP=20 ./scripts/backup-d1.sh          # 保留最近 20 份（默认 10）
```

- 输出到 `~/.local/share/shenge-work/d1-backups/<库名>-<时间戳>.sql`，**不进 Git**
  （含留言正文与访客哈希，属于访客数据）
- 实测一次：4.0 KB，4 张表，6 条 INSERT
- 自动清理超出 KEEP 的旧备份
- 需要 wrangler 已登录；脚本用 `--remote` 导出线上库（不是本地 `.wrangler` 模拟库）

为什么值得有：留言墙是唯一的用户产生内容，D1 免费层本身不做时间点恢复，
删错了就是没了。这个脚本是"能重来一次"的底线。

---

## 9. 可观测：Web Analytics 与 Umami 双路并行（T19）

### 9.1 为什么值得加第二路

现有统计只有 Umami Cloud 一家（10 万事件/月、1 个站点、6 个月留存）。单点风险有三：
额度打满就断档、被浏览器插件拦掉就归零、服务方哪天调整免费策略就全丢。

Cloudflare Web Analytics 免费、不限量、无 cookie，正好做兜底：它只看"有多少人来了、从哪来",
不参与事件体系，所以**不能替代 Umami，只能补位**。两路互相独立，任一路挂了另一路仍能看出量级。

### 9.2 实测可达性（先测再上）

| 目标 | 结果 |
|---|---|
| DNS `static.cloudflareinsights.com` | 104.16.80.73，ping 192ms |
| `beacon.min.js` 连续 5 次 | **5/5 HTTP 200，31,853B，0.60–0.94s** |

境内宽带可用。手机端与 Turnstile 共用同一套 Cloudflare 边缘，Turnstile 已在移动网络验过，
风险同源，未单独复测。

### 9.3 已做的代码改动

`js/analytics.js` 新增 `CONFIG.cfBeaconToken` 与 `loadCloudflareBeacon()`：
token 留空则**完全不加载、不发任何请求**（与 Umami/Clarity 的"留空即静默"一致）；
填入后注入 `beacon.min.js`，带 `data-cf-beacon` 的 token，脚本加载失败静默放弃，不影响另外两路。
`file://` 与 `localhost` 仍被统一跳过，不污染线上数据。

### 9.4 站点是怎么建的（以及 pages.dev 的坑）

wrangler 的 OAuth 登录态**没有 RUM/analytics 权限**，实测：

```
GET  /accounts/<id>/rum/site_info/list  → 10000 Authentication error
POST /accounts/<id>/rum/site_info       → 10000 Authentication error
```

`wrangler whoami` 的 scope 列表里也确实没有 analytics 相关项（有 `challenge-widgets.write`，
所以 Turnstile 能自动建、Web Analytics 不能）。要么在控制台点一次，要么另建一个带
"Account Analytics:Edit" 的 API Token —— 后者反而更绕。

**已在控制台建好（2026-11-19）**：`Analytics → Web Analytics → 添加站点` →
填 `shenge-work.github.io` → 进「管理站点」取 snippet 里的 token。

| 项 | 值 |
|---|---|
| 站点 | `shenge-work.github.io` |
| token | `e8d13ee29814404299a92efbdea4b73e`（公开值，写在页面里无害） |
| 官方形态 | `<script type="module" src=".../beacon.min.js" data-cf-beacon='{"token":"..."}'>` |

**坑：`pages.dev` 建不了独立站点。** 给 `shenge-work.pages.dev` 单独 Add site 时，主机名填进去
「完成」始终置灰、一失焦就被清空 —— 该表单只接受账号下的 zone 域名，不接受 CF 自己的子域。
所以两个 host 共用这一个 token：beacon 从 `pages.dev` 上报同样返回 200，数据归到同一站点，
只是 host 维度只列出已登记的 `github.io`。

### 9.5 生效验证（已完成）

线上实测（2026-11-19，浏览器打开 `shenge-work.pages.dev` 抓网络请求）：

| 观察 | 结果 |
|---|---|
| `cloudflareinsights.com/cdn-cgi/rum` | 多次 OPTIONS + POST，状态全部 ok |
| `cloud.umami.is/script.js` | GET ok |

两路同时在跑，互不影响。CF 面板通常几分钟到几小时出数（不实时）；两边 PV 数字对不上是正常的
（CF 口径更严，剔除部分爬虫与预加载），不要当 bug 去修。

---

## 10. 备注

- 计数的历史值**没有迁移**：abacus 取数接口实测已返回 error，取不到原值，因此 D1 从 0 起算。
  这是有意接受的损失（原数字本身来自第三方、无法验证）。
- `shenge-blog.pages.dev`、`career-agent` 两个 Pages 项目与本文无关，未做任何改动。
- **R2 方案已废弃（2026-11-21）**：原计划把 `assets/character-views/` 归档到 Cloudflare R2 bucket
  `shenge-assets`，但当前账号（`ead07d9f…`，`shenge.work@gmail.com`）**无可绑定支付方式，R2 无法启用**，
  `wrangler r2 bucket list/create` 报 `10042 Please enable R2 through the Cloudflare Dashboard`，且无自助启用 API。
  `scripts/r2-sync.sh` / `scripts/r2-cors.json` 保留作历史参考，**当前不再使用**。视频
  `videos/lessie-demo.mp4`（9.8MB）仍在仓库、地址未改（低于 25MiB 上限，不受影响）。
- **改用飞书云盘归档（2026-11-21 已完成，见 [TODO.md T23](TODO.md)）**：`character-views/`
  57 文件 / 573MB 整目录归档到 `https://my.feishu.cn/drive/folder/BnalfpLM8lzNYLdkYu3cqH71nAc`，
  抽样 MD5 校验一致；已从 git 移除（本地文件保留），Pages 自动构建随之恢复。需重做模型时用
  `lark-cli drive +pull` 拉回。未做 git 历史瘦身（filter-repo 强推，破坏性）。
- **连带故障 T22 已随之根治**：素材移出仓库后，构建命令 `cp -r ... assets ... dist/` 不再碰到大文件，
  `pages.dev` 自动构建从连续 `Failure` 恢复为 `Success`，两站内容一致（11-20 曾先用
  `deploy-pages.sh` 直传止血）。详见 [cloudflare-pages-deploy.md 故障节](cloudflare-pages-deploy.md)
  与 [TODO.md §3.18](TODO.md)。
