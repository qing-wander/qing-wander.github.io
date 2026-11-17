# 项目待办与未竟事项（TODO / Backlog）

> 文档定位：全站**唯一**的「还没做的事」台账。各专题文档里散落的「暂缓 / 未做 / 待验证 / 必做未配」
> 统一在这里登记，每条给出状态、影响、前置条件、执行步骤与验收标准，并回链依据文档。
> 目的：换会话、换机器、换协作人时，不用通读五份设计文档也能知道下一步该做什么、哪些是故意不做的。
>
> 最近一次盘点：**2026-11-17**（Resend 接入收尾 + T2 git refs 对齐 +「岗位匹配 JD MATCH」上线与首轮线上验收，新增 T10–T12）。

---

## 0. 一句话现状

站点线上功能均可用：主页、简历页、留言墙、AI 问答助手、AI 语音播报、岗位匹配、访问统计、访客计数、简历转发。

**新增功能「岗位匹配 JD MATCH」（2026-11-17）已上线**：静态文件由 `7c7b5e1` 推送、GitHub Pages
已构建（生产首页含 `#jd` 区块与 `js/jd-match.js` / `css/jd-match.css` 引用）；云函数在并行会话
部署语音链路时已一并带上 `mode:"jd"` 分支，线上实测用真实 hy3 返回结构化对照表
（`ok:true`，score 75，4 条需求含证据出处与追问点），问答与 TTS 回归均为 200。
**T10 已完成，T11 端到端验收已于 2026-11-18 全项完成**（含预览子域 CORS 修复、`chat_logs` 查库、移动端触屏验收，见 §3.11）；T5 同步关闭。
方案、进度与验收清单详见 [jd-match.md](jd-match.md)。

**既有功能的缺口仍是「访客填任意邮箱都能自动收到简历」**。Resend 尚未验证自有发信域名，
`onboarding@resend.dev` 只能发给账号邮箱 `shenge.work@gmail.com`；其他邮箱会被 Resend 以
403 `recipient_not_verified` 拒绝，前端按设计自动切到「用邮箱客户端发送」的 mailto 兜底
（收件人已填好），功能不中断，但不会自动收到邮件。

站长已于 **2026-11-17 明确决定暂不配置域名**，因此这是「已决策暂缓」，**不是故障、不是 bug**。
其余条目都是文档过时、工程卫生、可选增强或思考型迭代池，**不阻塞既有线上功能**。

---

## 1. 状态约定

| 状态 | 含义 | 处理方式 |
|---|---|---|
| `待办` | 需要做，尚未排期 | 按明细里的步骤执行，做完更新状态 |
| `已决策暂缓` | 明确决定先不做，但保留完整做法 | 只有触发条件出现才重开，别当 bug 修 |
| `已决策不做` | 本轮明确不做（非删除，设计保留） | 不排期；重开需先改决策记录 |
| `待复核` | 记录可能过时，需先核实再决定 | 先核实，再改成 `待办` 或 `已完成` |
| `进行中` | 已开始执行且部分验收项通过，剩余项见明细 | 只做明细里未通过的项，别重复已通过的 |
| `可选` / `思考池` | 按需启用，未排期 | 不要当任务领 |

---

## 2. 待办总表

