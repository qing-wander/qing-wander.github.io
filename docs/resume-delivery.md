# 留言墙 + 简历转发（Cloudflare Pages Functions + Resend）

2026-11 新增的两个交互能力的后端与上线指引。

> **简历转发方向**：浏览简历的人 → 收件人（他自己 / 同事 / 指定人）。
> 访客填收件人邮箱，系统把「陈培胜的在线简历」发到该邮箱，收件人点链接即可查看，
> 不需要下载附件。**不是**把访客邮箱发给站长；站长如需备案可配 `DELIVER_BCC`。

## 做了什么

| 功能 | 页面 | 前端调用 | 后端 |
|---|---|---|---|
| 留言墙（公开） | `index.html` SEC.10 | `GET /api/wall`（分页 / `peek`）、`POST /api/wall`、`DELETE`（管理员） | `functions/api/wall.js` · KV 存储 |
| 简历转发到邮箱 | `resume.html` 「发简历到邮箱」按钮 | `POST /api/deliver {to, name?, email?, note?}` | `functions/api/deliver.js` · Resend 发信 |

两份函数代码都在仓库 `functions/api/`，随静态资源一起部署到 Cloudflare Pages（`scripts/deploy-pages.sh` / `scripts/sync-pages-from-github.sh` 已带上，会自动剔除 `functions/tencent`）。

两张前端页面都带**双线路自适应**：

| 页面打开位置 | API 请求地址 | 说明 |
|---|---|---|
| `shenge-work.github.io`（主站） | 直接打 `https://shenge-work.pages.dev/api/*` | GitHub Pages 只有静态文件，没有 Functions；已把 github.io 列入 CORS 白名单 |
| `shenge-work.pages.dev`（备份站） | 同源 `/api/*` | 正常路径，少一次跨域 |
| `localhost` / `127.0.0.1`（本地预览） | 只打本机，不回落线上 | 避免本地测试真的写进线上留言/发信 |

同源请求若返回 404 / 405 / 非 JSON（静态主机把 `/api/*` 当文件返回），会自动切到下一条线路；两条都不可用时，留言墙显示「暂未开放」、转发弹窗展示 mailto 兜底（收件人已填好）。

### 留言墙接口语义（2026-11 完善）

| 请求 | 返回 | 前端用途 |
|---|---|---|
| `GET /api/wall?limit=20&offset=0` | `{ok, open, messages, total, limit, offset, hasMore}` | 首屏 / 刷新；`limit` 1–50，默认 20 |
| `GET /api/wall?limit=20&offset=20` | 同上 | 「加载更早的留言」，墙上最多 100 条 |
| `GET /api/wall?peek=1` | `{ok, open, total, latest:{id,ts}}` | 每 60 秒轻量轮询（不传正文），有新留言时显示「有新留言 ▲」 |
| `POST /api/wall {name?,text}` | 第一页数据（`201`）；重复提交返回 `duplicate:true` | 提交后立即刷新列表并高亮自己的留言 |
| `DELETE /api/wall {id}` + `X-Admin-Token` | 删除后的第一页 | 站长删留言；未配置令牌时接口不暴露（404） |
| `GET /api/wall` 且未绑定 KV | `open:false, reason:"kv_not_bound"` | 前端显示「暂未开放」；`?wallDebug=1` 可看诊断 |

前端交互：每页 20 条 + 加载更早、手动刷新、页面可见时 60 秒轮询提示新留言、相对时间（悬停看精确时间）、`⌘/Ctrl + Enter` 提交、字数计数、加载骨架 / 网络失败可重试、成功失败 Toast 分色、本次会话自己的留言标「· 我」。多行留言的换行会保留。

