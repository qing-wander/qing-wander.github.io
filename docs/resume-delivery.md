# 留言板 + 简历投递（Cloudflare Pages Functions + D1 + Resend）

> 状态：现行 · 最后核对 2026-11-25
> 本文管两条链路：**留言板**（按设备隔离的私密留言本）与**简历投递**（把简历发到指定邮箱）。
> 二者的共同前置是 D1（业务数据）与 Resend（发信）；KV 只在投递限额与登录票据里还有少量用途。

> **投递方向**：浏览简历的人 → 收件人（他自己 / 同事 / 指定人）。
> 访客填收件人邮箱，系统把「陈培胜的在线简历」发到该邮箱，收件人点链接即可查看，
> 不需要下载附件。**不是**把访客邮箱发给站长；站长如需备案可配 `DELIVER_BCC`。

## 做了什么

| 功能 | 页面 | 前端调用 | 后端 |
|---|---|---|---|
| 留言板（按设备隔离） | `index.html` SEC.10 | `GET /api/wall`（分页 / `peek`）、`POST /api/wall`（留言 / 追问）、`DELETE`（应急） | `functions/api/wall.js` · **D1** |
| 简历自动投递 | `resume.html` | `GET /api/challenge` → `POST /api/deliver-preview` → `POST /api/deliver` | `functions/api/deliver*.js` · D1 + Resend |
| 学历核验 | `school.html` | `POST /api/verify-access` → 邮件审批 → `GET/POST /api/verify-access-approve` | `functions/api/verify-access*.js` · D1 + Resend |

函数代码都在 `functions/api/`，随静态资源一起部署到 Cloudflare Pages（`scripts/pages-build.sh` 会把
`functions/` 编进 Functions，并剔除 `functions/tencent`——那是腾讯云函数源码，不是 Pages 路由）。

**接口线路自适应**（`js/main.js` 的 `API_BASES`）：

| 页面打开位置 | API 请求地址 | 说明 |
|---|---|---|
| `chenpeisheng.cn`（主站） | 同源 `/api/*` | 正常路径，Functions 与页面同域 |
| `shenge-work.pages.dev`（平台域） | 同源 `/api/*` | 正常路径 |
| `shenge-work.github.io`（旧线路） | 直接打 `https://shenge-work.pages.dev/api/*` | GitHub Pages 没有 Functions，已列入 CORS 白名单 |
| `localhost` / `127.0.0.1` | 只打本机 | 避免本地测试真的写进线上数据 |

同源请求若返回 404 / 405 / 非 JSON（静态主机把 `/api/*` 当文件返回），会自动切到下一条线路；两条都不可用时，留言板显示「暂未开放」、投递弹窗展示 mailto 兜底（收件人已填好）。

### 留言板接口语义（2026-11-25）

留言板按 `X-Device-Id`（前端 `localStorage` 里的 UUID，服务端只存 HMAC 后的 `device_hash`）分区：
**每条留言只对写入它的设备可见**，这是隐私分区，不是安全认证（清缓存 = 新设备，ID 可伪造）。

| 请求 | 返回 | 前端用途 |
|---|---|---|
| `GET /api/wall?limit=20&offset=0` + `X-Device-Id` | `{ok, open, messages, total, limit, offset, hasMore}`，每条带 `replies` 对话 | 首屏 / 刷新；`limit` 1–50，默认 20 |
| `GET /api/wall?peek=1` | `{ok, open, total, latest:{id,ts}, latestReply}` | 每 60 秒轻量轮询（不传正文），有新留言 / 站长回复时提示 |
| `POST /api/wall {name?, text}` | 本设备第一页数据（`201`）；重复提交 `duplicate:true` | 提交后立即刷新并高亮自己的留言 |
| `POST /api/wall {replyTo, text}` | 同上（追加一条访客追问） | 在留言下「评论 / 追问」，站长回复也在这个 `replies` 里 |
| `DELETE /api/wall {id}` + `X-Admin-Token` | 删除后的第一页 | 站长应急删除；正式入口在后台「留言审核」 |
| 未绑定 D1 | `open:false, reason:"db_not_bound"` | 前端显示「暂未开放」；`?wallDebug=1` 可看诊断 |
| 缺少设备 ID | `open:true, reason:"device_required"` | 前端提示设备识别不可用 |

