# 贡献指南（CONTRIBUTING）

先说清楚这个仓库的性质：它是**一个人的求职作品集**，不是通用产品。
欢迎修 bug、补文档、提可复用的工程改进；但涉及「换成别人的内容」「加广告/推广」「引框架重写」的改动不会被接受。

- 有疑问 / 想讨论：开 [Discussion](https://github.com/shenge-work/shenge-work.github.io/discussions) 或 Issue
- 安全漏洞：**不要开公开 issue**，按 [SECURITY.md](SECURITY.md) 私信
- 第一次贡献：从 `good first issue` 标签或文档纠错开始

---

## 1. 环境

| 依赖 | 版本 | 用途 |
|---|---|---|
| Node.js | 22+ | Functions、生成脚本、单测（使用内置 `node:sqlite`、`node:test`，无 npm 依赖） |
| Python | 3.9+ | JSON→JS 快照、TF-IDF 知识库（仅标准库） |
| wrangler | 可选 | 本地 D1 / Pages 调试，`npx wrangler` 即可 |

仓库**没有** `package.json`，不要为了跑测试引入依赖；测试用 `node --test` 直接执行。

```bash
git clone https://github.com/shenge-work/shenge-work.github.io.git
cd shenge-work.github.io
node scripts/dev-api-server.mjs      # http://127.0.0.1:8877/index.html
```

## 2. 先跑一遍闸门

提交前请在本地跑完，CI 跑的是同一套：

```bash
node --test tests/*.test.mjs
node scripts/validate_content.mjs
node scripts/render_resume.mjs --check
node scripts/render_work_details.mjs --check
python3 scripts/sync_site_data.py --check
node scripts/build_rag_chunks.mjs --check
bash scripts/pages-build.sh          # 可选，但改了 HTML/构建相关务必跑
```

## 3. 代码约定

### 前端（`js/`、`css/`）

- **零框架、零构建**：原生 HTML/CSS/JS，ES5 兼容（不用 `let`/箭头函数/模板字符串/`class`）；
  文件用 IIFE 包裹，不引入 bundler。
- 新增全局能力挂到 `window` 上并加注释，例如 `window.CPAI_SKINS`。
- 颜色、间距、阴影一律走 `css/style.css` 顶部的 CSS 变量，不要在组件里写死色值。
- 新交互必须**可降级**：接口失败、脚本被拦、`localStorage` 不可用时页面其余部分仍可用。
- 不要在 HTML 里拼未转义的用户输入；统一走 `esc()`。

### 后端（`functions/`）

- Cloudflare Pages Functions，ES Module（`export async function onRequestGet/Post`）。
- **优先零依赖**：能用 `fetch`、`crypto.subtle`、`node:sqlite`（本地）解决就不引包。
- 逻辑分层：可测的纯函数放 `functions/lib/`，路由只做参数校验、鉴权、限流与响应。
- 所有外部调用必须有超时与失败分支；失败时**降级而不是 500**（除非确实无法继续）。
- 新接口必须：CORS 白名单 → 输入校验 → 限流 → 业务 → 结构化错误码。

### 数据与内容

- 内容只改 `data/site-data.json`（或后台「站点数据」），**不要手改生成物**：
  `resume.html`、`work/*.html`、`data/site-data.js` 由脚本生成，CI 会逐字比对。
- 改完跑生成脚本：
  ```bash
  node scripts/render_resume.mjs
  node scripts/render_work_details.mjs
  python3 scripts/sync_site_data.py
  ```
- 新增字段时同步更新：模板（`templates/`）、渲染脚本、`scripts/validate_content.mjs` 的校验规则。

## 4. 隐私红线

**以下内容一律不得进入仓库、日志或测试夹具**：

- 真实手机号、身份证号、学信网验证码、家庭住址；
- API Key、Session Secret、Resend Key、微信 AppSecret；
- 真实访客的设备哈希、IP、留言正文。

测试用占位符（`13800000000`、`test@example.com`）。提交前自查：

```bash
git diff --cached | grep -nE '1[3-9][0-9]{9}|re_[A-Za-z0-9]{8,}|sk-[A-Za-z0-9]{8,}'
```

## 5. 提交规范

采用 Conventional Commits，描述用中文：

```
feat(wall): 留言支持站长回复
fix(deploy): 构建产物补齐 robots.txt
docs(readme): 重写部署章节
chore(kb): 重建 RAG 切片
```

- 一个提交做一件事；格式化改动单独提交。
- 不提交 `dist/`、`.temp/`、`.dev.vars`、`_*.html` 调试探针（已在 `.gitignore`）。

## 6. Pull Request

1. Fork → 新建分支（`fix/xxx`、`feat/xxx`、`docs/xxx`）。
2. 提交前跑完 §2 的闸门，并在 PR 描述里贴结果。
3. PR 模板会要求你确认：
   - [ ] 没有手改生成物
   - [ ] 没有引入隐私数据或密钥
   - [ ] 新增/修改的行为有测试或可复现的验证步骤
   - [ ] 相关文档（README / `docs/`）已同步
4. 涉及 UI 的改动请附截图（桌面 + 移动端各一张）。
5. 涉及数据库的改动请附迁移 SQL（放 `db/migrations/`，幂等、可重复执行）。

## 7. 文档要求

- 新增能力 = 新增/更新文档；文档索引在 [`docs/README.md`](docs/README.md)。
- 文档开头写清 `状态`（现行 / 历史 / 台账）与最后核对日期。
- 「还没做的事」只登记在 [`docs/TODO.md`](docs/TODO.md)，不要在专题文档里另起清单。

## 8. 不会被合并的改动

- 引入 React/Vue/Tailwind 等框架或构建链重写前端；
- 把作者的个人内容替换成他人/营销内容；
- 增加追踪脚本、广告、外链推广；
- 为了「好看」而删除降级分支、错误处理或隐私保护；
- 大规模无行为变化的格式化（会单独安排）。
