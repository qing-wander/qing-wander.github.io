# Cloudflare Pages 备用托管

GitHub Pages 之外的备用线路，同一套静态文件。当前线上地址：

- 作品集主页：https://shenge-work.pages.dev/
- 在线简历：https://shenge-work.pages.dev/resume.html

## 当前实际形态（2026-11-18 实测）

项目 `shenge-work` 已配置为 GitHub 数据源（`shenge-work/shenge-work.github.io`，生产分支 `main`），
**GitHub App 授权已生效，`push` 即触发自动构建**——这是当前主链路。

2026-11-17 实测证据（推翻 2026-11-11 版文档里「push 不会触发构建」的结论）：

- 远端 commit `d5de5afe`（18:41:23Z）后 3 秒，Pages 产生 production 部署 `0a522e4f`（18:41:26Z）；
- `deployment_trigger.type = github:push`，`commit_hash = d5de5afe…`，各 stage 全部 success；
- 自动构建后线上 `GET /api/wall?peek=1` → `200 {"ok":true,"open":true}`；
  `POST /api/deliver` → `400 bad_request`（正常参数校验），说明 `functions/` **没有被自动构建冲掉**，
  仍被 Pages 编译成 Functions（虽然不进 `dist`）。

保留的两条兜底通道（自动构建正常时不需要用）：

1. **手动强制同步**（远端 main 直传，幂等）
   ```bash
   ./scripts/sync-pages-from-github.sh --force   # 忽略状态，立即按远端 main 部署
   ./scripts/sync-pages-from-github.sh --check   # 只看远端有无新提交
   ./scripts/deploy-pages.sh                     # 按本地工作区直传（紧急修复用，支持 --dry-run）
   ```
2. **本机 launchd 定时同步（历史方案，已不再是主链路）**
   - 每小时跑一次 `scripts/sync-pages-from-github.sh`；commit 未变则跳过，部署后逐文件比对 md5
   - 日志：`~/Library/Logs/pages-sync.log`、`~/Library/Logs/pages-sync.err.log`
   - 状态：`~/.local/state/pages-sync/shenge-work.last-commit`
   - 停用：`launchctl bootout gui/$(id -u)/com.shenge.pages-sync`
   - 说明：该方案为「Cloudflare 未授权 GitHub App」时期的替代手段，当前机器/系统更换后无需再恢复

> 结论：**改静态文件只需 push**；只有云函数（CloudBase）与 Pages 环境变量需要单独处理。

## 项目配置

| 项 | 值 |
|---|---|
| 项目名 | `shenge-work` |
| 数据源 | GitHub `shenge-work/shenge-work.github.io`，生产分支 `main` |
| 构建命令 | `mkdir -p dist && cp -r index.html resume.html css js data images videos assets favicon-64.png favicon.png dist/` |
| 输出目录 | `dist` |
| 根目录 | 仓库根（留空） |

仓库里的 `functions/`（腾讯云函数源码）、`worker/`、`docs/`、`scripts/` 不进构建产物，只部署前端真正要用的文件。

## 跨域（CORS）白名单

页面的 AI 问答走腾讯云 CloudBase 函数 `resume-ai-chat`，它按 `Origin` 做白名单校验（见 `functions/tencent/index.js`），不放行就返回 403 `origin_denied`，浏览器侧报 CORS 错误。

- 平台环境变量 `ALLOWED_ORIGINS`（逗号分隔）**优先于代码默认值**。当前线上已配置为：
  ```
  https://shenge-work.github.io,https://shenge-work.pages.dev,*.shenge-work.pages.dev
  ```
  实测两个正式域名均回显自身 ACAO，外来域名返回 403。
- 代码默认值同样包含 `https://shenge-work.github.io`、`https://shenge-work.pages.dev`，以及通配规则 `*.shenge-work.pages.dev`（覆盖每个 commit 的预览部署 `https://<commit>.shenge-work.pages.dev`）。
- **通配规则需要「新代码 + 新配置」同时到位**：旧线上包只做精确匹配，而当时环境变量也是精确列表，所以预览子域曾一直 403。
  2026-11-18 已在控制台把 `*.shenge-work.pages.dev` 写进环境变量（保存即生效，无需重新部署代码）；
  若某次部署后预览域又变 403，先查环境变量是否被覆盖，再查函数包是否是旧版。

## 与 GitHub Pages 的关系

- 两边跑同一份仓库，最终内容一致
- 统计 / 计数 / AI 问答后端与域名无关，两边共用同一套
- 已知差异：Pages 默认 pretty URL，`/resume.html` 会 308 跳到 `/resume`；GitHub Pages 保持 `/resume.html`
