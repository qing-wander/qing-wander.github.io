# 陈培胜 · 求职作品集（CHEN PEISHENG Portfolio）

AI Agent 工程师求职个人网站：基于纯原生 HTML / CSS / JavaScript 构建，无任何第三方依赖，通过 **GitHub Pages** 免费托管。包含作品集主页与在线简历页，全面展示个人优势、工作经历、项目作品、专业技能与联系方式。

**在线访问**
- 作品集主页：https://shenge-work.github.io/
- 在线简历：https://shenge-work.github.io/resume.html

**备用线路（Cloudflare Pages，同一套静态文件）**
- 作品集主页：https://shenge-work.pages.dev/
- 在线简历：https://shenge-work.pages.dev/resume.html
- 更新方式：项目已配 GitHub 数据源，但 **Cloudflare 的 GitHub App 尚未授权本仓库**，push 暂不会触发自动构建；目前由本机 launchd 每小时跑 `scripts/sync-pages-from-github.sh`，拉 `main` 最新提交直传 Pages
  - 手动同步：`./scripts/sync-pages-from-github.sh --force`（`--check` 只看有没有新提交）
  - 按本地工作区直传：`./scripts/deploy-pages.sh`（支持 `--dry-run`）
  - 构建命令（启用自动构建后使用）：`mkdir -p dist && cp -r index.html resume.html css js data images videos assets favicon-64.png favicon.png dist/`，输出目录 `dist`
- 想启用「push 即部署」：GitHub → Settings → Applications → Cloudflare Pages → `Configure` → 授权 `shenge-work.github.io` 仓库
- 详细说明：[docs/cloudflare-pages-deploy.md](docs/cloudflare-pages-deploy.md)

> 注意：Pages 只读取 GitHub 仓库的提交，本地改动必须 push 到 GitHub 才会同步；同步由本机定时任务完成，机器关机时会顺延到下次开机。

## 页面结构

### 作品集主页（index.html）
单页作品集，涵盖 9 大板块：
| 板块 | 说明 |
|---|---|
| 关于我 ABOUT | 个人形象照 + 自我介绍 |
| 求职意向 TARGET | 目标岗位与期望 |
| 岗位匹配 JD MATCH | 粘贴 JD，由站内 RAG Agent 生成「要求 → 对应经历 → 缺口 → 追问点」对照表 |
| 教育经历 EDUCATION | 全日制统招本科（中山大学新华学院 · 软件工程） |
| 工作经历 EXPERIENCE | 进门财经 / Lessie / 房极客 / 周生生 |
| 项目作品 WORKS | comein.cn / lessie.cn / hicreator.ai 等作品展示 |
| 专业技能 SKILLS | 技能条可视化 |
| 获奖证书 AWARDS | 证书图片展示 |
| 联系方式 CONTACT | 电话 / 邮箱 / GitHub 直达 |

### 在线简历（resume.html）
单页 ATS 友好简历，主要区块：
- **个人优势**：跨语言复合背景、0→1 系统建设能力、Agent 工程化专精
- **工作经历**：进门财经（AI 投研工作台）、Lessie（AI 人脉搜索引擎）、房极客（房地产 SaaS）、周生生（CRM 平台）
- **项目经历**：comein.cn AI 投研工作台、lessie.cn AI 人脉搜索引擎、hicreator.ai 海外红人营销 SaaS（项目标题可点击直达官网）
- **专业技能**：Agent/Harness、AI 驱动编程、数据与中间件、后端、前端、DevOps 六大分类（掌握层级两行式，ATS 友好）
- **教育经历**：含学信网学历在线验证码区块 + 二维码扫码核验（有效期至 2027-04-29）

## 功能特性

页面交互主要由 `js/main.js` 实现，模块清单：
1. **移动端菜单**：汉堡菜单折叠导航，适配小屏
2. **导航高亮**：滚动时自动高亮当前所在板块
3. **滚动进场动画**：元素进入视口时渐进浮现
4. **数字滚动动画**：量化指标（如 10W+ 日活、70% 转化提升）数字滚动呈现
5. **技能条填充**：专业技能水平条动画
6. **项目详情数据**：作品卡片数据驱动渲染
7. **项目模态框**：点击作品弹出详情（多尺寸适配）
8. **Toast 提示**：简历下载等操作轻提示
9. **全站访问计数器**：右下角复古里程表样式，显示全站真实访问次数（默认走免费计数服务，后端不可用时回退本机计数，不会显示 0）
10. **3D AI 简历问答助手**：右下角可切换 9 款角色皮肤（3 款真 3D GLB + 本地 SVG 角色 + AI 生成立绘），无边框悬浮，待机/思考/回答都有对应动画；首次进入自动挥手打招呼并自我介绍「我是 AI 简历问答助手」；右键/双击/长按/快捷键 `S` 切换皮肤，数字 `1–9` 直达，选择本地记忆（设计文档：[docs/ai-avatar-skins.md](docs/ai-avatar-skins.md)）
11. **AI 语音播报（Phase 1 + 2）**：助手把欢迎语与回答「说」出来，首次进页面打招呼也有语音；浏览器拦截自动播放时给「一点即播」引导、首次交互补播；一键开关（本地记忆）、右键换音色、分句队列、口型律动联动。底层是浏览器内置 `SpeechSynthesis`（Edge 优先在线神经语音，零 Key 零费用）；**另外接了腾讯云 TTS 云端通道**（精品音色 101001，800 万字符免费包），启动探测成功才切云端，失败/超时自动无感回落到浏览器语音，`?tts=browser` 可强制降级。密钥只存云函数环境变量，设计文档：[docs/ai-voice-survey.md](docs/ai-voice-survey.md)
12. **岗位匹配（JD MATCH）**：招聘方粘贴 JD（≤1500 字），云函数把 JD 拆成需求条目，逐条在 37 段档案切片上做 TF-IDF 召回，模型在固定结构约束下输出「覆盖 / 部分 / 缺口 + 证据出处 + 面试追问点」，前端渲染对照表并支持复制 Markdown。与问答助手共用同一台云函数和同一份知识库，单独限流（10 分钟 4 次），设计文档：[docs/jd-match.md](docs/jd-match.md)

