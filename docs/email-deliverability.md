# 域名邮箱与发信信誉：体检、选型与迁移 Runbook

> 对象：`chenpeisheng.cn`（DNS 托管 Cloudflare，收信走 Email Routing 转发到 QQ / Gmail）
> 关联代码：`functions/api/deliver.js`、`functions/lib/wall-notify.js`、`functions/lib/admin-login.js`（均通过 Resend 发信）
> 体检工具：`node scripts/mail-dns-audit.mjs [--expect feishu|tencent|google]`
> 链路复测：`node scripts/mail-e2e-test.mjs --to <某邮箱>`（自动过 PoW，等价于真人点「自动投递」）
> 最后更新：2026-11-26（飞书已切换，见 §11）

---

## 0. 结论先行

> **2026-11-26 下午更新：方案已落地。** `chenpeisheng.cn` 的 MX 已切到飞书（mx1/2/3.feishu.cn），
> `hi@chenpeisheng.cn` 邮箱已建好并能收信，Cloudflare Email Routing 已停用。
> 剩下两件收尾：**飞书 DKIM 还没启用**（后台权限不足，需超级管理员）、**DMARC 策略还停在 p=none**。
> 过程中的一次事故与修复见 §11，务必读一遍——同一个坑很容易再踩。

1. **现在这套不是"域名邮箱"，是"域名收件箱 + 借别人的身份发信"。** Cloudflare Email Routing 只负责收，没有 SMTP，永远发不了信；你在 QQ / Gmail 点回复，发件人就是 QQ / Gmail 地址，跟 `chenpeisheng.cn` 没有关系。
2. **"信誉被扣分"这个说法不准确，但你的直觉方向是对的。** 域名信誉不会掉——因为你根本没用它发过信；真正的损失是**它永远是 0 分的冷启动状态**，同时被消耗的是你 QQ / Gmail **个人账号**的信誉（账号级 + 共享 IP 池，你既控制不了也申诉不了）。
3. **"养号预热"这个概念要拆开。** 你做过的 RPA 养号是"账号养号"；域名发信是"域名冷启动"，只跟三件事有关：认证是否齐全、发信量是否平滑、投诉/退信是否够低。个人每天几十封的量，**不需要 IP 预热**（IP 是服务商的，早就预热好了）。
4. **Gmail 的 `Send as` 后门已经进入关闭倒计时**：Google 官方公告 2026 Q3 起限制新配置，**2027 年 1 月完全移除**第三方地址发信。也就是说，"继续用 Gmail 假装是 hi@"这条路今年内就会失效，不是"要不要优化"的问题，是"必须换"。
5. **推荐方案：飞书邮箱免费版承接 `hi@`，Resend 继续承接事务邮件。** 腾讯企业邮功能更"国内"，但卡 ICP 备案这道硬门槛；Google Workspace 最省心但要付费。三条路的取舍见第 3 节。

---

## 1. 实测现状（2026-11-26）

| 项目 | 实测值 | 判断 |
|---|---|---|
| MX | `route1/2/3.mx.cloudflare.net`（3 / 25 / 30） | 只收不发 |
| 根域 SPF | `v=spf1 include:_spf.mx.cloudflare.net ~all` | 这条 include 是给 Cloudflare 转发用的，**对"你用 hi@ 发信"零作用** |
| DMARC | `v=DMARC1; p=none;` | 无 `rua=`，收不到报告 = 完全盲飞；无 `adkim/aspf` |
| DKIM | 只有 `resend._domainkey` 和 `cf2024-1._domainkey` | `cf2024` 签的是"转发件"，不是你发出的信 |
| 事务邮件子域 | `send`：SPF（ip4×3）+ MX `feedback.forge.rmta.net` | Resend 记录其实**已经配好了**（见 1.1） |
| MTA-STS / TLS-RPT | 未配置 | 可选，不影响主流程 |

体检命令输出：通过 5 · 告警 4 · 致命 0（致命项为 0 是因为 SPF/DMARC 都存在，但都属于"配了等于没配"的状态）。

### 1.1 一个意外发现：Resend 的域名记录已经在 DNS 里

