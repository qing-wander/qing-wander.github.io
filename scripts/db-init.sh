#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
#  一条命令初始化 D1：建库 → 建表 → 灌 RAG → 灌站点数据 → 校验
# ──────────────────────────────────────────────────────────────────────
#  用法：
#    bash scripts/db-init.sh            # 本地 D1（安全，默认）
#    bash scripts/db-init.sh remote     # 云端 D1（会创建数据库并写入数据）
#
#  环境变量：
#    D1_DB_NAME   数据库名，默认 portfolio-db
#    DATA_DIR     站点 JSON 目录，默认仓库 data/；fork 换数据就指向自己的目录
#    WRANGLER     wrangler 可执行文件，默认 npx --yes wrangler
#
#  前提：
#    1. 已装 Node.js + npm（npx 可用）
#    2. remote 模式已登录 Cloudflare（npx wrangler login 或有 CF_API_TOKEN）
#    3. 站点 JSON 已按 data/ 下的文件名准备好（7 个 key）
#
#  注意：db/schema.sql 已包含全部 DDL（含 kb_* / qa_logs / asset_links），
#  不要再逐条跑 db/migrations/ 里的旧迁移；其中 wall-device-isolation 是
#  只给旧库补列的 ALTER，新库跑会报重复列。
# ──────────────────────────────────────────────────────────────────────

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

DB_NAME="${D1_DB_NAME:-portfolio-db}"
MODE="${1:-local}"
if [ "$MODE" != "local" ] && [ "$MODE" != "remote" ]; then
  echo "用法：bash scripts/db-init.sh [local|remote]" >&2
  exit 2
fi
FLAG="--$MODE"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ -n "${WRANGLER:-}" ]; then
  W_CMD=("$WRANGLER")
elif command -v wrangler >/dev/null 2>&1; then
  W_CMD=(wrangler)
elif npx --no-install wrangler --version >/dev/null 2>&1; then
  W_CMD=(npx --no-install wrangler)
else
  W_CMD=(npx --yes wrangler)
fi

run_sql_file() {
  local file="$1"
  echo "   · $(basename "$file")"
  "${W_CMD[@]}" d1 execute "$DB_NAME" "$FLAG" --file "$file" >/dev/null
}

echo "=== ① 数据库：${DB_NAME}（${MODE}）"
if [ "$MODE" = "remote" ]; then
  CREATE_OUT="$("${W_CMD[@]}" d1 create "$DB_NAME" 2>&1 || true)"
  if printf '%s' "$CREATE_OUT" | grep -qi 'already exists'; then
    echo "   · 数据库已存在，跳过创建"
  else
    printf '%s\n' "$CREATE_OUT"
    DB_ID="$(printf '%s' "$CREATE_OUT" | sed -n 's/.*database_id *= *"\([^"]*\)".*/\1/p' | head -n 1)"
    if [ -z "$DB_ID" ]; then
      echo "✗ 未能从创建输出解析 database_id，请手动写入 wrangler.toml 后重跑" >&2
      exit 1
    fi
    python3 - "$DB_ID" <<'PY'
import re, sys
path = 'wrangler.toml'
text = open(path, encoding='utf-8').read()
new_id = sys.argv[1]
text, n = re.subn(r'(database_id\s*=\s*")[^"]+(")', lambda m: m.group(1) + new_id + m.group(2), text, count=1)
if n != 1:
    raise SystemExit('wrangler.toml 里没找到 database_id')
open(path, 'w', encoding='utf-8').write(text)
print('   · 已把 database_id 写入 wrangler.toml')
PY
  fi
fi

echo "=== ② 完整基线 DDL"
run_sql_file db/schema.sql

echo "=== ③ 静态资源外链种子"
run_sql_file db/migrations/2026-11-22-interview-assets.sql

echo "=== ④ RAG 切片与词频（云端生成，产物不入库）"
RAG_OUT_DIR="$TMP/rag" node scripts/build_rag_chunks.mjs
run_sql_file "$TMP/rag/kb-chunks.seed.sql"
run_sql_file "$TMP/rag/kb-terms.seed.sql"

echo "=== ⑤ 站点数据（7 个 key）"
D1_DB_NAME="$DB_NAME" D1_MODE="$MODE" node scripts/seed-site-content.mjs

echo "=== ⑥ 校验"
"${W_CMD[@]}" d1 execute "$DB_NAME" "$FLAG" \
  --command "SELECT 'site_content' AS t, COUNT(*) AS n FROM site_content UNION ALL SELECT 'kb_chunks', COUNT(*) FROM kb_chunks UNION ALL SELECT 'asset_links', COUNT(*) FROM asset_links;"

echo "✓ 初始化完成。remote 模式还需在 Pages 控制台绑定 DB / KV / AI / Vectorize，并配置 Secrets（见 .env.example）。"
