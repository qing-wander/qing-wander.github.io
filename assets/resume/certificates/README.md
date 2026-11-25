# 自动投递 · 附加证书附件目录

简历页「自动投递」弹窗里有 4 个附加材料勾选框（默认不勾选）：

| 勾选框 | 需要放入的文件名 | 邮件里的显示名 |
|---|---|---|
| 身份证复印件 | `id-card.pdf` | 身份证复印件.pdf |
| 学历证书 | `diploma.pdf` | 学历证书.pdf |
| 学位证书 | `degree.pdf` | 学位证书.pdf |
| 其他相关资质证书 | `other-qualifications.pdf` | 其他相关资质证书.pdf |

## 现状

文件**尚未提供**，所以现在勾选这些框时，后端取文件会 404 → 跳过附件，并在邮件正文标注「文件待补充，本次未随信附上」。功能链路已经打通。

## 如何启用

把对应 PDF 按上表文件名放进本目录即可，无需改代码：

- 后端 `functions/api/deliver.js` 用 `fetch(new URL(path, request.url))` 读取本站静态资源，转成 base64 作为 Resend 附件；
- 文件名 / 路径映射在 `functions/lib/deliver-content.js` 的 `CERT_SLOTS` 里，要改名改那里；
- 单附件上限 12MB（代码常量 `MAX_ATTACH_BYTES`），Resend 全封上限 40MB；
- 建议证书里敏感信息自行打码，勾选即代表投递人同意随信发送。

PDF 简历附件（`assets/resume/chen-peisheng-resume-2026.pdf`）由 `node scripts/render_print_previews.mjs` 自动生成，勿手改。