前端交互：每页 20 条 + 加载更早、手动刷新、页面可见时 60 秒轮询、相对时间（悬停看精确时间）、
`⌘/Ctrl + Enter` 提交、字数计数（300 字）、加载骨架 / 网络失败可重试、成功失败 Toast 分色、
本次会话自己的留言标「· 我」；多行留言保留换行。站长在 `/admin` 回复后，访客端靠 `peek` 的
`latestReply` 收到「站长回复了你」。

> **线上当前状态（2026-11-19 起）**：留言板与访问计数已从 Workers KV 迁到 D1（`portfolio-db`），
> 表结构见 `db/schema.sql`。`./scripts/wall-check.sh` 11/11 全过。
> KV 仍绑定为 `SITE_KV`，供投递限额与登录票据使用，**不再是留言存储**。


### 新留言邮件通知（2026-11-22 · Resend）

留言一旦**真正写库成功**，就给站长发一封通知邮件；校验失败 / 重复提交 / 限流 / 填写不完整一律不发。

| 项目 | 实现 |
|---|---|
| 触发点 | `functions/api/wall.js` 的 `onRequestPost`，在 `INSERT` + `upsertDevice` + `trim` 之后 |
| 发信模块 | `functions/lib/wall-notify.js`（纯函数构造邮件 + 单一 `fetch` 出口） |
| 收件人 | 默认 `hi@chenpeisheng.cn`，可用 `WALL_NOTIFY_TO` 覆盖；当前 Resend 未验证域名，`onboarding@resend.dev` 只能发给注册邮箱 |
| 发件人 | 复用 `RESEND_FROM`；想单独设置可用 `WALL_NOTIFY_FROM` |
| 邮件内容 | 称呼、北京时间、来源域名、设备哈希、留言 ID、完整正文（保留换行）、后台入口；访客输入全部 HTML 转义 |
| 不阻塞访客 | 线上走 `ctx.waitUntil` 挂后台任务，响应立即返回；本地 dev server 没有 ctx 时直接 await |
| 失败策略 | 无 key / 收件人非法 / Resend 报错 / 网络异常 → 只写日志，留言接口照常 `201`，不做重试（避免重复通知） |

> 留言墙本身已有每 IP 与全站日额度限制，通知复用同一道门，不再额外限流；Resend 免费额度 100 封/天，远高于留言墙的 30 条/天上限。
> 测试：`node --test tests/wall-notify.test.mjs`（mock Resend，不真发信），覆盖转义、收件人覆盖、无 key、Resend 报错、成功写入才发信、重复提交不重复发、`waitUntil` 后台执行。

**架构为什么这样选**：
- GitHub Pages 只出静态文件，没有后端——两个 API 都部署在 **Cloudflare Pages（shenge-work.pages.dev）**，国内可达、免费额度足够；
- 发信走 Resend：调用发生在 Cloudflare 节点（无墙），API key 只放 Cloudflare 环境变量，前端代码永不接触；
- 收件人是访客临时填写的**任意邮箱**，因此 Resend 必须配好**已验证域名**（见 ①b）；
  未验证时只能发给 Resend 账号自己的邮箱，接口会返回 `recipient_not_verified`，前端自动切到
  访客本机的邮箱客户端（mailto，收件人已填好），功能不中断。

## 站长需要做的一次性配置（约 10 分钟）