```
resend._domainkey.chenpeisheng.cn   TXT   p=MIGfMA0GCSqGSIb3DQEB...   ← 根域 DKIM 公钥
send.chenpeisheng.cn                TXT   v=spf1 ip4:52.3.252.119 ip4:44.222.39.36 ip4:199.249.231.0/24 ~all
send.chenpeisheng.cn                MX 10 feedback.forge.rmta.net
```

这三条正是 Resend 验证一个域名所需的完整组合（DKIM 在根域、Return-Path 与退信处理在 `send` 子域）。
**2026-11-26 已在 Resend 控制台确认：`chenpeisheng.cn` 状态为 `Verified`（创建于 3 天前）**，
所以 `docs/TODO.md` 里「未验证域名 → 只能发给注册邮箱」的结论已经过期。

> 这意味着"访客给 HR 邮箱自动投递简历"这个功能，只差一个环境变量 + 一次重新部署——两者已于 2026-11-26 完成（见 §10）。

---

## 2. 你的三个判断，逐条校准

### 2.1 "回复用 QQ / Gmail 会影响邮箱信誉度" —— 半对

| 维度 | 实际发生的事 |
|---|---|
| 你的域名信誉 | **不受损，但也不积累**。收件方看到的发件人是 `gmail.com` / `qq.com`，DMARC 校验的是它们的域，跟 `chenpeisheng.cn` 无关。代价是这个域名永远是"没发过信的新域"，将来真要用它发信时得从零冷启动。 |
| 你的个人邮箱信誉 | **在持续消耗**。Gmail / QQ 按"账号 + 发送 IP 池"计算信誉，你无法查看也无法干预；一旦被批量退信、被收件人点"举报垃圾邮件"，影响的是你所有私人邮件（包括验证码、账单）。 |
| 品牌一致性 | 收件人先看到 `hi@chenpeisheng.cn`，回复却来自 `1549xxxx@qq.com`——这本身就是一个"可疑信号"，企业邮件网关会把"同一线程里发件域突变"计入风控。 |
| 线程完整性 | 你的回复不落在 `hi@` 的会话里，换设备/换客户端就断链；将来想把 `hi@` 交给别人接手，历史对话全在私人邮箱里。 |

### 2.2 "投递垃圾箱率有影响" —— 对，但机制和你想的不一样

转发链路的真实情况：

- Cloudflare 转发时会做 **SRS（Sender Rewriting Scheme）**，把 envelope sender 改写成自己的域。于是 **SPF 对原发件域不再对齐**，DMARC 只能靠原发件人的 **DKIM 签名**活下来。
- 原发件人**有 DKIM**（Gmail、Outlook、大公司基本都有）→ 签名随着邮件体一起被转发，DMARC 仍然 pass，Gmail / Outlook 能正常进箱。
- 原发件人**没有 DKIM**（部分国内系统、老系统）→ DMARC 直接 fail。Cloudflare 会加 **ARC** 密封头，Gmail、Microsoft 认，**QQ / 163 对 ARC 的支持很弱** → 这类邮件进垃圾箱或静默丢弃的概率明显更高。
- 另一个常被忽略的点：转发件里**没有你域名的 DKIM 签名**。收件方的画像里，`chenpeisheng.cn` 是一个"从来没有正常发过信、却总在转发别人邮件"的域，这个画像对将来你真正发信没有任何帮助。

一句话：**转发不是"必然进垃圾箱"，但它是"永远建立不起自己的信誉"。**

### 2.3 "养号预热机制也有问题" —— 概念要分开

| 概念 | 适用对象 | 你现在的状态 |
|---|---|---|
| **IP 预热** | 自建 MTA / 买了独立 IP 的 ESP | 不适用。你用的是服务商共享 IP，早就预热过了 |
| **域名冷启动** | 任何新启用发信能力的域名 | **完全没做**：域名从未发过信，SPF 里那条 include 还是不存在的发信方 |
| **账号养号** | 社媒 / 邮箱账号（你之前做的 RPA 群控） | 与域名信誉无关，别把两套指标混在一起 |