| ID | 事项 | 状态 | 优先级 | 影响范围 | 依据 |
|---|---|---|---|---|---|
| T1 | 验证 Resend 发信域名，放开任意收件人自动发信 | `已决策暂缓` | 高（唯一功能缺口） | `resume.html` 发简历到邮箱 | [resume-delivery.md §①b](resume-delivery.md) |
| T2 | 本地 git 引用与远端 `main` 对齐 | `已完成（2026-11-17）` | — | 本机开发 | 本文 §3.2 |
| T3 | 更新 `cloudflare-pages-deploy.md` 的过时描述 | `待办` | 中（文档准确性） | 部署文档 | [cloudflare-pages-deploy.md](cloudflare-pages-deploy.md) |
| T4 | AI 问答助手 13.8「未做」清单复核 | `待复核` | 中 | AI 问答 / README | [ai-assistant-survey.md §13.8](ai-assistant-survey.md) |
| T5 | 预览子域 `*.pages.dev` 的 CORS 通配 | `已完成（2026-11-18）` | — | 预览部署的 AI 问答 / JD 匹配 | 本文 §3.5（含配置修复与全量回传踩坑） |
| T6 | 可选环境变量 `DELIVER_BCC` / `WALL_ADMIN_TOKEN` | `可选` | 低 | 转发备案 / 留言删除 | [resume-delivery.md §③](resume-delivery.md) |
| T7 | Pages CMS 账号授权状态确认 | `待确认` | 低 | 网页改文案 | [observability-and-cms.md §一.3](observability-and-cms.md) |
| T8 | AI 助手皮肤后续迭代池 | `思考池` | 低 | 右下角助手 | [ai-avatar-skins.md §9](ai-avatar-skins.md) |
| T9 | 里程碑 M5「本地推理演示通道」 | `已决策不做` | — | AI 问答 | [ai-assistant-survey.md D4](ai-assistant-survey.md) |
| T10 | 上线收尾：推送 JD 静态文件 + 云函数 `mode:jd` 生效 | `已完成（2026-11-17）` | — | AI 问答 / JD 匹配 | 本文 §3.10 / [jd-match.md §5](jd-match.md) |
| T11 | JD 匹配端到端验收（含 3 项人工复核） | `已完成（2026-11-18）` | — | JD 匹配 | 本文 §3.11 / [jd-match.md §4.3](jd-match.md) |
| T12 | JD 匹配迭代池（缓存 / 分享 / PDF / 追问直达 / 招聘方速览模式）——追问直达已随面板模式完成，其余仍在思考池 | `思考池（追问直达已完成）` | 低 | JD 匹配 | [jd-match.md §9](jd-match.md) |
| T13 | AI 助手面板内 JD 模式（模式切换 / 对话内紧凑结果卡 / 追问直达问答） | `已完成（2026-11-18）` | — | AI 问答 / JD 匹配 | [jd-match.md §10](jd-match.md) |

---

## 3. 逐条明细

### 3.1 T1 · Resend 发信域名验证（既有功能缺口）

**现状（2026-11-17 实测）**

| 收件人 | 结果 |
|---|---|
| `shenge.work@gmail.com`（Resend 注册邮箱） | 自动发信成功，`POST /api/deliver` → `201 {"ok":true,...}`，Resend 邮件 id `01a1e59e-…` |
| 其他任意邮箱（含测试邮箱 `1549735463@qq.com`） | Resend 403 `recipient_not_verified` → 接口返回该错误 → 前端显示 mailto 兜底 |

代码侧全部就绪：`functions/api/deliver.js`、前端弹窗、CORS、限流、邮件模板、Tests 均已上线并实测通过。
缺的只是 Resend 的**发信域名验证**：未验证域名时 `onboarding@resend.dev` 只能发给账号自己的邮箱，
这是 Resend 的平台硬规则，改代码绕不过去。

**前置条件**：需要一个自有域名。当前：

- Cloudflare 账号下 zone 列表为空；
- GitHub Pages 未绑自定义域名（无 CNAME）；
- 文档里举例的 `shenge.dev` 未注册；
- 域名 DNS 托管在 Cloudflare 时可由脚本直接加记录；托管在别的注册商则需本人登录后台添加
  （或提前登录好把后台交给代理人）。涉及**购买域名付款 / 第三方账号登录**必须本人操作。

**执行步骤（代码零改动）**

1. 准备自有域名（已有则跳过；没有则先在注册商购买，约 ¥10–60/年）。
2. Resend Dashboard → **Domains → Add Domain**，填入域名。
3. 按 Resend 给出的值添加 DNS 记录（SPF / DKIM / DMARC，通常 3–5 条），等待验证通过（一般几分钟）。
4. Cloudflare Pages 项目 `shenge-work` → **Settings → Variables and Secrets → Production**，
   把 `RESEND_FROM` 从 `Portfolio Resume <onboarding@resend.dev>`
   改成 `陈培胜简历 <resume@你的域名>`。
5. **重新部署**（Pages 控制台 Deployments → … → Retry deployment，或 push 一次触发自动构建）；
   Pages 环境变量修改后必须重新部署才生效。
6. 用真实邮箱端到端复测（见下方验收）。

**验收标准**

```bash
curl -s -X POST https://shenge-work.pages.dev/api/deliver \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://shenge-work.github.io' \
  -d '{"to":"1549735463@qq.com"}'
# 期望 {"ok":true,...}；返回 recipient_not_verified 说明域名验证或 RESEND_FROM 未生效
```