> **进度（2026-11-17）**：① 注册 / API Key、③ 环境变量、④ 部署均已做完，**只剩 ①b 验证发信域名**。
> Cloudflare Pages 项目 `shenge-work` 的 Production 已配置 `RESEND_API_KEY`（Secret）、
> `RESEND_FROM=Portfolio Resume <onboarding@resend.dev>`、`ALLOWED_ORIGINS`（含主站 / 备站 / 本地 8877），
> 并保留 `SITE_KV` 绑定；变量修改后用 Cloudflare 的 **Retry deployment** 重新部署生效。
> API Key 用的是 Resend onboarding 自动生成的「仅发信」受限 key（最小权限，不能读邮件 / 管域名）。
>
> 实测：`POST /api/deliver` → 账号邮箱 `hi@chenpeisheng.cn` 返回 `201 {"ok":true,"id":"01a1e59e-…"}`；
> 发给其他邮箱被 Resend 以 403 拒绝，接口返回 `recipient_not_verified`，前端按设计切到 mailto 兜底。
> **结论**：自动发信链路已通，但要让访客填任意邮箱都能收信，必须完成 ①b 并把 `RESEND_FROM`
> 改成 `陈培胜简历 <resume@已验证域名>`（改完需再次重新部署）。
>
> **2026-11-17 站长决定：暂不配置域名**。当前保持「自动发信仅支持 `hi@chenpeisheng.cn`、
> 其他邮箱走 mailto 兜底」的模式；以后要开放任意收件人，只需做 ①b + 改 `RESEND_FROM` + 重新部署，
> 无需改动任何代码。

### ① 注册 Resend（2 分钟）· ✅ 已完成

1. 打开 https://resend.com/signup ，用 Google 账号（建议直接用 hi@chenpeisheng.cn）注册；
2. 进入 Dashboard → **API Keys** → `Create API Key`，名字随意（如 `portfolio-deliver`），权限选默认的 `Full access`；
3. 复制 `re_` 开头的 key（**只显示一次**），先存到本地记事本。

### ①b 验证发信域名（要让任意收件人收到，必须做）· ⏸ 站长决定暂缓

> 当前 Cloudflare 账号下没有任何 zone，Pages 项目也只有 `shenge-work.pages.dev`，GitHub Pages 未绑自定义域名：
> 需要先有一个自有域名（任意注册商均可），才能做这一步。

1. Resend Dashboard → **Domains** → `Add Domain`，填你已有的域名（如 `shenge.dev`），按提示加 DNS 记录（SPF / DKIM，通常 5 分钟生效）；
2. 验证通过后，把 Pages 环境变量 `RESEND_FROM` 设为 `陈培胜简历 <resume@你的域名>`；
3. 没做这步也能用：访客会看到「用邮箱客户端发送」的兜底按钮。

> 想省事也可以先用免费测试模式（`onboarding@resend.dev` + 收件人只能是 Resend 注册邮箱），
> 但访客填自己邮箱时会被 Resend 拒绝，只能走 mailto 兜底。

### ② Cloudflare Pages 绑定 D1 与 KV（3 分钟）· 留言能否用就看这一步

> ✅ **已完成**：D1 `portfolio-db` 以 `DB` 绑定、KV `site-kv` 以 `SITE_KV` 绑定，均挂在
> `shenge-work` 的 Production 环境。以下保留为重建 / 换账号时的操作记录。
> 绑定后必须**重新部署**才会生效（控制台会提示 "This change will take effect on the next deployment"）；
> 用 `./scripts/wall-check.sh` 验证。

1. **D1**：`npx wrangler d1 create portfolio-db`（或在控制台 Storage & Databases → D1 新建），
   记下 `database_id`，按 [wrangler.toml](../wrangler.toml) 的 `[[d1_databases]]` 填好；
   执行建表与种子：`bash scripts/db-init.sh remote`。
2. **KV**：Storage & Databases → Workers KV → 新建 `site-kv`，记下 namespace ID，
   填到 `wrangler.toml` 的 `[[kv_namespaces]]`。
3. **绑定**：Workers & Pages → 项目 `shenge-work` → **Settings → Bindings**（Production 环境）：
   - `+ Add` → **D1 database** → Variable name **`DB`** → 选 `portfolio-db`；
   - `+ Add` → **KV namespace** → Variable name **`SITE_KV`** → 选 `site-kv`；
   - 检索用的 `AI`（Workers AI）与 `VECTORIZE`（索引 `resume-kb`）**不在 Pages**，而在语义层 Worker
     `worker/kb/`（`resume-kb-api`），部署方式见 [cloudflare-pages-deploy.md §3](cloudflare-pages-deploy.md)。