个人低频场景（< 50 封/天）真正要做的只有三件：**认证齐全 → 发信量平滑上升 → 退信和投诉压住**。第 6 节给了 30 天节奏表。

---

## 3. 方案选型

### 3.1 对比

| 方案 | 费用 | 自定义域名 | 备案要求 | 单账号发信额度 | IMAP/SMTP | 海外链路 | 国内 QQ/163 到达 | 结论 |
|---|---|---|---|---|---|---|---|---|
| **飞书邮箱（基础版/免费）** | ¥0 | 支持 | **不需要** | 100 封/天、50 个外部收件人/天（企业认证后 400/200） | 支持（第三方客户端需生成专用密码） | 较好 | 好 | **主选** |
| 腾讯企业邮（基础版） | ¥0 | 支持 | **需 ICP 备案** | 约 500 封/天 | 支持 | 一般 | **最好**（与 QQ 同体系） | 备选，卡备案 |
| 腾讯企业邮（专业版） | ¥950/年起（5 账号起） | 支持 | 需备案 | 更高 | 支持 | 一般 | 最好 | 个人用性价比低 |
| **Google Workspace Business Starter** | US$7–9/月/人（≈ ¥600–780/年，以官网为准） | 支持 | 不需要 | 约 2,000 封/天 | 支持 | 最好 | 一般 | 想留在 Gmail 就选它 |
| Zoho Mail Lite | US$1–1.5/月/人（≈ ¥90–130/年，以官网为准） | 支持 | 不需要 | 较低 | 支持 | 好 | 一般 | 预算极紧的备选 |
| 继续 CF 转发 + Gmail Send-as | ¥0 | 名义上支持 | 不需要 | — | — | — | — | **2027-01 失效，不要选** |
| Cloudflare Email Sending | $5/月（Workers Paid，3,000 封） | 支持 | 不需要 | 3,000 封/月 | 无信箱 | 好 | 未知 | 只能做程序发信，不能当邮箱 |

### 3.2 为什么是飞书

1. **没有备案门槛**。`chenpeisheng.cn` 是 `.cn`，注册只强制实名；托管在 Cloudflare Pages（境外）不触发 ICP 备案。腾讯企业邮绑定自定义域名要求"已备案域名"，这道门槛对你大概率走不通——先去 `beian.miit.gov.cn` 查一次，查不到就别考虑腾讯了。
2. **免费且够用**。一个人每天几十封邮件，100 封/天的额度绰绰有余；50 个用户上限对个人品牌是浪费，但不要钱。
3. **协议齐全**。Webmail / App / IMAP / SMTP 都有，你可以继续用 Apple Mail、Spark 或 Gmail App（App 端仍支持第三方账号）收发，不必被绑死在飞书客户端。
4. **海外链路比腾讯好**。你投的是海外 + 国内双向岗位，飞书的海外投递口碑优于国内老牌企业邮（这是第三方实测结论，不是官方承诺）。

需要接受的代价：

- 免费版 15GB 是**企业共享空间**（即时消息/邮箱/云文档共用），企业认证后 100GB。
- 与飞书生态绑定；免费版额度属于"政策允许"而非"合同承诺"，量大时可能变。
- 100 封/天 + 50 个外部收件人/天，**绝对不能拿来做批量 cold email**，会直接触发服务商自己的限流退信。

### 3.3 什么情况下改选别的

- **收件人 80% 是国内 HR / 国企 / 传统企业，且域名已备案** → 腾讯企业邮基础版，QQ 体系内到达率无可替代。
- **你离不开 Gmail 网页端的快捷键、搜索、过滤器** → Google Workspace，`hi@chenpeisheng.cn` 直接变成 Gmail 主账号，没有 send-as 的破事，DMARC 也最干净。每月约 ¥55 买的是"不用改习惯"。
- **只是想让 `hi@` 能收能发，其它都无所谓** → 飞书，别犹豫。

---

## 4. 目标架构

