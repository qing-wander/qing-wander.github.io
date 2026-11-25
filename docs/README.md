# 文档索引（docs/）

这个目录是项目的**设计与运维档案**：为什么这么选、踩过哪些坑、怎么验证、还差什么。
它不重复 README 的功能清单——README 回答「这是什么、怎么跑」，这里回答「为什么」和「怎么维护」。

> 最近一次全量整理：**2026-11-25**（对齐当时代码：数据上云、后台并入 `/admin`、RAG 迁到 Cloudflare）。

## 1. 从哪里开始读

| 你想做什么 | 先读 | 再看 |
|---|---|---|
| 第一次上手这个仓库 | [../README.md](../README.md) | 本文 §3 的「按角色路线」 |
| 改简历 / 主页内容 | [../README.md#数据与内容模型](../README.md#数据与内容模型) | [p0-single-source.md](p0-single-source.md) |
| 改后端 / 加接口 | [cloudflare-rag-admin-plan.md](cloudflare-rag-admin-plan.md) | [ai-assistant-survey.md](ai-assistant-survey.md) |
| 部署 / 排障 | [cloudflare-pages-deploy.md](cloudflare-pages-deploy.md) | [cloudflare-free-resources.md](cloudflare-free-resources.md) |
| 知道还剩什么没做 | [TODO.md](TODO.md) | — |

## 2. 文档地图

状态说明：**现行**＝与当前代码一致、可据此开发；**历史**＝记录当时的方案与踩坑，结论可能已被替代；
**台账**＝持续更新，不描述实现细节。

### 2.1 架构与后端

| 文档 | 内容 | 状态 | 最近核对 | 主要对应代码 |
|---|---|---|---|---|
| [cloudflare-rag-admin-plan.md](cloudflare-rag-admin-plan.md) | 总设计：单一真相源、RAG、JD 匹配、后台、可观测、免费额度测算 | 现行（规划 + 落地记录） | 2026-11-23 | `functions/api/**`、`db/schema.sql` |
| [ai-assistant-survey.md](ai-assistant-survey.md) | 问答助手 v1：可达性实测、TF-IDF + CloudBase、限流、日志、验收 V1–V11 | 历史（v1 链路，仍作踩坑参考） | 2026-11-25（补现状说明） | `functions/tencent/**`、`functions/api/chat.js` |
| [jd-match.md](jd-match.md) | 岗位匹配：需求拆条、字面覆盖核算、接口契约、验收 | 现行 | 2026-11-25 | `functions/api/jd.js`、`js/jd-match.js` |
| [ai-voice-survey.md](ai-voice-survey.md) | 语音：免费 TTS 选型、自动播放对策、两期实施 | 现行 | 2026-11-23 | `js/ai-voice*.js`、`functions/lib/tts.js`、`functions/tencent/tts.js` |
| [p0-single-source.md](p0-single-source.md) | P0 实施：单一真相源 + 留言板设备隔离 | 现行（含迁移前置条件） | 2026-11-23 | `scripts/build_rag_chunks.mjs`、`functions/api/wall.js` |

### 2.2 部署与运维

| 文档 | 内容 | 状态 | 最近核对 | 主要对应代码 |
|---|---|---|---|---|
| [cloudflare-pages-deploy.md](cloudflare-pages-deploy.md) | 主站托管：构建、部署、绑定、迁移、历史故障复盘 | 现行（2026-11-25 重写） | 2026-11-25 | `scripts/pages-build.sh`、`deploy-pages.sh`、`wrangler.toml` |
| [cloudflare-free-resources.md](cloudflare-free-resources.md) | 免费额度盘点、KV→D1 迁移与回滚 | 现行 | 2026-11-23 | `functions/api/visits.js`、`wall.js` |
| [resume-delivery.md](resume-delivery.md) | 留言板 + 简历投递：接口语义、限流、配置、排障 | 现行（2026-11-25 校正 D1/设备隔离） | 2026-11-25 | `functions/api/wall.js`、`deliver.js`、`lib/wall-notify.js` |
| [observability-and-cms.md](observability-and-cms.md) | 教程：Umami / Clarity / Pages CMS 接入；私密佐证材料加密申请—审批—签名取流链路 | 通用教程（站点现状以 README 为准） | 2026-11-25 | `js/analytics.js`、`functions/api/secure-asset.js`、`functions/lib/secure-access.js`、`js/secure-access.js` |

### 2.3 视觉与素材

| 文档 | 内容 | 状态 | 最近核对 | 主要对应代码 |
|---|---|---|---|---|
| [pet-self3d-pipeline.md](pet-self3d-pipeline.md) | 个人形象 3D 桌宠：制作流水线、参数、现状、优化交接 | 现行 | 2026-11-23 | `assets/skins/models/*.glb`、`js/ai-skins.js` |
| [ai-avatar-skins.md](ai-avatar-skins.md) | 皮肤系统演进：9 款 → 收敛为 2 套 3D 形象 | 历史（皮肤菜单已隐藏） | 2026-11-25（补现状） | `js/ai-skins.js`、`js/gender-switch.js` |
| [3d-character-library.md](3d-character-library.md) | three.js 官方人物资产盘点与入库 | 历史（素材池） | 2026-11-20 | `assets/character-views/`（不入库） |
| [mixamo-auto-rigging-guide.md](mixamo-auto-rigging-guide.md) | Mixamo 绑骨 + 动画导出流程 | 参考资料 | 2026-11-21 | `tools/character-pipeline/` |

### 2.4 复盘与台账

| 文档 | 内容 | 状态 | 最近核对 |
|---|---|---|---|
| [portfolio-capabilities-and-learnings.md](portfolio-capabilities-and-learnings.md) | 功能全景、能力矩阵、33 条经验、诚实缺口 | 现行（复盘） | 2026-11-18 |
| [TODO.md](TODO.md) | 唯一「还没做的事」台账（状态 / 影响 / 验收） | 台账 | 2026-11-25 |

## 3. 按角色路线

**内容维护者**：`data/site-data.json` → 生成脚本 → `--check` → push。
只看 [../README.md#数据与内容模型](../README.md#数据与内容模型)；要理解为什么不能手改 HTML，读 [p0-single-source.md](p0-single-source.md)。

**前端改动**：`js/main.js`（页面渲染与交互）、`js/jd-match.js`、`js/ai-*.js`。
语音与助手面板的边界见 [ai-voice-survey.md](ai-voice-survey.md)、[ai-avatar-skins.md](ai-avatar-skins.md)。

**后端改动**：先在纯函数里实现并补 `tests/*.test.mjs`，再挂到 `functions/api/`。
检索相关读 [cloudflare-rag-admin-plan.md](cloudflare-rag-admin-plan.md) 第 5 节；后台读第 7 节。

**运维**：部署链路看 [cloudflare-pages-deploy.md](cloudflare-pages-deploy.md)；留言/投递排障看
[resume-delivery.md](resume-delivery.md)；额度与迁移看 [cloudflare-free-resources.md](cloudflare-free-resources.md)。

## 4. 文档维护约定

1. **代码改了，文档同批改**：接口契约、环境变量、表结构、命令一变，对应文档与 README 必须一起改；
   PR 里把「文档是否同步」当作检查项（见 [../CONTRIBUTING.md](../CONTRIBUTING.md)）。
2. **状态要可判断**：每篇文档开头写清 `状态`（现行 / 历史 / 台账）与最后核对日期；
   被替代的方案不要删，标成「历史」并指出现行文档。
3. **待办只写一处**：新发现的缺口先登记 [TODO.md](TODO.md)，再回写专题文档，避免两处打架。
4. **不写不可复现的结论**：贴命令、贴返回码、贴日志；「应该可以」不算验收。
5. **敏感信息零入库**：手机号、验证码、API Key、真实设备哈希、后台会话，示例一律用占位符。

> 本文与 README 同步维护；新增文档请在上表登记，否则视为不存在。
