# 安全策略（Security Policy）

## 支持范围

本站是一个公开的静态站点 + Cloudflare Pages Functions，重点保护对象：

| 范围 | 说明 |
|---|---|
| `/api/**` | 问答、检索、留言、投递、学历核验、公司档案互动、后台接口 |
| `/admin`、`/login` | 管理后台（会话、CSRF、权限边界） |
| 数据 | D1 中的站点内容、留言、问答日志、设备哈希 |
| 密钥 | Cloudflare 环境变量、Resend、腾讯云、微信 AppSecret |

## 报告漏洞

**请勿开公开 Issue**，直接邮件联系：

- 邮箱：**hi@chenpeisheng.cn**（主题加 `[SECURITY]`）
- 也可用 GitHub 的 [Private vulnerability reporting](https://github.com/shenge-work/shenge-work.github.io/security/advisories/new)

请在邮件里给出：影响范围、复现步骤（curl 或截图）、可能的修复方向。
**不要**在报告里附带真实访客数据或他人的个人信息。

响应预期：48 小时内确认收到，7 天内给出评估与修复计划；修复上线后会在
[CHANGELOG](CHANGELOG.md) 中记录（不披露细节直到修复部署完成）。

## 已知的、按设计接受的风险

这些不是漏洞，报告前请先确认：

1. **简历内容本身是公开的**：姓名、邮箱、工作经历、项目细节都用于求职展示。
   手机号与学信网验证码在公开仓库中是占位符，真实值只在 D1。
2. **留言板的「设备隔离」是隐私分区，不是身份认证**：清缓存即新设备，`device_id` 可伪造。
   它解决的是「不想让陌生人看到我写的话」，不承诺抗攻击。
3. **无密码后台**：登录依赖邮箱验证码白名单与微信授权，安全边界在 `ADMIN_EMAILS` /
   `WECHAT_ALLOW_OPENIDS` 白名单与 30 天会话；不提供账号密码登录。
4. **限流是尽力而为**：内存 + D1 计数，跨实例有窗口误差；不承诺抵御大规模 DDoS
   （那属于 Cloudflare 平台层）。
5. **Resend 未验证发信域名**：投递只能发到账号邮箱，其他地址走 mailto 兜底（见 `docs/TODO.md` T1）。

## 我们特别关心的漏洞

- 鉴权绕过：未登录访问 `/admin` 或其接口、CSRF、会话伪造；
- 注入：D1 SQL 拼接、提示词注入导致越权信息泄露；
- 越权读取：通过 `/api/wall` 读到其他设备留言、后台导出泄露他人数据；
- 密钥泄露：仓库、构建产物、前端源码中出现真实密钥；
- XSS：留言 / 公司档案评论 / JD 输入未转义；
- 邮件滥用：投递接口被当作垃圾邮件跳板（PoW / 限流绕过）。

## 安全实践（维护者自查）

- 密钥只放 Cloudflare 环境变量；本地用 `.dev.vars` / `.secrets.local`（已 gitignore）。
- 所有用户输入统一校验 + 截断 + 转义；SQL 一律参数绑定。
- 后台两层守卫：`functions/_middleware.js`（页面 302）+ `requireAdmin`（接口 401）。
- 提交前自查：`git diff --cached | grep -nE '1[3-9][0-9]{9}|re_[A-Za-z0-9]{8,}'`。
- 定期：`./scripts/wall-check.sh`、`./scripts/backup-d1.sh`。