```
                         ┌──────────────────────────────┐
   外部来信 ──MX─────────▶│  飞书邮箱  hi@chenpeisheng.cn │──SMTP/IMAP──▶ 你的客户端
                         │  DKIM d=chenpeisheng.cn       │
                         └──────────────────────────────┘
                                      ▲
                                      │ 人工回信（发件人就是 hi@）
                                      │
   站点触发 ──HTTPS──▶ Cloudflare Pages Functions ──API──▶ Resend
   （验证码 / 简历投递 / 留言通知）                        DKIM d=chenpeisheng.cn
                                                          Return-Path send.chenpeisheng.cn
```

三条原则：

1. **一个人工身份，一个程序身份。** 人工邮件走飞书（有信箱、有会话、有附件），事务邮件走 Resend（有 API、有送达回执、不占信箱额度）。
2. **两条流共用 `chenpeisheng.cn` 的 DKIM，但用不同的 Return-Path。** 量小、收件人都是主动触发，共用根域可以接受；将来要做冷邮件/批量，再拆 `mail.chenpeisheng.cn` 独立子域，别把批量信誉押在人工身份上。
3. **Cloudflare 继续管 DNS，但不再管收信。** Email Routing 与飞书 MX 互斥，迁移即停用；DNS 托管、Pages、Workers 都不受影响。

---

## 5. 迁移 Runbook

### 阶段 0 · 今天就能做，零风险（约 20 分钟）

| # | 动作 | 验证 |
|---|---|---|
| 0.1 | ✅ 已完成（11-26）：Resend 控制台确认 `chenpeisheng.cn` 为 `Verified` | Domains 列表显示绿色 `Verified` |
| 0.2 | ✅ 已完成（11-26）：Pages `shenge-work` → Production 变量 `RESEND_FROM` = `陈培胜 <hi@chenpeisheng.cn>`，并重试部署（部署 ID `16864ceb`，12:52 success） | 见 0.4 |
| 0.3 | ✅ 已完成（11-26）：`_dmarc` 加上 `rua=mailto:hi@chenpeisheng.cn; fo=1; adkim=r; aspf=r`（策略仍 `p=none`） | `dig TXT _dmarc.chenpeisheng.cn` 已返回新值；体检脚本不再提示"没有 rua" |
| 0.4 | ⏳ 待做：端到端复测（**必须走页面 UI**，不能直接 curl） | 见下方说明 |

> `/api/deliver` 有 PoW 凭证 + 来源白名单 + Turnstile 三重防护，直接 `curl` 会返回 `Forbidden`（2026-11-26 实测）。
> 复测只能打开 `https://chenpeisheng.cn/resume` → 页尾「自动投递 ✉」→ 填一个真实收件邮箱提交；
> 成功判据是页面不再出现 mailto 兜底按钮，且收件方看到的发件人是「陈培胜 `<hi@chenpeisheng.cn>`」。

> 注意：Resend API Key 是"仅发信"的受限 key，**加域名/查域名必须用主账号登录控制台**，改不了就用全权限 key 临时操作（用完删）。

### 阶段 1 · 飞书开户与域名验证（约 30 分钟，不影响现有收信）

> ✅ 已于 2026-11-26 完成（域名验证 TXT 已生效、`hi@` 邮箱已建），本节保留作步骤参考。

1. 注册飞书（企业类型选"小微企业 / 个人工作室"即可，无需营业执照）。
2. 管理后台 → 产品设置 → 邮箱 → 服务管理 → 域名管理 → 添加 `chenpeisheng.cn`。
3. 抄下后台给出的四组值：**验证 TXT**、**MX ×3**、**SPF**、**DKIM**（selector 以页面为准，不要照抄本文档）。
4. 只先加**验证 TXT** 到 Cloudflare（`@`，TXT）。此时不动 MX，收信完全不受影响。
5. 打开 `MIGRATION_WINDOW=true` 的心理准备：下一步要在 10 分钟内完成。

### 阶段 2 · 切换窗口（10 分钟，建议凌晨）

> ✅ 已于 2026-11-26 完成：MX 全部指向飞书，Cloudflare Email Routing 已停用（那三条 CF MX 已消失）。
> 唯一遗漏是第 5 步之后的 DKIM 没启用，见 §11.2。

> 关键：**先加飞书 MX，再关 Cloudflare Email Routing**。反过来的话，关掉 routing 会立刻删掉 CF 的 MX，中间会出现"域名无 MX"的空窗，来信直接退信。

