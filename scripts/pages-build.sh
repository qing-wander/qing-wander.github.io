#!/usr/bin/env bash
# Cloudflare Pages 构建产物 dist/ —— 自动构建与手动部署共用的唯一入口
#
# 控制台配置（Pages 项目 shenge-work → Settings → Builds & deployments）：
#   Build command    : bash scripts/pages-build.sh
#   Build output dir : dist
#   Root directory   :（留空）
#
# 背景：控制台原来写死了一份白名单
#   mkdir -p dist && cp -r index.html resume.html css js ... dist/
# 后来新增的 jd.html / company.html / 404.html 和 functions/ 从未进入产物，
# 于是 pages.dev 上点 hero「JD 匹配」跳到 /jd.html 后被 SPA fallback 吞回首页；
# github.io 走仓库原生文件，一直是正常的。根目录 HTML 改为自动收集后，
# 新增独立页不必再改任何白名单。
#
# 手动部署：./scripts/deploy-pages.sh（同样调用本脚本，再上传到 Pages）
# 本地试跑：bash scripts/pages-build.sh && ls dist/*.html
#
# 注意：assets/character-views 是 3D 原始素材（约 573MB，已 gitignore），
# 既不能入库也不能部署（Pages 单文件上限 25MiB），这里显式排除。

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
OUT="$ROOT/dist"

rm -rf "$OUT"
mkdir -p "$OUT"

echo "=== ① 根目录独立页（自动收集，排除 _ 开头的本地调试探针）"
HTML_FILES=()
for f in *.html; do
  [ -f "$f" ] || continue
  case "$f" in _*) continue ;; esac
  cp "$f" "$OUT/"
  HTML_FILES+=("$f")
done
echo "   ${HTML_FILES[*]}"

echo "=== ② 静态资源"
for item in css js data images videos favicon-64.png favicon.png; do
  if [ ! -e "$item" ]; then
    echo "✗ 缺少 $item，先检查仓库是否完整"
    exit 1
  fi
  cp -R "$item" "$OUT/"
done

echo "=== ③ assets（排除 character-views 原始素材）"
if [ ! -d assets ]; then
  echo "✗ 缺少 assets/"
  exit 1
fi
(
  cd assets
  find . -type f ! -path './character-views/*' -print0 |
    while IFS= read -r -d '' f; do
      mkdir -p "$OUT/assets/$(dirname "$f")"
      cp "$f" "$OUT/assets/$f"
    done
)

echo "=== ④ Pages Functions（/api/*）；腾讯云函数源码不是 Pages 路由"
cp -R functions "$OUT/"
rm -rf "$OUT/functions/tencent"

echo "=== ⑤ 独立页硬校验：缺一个就让构建失败，别等线上被 fallback 吞掉"
for f in index.html resume.html jd.html company.html 404.html \
         css/jd-match.css js/jd-match.js functions/api/wall.js; do
  if [ ! -f "$OUT/$f" ]; then
    echo "✗ dist 缺少 $f，独立页会变成 404 / 首页 fallback"
    exit 1
  fi
done

echo "=== ⑥ 单文件上限 25MiB"
BIG="$(find "$OUT" -type f -size +25M 2>/dev/null || true)"
if [ -n "$BIG" ]; then
  echo "✗ 以下文件超过 Cloudflare Pages 单文件 25MiB 上限："
  printf '%s\n' "$BIG"
  exit 1
fi

echo "✓ dist 构建完成：$(find "$OUT" -type f | wc -l | tr -d ' ') 个文件 / $(du -sh "$OUT" | awk '{print $1}')"
echo "  HTML: $(cd "$OUT" && ls -1 *.html | tr '\n' ' ')"
