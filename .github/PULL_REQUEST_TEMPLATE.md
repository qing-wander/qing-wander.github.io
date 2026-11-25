## 改了什么

<!-- 一两句话说清动机与结果，不要只贴文件列表 -->

## 类型

- [ ] 修复 bug
- [ ] 新功能 / 改进
- [ ] 文档
- [ ] 重构 / 工程卫生（无行为变化）
- [ ] 数据 / 内容更新

## 验证

<!-- 贴命令与结果，或截图（UI 改动请附桌面 + 移动端） -->

```bash
node --test tests/*.test.mjs
node scripts/validate_content.mjs
```

## 自查清单

- [ ] 没有手改生成物（`resume.html` / `work/*.html` / `data/site-data.js`），改的是数据或模板
- [ ] 没有提交隐私数据或密钥（手机号、验证码、`re_` / `sk-` 开头的 Key、真实设备哈希）
- [ ] 新增逻辑有测试或可复现的验证步骤（是否补了 `tests/*.test.mjs`）
- [ ] 涉及表结构时，迁移 SQL 已放到 `db/migrations/` 且可重复执行
- [ ] 相关文档已同步（README / `docs/`；新增文档已在 `docs/README.md` 登记）
- [ ] 前端改动仍保持零框架、ES5 兼容，并保留降级分支
