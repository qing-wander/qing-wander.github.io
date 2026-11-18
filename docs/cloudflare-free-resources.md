# Cloudflare 免费资源盘点与落地记录

> 文档定位：记录「这个作品集站到底用得上 Cloudflare 哪些免费资源」的评估结论，
> 以及 2026-11-19 把访问计数、留言墙从 KV 迁到 D1 的实际改动与验收。
> 待办状态以 [TODO.md](TODO.md) 为唯一台账（本文对应 T16）；部署链路见
> [cloudflare-pages-deploy.md](cloudflare-pages-deploy.md)。

**最近更新：2026-11-19**（首次盘点 + T16 落地，线上已验收）。

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
| **R2** | 10GB 存储；100 万次写 + 1000 万次读/月；**出站免费** | 未使用（视频 9.8MB 在仓库内，Pages 限制内） | 可选项，非必需 |
| **Cloudflare Registrar** | 成本价、无溢价、免费 WHOIS 隐私 | 未使用（无域名） | **被支付问题卡住** |
| **Email Routing** | 免费收信转发、无限别名 | 未使用（无域名） | 被域名卡住 |
| **Zero Trust Access** | 50 用户内免费 | 未使用 | 需自有域名才能保护 Pages 站 |
| **Turnstile** | 免费不限量 | 未使用（留言墙靠 IP 限流） | 被刷再加 |
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

## 7. 备注

- 计数的历史值**没有迁移**：abacus 取数接口实测已返回 error，取不到原值，因此 D1 从 0 起算。
  这是有意接受的损失（原数字本身来自第三方、无法验证）。
- `shenge-blog.pages.dev`、`career-agent` 两个 Pages 项目与本文无关，未做任何改动。
- 后续若要接 R2：优先搬 `videos/lessie-demo.mp4`（9.8MB，`.git` 已 24MB），
  但 Pages 单文件 25MB 限制内、带宽不限，属于「工程卫生」而非「必须」。
