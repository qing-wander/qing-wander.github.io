#!/usr/bin/env bash
# ⚠️ 已废弃（2026-11-21）：Cloudflare 账号无支付方式无法启用 R2，本脚本不再使用。
# 原始素材改为归档到飞书云盘（https://my.feishu.cn/drive/folder/BnalfpLM8lzNYLdkYu3cqH71nAc），
# 并已从 git 移除；详见 docs/TODO.md T23。本文件仅作历史方案参考，保留勿删。
#
# 把不参与线上部署的大体积静态素材归档到 Cloudflare R2。
#
# 前置条件：
#   1) Cloudflare 账号已启用 R2（dashboard → R2 Object Storage → 启用）
#   2) 本机已执行 npx wrangler login（凭据在 ~/Library/Preferences/.wrangler）
#
# 用法：
#   ./scripts/r2-sync.sh            # 创建桶（如不存在）+ 上传 + 配 CORS + 开 r2.dev
#   ./scripts/r2-sync.sh --dry-run  # 只打印待上传清单，不调用 API
#
# 归档后的 URL 形如：
#   https://<bucket>.<account>.r2.dev/character-views/model/female/female.glb
#   https://<bucket>.<account>.r2.dev/videos/lessie-demo.mp4
# 生产环境建议用 `wrangler r2 bucket domain add <bucket> <域名>` 绑定自定义域名。

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
BUCKET="shenge-assets"
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

# 优先使用本机已缓存的 wrangler 4.164.0，避免 npx 反复解析/下载
WRANGLER_BIN="${WRANGLER_BIN:-$HOME/.npm/_npx/3ab751a803c3c994/node_modules/wrangler/bin/wrangler.js}"
if [ -f "$WRANGLER_BIN" ]; then
  WRANGLER=(node "$WRANGLER_BIN")
else
  WRANGLER=(npx --yes wrangler@4.164.0)
fi

echo "=== ① 待上传清单"
if [ ! -d assets/character-views ]; then
  echo "✗ 缺少 assets/character-views/，先检查仓库是否完整" >&2
  exit 1
fi
COUNT=$(find assets/character-views -type f ! -name '.DS_Store' | wc -l | tr -d ' ')
SIZE=$(du -sh assets/character-views | awk '{print $1}')
echo "   character-views: $COUNT 个文件，合计 $SIZE"
if [ -f videos/lessie-demo.mp4 ]; then
  echo "   videos/lessie-demo.mp4: $(du -h videos/lessie-demo.mp4 | awk '{print $1}')"
fi

if [ "$DRY_RUN" = "1" ]; then
  find assets/character-views -type f ! -name '.DS_Store' | sed 's|^assets/||;s|^|   |' | sort
  echo "   videos/lessie-demo.mp4"
  echo "（dry-run 结束，未调用 Cloudflare API）"
  exit 0
fi

echo "=== ② 确认 R2 可用"
if ! "${WRANGLER[@]}" r2 bucket list >/dev/null 2>&1; then
  echo "✗ R2 未启用或 wrangler 未登录。" >&2
  echo "  请先到 https://dash.cloudflare.com → R2 Object Storage 启用 R2，" >&2
  echo "  再执行 npx wrangler login，然后重跑本脚本。" >&2
  exit 1
fi

echo "=== ③ 创建 bucket（已存在则跳过）"
if "${WRANGLER[@]}" r2 bucket info "$BUCKET" >/dev/null 2>&1; then
  echo "   bucket $BUCKET 已存在"
else
  "${WRANGLER[@]}" r2 bucket create "$BUCKET"
fi

echo "=== ④ 上传文件"
upload_one() {
  local src="$1" key="$2"
  echo "   → $key ($(du -h "$src" | awk '{print $1}'))"
  "${WRANGLER[@]}" r2 object put "$BUCKET/$key" --file "$src" >/dev/null
}
while IFS= read -r -d '' f; do
  upload_one "$f" "${f#assets/}"
done < <(find assets/character-views -type f ! -name '.DS_Store' -print0)
if [ -f videos/lessie-demo.mp4 ]; then
  upload_one "videos/lessie-demo.mp4" "videos/lessie-demo.mp4"
fi

echo "=== ⑤ 配置 CORS"
"${WRANGLER[@]}" r2 bucket cors set "$BUCKET" --file "$ROOT/scripts/r2-cors.json"

echo "=== ⑥ 开启公开只读 URL（r2.dev，仅用于开发/验证）"
"${WRANGLER[@]}" r2 bucket dev-url enable "$BUCKET" >/dev/null 2>&1 || true
DEV_URL=$("${WRANGLER[@]}" r2 bucket dev-url get "$BUCKET" 2>/dev/null | grep -Eo 'https://[^ ]+' | head -1 || true)

echo
echo "完成。公开地址：${DEV_URL:-见 wrangler r2 bucket dev-url get $BUCKET 输出}"
echo "生产环境建议绑定自定义域名：npx wrangler r2 bucket domain add $BUCKET assets.你的域名"