1. Cloudflare DNS 加 3 条 MX：
   - `mx1.feishu.cn` 优先级 1
   - `mx2.feishu.cn` 优先级 5
   - `mx3.feishu.cn` 优先级 10
   此时两套 MX 并存，邮件会在 CF 与飞书之间轮询投递——**会出现少量重复件，但不会丢信**，这是刻意换来的安全边界。
2. 立刻去 Cloudflare → Email → Email Routing → **停用 / Disable**。CF 会自动移除它那 3 条 MX。
3. 回飞书后台点"验证"。
4. 把根域 TXT 的 SPF 换成飞书给的那条（官方形式 `v=spf1 +include:_netblocks.m.feishu.cn -all`）。**根域只能有一条 `v=spf1` 记录**，原来那条 CF 的必须删掉，两条并存会直接判 SPF 永久失败。
5. 加 DKIM 记录，飞书后台点验证。
6. 建 `hi@chenpeisheng.cn` 账号（建议同时建 `dmarc@` 别名，收聚合报告）。
7. 从外部邮箱（QQ / Gmail 各一封）发到 `hi@`，确认收到；再从飞书回一封，确认对方收到的发件人是 `hi@`。

**回滚**：Cloudflare → Email Routing → 重新启用（会自动加回 MX），删除飞书 3 条 MX。5 分钟内可恢复收信。

### 阶段 3 · 切换后 24 小时：验收

```bash
node scripts/mail-dns-audit.mjs --expect feishu
```

期望：**0 致命**，MX / SPF / DKIM 全部命中飞书。

再手工验两件事（脚本查不到）：

1. 用 QQ 邮箱发一封到 `hi@`，在飞书里看原文头：`Authentication-Results` 应含 `spf=pass`、`dkim=pass`。
2. 从飞书发一封到 Gmail，在 Gmail 点"显示原始邮件"：应看到 `dkim=pass header.d=chenpeisheng.cn`，且"发件人"旁没有 `via` 字样。

### 阶段 4 · 14 天后：收策略

| 时间 | DMARC 记录 | 前提 |
|---|---|---|
| D0 | `v=DMARC1; p=none; rua=mailto:dmarc@chenpeisheng.cn; fo=1; adkim=r; aspf=r` | 先观察，收报告 |
| D+14 | `v=DMARC1; p=quarantine; pct=100; rua=...; adkim=r; aspf=r` | 报告里 `dkim=pass` 占比 > 98%，且没有未知发信源 |
| D+30 | `v=DMARC1; p=reject; sp=quarantine; rua=...; adkim=r; aspf=r; fo=1` | 连续两周无异常；`sp=quarantine` 给子域留缓冲 |

> 不要在 DKIM 还没验证通过时上 `p=reject`——那等于把自己所有信直接退掉。

---

## 6. 冷启动与监控

### 6.1 30 天节奏（个人低频版，不是 ESP 那套）

| 阶段 | 每天发信量 | 内容 | 目的 |
|---|---|---|---|
| D1–D3 | 5–10 封 | 只发给**会回复你**的人（朋友、前同事、已联系的 HR） | 建立"有人愿意回"的正向信号 |
| D4–D7 | 10–20 封 | 正常求职信，可带 PDF 简历 | 让附件与链接也进入正常画像 |
| D8–D14 | 20–30 封 | 混入事务邮件（验证码、投递通知） | 验证两条流共存不互相拖累 |
| D15–D30 | 30–50 封 | 正常节奏 | 稳定即合格，不要冲量 |
| 长期 | ≤ 80 封/天 | 留 20% 余量给飞书限流 | 触发服务商限流会产生硬退信，比进垃圾箱更伤 |

**明确不要做**：

- 第一天就 BCC 50 个 HR——这是最典型的垃圾邮件特征，且会直接撞上飞书"50 个外部收件人/天"的硬限制。
- 用"邮件预热服务"给个人域名刷量。共享 IP 场景下刷量只会加速被标记。
- 在同一个域名上既做转发、又做批量群发、又做事务邮件。三者信誉互相污染。

