#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# D1 备份：把线上库导出成 SQL 快照，存在本机（不进仓库）
# ──────────────────────────────────────────────────────────────
# 为什么默认存到 ~/.local/share 而不是仓库里：
#   导出文件包含留言正文与访客哈希，属于访客数据，不该进 Git（也避免仓库膨胀）。
#
# 用法：
#   ./scripts/backup-d1.sh                  # 备份 portfolio-db
#   ./scripts/backup-d1.sh portfolio-db     # 指定库名
#   KEEP=20 ./scripts/backup-d1.sh          # 保留最近 20 份（默认 10）
#   D1_BACKUP_DIR=/Volumes/xxx ./scripts/backup-d1.sh   # 换输出目录（比如外置盘）
#
# 需要已登录 wrangler（npx wrangler whoami 能出账号即可）。
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

DB="${1:-portfolio-db}"
OUT_DIR="${D1_BACKUP_DIR:-$HOME/.local/share/qing-wander/d1-backups}"
KEEP="${KEEP:-10}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$OUT_DIR/${DB}-${STAMP}.sql"

mkdir -p "$OUT_DIR"

echo "数据库：$DB"
echo "输出：  $OUT"
echo "───────────────────────────────────────────────"

# --remote 导出线上库（不是本地 .wrangler 模拟库）；失败即中止
npx wrangler d1 export "$DB" --remote --output="$OUT" 2>&1 | tail -6

if [ ! -s "$OUT" ]; then
  echo "FAIL 导出文件为空：$OUT" >&2
  exit 1
fi

SIZE="$(du -h "$OUT" | cut -f1 | tr -d ' ')"
TABLES="$(grep -c '^CREATE TABLE' "$OUT" 2>/dev/null || echo 0)"
INSERTS="$(grep -c '^INSERT INTO' "$OUT" 2>/dev/null || echo 0)"

echo "───────────────────────────────────────────────"
echo "PASS 已生成：$(basename "$OUT")（${SIZE}，${TABLES} 张表，${INSERTS} 条 INSERT）"

# 只保留最近 KEEP 份：按修改时间从新到旧，跳过头 KEEP 个后全部删除
OLD="$(ls -1t "$OUT_DIR/${DB}-"*.sql 2>/dev/null | tail -n +$((KEEP + 1)) || true)"
if [ -n "$OLD" ]; then
  echo "$OLD" | while IFS= read -r f; do
    [ -n "$f" ] && rm -f "$f" && echo "清理旧备份：$(basename "$f")"
  done
fi

echo "当前保留："
ls -1t "$OUT_DIR/${DB}-"*.sql 2>/dev/null | head -n "$KEEP" | while IFS= read -r f; do
  echo "  $(basename "$f")"
done

echo "提示：留言是访客数据，备份别提交进 Git，也别随手发到群里。"