4. **注意**：项目名是 `shenge-work`，不是 `shenge-work.pages.dev`。Preview 环境默认未绑定，
   预览部署的留言板会显示关闭态（刻意如此，避免测试数据混入生产）。


### ③ 配置环境变量（2 分钟）· ✅ 已完成

同在 `shenge-work` 项目 → **Settings → Variables and Secrets** → 添加：

| 类型 | 变量名 | 值 | 用途 |
|---|---|---|---|
| Secret | `ADMIN_SESSION_SECRET` | 32 字节以上随机串 | **必填**：后台会话签名（缺了谁都进不去） |
| Variable | `ADMIN_EMAILS` | `hi@chenpeisheng.cn` | **必填**：允许登录后台的邮箱白名单 |
| Secret | `DEVICE_HASH_PEPPER` | 32 字节以上随机串 | **必填**：设备指纹 HMAC（留言板 / 点赞 / 核验共用） |
| Secret | `VERIFY_ACCESS_SECRET` | 随机串 | **必填**：学历核验审批链接签名 |
| Secret | `DELIVER_CHALLENGE_SECRET` | 随机串 | **必填**：投递凭证签名 |
| Secret | `RESEND_API_KEY` | `re_...`（①里拿到的） | 发信（验证码 / 通知 / 投递）；不配则投递走 mailto 兜底 |
| Variable | `RESEND_FROM` | `陈培胜简历 <resume@你的已验证域名>` | 发件人；不配则用 `onboarding@resend.dev`（只能发注册邮箱） |
| Variable | `WALL_NOTIFY_TO` | 如 `hi@chenpeisheng.cn`（可选） | 留言通知收件人；不配默认 Resend 注册邮箱 |
| Variable | `WALL_NOTIFY_FROM` | 如 `Portfolio Wall <onboarding@resend.dev>`（可选） | 留言通知单独指定发件人；不配复用 `RESEND_FROM` |
| Variable | `DELIVER_BCC` | 如 `hi@chenpeisheng.cn`（可选） | 站长收一份投递备案，不配则完全不经手 |
| Variable | `ALLOWED_ORIGINS` | `https://chenpeisheng.cn,https://shenge-work.pages.dev,*.shenge-work.pages.dev` | 跨域白名单 |
| Variable | `WALL_ADMIN_TOKEN` | 自拟一串随机字符（如 32 位） | 留言应急删除令牌（可选） |
| Secret | `TURNSTILE_SECRET` | Turnstile widget「shenge-work-portfolio」私钥 | 人机校验（可选；未配则全部按非严格档限流） |

> Secret 类型选「**Secret**」而不是「Text」，加密存储。
> 配完点 `Save`。**Pages 变量/KV 绑定修改后需要重新部署才生效**（重新跑一次部署脚本，或 Pages 控制台 Deployments → … → Retry deployment）。

### ④ 部署并验证（3 分钟）· ✅ 已完成

```bash
git push                      # 主链路：Cloudflare Pages 自动构建
./scripts/deploy-pages.sh     # 兜底：按本地工作区直传（含 functions/api）
```

> 变量或绑定变更后必须产生一次新部署才生效：push 一个空提交，或在控制台
> Deployments → … → **Retry deployment**；只有函数代码改动才需要完整上传。

验证清单（浏览器直接访问）：

| 检查 | URL / 操作 | 预期 |
|---|---|---|
| 一键自检 | `./scripts/wall-check.sh` | 只读检查 open / 分页 / peek / CORS；失败时打印 D1 绑定指引 |
| 留言板读取 | `https://chenpeisheng.cn/api/wall`（带 `X-Device-Id`） | `{"ok":true,"open":true,"messages":[...],"total":N,"hasMore":...}` |
| 留言提交 | 主页滚到 SEC.10 留言板 → 填写提交 | 列表立即出现新留言并高亮；`⌘/Ctrl + Enter` 也可提交 |
| 留言通知 | 提交一条真实留言 | 站长邮箱几秒内收到「【留言板】…」；重复提交不重复发 |
| 站长回复 | `/admin` → 留言审核 → 回复 | 访客端 60 秒内出现「站长回复了你」 |
| 加载更早 | 本设备超过 20 条时点「加载更早的留言」 | 每次追加 20 条（单设备上限 20 条，旧的自淘汰） |
| 投递预览 | `resume.html` → 自动投递 → 先点「预览」 | 预览内容与实际发出的邮件一致 |
| 投递发信 | 填收件人提交 | 收件人收到带 PDF / 证书附件的邮件（未验证域名时仅账号邮箱可收） |
| 多收件人 | 收件人填 `a@x.com, b@y.com` | 一封邮件同时到达两人（最多 3 个） |
| 兜底 | 未配置 key / 域名未验证时提交 | 弹窗底部出现「用邮箱客户端发送」mailto，收件人已填好 |