- 浏览器打开 `resume.html` → 「发简历到邮箱」→ 填 `1549735463@qq.com` 提交，
  应显示发送成功、**不再出现 mailto 兜底按钮**；
- 该邮箱收到「陈培胜 · AI Agent 工程师 · 在线简历」，两个简历入口按钮可点；
- 在 Resend Dashboard → Emails 能看到 `Delivered` 状态；
- 记得清掉测试产生的 KV `deliver:*` 限流计数（本次已清过一次，做法见 `resume-delivery.md`）。

**代价与风险**：仅域名年费 + 约 10 分钟配置；Resend 免费额度足够。
不改任何前端 / 函数代码，`ALLOWED_ORIGINS`、`SITE_KV`、`RESEND_API_KEY` 都不用动。

**决策记录**：2026-11-17 站长在「我有域名 / 帮我买 / 先不配域名」中明确选择**先不配域名**，
保持「自动发信仅支持账号邮箱 + 其他邮箱 mailto 兜底」。
**重开触发条件**：访客反馈收不到自动邮件、或站长愿意提供 / 购买域名。

---

### 3.2 T2 · 本地 git 引用与远端 `main` 对齐 ✅ 已完成（2026-11-17）

**结论**：本机 `github.com` 代理已恢复可达，`git fetch` / `git push` 均可用，**不再需要 Git Data API 中转**；
本地 `HEAD` / `main` / `origin/main` 已统一到 `941da91`。

**实测根因**：不是「代理不可达」，而是代理对 Git 的 HTTP/2 传输处理有问题——
`git ls-remote` 与 `curl https://github.com/.../info/refs` 都返回 200，但 `git fetch`
报 `Empty reply from server`。加 `-c http.version=HTTP/1.1` 后立刻成功。
已把两项参数写入本机 `.git/config`（**不入库**）：`http.version=HTTP/1.1` 与 `http.sslBackend=openssl`。
后者同样必要：Windows Git 默认的 `schannel` 在 push 时会报 `failed to receive handshake`，换成 `openssl` 才成功。代理偶有波动（`CONNECT tunnel failed, response 502` / 超时），失败重试即可，不必回退到 API 通道。

**实际执行步骤**：

```bash
git fetch --unshallow origin      # 若曾用 --depth=1 拉过，先补回完整历史
git status --short                # 对齐前备份现场：HEAD / git diff / 未跟踪文件
git reset --mixed origin/main     # 只移动 refs + index，不动工作区
```

> ⚠️ **原步骤里的 `git reset --hard origin/main` 是错的，别照抄**：工作区当时还有一批
> **未上线**的「岗位匹配 JD MATCH」改动与 `docs/ai-avatar-skins.md` 排版改动，
> `--hard` 会把它们全部抹掉。只有 `--mixed` 能在对齐 refs 的同时保住这些文件。

**验收（已通过）**：
- `git rev-parse HEAD` == `git rev-parse main` == `git rev-parse origin/main` == `941da91`，且仓库非 shallow；
- `git push origin main` **实测成功**（`941da91..b9e5706`，本条记录即由标准通道推送），推送后 `HEAD` / `main` / `origin/main` 三者一致；
- `git status` 从 17 项收敛到 **9 项**，且 5 个语音文件（`js/ai-voice.js`、
  `js/ai-voice-cloud.js`、`css/ai-voice.css`、`docs/ai-voice-survey.md`、
  `functions/tencent/tts.js`）全部识别为「已提交且内容一致」，不再显示 `??`；
- 剩余 9 项是**真实未上线工作**，与语音无关：6 个 `M`（`README.md` / `index.html` /
  `js/main.js` / `functions/tencent/{index,prompt}.js` 的 JD 改动、
  `docs/ai-avatar-skins.md` 纯排版）+ 3 个未跟踪（`css/jd-match.css`、
  `js/jd-match.js`、`docs/jd-match.md`）。这是下一条要处理的线，**别误当脏状态清掉**。

**顺带澄清**：`docs/resume-delivery.md` / `docs/TODO.md` / `docs/ai-assistant-survey.md`
对齐后自动变干净——此前显示的 `M` 只是「内容已入库、本地 refs 落后」造成的假象，无需再单独提交。