> **线上当前状态（2026-11-16 已开放）**：`GET https://shenge-work.pages.dev/api/wall` 返回 `open:true`，KV namespace `site-kv`（ID `f5253a16b4d84a20a32c0cd497b1f269`）已以变量名 `SITE_KV` 绑定到 `shenge-work` 的 **Production** 环境，新版前后端也已随部署上线。`./scripts/wall-check.sh` 11/11 全过。

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
> 实测：`POST /api/deliver` → 账号邮箱 `shenge.work@gmail.com` 返回 `201 {"ok":true,"id":"01a1e59e-…"}`；
> 发给其他邮箱被 Resend 以 403 拒绝，接口返回 `recipient_not_verified`，前端按设计切到 mailto 兜底。
> **结论**：自动发信链路已通，但要让访客填任意邮箱都能收信，必须完成 ①b 并把 `RESEND_FROM`
> 改成 `陈培胜简历 <resume@已验证域名>`（改完需再次重新部署）。
>
> **2026-11-17 站长决定：暂不配置域名**。当前保持「自动发信仅支持 `shenge.work@gmail.com`、
> 其他邮箱走 mailto 兜底」的模式；以后要开放任意收件人，只需做 ①b + 改 `RESEND_FROM` + 重新部署，
> 无需改动任何代码。

### ① 注册 Resend（2 分钟）· ✅ 已完成

1. 打开 https://resend.com/signup ，用 Google 账号（建议直接用 shenge.work@gmail.com）注册；
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

### ② Cloudflare Pages 绑定 KV（3 分钟）· 留言墙能否用就看这一步

> ✅ **这一步已于 2026-11-16 完成**：新建 `site-kv` 并以 `SITE_KV` 绑定到 `shenge-work` 的 Production 环境，随后重新部署生效。以下保留为重建/换账号时的操作记录。
> 绑定后必须**重新部署**才会生效（控制台会明确提示 "This change will take effect on the next deployment"）；用 `./scripts/wall-check.sh` 验证。

1. 打开 https://dash.cloudflare.com → 左侧 **Storage & Databases → Workers KV** → `Create a KV namespace`；
2. 名字 `site-kv`（任意），Data location 保持默认 Standard，创建后记下 namespace ID（可复用已有的 `VISITS` KV 也可以，不必新建——但**注意免费版同 namespace 留言数据与其共用，建议新建**）；
3. 左侧 **Workers & Pages** → 找到 Pages 项目 `shenge-work` → **Settings → Bindings**（2026-11 新版控制台已把 KV 绑定从旧版 "Settings → Functions → KV namespace bindings" 挪到 Bindings 区块；环境选 **Production**）：
   - 点 `+ Add` → 在资源列表里选 **KV namespace**（列表按字母排序，需向下滚动）；
   - Variable name 填 **`SITE_KV`**（必须一字不差），KV namespace 选刚建的 `site-kv`，点 Save；
4. **注意**：项目名不是 `shenge-work.pages.dev`，而是 Pages 里的项目 `shenge-work`。Preview 环境未绑定，预览部署的留言墙仍会显示关闭态（刻意如此，避免测试留言混入生产数据）。

### ③ 配置环境变量（2 分钟）· ✅ 已完成

同在 `shenge-work` 项目 → **Settings → Variables and Secrets** → 添加：

| 类型 | 变量名 | 值 | 用途 |
|---|---|---|---|
| Secret | `RESEND_API_KEY` | `re_...`（①里拿到的） | 发信；不配置则前端自动走 mailto 兜底 |
| Variable | `RESEND_FROM` | `陈培胜简历 <resume@你的已验证域名>` | 发件人；不配则用 `onboarding@resend.dev`（只能发注册邮箱） |
| Variable | `DELIVER_BCC` | 如 `shenge.work@gmail.com`（可选） | 站长收一份转发备案，不配则完全不经手 |
| Variable | `ALLOWED_ORIGINS` | `https://shenge-work.github.io,https://shenge-work.pages.dev` | 跨域白名单 |
| Variable | `WALL_ADMIN_TOKEN` | 自拟一串随机字符（如 32 位） | 留言管理删除令牌（可选） |

> Secret 类型选「**Secret**」而不是「Text」，加密存储。
> 配完点 `Save`。**Pages 变量/KV 绑定修改后需要重新部署才生效**（重新跑一次部署脚本，或 Pages 控制台 Deployments → … → Retry deployment）。

