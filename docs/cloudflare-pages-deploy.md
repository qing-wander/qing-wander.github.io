# Cloudflare Pages 备用托管

GitHub Pages 之外的备用线路，同一套静态文件。当前线上地址：

- 作品集主页：https://shenge-work.pages.dev/
- 在线简历：https://shenge-work.pages.dev/resume.html

## ⚠️ 当前故障：自动构建连续失败，`pages.dev` 停在旧版（2026-11-20）

**现象**：`github.io` 已是最新版（含男女双 3D 形象），`pages.dev` 仍是 11-19 旧版，看不到新模型。
两个域名内容不一致（登记为 [TODO.md T22](TODO.md)）。

**根因**：构建命令把整个 `assets/` 拷进 `dist`，而 `assets/character-views/` 里有 27.5MiB 的
`female.fbx` 等多个超过 **Cloudflare Pages 单文件 25MiB 上限**的原始素材。构建日志原文：

```
Executing user command: mkdir -p dist && cp -r index.html resume.html css js data images videos assets favicon-64.png favicon.png dist/
✘ [ERROR] Error: Pages only supports files up to 25 MiB in size
  assets/character-views/model/female/female.fbx is 27.5 MiB in size
Failed to validate assets in the output directory with code: 1
```

`wrangler pages deployment list --project-name=shenge-work` 显示自 `aedf7ac`（11-20）起
**7 个 production 部署全部 `Failure`**；线上在跑的是 23 小时前的 `01b2e1f`（11-19）。
GitHub Pages 不吃这条构建命令、也无 25MiB 限制，所以没受影响。

**已根治（2026-11-21）**，分两步，均不需要改 build command、不需要 R2/支付：

1. **止血**（11-20 23:50）：wrangler 直传，`deploy-pages.sh`（已排除 `character-views`）
   产出 70 文件 / 33MB，新 production 部署 `6241af37-852a-4075-855e-e0984418b8df`。
2. **根治**（11-21）：把 `assets/character-views/` 57 文件 / 573MB 整目录归档到飞书云盘
   （`https://my.feishu.cn/drive/folder/BnalfpLM8lzNYLdkYu3cqH71nAc`），`git rm --cached` + `.gitignore`
   从仓库移除并 push。build command `cp -r ... assets ... dist/` 不再碰到大文件，
   Cloudflare 自动构建从连续 `Failure` 恢复为 `Success`。

两站现均引用 `ai-skins.js?v=20261120K5`、均含 `female3d`，首页 md5 一致
（`efe367f5521b35298ccd1c60487c89dc`）。原始素材移出后本地物理文件仍保留，
需要可从飞书 `+pull` 拉回，详见 [TODO.md T22 / T23](TODO.md)。

> 历史背景：原计划归档到 Cloudflare R2，但账号无支付方式无法启用（错误 `10042`），
> 已改用飞书云盘；`scripts/r2-sync.sh` 保留作参考但不再使用。
> 未做：git 历史瘦身（filter-repo 强推，破坏性），工作区已清爽但 `.git` 历史仍含旧体积。

## 当前实际形态（2026-11-18 实测；构建命令缺陷见上节）

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
  https://chenpeisheng.cn,https://shenge-work.pages.dev,*.shenge-work.pages.dev
  ```
  实测两个正式域名均回显自身 ACAO，外来域名返回 403。
- 代码默认值同样包含 `https://chenpeisheng.cn`、`https://shenge-work.pages.dev`，以及通配规则 `*.shenge-work.pages.dev`（覆盖每个 commit 的预览部署 `https://<commit>.shenge-work.pages.dev`）。
- **通配规则需要「新代码 + 新配置」同时到位**：旧线上包只做精确匹配，而当时环境变量也是精确列表，所以预览子域曾一直 403。
  2026-11-18 已在控制台把 `*.shenge-work.pages.dev` 写进环境变量（保存即生效，无需重新部署代码）；
  若某次部署后预览域又变 403，先查环境变量是否被覆盖，再查函数包是否是旧版。

## 与 GitHub Pages 的关系

- 两边跑同一份仓库，**正常时**最终内容一致；**2026-11-20 起因 T22 构建失败暂时分叉**（pages.dev 旧、github.io 新）
- 统计 / 计数 / AI 问答后端与域名无关，两边共用同一套
- 已知差异：Pages 默认 pretty URL，`/resume.html` 会 308 跳到 `/resume`；GitHub Pages 保持 `/resume.html`
- **发布链路差异是 T22 的根源**：GitHub Pages 直接发布仓库静态文件、无单文件大小限制；
  Cloudflare Pages 走「build command → `dist` → 上传校验」，受 25MiB/文件上限约束，
  所以同一份仓库里一旦出现 >25MiB 文件，只有 pages.dev 会构建失败。改大文件时务必先看这一节。