---

### 3.3 T3 · `docs/cloudflare-pages-deploy.md` 已过时，需更新

文档「当前实际形态（2026-11-11）」称 **Cloudflare GitHub App 尚未授权该仓库、push 不会触发自动构建**，
并说当前靠 macOS `launchd` 每小时跑 `sync-pages-from-github.sh` 同步。

**2026-11-17 实测证据（与文档相反）**：

- 远端 commit `d5de5afe`（18:41:23Z）后 3 秒，Pages 产生 production 部署 `0a522e4f`（18:41:26Z）；
- 部署 `deployment_trigger.type = github:push`，`commit_hash = d5de5afe…`，各 stage 全部 success；
- 自动构建后线上 `GET /api/wall?peek=1` → `200 {"ok":true,"open":true}`、
  `POST /api/deliver` → `400 bad_request`（正常参数校验），说明 `functions/` **没有被自动构建冲掉**；
- 当前开发机是 Windows，文档里的 `launchctl` / `~/Library/Logs` 方案不适用。

**要做**：把文档改成「**push 即部署为当前主链路**（GitHub 集成已生效），
`scripts/sync-pages-from-github.sh` / `deploy-pages.sh` 仅作兜底与紧急修复」；
删除或明确标注 macOS launchd 段落为历史方案；补一句「functions 不进 `dist` 仍会被 Pages 编译，自动构建不会丢 API」。
授权时间与授权人未在仓库中记录，如能查到请一并补上。

**验收**：文档描述的部署链路与线上实测一致，且不再出现「push 不会触发构建」的误导性结论。

---

### 3.4 T4 · AI 问答助手 13.8「未做」清单复核

`docs/ai-assistant-survey.md` §13.8 写着：

> **未做**：知识库自动联动、CI 实跑、移动端实测、监控告警、README 项目章节。

但仓库现状已部分变化，直接照抄会把已完成的事继续当待办：

- `.github/workflows/build-kb.yml` 已存在（知识库自动联动 / CI 是否**实跑过**仍需查 Actions 运行记录）；
- `README.md` 功能特性第 10 条已有「3D AI 简历问答助手」及皮肤文档链接，但**架构章节 / 项目描述章节**是否补齐待核；
- 同节下方又写「回归脚本已补（见 13.11）」「网关限频改为函数内两级限流落地」，说明该段是阶段性记录，未回写。

**要做**：逐项核实五项（知识库联动 / CI 实跑 / 移动端实测 / 监控告警 / README 章节），
分别标成 `已完成` 或 `待办`；把结果回写 13.8，若仍有未完成项，在本文件 T4 下拆成独立条目并给验收标准。

**验收**：13.8 不再是无法判断时效的一句话；本文件 T4 状态从 `待复核` 改为明确结论。

---

### 3.5 T5 · 预览子域 CORS 通配（已完成，2026-11-18）

**问题**：函数代码本身支持 `*.` 通配（`DEFAULT_ORIGINS` 含 `*.shenge-work.pages.dev`），
但线上环境变量 `ALLOWED_ORIGINS` 是精确列表
`https://shenge-work.github.io,https://shenge-work.pages.dev`，覆盖了代码默认值，
因此 `Origin: https://abc123.shenge-work.pages.dev` 一直 403 `origin_denied`。
**不是代码 bug，是线上配置没跟上**；`docs/jd-match.md` §4.3 里「随函数重部署自动生效」的推测不成立。

**处置（2026-11-18 02:14，Chrome 登录 CloudBase 新版开发平台）**：
环境 `resume-ai` → 云函数 `resume-ai-chat` → 函数配置 → 编辑 → 环境配置 → 环境变量，
把 `ALLOWED_ORIGINS` 改为
`https://shenge-work.github.io,https://shenge-work.pages.dev,*.shenge-work.pages.dev`；
其余 5 个变量（`AI_API_KEY` / `TTS_REGION` / `TTS_SECRET_ID` / `TTS_SECRET_KEY` /
`TTS_VOICE_TYPE`）**一个没动**。**保存即生效**，无需重传代码、无需重新打包。

**复验（同轮线上直探）**：