### ④ 部署并验证（3 分钟）· ✅ 已完成（Retry deployment）

```bash
./scripts/deploy-pages.sh          # 上传含 functions/api 的完整站点
```

> Windows / Git Bash 上若缺 `rsync`、`md5`，不必补装：变量或绑定变更后可直接调用
> Cloudflare API `POST /accounts/{account_id}/pages/projects/shenge-work/deployments/{deployment_id}/retry`
> 重新部署（本次即如此，复用已登录的 wrangler OAuth 凭据）；只有函数代码有改动才需要完整上传。

验证清单（浏览器直接访问）：

| 检查 | URL / 操作 | 预期 |
|---|---|--- |
| 一键自检 | `./scripts/wall-check.sh` | 只读检查 open / 分页 / peek / CORS；失败时打印 KV 绑定指引 |
| 留言墙读取 | `https://shenge-work.pages.dev/api/wall` | `{"ok":true,"open":true,"messages":[...],"total":N,"hasMore":...}` |
| 留言提交 | 主页滚到 SEC.10 留言墙 → 填写提交 | 列表立即出现新留言并高亮；`⌘/Ctrl + Enter` 也可提交 |
| 加载更早 | 墙上超过 20 条时点「加载更早的留言」 | 每次追加 20 条，读到 100 条上限 |
| 转发发信 | `resume.html` → 「发简历到邮箱」→ 填你自己的另一个邮箱提交 | 该邮箱收到「陈培胜 · AI Agent 工程师 · 在线简历」，含两个简历入口按钮 |
| 多收件人 | 收件人填 `a@x.com, b@y.com` | 一封邮件同时到达两人（最多 3 个） |
| 兜底 | 未配置 key / 域名未验证时提交 | 弹窗底部出现「用邮箱客户端发送」mailto，收件人已填好 |

### ⑤ 线上自检小贴士

- `curl -s -X POST https://shenge-work.pages.dev/api/deliver -H 'Content-Type: application/json' -H 'Origin: https://shenge-work.github.io' -d '{"to":"你的另一个邮箱"}'`
  返回 `{"ok":true,...}` 说明发信链路通了；返回 `recipient_not_verified` 说明域名还没验证；
- 返回 200 但内容是 HTML，说明 `functions/api` 还没部署（重新跑部署脚本）；
- 留言墙专项自检：`./scripts/wall-check.sh`，只读、不写数据；
  `./scripts/wall-check.sh --post --admin-token=<WALL_ADMIN_TOKEN>` 会提交一条测试留言并自动删掉（不传令牌会留在墙上）；
- 浏览器里打开主页并加 `?wallDebug=1`，会在留言列表上方显示当前 API 线路、HTTP 状态、`open`、`reason` 与修复提示，
  适合在别人电脑上快速定位「为什么显示暂未开放」。
- `./scripts/deploy-pages.sh` 部署结束会自动打印 `/api/wall open=...`，绑定漏了当场就能看见。

## 本地自测（不用联网、不碰线上数据）

```bash
node scripts/dev-api-server.mjs              # 静态站 + 真实 functions/api + 内存 KV（带 TTL）+ 模拟 Resend
WALL_SEED=45 node scripts/dev-api-server.mjs # 预置 45 条留言，验收分页 / 加载更多
PORT=8878 WALL_NO_KV=1 node scripts/dev-api-server.mjs  # 模拟「线上忘了绑定 KV」的关闭态
./scripts/wall-check.sh http://127.0.0.1:8877   # 本地接口自检
# 打开 http://127.0.0.1:8877/index.html?wallDebug=1 与 /resume.html 手动点一遍
```

联调服务器默认带一个本地管理令牌 `local-admin-token`（可用 `WALL_ADMIN_TOKEN` 覆盖），内存 KV 会模拟 `expirationTtl`，所以固定窗口限流到期解锁也能测。注意 `本地预览.command` 起的是 8765 纯静态服务，**没有 `/api`**；页面会提示改用 8877 联调服务器。

