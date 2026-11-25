#!/usr/bin/env bash
# 作品集静态站 —— Cloudflare Pages 部署脚本（GitHub Pages 之外的备用托管）
#
# 用法：
#   ./scripts/deploy-pages.sh              # 直接上传当前静态文件到 shenge-work 项目
#   ./scripts/deploy-pages.sh --dry-run    # 只打印会传哪些文件，不真的部署
#   WRANGLER_BIN=/path/to/wrangler.js ./scripts/deploy-pages.sh
#                                         # npx 缓存损坏时直接指定已下载的 wrangler 入口
#
# 线上地址：
#   生产环境  https://shenge-work.pages.dev
#   预览环境  https://<commit>.shenge-work.pages.dev
#
# 说明：
#   · 上传静态资源（根目录全部 .html / CSS / JS / data / images / videos /
#     assets(3D 皮肤，排除 character-views 原始素材) / favicon）及 functions/api
#     （Cloudflare Pages Functions：留言墙 /api/wall、简历投递 /api/deliver）；
#     产物统一由 scripts/pages-build.sh 生成，GitHub 自动构建的控制台命令为：
#       Build command = bash scripts/pages-build.sh ／ Output dir = dist
#     不上传 functions/tencent（腾讯云函数源码）、worker/、.git、docs、
#     assets/character-views；
#   · assets/character-views 为混元/Mixamo 原始素材（约 573MB，含 28–49MB 单文件），
#     不参与线上部署；已从 git 移除（.gitignore 排除），整目录归档到飞书云盘：
#     https://my.feishu.cn/drive/folder/BnalfpLM8lzNYLdkYu3cqH71nAc
#     （用 lark-cli drive +pull 拉回；旧的 R2 方案因账号无支付方式已废弃，见 docs/TODO.md T23）；
#   · Functions 需在 Pages 项目 Settings 里绑定 KV（SITE_KV）与变量
#     （RESEND_API_KEY 等），见 docs/resume-delivery.md；
#   · Cloudflare Pages 单文件上限 25MB；线上最大文件为 videos/lessie-demo.mp4 约 9.8MB；
#     原始模型素材已从部署清单排除并移出仓库，详见 docs/TODO.md T23。
#   · 首次部署需登录：npx wrangler login（本机已登录，凭据在 ~/Library/Preferences/.wrangler）。

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PROJECT="shenge-work"
BRANCH="main"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/portfolio-pages.XXXXXX")"

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg"; exit 2 ;;
  esac
done

trap 'rm -rf "$STAGE"' EXIT

# Functions 侧要渲染简历变体，模板/数据必须先嵌入（生成物，勿手改）
node scripts/embed_assets.mjs

echo "=== ① 构建 Pages 产物（与 GitHub 自动构建共用 scripts/pages-build.sh）"
# 以前这里维护了一份静态资源白名单，Cloudflare 控制台里还有另一份更旧的白名单，
# 两边都漏掉 jd.html / company.html / 404.html 与 functions/，导致 pages.dev 上
# 点 hero「JD 匹配」跳到 /jd.html 后被 SPA fallback 吞回首页（github.io 一直正常）。
# 现在自动构建与手动部署共用同一个脚本：根目录 HTML 自动收集，新增独立页无需改白名单。
bash scripts/pages-build.sh
rsync -a "$ROOT/dist/" "$STAGE/"
echo "   已纳入 HTML：$(cd "$STAGE" && ls -1 *.html | tr '\n' ' ')"
if [ ! -d "$STAGE/functions/api" ]; then
  echo "✗ 缺少 functions/api（留言墙 / 投递函数）"
  exit 1
fi

FILE_COUNT=$(find "$STAGE" -type f | wc -l | tr -d ' ')
TOTAL_SIZE=$(du -sh "$STAGE" | awk '{print $1}')
echo "   $FILE_COUNT 个文件，合计 $TOTAL_SIZE"

BIG=$(find "$STAGE" -type f -size +25M 2>/dev/null || true)
if [ -n "$BIG" ]; then
  echo "✗ 以下文件超过 Cloudflare Pages 单文件 25MB 上限："
  printf '%s\n' "$BIG"
  exit 1
fi

echo "=== ② 前置检查：wrangler 登录状态"
# npx 缓存损坏（npm EIO / .bin rename 失败）时，可绕开 npx 直接指向已下载的
# wrangler 入口 JS：WRANGLER_BIN=.../node_modules/wrangler/bin/wrangler.js ./scripts/deploy-pages.sh
if [ -n "${WRANGLER_BIN:-}" ]; then
  WRANGLER=(node "$WRANGLER_BIN")
else
  # 固定版本：npm 镜像把 latest 指向了尚未发布的 4.165.0，@latest 会 ETARGET 失败
  WRANGLER=(npx --yes wrangler@4.164.0)
fi
if ! "${WRANGLER[@]}" whoami >/dev/null 2>&1; then
  echo "尚未登录 Cloudflare，先执行：npx wrangler login"
  exit 1
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "=== ③ dry-run：待上传清单"
  (cd "$STAGE" && find . -type f | sed 's|^\./|   |' | sort)
  echo "（未实际上传）"
  exit 0
fi

echo "=== ③ 部署到 Cloudflare Pages（项目 ${PROJECT} / 分支 ${BRANCH}）"
# 在暂存目录里执行，wrangler 的 .wrangler 缓存就不会落到仓库根目录
(cd "$STAGE" && "${WRANGLER[@]}" pages deploy . \
  --project-name="$PROJECT" \
  --branch="$BRANCH" \
  --commit-dirty=true)

echo "=== ④ 验证线上"
PROD="https://$PROJECT.pages.dev/"
for path in "" resume.html company.html school.html jd.html data/site-data.json css/style.css js/main.js css/jd-match.css js/jd-match.js css/school-profile.css js/school-profile.js data/school-profiles.js; do
  code=$(curl -sL --ipv4 -o /dev/null -w '%{http_code}' -A "Mozilla/5.0" "${PROD}${path}")
  echo "   ${code}  ${PROD}${path}"
done
# 独立页不能只是 200：SPA fallback 也会 200 但返回首页，用 title 兜底核对
for path in jd.html company.html school.html; do
  title=$(curl -sL --ipv4 -A "Mozilla/5.0" "${PROD}${path}" | grep -o '<title>[^<]*</title>' | head -1)
  case "$title" in
    *"求职作品集 2026"*) echo "   ⚠ ${path} 疑似回退到首页（title=${title}）" ;;
    *) echo "   ${path} title=${title}" ;;
  esac
done
echo "本地首页 md5: $(md5 -q index.html)"
echo "线上首页 md5: $(curl -sL --ipv4 -A "Mozilla/5.0" "$PROD" | md5 -q)"

echo "=== ⑤ 留言墙接口自检（KV 绑定容易漏，部署后直接看结果）"
WALL_STATE=$(curl -s -m 15 "${PROD}api/wall" | python3 -c \
  'import sys,json
try:
    d=json.load(sys.stdin); print("true" if d.get("open") else "false (%s)" % (d.get("reason") or "unknown"))
except Exception: print("unreachable")' 2>/dev/null || echo 'unreachable')
echo "   /api/wall open=$WALL_STATE"
if [ "$WALL_STATE" != "true" ]; then
  echo "   ⚠ 留言墙未开放：Cloudflare Pages → Settings → Functions → KV namespace bindings"
  echo "     添加变量名为 SITE_KV 的绑定，保存后重新部署（绑定变更不会热更新）。"
  echo "     详见 docs/resume-delivery.md；一键自检：./scripts/wall-check.sh"
fi
echo
echo "完成：$PROD"