| 探测 | 结果 |
|---|---|
| `POST /chat` + 预览子域 Origin | 403 → **400 `bad_request`**（已越过 CORS 层） |
| `OPTIONS` 预检 + 预览子域 Origin | 204，`Access-Control-Allow-Origin` 正确回显 |
| 主站 / 备站 Origin | 正常 |
| 外来域名 `evil.example.com` | 仍 403 `origin_denied` |
| 问答 `{"question":...}` / `{"mode":"tts"}` | 均 200，服务端密钥未丢失 |

> ⚠️ 仍要记住：走云 API `UpdateFunctionConfiguration` 时必须**全量回传**环境变量，
> 漏掉 `AI_API_KEY` 会让 `/chat` 立刻失效（见 §3.2）。控制台 UI 编辑会自动保留全部变量，
> 这次没触发该坑，但日后用 API 改配置仍按全量处理。

---

### 3.6 T6 · 两个可选环境变量（按需，非阻塞）

| 变量 | 作用 | 不配置时的行为 |
|---|---|---|
| `DELIVER_BCC` | 每封简历转发密送一份给站长备案 | 完全不经手，隐私更好（当前状态） |
| `WALL_ADMIN_TOKEN` | 留言墙管理员删除令牌 | `DELETE /api/wall` 不暴露（返回 404），删留言只能改 KV |

配置位置：Pages 项目 `shenge-work` → Settings → Variables and Secrets → **Production**；
`WALL_ADMIN_TOKEN` 建议随机 32 位；改完记得**重新部署**。
`./scripts/wall-check.sh --post --admin-token=<TOKEN>` 可验证删除链路（会提交一条测试留言并自动删掉）。

---

### 3.7 T7 · Pages CMS 授权状态待人工确认

`docs/observability-and-cms.md` 把 Umami Cloud、Pages CMS 标为「必做」，Clarity 标为「可选」。
仓库里 `js/analytics.js` 的 `umamiWebsiteId` 与 `clarityProjectId` **均已填好**（统计已接入）；
`.pages.yml` 也在。剩下 Pages CMS 的 **GitHub App 授权**属于必须本人登录点授权的账号操作，
仓库内无法判断是否已完成。

**确认方式**：登录 <https://app.pagescms.org> → 能看到「作品集内容（全站文案）」入口即已授权；
再改一处文案点 Save，观察是否生成 commit → Actions 重建 `site-data.js` → 约 1 分钟线上生效。
若未授权，按教程 §一.3 完成（只勾 `shenge-work.github.io` 一个仓库）。

---

### 3.8 T8 · AI 助手皮肤后续迭代池（未排期，思考用）

来自 `docs/ai-avatar-skins.md` §9，**不是待办任务清单**，只是避免想法丢失：

- 体验层：语音播报（TTS）、口型同步、按回答内容切情绪动画；
- 能力层：点击彩蛋动作轮换、待机活动池、桌宠全局活动；
- 工程层：皮肤 JSON manifest / 外置皮肤包、AI 立绘工作流脚本化、3D 加载性能埋点与低端设备自动降级；
- §9.4 决策待办：是否上语音 TTS、狐狸 / 机器人默认选择、30 分钟打招呼冷却是否缩短。

需要排期时，先在本文件新建独立条目并给出验收标准，再动代码。

---

### 3.9 T9 · 里程碑 M5 本地推理通道（已决策不做）

`docs/ai-assistant-survey.md` 决策 **D4**：WebGPU / WASM 本地小模型推理本轮**不做**
（首次要下载 300MB–1.2GB 权重，常规访客体验不可接受），里程碑 M5 取消，但 §5.5 的设计保留。
在这里登记是为了避免以后被误当成「漏做的里程碑」重新捡起来。
**重开触发条件**：明确要做「对话数据不出浏览器」的面试演示道具，且能接受首次加载成本。

---

### 3.10 T10 · 上线收尾：推送 JD 静态文件 + 云函数 `mode:jd` 生效（已完成 2026-11-17）

**结论：两条发布链路均已走完，无需再部署、无需再 push。** 原先登记的「静态未 push / 云函数未
重部署」是开发当时的快照，现已被线上实测推翻（下面按事实链记录，避免后来者重复上线）。