### 6.2 指标与阈值

| 指标 | 健康值 | 怎么看 |
|---|---|---|
| 硬退信率 | < 1% | 飞书退信通知 / Resend Dashboard |
| 投诉率 | < 0.1% | Google Postmaster（量小可能无数据）、DMARC 报告 |
| DMARC 通过率 | > 98% | `dmarc@` 收到的聚合 XML，或用 Cloudflare DMARC Management 可视化 |
| 垃圾箱命中 | 0 / 4 | 种子测试：QQ、163、Gmail、Outlook 各发一封，人工确认落箱位置 |
| 认证得分 | 10/10 | 发一封到 `mail-tester.com` 给的临时地址，看评分与扣分项 |

### 6.3 推荐工具

- **`node scripts/mail-dns-audit.mjs`**：本仓库自带，迁移前后各跑一次，比人肉 dig 可靠。
- **mail-tester.com**：免费，给出 10 分制评分和具体扣分项（SPF/DKIM/DMARC/黑名单/内容）。
- **Cloudflare DMARC Management**：Dashboard 里一键接管 `rua`，把 XML 报告变成图表，免费。
- **Google Postmaster Tools**：验证域名所有权后可看 Gmail 侧的声誉/垃圾率，但**低频域名基本没数据**，别指望它。
- **MXToolbox**：查黑名单、SPF 语法、DKIM 选择器是否存在。

---

## 7. 与本仓库代码的衔接

| 位置 | 现状 | 迁移后 |
|---|---|---|
| `RESEND_FROM`（Pages 环境变量） | `Portfolio Resume <onboarding@resend.dev>` | `陈培胜 <hi@chenpeisheng.cn>` |
| `functions/lib/admin-login.js` 的 `DEFAULT_FROM` | `Portfolio Resume <onboarding@resend.dev>` | 无需改，环境变量优先；仅作兜底 |
| `functions/lib/wall-notify.js` 的 `DEFAULT_FROM` | `Portfolio Wall <onboarding@resend.dev>` | 同上 |
| `WALL_NOTIFY_TO` | 默认 `hi@chenpeisheng.cn` | 不变，MX 切换后依然可达 |
| 根域 SPF | `include:_spf.mx.cloudflare.net` | `include:_netblocks.m.feishu.cn` |
| `send.chenpeisheng.cn` | Resend 的 SPF + MX | **不动**，与飞书 MX 不冲突（不同主机名） |

改完环境变量**必须重新部署**，Pages 的变量不会热更新。

---

## 8. 成本与时间

| 项 | 费用 | 时间 |
|---|---|---|
| 飞书邮箱免费版 | ¥0 | 注册 + 配 DNS 约 30 分钟 |
| 切换窗口 | ¥0 | 10 分钟（建议凌晨） |
| Resend | 已有免费额度（100 封/天） | 改一个变量 + 重新部署，10 分钟 |
| 监控 | ¥0（Cloudflare DMARC + mail-tester） | 每周 5 分钟，持续 1 个月 |
| 合计 | **¥0**（若改选 Google Workspace：约 ¥650/年） | 首日 1 小时，之后 30 天轻量观察 |

---

## 9. 需要你确认的三件事

1. **`chenpeisheng.cn` 有没有 ICP 备案？** 去 `beian.miit.gov.cn` 查。查不到 → 腾讯企业邮直接排除。
2. **你的收件人主要是国内还是海外？** 国内为主且已备案 → 腾讯更稳；混合或海外偏多 → 飞书。
3. **愿不愿意每月付约 ¥55（US$7–9）换"原生 Gmail + 自己的域名"？** 愿意 → Google Workspace，一步到位，没有任何 send-as 的坑。

确定后按第 5 节执行；阶段 2 的 10 分钟窗口需要你本人在 Cloudflare 和飞书后台操作（涉及账号登录，脚本不代劳）。迁移完成后跑一次：

```bash
node scripts/mail-dns-audit.mjs --expect feishu
```

全绿即收工。

---

## 10. 执行记录（2026-11-26）