已回归的点：留言 GET/分页/peek/POST/重复提交/固定窗口限流/换行与 emoji 截断/来源校验/管理员删除；转发接口的收件人解析（多收件人、去重、格式校验、最多 3 个）、Reply-To、主题与正文、每收件人/每 IP/全站限额；未配置与域名未验证两种情况的 mailto 兜底；移动端 320–390px 布局。

## 日常使用

**查看留言**：主页 SEC.10（最新在前，每页 20 条，可「加载更早的留言」一直翻到 100 条上限）。点「↻ 刷新」看最新；页面开着时每 60 秒自动探一次，有别人新留言会出现「有新留言 ▲」。时间显示相对值，鼠标悬停看精确时间。

**删除一条留言**（配置了 `WALL_ADMIN_TOKEN` 时可用）：

```bash
curl -X DELETE https://shenge-work.pages.dev/api/wall \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: <你的 WALL_ADMIN_TOKEN>" \
  -d '{"id":"wxxxxx"}'
```

（id 在留言卡左上角 `#` 后面。）

**转发出去的邮件长什么样**：主题「陈培胜 · AI Agent 工程师 · 在线简历（某某 转发）」，正文为纸感卡片：开头说明「无需下载附件，点按钮看完整简历」+ 转发人/回复地址/收件人 + 附言块（若有）+ 两个按钮（主/备线路在线简历）+ 页脚。访客填了自己的邮箱时，Reply-To 即该邮箱——收件人直接回复就能联系到转发人。

**站长要不要收到副本**：默认完全不经手。需要备案时配 `DELIVER_BCC`，每封转发都会密送一份给你。

## 容量与安全

- 留言：墙上保留 100 条（超过自动淘汰最旧），每 IP 每 10 分钟固定窗口 3 条、全站每天 50 条；
  被限流的请求**不再自增计数**（旧版会把访客永久锁死），限流键只存 IP 的 SHA-256 前 8 字节，不落明文；
  5 分钟内相同「称呼 + 内容」判为重复提交，直接返回现有列表；
- 内容：保留换行与组合 emoji（按 Unicode 码点截断，旧的 UTF-16 截断会切坏 emoji），
  剔除控制字符 / 零宽 / 双向控制符，连续空行收敛，前端渲染统一 escape；
- 转发：每个收件人每天 2 封、每 IP 每天 5 封、全站每天 30 封（防止被当成垃圾邮件跳板）；
- 收件人最多 3 个，逐个正则校验；附言截断 500 字；
- 防滥用：正则校验邮箱、内容截断、控制字符剥离；前端渲染统一 escape，KV 不存 IP 明文（限流键存 IP，仅计数用途）；
- 均为**免费额度内**：KV 免费档每天 10 万读 / 1000 写，远超本站量级。

## 排障：留言墙显示「暂未开放」

| 现象 | 原因 | 处理 |
|---|---|---|
| `/api/wall` 返回 `open:false, reason:kv_not_bound` | Pages 未绑定 `SITE_KV`（线上已于 2026-11-16 修复） | 按 ② 绑定 → 重新部署 → `./scripts/wall-check.sh` |
| 返回 200 但内容是 HTML | `functions/api` 没随站点部署 | 重新跑 `./scripts/deploy-pages.sh` |
| 提示「本地静态预览没有留言 API」 | 用的是 `本地预览.command` 的 8765 纯静态服务 | 改用 `node scripts/dev-api-server.mjs`（8877） |
| 提交 403 `origin_not_allowed` | 来源不在 `ALLOWED_ORIGINS` | 补白名单，或自检时用 `ORIGIN=` 指定 |
| 提交 429 `rate_limited` | 触发每 IP / 每日限额 | 看响应的 `retryAfter`（秒），窗口结束自动清零 |
| 列表一直加载 / 加载失败 | 两条线路都没拿到 JSON | 打开 `?wallDebug=1` 看线路、HTTP 状态与 `reason` |

`GET /api/wall` 只读无副作用，可直接用浏览器打开确认；`POST` 会写公开数据，自检脚本要显式加 `--post` 才会触发。

> AI生成