1. **静态发布已完成**：提交 `7c7b5e1 feat(jd): 岗位匹配 JD MATCH 上线` 推送到 `origin/main`，
   共 10 文件（新增 `js/jd-match.js`、`css/jd-match.css`、`docs/jd-match.md`，修改
   `index.html`、`js/main.js`、`README.md`、`functions/tencent/index.js`、
   `functions/tencent/prompt.js`、本文档、`docs/ai-avatar-skins.md`）。GitHub Pages 已构建：
   生产首页 200、含 `id="jd"` 区块与 `js/jd-match.js?v=20261117a` /
   `css/jd-match.css?v=20261117a` 引用，语音资源 `js/ai-voice*.js?v=20261117c` 未被覆盖。
2. **云函数 `mode:jd` 已在线上生效**：并行会话部署语音链路时上传的 `functions/tencent/` 整包
   已同时包含 JD 与 TTS 两套路由，因此**不需要再单独重部署**。线上用真实 hy3 直探
   `POST /chat {mode:"jd", jd:...}` 返回 `ok:true` 与完整结构化 `match`（score 75、
   `covered 2 / partial 1 / gap 1`、真实切片 id 与 `ground`、缺口与追问点），无 `parse_failed`。
3. **一致性检查**：仓库 `functions/tencent/index.js` 为 JD + TTS 合并版（两套路由共存），
   `index.js` / `prompt.js` / `tts.js` / `server.js` 全部 `node --check` 通过；
   `HEAD == origin/main`，工作区干净。
4. **既有链路回归**：`{"mode":"tts",...}` → 200，问答 `{"question":...}` → 200，均未受影响。

**复用探测命令**（后续回归可用，返回「缺少 question」才说明函数退回旧版）：

```bash
curl -s -X POST https://resume-ai-d9g7zghnxda2ee2cb-1307508155.ap-shanghai.app.tcloudbase.com/chat \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://shenge-work.github.io' \
  -d '{"mode":"jd","jd":"岗位职责：负责企业级 AI Agent 平台架构设计，含任务规划与多智能体编排；建设 RAG 检索链路并做召回评测。"}'
```

- 预览子域 CORS 通配（T5）已于 2026-11-18 通过控制台配置修复并复验，详见 §3.5。

---

### 3.11 T11 · JD 匹配端到端验收（已完成，2026-11-18）

**已通过（线上真实模型 + 真实浏览器）**：三个示例 JD 全部按固定结构出表（6.0–8.6 秒）；
证据 `src` 100% 命中 37 段真实切片；`jd_quota` 额度、注入拦截不占额度、CORS、非 JD 判定、
问答 / TTS 回归、1440 / 390px 四态渲染与 Markdown 导出均通过。生产域名真实点击示例
**8.79 秒出表**（score 72 / 7 行 / Markdown 1405 字符）、非 JD 新闻 `score=0` +「无法判断」、
太短与 1620 字超长均 400、非法 Origin 403、`OPTIONS` 预检 204 + CORS 回显、0 个 JS `pageerror`。
逐项数据见 [jd-match.md §4.2.1 / §6.3](jd-match.md)。

**原 3 项人工复核全部收口（2026-11-18）**：

| 项 | 结果 |
|---|---|
| 预览子域 CORS | 控制台把 `*.shenge-work.pages.dev` 追加进 `ALLOWED_ORIGINS` 后 403 消失；预检 / 主站 / 备站 / 外来域名 / 问答 / TTS 全部回归通过（详见 §3.5，T5 同步完成） |
| `chat_logs` 查库 | PostgreSQL SQL 编辑器：全表 **126 行**，`tag=jd` **11 行**，`q` 长度 2–300（均值 102）、手机号正则 0 命中、最新一条为单行岗位摘要，时间窗 11-17 23:46:37 → 11-18 00:07:49 |
| 移动端 | Chrome 移动设备模拟（`isMobile + hasTouch`，390 / 360 / 320px，DPR 3/3/2）全程 `tap()` 跑通 首屏 CTA → 示例 → 提交 → 结果 → 复制 → 重填 → 错误态；横向溢出 0、0 个 JS 错误、剪贴板 552 字符 |

**真机 WebView** 仍建议本人用手机打开 `https://shenge-work.pages.dev/#jd` 扫一眼
（确认字体渲染与 WebView 差异，约 30 秒）；桌面触屏模拟已覆盖布局与触摸事件，此项不再阻塞验收。
T11 置为 `已完成（2026-11-18）`。

---