| 时间 | 动作 | 结果 |
|---|---|---|
| 12:48 | Resend → Domains | `chenpeisheng.cn` 状态 **Verified**（创建 3 天前），无需再动 DNS |
| 12:50 | Cloudflare Pages `shenge-work` → 生产 → 变量和密钥 | `RESEND_FROM` 由 `Portfolio Resume <onboarding@resend.dev>` 改为 `陈培胜 <hi@chenpeisheng.cn>`（值类型为"密钥"，保存后不可回读） |
| 12:51 | 部署 → 最新生产部署 `3aa66e4` → 管理部署 → 重试部署 | 新部署 `16864ceb`，12:52 状态 **success**，24s，别名含 `chenpeisheng.cn` |
| 12:56 | Cloudflare DNS → `_dmarc` TXT | 由 `v=DMARC1; p=none;` 改为 `v=DMARC1; p=none; rua=mailto:hi@chenpeisheng.cn; fo=1; adkim=r; aspf=r`，已生效（dig 复核通过） |
| 13:00 | ICP 备案查询 | **未完成**：工信部查询页要求滑块拼图验证码，第三方站点（Chinaz）要求微信登录，均未绕过。站长已确认：**未备案** → 腾讯企业邮出局 |
| 13:05 | 飞书邮箱开通 | **未完成**：当前 Chrome 登录的是「飞书个人用户 sheng」，创建企业才能进管理后台，而建企业需要手机号 + 短信验证码，无法代办 |

**仍待办**：

1. 飞书建企业（需手机短信验证）→ 之后我来配 DNS、建 `hi@`、切 MX。
2. 端到端发信复测（走 `resume` 页面的「自动投递」，不能 curl）。

---

## 11. 执行记录（2026-11-26 下午 · 续做与事故复盘）

> 上一轮因会话额度中断，本轮从实测复核开始，发现进度其实比文档记的更靠前——飞书已经切完了。

### 11.1 DNS 侧实测：阶段 2 已完成

| 项目 | 实测值（2026-11-26 15:00 前后） | 判断 |
|---|---|---|
| MX | `1 mx1.feishu.cn` / `5 mx2.feishu.cn` / `10 mx3.feishu.cn` | ✅ 已切飞书，Cloudflare 那三条 MX 已被移除（Email Routing 停用） |
| 根域 TXT | `v=spf1 include:_netblocks.m.feishu.cn include:amazonses.com -all` | ✅ 飞书已加；`amazonses.com` 是 Resend 的底层，**可留可删**（见 11.4） |
| 域名验证 | `verification-code-site-App_feishu=3jsD2sl5p9re0SiA5RW1` | ✅ 飞书域名验证已过 |
| DMARC | `v=DMARC1; p=none; rua=mailto:hi@chenpeisheng.cn; fo=1; adkim=r; aspf=r` | ⏳ 观察期，D+14 再升 quarantine |
| DKIM | 只有 `resend._domainkey`，**飞书 selector 不存在** | ❌ **缺口**，见 11.2 |

体检脚本结论从「通过 5 · 告警 4」变成 **「通过 7 · 告警 1 · 致命 0」**：

```
MX        ✓ 指向真实邮箱服务商（mx1/2/3.feishu.cn）
SPF       ✓ 单条 + 有 all 收尾
DKIM      ✓ 已启用 resend（但缺飞书的）
DMARC     ! p=none 只观察不拦截
send 子域  ✓ Resend 的 SPF / MX 原样保留，与飞书不冲突
```

### 11.2 飞书邮箱已建号，但缺 DKIM

- 登录进飞书邮箱（租户 `wcnj4xzurpeh`）确认**邮箱账号就是 `hi@chenpeisheng.cn`**，
  收件箱里已有「欢迎使用飞书邮箱」的欢迎信 → 收信通路是活的。
- 管理后台 `产品设置 → 邮箱 → 安全与反垃圾 → DKIM 身份验证` 打不开：
  当前登录账号**不是超级管理员**（提示「你没有访问该功能的权限，请联系 @用户254038」）。
  也就是说 DKIM 这一步必须由超级管理员 `用户254038` 本人操作，脚本代办不了。