### ⑤ 线上自检小贴士

- 投递接口有 PoW 凭证，**不要**用裸 `curl` 直接 POST `/api/deliver`（会返回 `challenge_required`）；
  验证发信请走页面，或先 `GET /api/challenge` 拿凭证再提交；
- 返回 200 但内容是 HTML，说明 Functions 没随部署生效（重新 push 或跑部署脚本）；
- 留言板专项自检：`./scripts/wall-check.sh`，只读、不写数据；
  `./scripts/wall-check.sh --post --admin-token=<WALL_ADMIN_TOKEN>` 会提交一条测试留言并自动删掉；
- 浏览器里打开主页并加 `?wallDebug=1`，会显示当前 API 线路、HTTP 状态、`open`、`reason` 与修复提示；
- `./scripts/deploy-pages.sh` 部署结束会自动打印 `/api/wall open=...`，绑定漏了当场就能看见；
- 数据备份：`./scripts/backup-d1.sh` 导出 SQL 快照到 `~/.local/share/shenge-work/d1-backups/`（保留最近 10 份）。

## 本地自测（不用联网、不碰线上数据）

```bash
node scripts/dev-api-server.mjs              # 静态站 + 真实 functions/api + node:sqlite 模拟 D1 + 模拟 Resend
WALL_SEED=45 node scripts/dev-api-server.mjs # 预置 45 条「本设备」留言，验收分页
PORT=8878 WALL_NO_DB=1 node scripts/dev-api-server.mjs  # 模拟「线上忘了绑定 D1」的关闭态
./scripts/wall-check.sh http://127.0.0.1:8877           # 本地接口自检
# 打开 http://127.0.0.1:8877/index.html?wallDebug=1 与 /resume.html 手动点一遍
```

联调服务器默认带一个本地管理令牌 `local-admin-token`（可用 `WALL_ADMIN_TOKEN` 覆盖），并用 `node:sqlite` 内存库模拟 D1，所以固定窗口限流到期解锁也能测；想验「Turnstile 未通过→严格档」就加 `TURNSTILE_SECRET=test` 起服务。Resend 发信在本地被拦截成日志：提交留言后终端会打印 `[mock resend]`，其中 `subject` 以「【留言墙】」开头的就是新留言通知（`MOCK_RESEND=unverified` 可模拟被拒，留言仍会成功）。注意 `本地预览.command` 起的是 8765 纯静态服务，**没有 `/api`**；页面会提示改用 8877 联调服务器。

已回归的点：留言 GET/分页/peek/POST/重复提交/固定窗口限流/换行与 emoji 截断/来源校验/管理员删除；转发接口的收件人解析（多收件人、去重、格式校验、最多 3 个）、Reply-To、主题与正文、每收件人/每 IP/全站限额；未配置与域名未验证两种情况的 mailto 兜底；移动端 320–390px 布局。

## 日常使用

**查看留言**：主页 SEC.10（只看本设备写的内容；最新在前，每页 20 条，单设备最多保留 20 条）。点「↻ 刷新」看最新；页面开着时每 60 秒自动探一次，有新留言或站长回复会提示。时间显示相对值，鼠标悬停看精确时间。

**站长回复**：进 `/admin` → 留言审核 → 选一条 → 回复。访客无需刷新页面，60 秒内会看到「站长回复了你」；邮件里的「打开后台直接回复」用 `?focus=<留言 id>` 直达那一条。