### 3.12 T12 · JD 匹配迭代池（未排期，思考用）

来自 [jd-match.md §9](jd-match.md) 与同轮调研的备选方案，**不是待办任务清单**：

- 结果缓存：`sha256(JD)` 10 分钟内存缓存，重复点击不重复扣额度；
- 可分享链接：`?jd=` 压缩参数或短链，方便招聘方转给同事；
- 导出 PDF / 邮件：复用 `functions/api/deliver.js` 的 Resend 链路（注意 T1 的域名限制）；
- 追问点直达问答：点一条 `probe` 直接调 `/chat`，把对照表变成「面试预演」；
- 招聘方速览模式：同轮调研的备选方案（开关把整站切成 30 秒版，只留量化战绩与三个项目结论，
  成本一天以内；说服力弱于 JD 匹配，故本期未做）。

需要排期时，先在本文件新建独立条目并给出验收标准，再动代码。

---

## 4. 已完成（2026-11-16 / 17 收尾，勿重复做）

- 岗位匹配 JD MATCH 上线（2026-11-17）：静态 `7c7b5e1` 已推送、Pages 已构建、云函数 `mode:"jd"` 线上真实模型实测可用，问答与 TTS 回归 200（详见 §3.10）；**不要重复部署或重复 push**；
- AI 助手语音播报 Phase 1 + 2（浏览器 SpeechSynthesis + 腾讯云 TTS 云端通道）已上线并通过人工验收，见 [ai-voice-survey.md](ai-voice-survey.md)；
- Resend 账号（Chrome 现成 Google 会话登录）、「仅发信」最小权限 API Key，明文未落仓库；
- Cloudflare Pages `shenge-work` / Production 配置 `RESEND_API_KEY`(Secret)、`RESEND_FROM`、
  `ALLOWED_ORIGINS`，保留 `SITE_KV` 绑定，并用 Retry deployment 让变量生效；
- 端到端实测：账号邮箱发信 `201`、浏览器点击弹窗与 mailto 兜底实测、接口最终探测为正常参数校验；
- 测试产生的 KV `deliver:*` 限流计数已清空，临时 key 文件已删；
- `docs/resume-delivery.md` 已记录配置进度、暂缓决定与 Windows 下重新部署做法，并推送远端 `main`（`d5de5afe`）；
- 留言墙 KV `site-kv` 绑定 Production 已生效，`./scripts/wall-check.sh` 11/11 通过；
- 2026-11-17 复核：`github:push` 自动构建已生效，且自动部署不会丢失 `/api/*` Functions；
- T2（2026-11-17）：本机 git refs 与远端 `main` 对齐到 `941da91`，`http.version=HTTP/1.1` 写入 `.git/config`，标准 `git fetch` / `git push` 通道恢复，不再走 Git Data API；详见 §3.2。
- JD 匹配（2026-11-17）：「岗位匹配 JD MATCH」开发完成并本地全部验证通过——前端 SEC.03
  视图（三个示例 JD / 空态-加载-结果-错误四态 / Markdown 导出 / 1440–390px 响应式 / 四主题
  跟随）、云函数 `mode:"jd"` 分支（拆分 ≤14 条 / 逐条 TF-IDF 召回合并加权 / 两层输出约束与
  证据 id 白名单 / 10 分钟 4 次独立额度 / 注入拦截不占额度）、README 板块与功能清单更新、
  `docs/jd-match.md` v2 专题文档（调研 + 方案 + 进度）。
  **已上线（`7c7b5e1`）并完成线上端到端验收（T11 于 2026-11-18 全项完成）**，详见 §3.10 / §3.11。

---

## 5. 维护约定

1. **新发现的待办先落本文件**（带依据文档链接与验收标准），再决定是否回写专题文档；
   避免又散回五份设计文档里。
2. 完成一条：把总表状态改为 `已完成（YYYY-MM-DD）`，**同时同步依据文档里的状态**，避免两处打架。
3. 状态为 `已决策暂缓` / `已决策不做` 的条目**不要当 bug 修**；重开必须先写明触发条件。
4. 每次较大改动收尾时盘点一次；长期不动的 `思考池` 条目可保留，但不要悄悄变成排期。
5. 涉及**账号登录、GitHub App 授权、域名付款**的步骤必须本人操作，代理人应提前通知，不要尝试绕过。

> AI生成