**要补的动作（2 分钟）**：超管进后台 → 安全与反垃圾 → DKIM 身份验证 → 选 `chenpeisheng.cn` → 启用
→ 密钥长度选 2048 → 复制后台给的主机记录与 TXT 值 → 在 Cloudflare DNS 加一条 TXT
（主机名以**后台页面为准**，不要照抄本文档）→ 回后台点「立即验证」。

> 不补 DKIM 也能收能发（SPF 对齐已能过 DMARC），但少了签名：一旦邮件被转发、
> 或被 Gmail/Outlook 的严格策略审视，就只能靠 SPF 单腿站立，进垃圾箱的概率会高一档。

### 11.3 事故：`RESEND_API_KEY` 值为空，全站「自动投递」静默降级成 mailto

复测时页面底部没有报错，而是直接弹出「自动发信尚未配置（缺 RESEND_API_KEY），可用邮件客户端发送」。
这个文案只对应一个错误码 `resend_not_configured`，用浏览器同款请求头直接打接口确认：

```bash
curl -s -X POST https://chenpeisheng.cn/api/deliver \
  -H 'Content-Type: application/json' -H 'Origin: https://chenpeisheng.cn' \
  -H 'Referer: https://chenpeisheng.cn/resume' \
  -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/142.0.0.0' \
  -d '{"to":"probe@example.com"}'
# → 503 {"ok":false,"error":"resend_not_configured"}
```

**根因**：`functions/api/deliver.js` 里 `const apiKey = env.RESEND_API_KEY` 是空值。
但变量名在 Pages 生产环境里明明存在，且 Resend 后台显示「最后一次使用 ≈14 小时前」——
也就是 11-26 00:50 还在正常发验证码，之后才失效。时间点与 §10 里 **12:50 在控制台改 `RESEND_FROM`** 完全吻合：
Cloudflare Pages 的密钥类变量保存后不可回读，编辑某一行时如果整表提交，**其它行的空值会把原值覆盖掉**。

**修复**（已执行）：

1. Resend 后台新建一把 **Sending access** 的 key（`pages-deliver-20261126`），旧 key 保留待清理；
2. Pages → 设置 → 变量和密钥 → `RESEND_API_KEY` 重新填入，保存；
3. **重新部署**（Pages 的环境变量不热更新，必须新部署才注入）→ 接口恢复 200。

**教训（比结论更重要）**：

- 改 Pages 环境变量时**一次只改一行**，改完先确认其它密钥行仍显示「值已加密」，再点保存；
- `resend_not_configured` 与 `recipient_not_verified` 都是**降级为 mailto、页面不报错**的分支，
  用户视角完全无感。所以每次动完环境变量，必须跑一次
  `node scripts/mail-e2e-test.mjs --to <自己的邮箱>`，别靠肉眼看页面。

### 11.4 两处可选的收尾建议

1. **根域 SPF 里的 `include:amazonses.com` 可以删**。Resend 的发信信封域是 `send.chenpeisheng.cn`，
   它自己那条 SPF 已经覆盖；根域再 include 一次 SES 全池，等于把「谁有权代表 `chenpeisheng.cn` 发信」
   扩大到整个 SES 共享池，收益为零、面子上不干净。（删之前先跑一次 11.3 的复测，确认 DKIM 仍 pass。）
2. **`_dmarc` 的 `rua` 指向 `hi@`**，报告会和真人邮件混在一个收件箱。
   更干净的做法是建 `dmarc@chenpeisheng.cn` 别名专收聚合报告，`rua` 改指它。

### 11.5 本轮新增的两把工具

| 工具 | 用途 |
|---|---|
| `scripts/mail-dns-audit.mjs` | 体检 MX/SPF/DKIM/DMARC 现状，`--expect feishu` 校验迁移是否到位 |
| `scripts/mail-e2e-test.mjs` | 端到端复测：自动 `challenge → PoW → deliver`，与真人点「自动投递」等价，不需要浏览器、不碰密钥 |

```bash
node scripts/mail-dns-audit.mjs --expect feishu          # 期望 0 致命
node scripts/mail-e2e-test.mjs --to you@example.com      # 期望 200 + 邮件真的到了
```

> AI生成