简历页附加能力：
- 一键「保存为 PDF」：调用浏览器打印，米白纸感样式与屏幕一致
- 「打印 PDF（黑白）」：黑白省墨模式，纯黑两色输出，纸质打印兼容
- 打印样式与屏幕显示保持一致的粗边框 + 偏移阴影设计

## 设计风格

- **Neo-brutalism 粗野主义纸感设计**：米白纸底（#F3EEE2）、卡片（#FFFCF4）、粗黑描边（4px）、硬偏移阴影（6px/10px offset）
- **主题色**：活力橙 #FF5A1E、科技蓝 #2B4BE0、辅助绿 #1FA658
- **字体**：Space Mono（等宽技术感标题）+ Noto Sans SC（中文正文）
- **响应式**：768px 断点起多尺寸适配（姓名 clamp 字号、模态框 94vh、导航折叠），桌面 / 平板 / 手机全场景可用

## 技术栈

- **纯原生 HTML5 / CSS3 / JavaScript（ES5 兼容）**，页面本身零框架、零构建工具
- 静态文件直出，GitHub Pages 自动部署，加载快、无服务器成本
- 统计 / 计数脚本按需加载：ID 未配置或后端不可达时不发请求，不影响页面
- favicon 双尺寸适配（favicon.png / favicon-64.png）

## 目录结构

```
├── index.html              # 作品集主页
├── resume.html             # 在线简历页
├── 本地预览.command         # 双击生成快照并起本地预览
├── css/style.css           # 设计系统 + 响应式 + 打印模式
├── js/
│   ├── main.js             # 页面交互（10 大功能模块）+ 数据渲染
│   ├── jd-match.js         # 岗位匹配：JD 表单、限流提示、对照表渲染与 Markdown 导出
│   ├── ai-skins.js         # 3D AI 助手皮肤系统（角色舞台/皮肤切换/状态联动）
│   ├── ai-voice.js         # 语音播报：开关 / 分句队列 / 自动播放解锁 / 口型联动
│   ├── ai-voice-cloud.js   # 云端 TTS Provider：探测、缓存、失败回落浏览器语音
│   ├── analytics.js        # 埋点统一入口（Umami / Clarity，未填 ID 不发请求）
│   └── visitor-count.js    # 全站访问计数（abacus / 自建 Worker 可切换）
├── css/
│   ├── style.css           # 设计系统 + 响应式 + 打印模式
│   ├── jd-match.css        # 岗位匹配区块样式（跟随四种主题变量）
│   ├── ai-skins.css        # AI 助手角色皮肤样式
│   └── ai-voice.css        # 语音开关 / 引导气泡 / 说话律动样式
├── assets/skins/           # 3D 模型 / model-viewer / AI 立绘 / 皮肤总览
├── data/
│   ├── site-data.json      # 唯一编辑源：全部文案、项目、证书、联系方式
│   └── site-data.js        # 自动生成的 window.SITE_DATA 快照（勿手改）
├── images/                 # 形象照 / 项目图 / 证书 / 学信网二维码
├── functions/api/wall.js            # 留言墙 API（分页 / 限流 / 管理删除，KV 存储）
├── functions/api/deliver.js         # 简历转发到邮箱（Resend）
├── functions/tencent/index.js       # CloudBase HTTP 云函数：/chat 问答 + JD 匹配 + TTS 路由
├── functions/tencent/tts.js         # 腾讯云 TextToVoice 直调（TC3 签名 / LRU 缓存 / 零依赖）
├── scripts/wall-check.sh            # 留言墙线上自检（默认只读）
├── scripts/dev-api-server.mjs       # 本地联调：静态站 + 真实 Functions + 内存 KV
├── scripts/sync_site_data.py        # JSON → JS 快照，支持 --check
├── scripts/sync-pages-from-github.sh  # Cloudflare Pages 同步（api.github.com + 直传，幂等）
├── scripts/deploy-pages.sh          # Cloudflare Pages 兜底直传（支持 --dry-run）
├── scripts/pages-sync-daemon.sh     # launchd 包装脚本，补齐 node/npx 后执行同步
├── docs/ai-avatar-skins.md          # 3D AI 助手皮肤系统（设计 + 实施 + 迭代）
├── docs/observability-and-cms.md    # 教程：统计与内容管理接入
├── docs/ai-assistant-survey.md      # AI 简历问答后端（RAG）方案与实施
├── docs/ai-voice-survey.md          # 语音播报：免费 TTS 调研、选型、两期实施与线上验收
├── docs/jd-match.md                 # 岗位匹配：接口契约、检索与输出约束、部署与自测
├── docs/cloudflare-pages-deploy.md  # Cloudflare Pages 备用托管说明
├── docs/resume-delivery.md          # 留言墙 / 简历转发的部署、自检与排障
├── docs/TODO.md                     # 项目待办与未竟事项台账（唯一「还没做的事」清单）
├── worker/                 # 可选：自建 Cloudflare Worker 访客计数
├── .pages.yml              # Pages CMS 配置
├── .github/workflows/sync-site-data.yml  # JSON 变更后自动重建快照
└── favicon.png / favicon-64.png
```