**删除一条留言**：日常走 `/admin` → 留言审核 → 隐藏 / 删除；应急时可用 `WALL_ADMIN_TOKEN`：

```bash
curl -X DELETE https://chenpeisheng.cn/api/wall \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: <你的 WALL_ADMIN_TOKEN>" \
  -d '{"id":"wxxxxx"}'
```

（id 在留言卡左上角 `#` 后面。）

**转发出去的邮件长什么样**：主题「陈培胜 · AI Agent 工程师 · 在线简历（某某 转发）」，正文为纸感卡片：开头说明「无需下载附件，点按钮看完整简历」+ 转发人/回复地址/收件人 + 附言块（若有）+ 两个按钮（主/备线路在线简历）+ 页脚。访客填了自己的邮箱时，Reply-To 即该邮箱——收件人直接回复就能联系到转发人。

**站长要不要收到副本**：默认完全不经手。需要备案时配 `DELIVER_BCC`，每封转发都会密送一份给你。

## 容量与安全

**留言板**（数值取自 `functions/api/wall.js` 顶部常量）

- 单设备保留 **20 条**（超出滚掉自己最旧的），全站兜底 500 条（只控库体量，不按人裁剪）；
- 限流：每 IP 每 10 分钟 3 条、全站每天 30 条；Turnstile 未通过或脚本没加载时进严格档：
  每 IP 每小时 1 条、全站每天 10 条；
- 追问 / 评论：单条留言最多保留 20 条对话；每 IP 每 10 分钟 6 条、全站每天 40 条；
- 重复判定：5 分钟内同设备相同「称呼 + 内容」直接返回现有列表，不再计数；
- 正文上限 300 字（按 Unicode 码点，emoji 算 1 个），称呼 16 字；
- 设备隔离只存 `HMAC(device_id + DEVICE_HASH_PEPPER)`，不存原始 ID、不存 IP 明文；
- 历史留言（迁移前写入）`device_hash='legacy'`，公开端不可见，只在后台可见。

**投递**（数值取自 `functions/api/deliver.js` 顶部常量）

- 每个收件人每天 2 封、每 IP 每小时 3 封 / 每天 5 封、全站每小时 12 封 / 每天 30 封；
- 收件人最多 3 个并逐个校验；附言 500 字、JD 4000 字；单个附件上限 12MiB；
- 必须先取 `/api/challenge` 凭证（绑定来源 + IP + 用途，15 分钟过期 + PoW），裸脚本无法直接调用。

**内容净化**：保留换行与组合 emoji（按码点截断），剔除控制字符 / 零宽 / 双向控制符，
连续空行收敛，前端渲染统一 escape。

## 排障：留言板显示「暂未开放」

| 现象 | 原因 | 处理 |
|---|---|---|
| `/api/wall` 返回 `open:false, reason:db_not_bound` | Pages 未绑定 `DB`（D1）或库未建表 | 按 ② 绑 `DB` → `bash scripts/db-init.sh remote` → 重新部署 |
| `/api/wall` 返回 `open:true, reason:device_required` | 浏览器禁用了 localStorage / 未带 `X-Device-Id` | 换正常浏览器；确认 `main.js` 未被拦截 |
| 返回 200 但内容是 HTML | `functions/api` 没随站点部署 | 重新跑 `./scripts/deploy-pages.sh` |
| 提示「本地静态预览没有留言 API」 | 用的是 `本地预览.command` 的 8765 纯静态服务 | 改用 `node scripts/dev-api-server.mjs`（8877） |
| 提交 403 `origin_not_allowed` | 来源不在 `ALLOWED_ORIGINS` | 补白名单，或自检时用 `ORIGIN=` 指定 |
| 提交 429 `rate_limited` | 触发每 IP / 每日限额 | 看响应的 `retryAfter`（秒），窗口结束自动清零 |
| 列表一直加载 / 加载失败 | 两条线路都没拿到 JSON | 打开 `?wallDebug=1` 看线路、HTTP 状态与 `reason` |

`GET /api/wall` 只读无副作用，可直接用浏览器打开确认（需带 `X-Device-Id`）；`POST` 会写数据，自检脚本要显式加 `--post` 才会触发。