## 数据驱动

站内所有文案、项目、证书、联系方式都集中在 `data/site-data.json` 一个文件里，改它即可，不用动 HTML：

- **线上**：`js/main.js` 用 `fetch('data/site-data.json?v=<时间戳>')` 读取，时间戳用于绕过 CDN 缓存
- **本地双击预览**：`file://` 下 `fetch` 不可用，自动回退到 `data/site-data.js` 快照
- **快照维护**：`python3 scripts/sync_site_data.py` 手动重建，或由 GitHub Actions 在 JSON 变更后自动重建

## 本地预览与部署

**本地预览**
```bash
# 方式一：直接双击 index.html 用浏览器打开
# 方式二：启动本地静态服务器
python3 -m http.server 8000
# 访问 http://localhost:8000
```

**GitHub Pages 部署**（本仓库已启用）
1. 将代码推送到 GitHub 仓库
2. 仓库 `Settings → Pages → Source: Deploy from a branch`
3. 选择 `main` 分支、`/ (root)` 目录，保存即自动上线

## 留言墙（主页 SEC.10）

匿名访客可公开留言，后端是 Cloudflare Pages Function + KV；主站 `github.io` 是纯静态，API 走备用站 `pages.dev`（双线路自动切换）。

- **线上自检**：`./scripts/wall-check.sh`（默认只读）。2026-11-16 已绑定 `SITE_KV`（`site-kv` namespace，Production 环境）并重新部署，`open=true`、11/11 全过，`./scripts/deploy-pages.sh` 部署结束也会自动检查这一项。绑定/环境变量变更需在控制台操作并重新部署才生效，见 [docs/resume-delivery.md](docs/resume-delivery.md) ②。
- **本地联调**：`node scripts/dev-api-server.mjs` → `http://127.0.0.1:8877/index.html`；`本地预览.command` 的 8765 是纯静态服务，没有 `/api`。
- **交互**：每页 20 条 + 加载更早、手动刷新、60 秒新留言提示、相对时间、`⌘/Ctrl + Enter` 提交、加载/错误状态；站长排障可加 `?wallDebug=1`。

## 可观测统计与内容管理

站点保持纯静态，统计与内容管理全部走免费服务，**不需要自建后端、不需要服务器**：

| 能力 | 服务 | 免费额度 | 配置位置 |
|---|---|---|---|
| 访问统计（PV/UV/来源/事件） | Umami Cloud | 10 万事件/月、1 站点、6 个月留存 | `js/analytics.js` → `umamiWebsiteId` |
| 行为观测（录屏/热图） | Microsoft Clarity | 不限流量 | `js/analytics.js` → `clarityProjectId` |
| 内容管理（网页改文案） | Pages CMS | 免费（GitHub App 直连） | `.pages.yml` |
| 数据同步（JSON→快照） | GitHub Actions | 公开仓库免费 | `.github/workflows/sync-site-data.yml` |
| 全站访问计数 | abacus（默认）/ Cloudflare Worker + KV（可选） | 免费 | `js/visitor-count.js` → `CONFIG` |

接入只需填 ID：`js/analytics.js` 顶部 `CONFIG` 留空 = 不加载、不发任何请求。

**教程入口**
- 完整接入教程（注册 → 拿 ID → 填配置 → 验证 → 排障）：[docs/observability-and-cms.md](docs/observability-and-cms.md)
- 只想快速跑通：看教程开头的「5 分钟最快路径」
- 教程里的账号授权步骤**必须本人操作**（第三方登录与 GitHub App 授权弹窗无法代办）

## 项目待办

所有「还没做的事」集中登记在 [docs/TODO.md](docs/TODO.md)：含状态、影响、前置条件、执行步骤与验收标准，
较大改动收尾时盘点一次。已决策暂缓的条目（如 Resend 发信域名验证）不是故障，别当 bug 修。

## 作者

**陈培胜** · AI Agent 工程师 · 广东深圳

- GitHub：https://github.com/shenge-work
- 作品集：https://shenge-work.github.io
- 邮箱：shenge.work@gmail.com

> AI生成
