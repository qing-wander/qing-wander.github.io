#!/usr/bin/env bash
# 留言板线上自检 —— 只读诊断为主，确认 /api/wall 是否真的可用
#
# 2026-11-19 起留言板按设备隔离：每个请求都要带 X-Device-Id，
# 服务端只返回这台设备的留言。本脚本用固定设备号做自检，
# 并额外验证「另一台设备看不到刚才写的留言」这条隔离契约。
#
# 用法：
#   ./scripts/wall-check.sh                          # 只读：设备头 / 分页 / peek / CORS 预检
#   ./scripts/wall-check.sh --post                  # 追加一次真实提交（只写进自检设备，不污染访客）
#   ./scripts/wall-check.sh --post --admin-token=X  # 提交后用管理令牌自动删除测试留言
#   WALL_ADMIN_TOKEN=X ./scripts/wall-check.sh --post
#   ./scripts/wall-check.sh http://127.0.0.1:8877  # 打本地联调服务器
#   ORIGIN=https://shenge-work.pages.dev ./scripts/wall-check.sh --post
#   DEVICE_ID=my-device-00001 ./scripts/wall-check.sh
#
# 退出码：全部通过 0；有失败 1；参数错误 2。
# 说明：线上主站 github.io 是纯静态，API 在 Cloudflare Pages，默认就打 pages.dev。

set -uo pipefail

BASE="https://shenge-work.pages.dev"
ORIGIN="${ORIGIN:-https://shenge-work.github.io}"
ADMIN_TOKEN="${WALL_ADMIN_TOKEN:-}"
DEVICE_ID="${DEVICE_ID:-wc-selfcheck-0001}"
OTHER_ID="${OTHER_ID:-wc-other-$(date +%s)}"
DO_POST=0

for arg in "$@"; do
  case "$arg" in
    --post) DO_POST=1 ;;
    --admin-token=*) ADMIN_TOKEN="${arg#*=}" ;;
    --device=*) DEVICE_ID="${arg#*=}" ;;
    http://*|https://*) BASE="${arg%/}" ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg"; exit 2 ;;
  esac
done

case "$DEVICE_ID" in
  *[!A-Za-z0-9_-]*) echo "DEVICE_ID 只能用字母数字 _ -：$DEVICE_ID"; exit 2 ;;
esac

DEV=(-H "X-Device-Id: $DEVICE_ID")

PASS=0
FAIL=0
TMP="$(mktemp -t wallcheck.XXXXXX)"
trap 'rm -f "$TMP"' EXIT

c_green=$'\033[32m'; c_red=$'\033[31m'; c_yellow=$'\033[33m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
if [ ! -t 1 ]; then c_green=""; c_red=""; c_yellow=""; c_dim=""; c_off=""; fi

# jget <路径> —— 支持 a.b.0.c 形式，布尔输出 true/false
jget() {
  python3 - "$1" "$TMP" <<'PY' 2>/dev/null
import json, sys
try:
    d = json.load(open(sys.argv[2]))
except Exception:
    print(""); raise SystemExit
v = d
for part in sys.argv[1].split('.'):
    if isinstance(v, list) and part.isdigit():
        v = v[int(part)] if int(part) < len(v) else ""
    elif isinstance(v, dict):
        v = v.get(part, "")
    else:
        v = ""
if isinstance(v, bool): print("true" if v else "false")
elif v is None: print("")
else: print(v)
PY
}

check() { # check <编号> <描述> <期望> <实际>
  local id="$1" what="$2" expect="$3" actual="$4"
  if [ "$expect" = "$actual" ]; then
    printf '%sPASS%s  %-5s %s\n' "$c_green" "$c_off" "$id" "$what"
    PASS=$((PASS+1))
  else
    printf '%sFAIL%s  %-5s %s\n       期望=%s 实际=%s\n' "$c_red" "$c_off" "$id" "$what" "$expect" "$actual"
    FAIL=$((FAIL+1))
  fi
}

db_guide() {
  cat <<'GUIDE'
  ─────────────────────────────────────────────────────────────
  Cloudflare Pages 项目还没绑定 D1 数据库 DB，函数会返回 open=false，
  前端因此显示「留言本暂未开放」。约 2 分钟即可修好：

   1) 确认 D1 库与表结构已就绪（一次性）：
        npx wrangler d1 create portfolio-db
        npx wrangler d1 execute portfolio-db --remote --file=db/schema.sql
      老库（2026-11-19 之前建的）还要补跑设备隔离迁移：
        npx wrangler d1 execute portfolio-db --remote --file=db/migrations/2026-11-19-wall-device-isolation.sql
   2) Workers & Pages → 项目 shenge-work → Settings → Functions
      → D1 database bindings → Add binding
        Variable name  : DB              ← 必须一字不差
        D1 database    : portfolio-db
   3) 保存后必须重新部署才生效（绑定改动不会热更新）：
        git push        （主链路，GitHub 集成自动构建）
      或 ./scripts/deploy-pages.sh / Pages → Deployments → Retry deployment
   4) 重新跑：./scripts/wall-check.sh   直到出现 open=true

  可选/建议变量（Settings → Variables and Secrets）：
    ALLOWED_ORIGINS    跨域白名单，默认已含 github.io / pages.dev / 本地端口
    DEVICE_HASH_PEPPER 设备哈希盐（设备隔离必需；换了等于所有设备重新分区）
    WALL_ADMIN_TOKEN   应急删除令牌；不配则 DELETE /api/wall 不暴露（日常管理走独立后台）
  详见 docs/cloudflare-rag-admin-plan.md 与 docs/resume-delivery.md
  ─────────────────────────────────────────────────────────────
GUIDE
}

echo "站点：$BASE"
echo "来源：$ORIGIN"
echo "设备：${DEVICE_ID}（隔离对照：${OTHER_ID}）"
echo "模式：只读$([ "$DO_POST" = "1" ] && echo ' + 真实提交（只写进自检设备）')"
echo "───────────────────────────────────────────────"

# ① 没有设备头 → 明确返回 device_required，而不是把全站留言倒出来
CODE=$(curl -sS -o "$TMP" -w '%{http_code}' -m 15 "$BASE/api/wall")
check W0 "GET 无设备头仍返回 200" 200 "$CODE"
check W0b "无设备头 → reason=device_required" device_required "$(jget reason)"
check W0c "无设备头 → 不泄露任何正文" "" "$(jget messages.0.text)"

# ② 基础读取（带设备头）
CODE=$(curl -sS -o "$TMP" -w '%{http_code}' -m 15 "${DEV[@]}" "$BASE/api/wall")
check W1 "GET /api/wall 返回 200" 200 "$CODE"
check W2 "响应 ok=true" true "$(jget ok)"
OPEN=$(jget open)
REASON=$(jget reason)

if [ "$OPEN" != "true" ]; then
  printf '%sFAIL%s  W3    留言板已开放（open=true）\n       实际 open=%s reason=%s\n' \
    "$c_red" "$c_off" "${OPEN:-<空>}" "${REASON:-<空>}"
  FAIL=$((FAIL+1))
  if [ "$REASON" = "db_not_bound" ] || [ "$REASON" = "kv_not_bound" ] || [ -z "$REASON" ]; then
    db_guide
  else
    echo "  reason=$REASON，先看 functions/api/wall.js 对应分支。"
  fi
  echo "───────────────────────────────────────────────"
  printf '合计：%s%d 通过%s  %s%d 失败%s\n' "$c_green" "$PASS" "$c_off" "$c_red" "$FAIL" "$c_off"
  exit 1
fi
printf '%sPASS%s  W3    留言板已开放（open=true）\n' "$c_green" "$c_off"
PASS=$((PASS+1))

# ③ 分页字段
CODE=$(curl -sS -o "$TMP" -w '%{http_code}' -m 15 "${DEV[@]}" "$BASE/api/wall?limit=5&offset=0")
check W4 "分页 GET 返回 200" 200 "$CODE"
check W5 "limit 生效" 5 "$(jget limit)"
TOTAL=$(jget total)
case "$TOTAL" in ''|*[!0-9]*) check W6 "total 是数字" number "bad:$TOTAL" ;;
  *) printf '%sPASS%s  W6    total 是数字（本设备共 %s 条）\n' "$c_green" "$c_off" "$TOTAL"; PASS=$((PASS+1)) ;; esac
HAS=$(jget hasMore)
if [ "$HAS" = "true" ] || [ "$HAS" = "false" ]; then
  printf '%sPASS%s  W7    hasMore 是布尔值（%s）\n' "$c_green" "$c_off" "$HAS"; PASS=$((PASS+1))
else
  check W7 "hasMore 是布尔值" "true|false" "$HAS"
fi

# ④ 轻量轮询
CODE=$(curl -sS -o "$TMP" -w '%{http_code}' -m 15 "${DEV[@]}" "$BASE/api/wall?peek=1")
check W8 "peek 返回 200" 200 "$CODE"
check W9 "peek 不返回正文（messages 为空）" "" "$(jget messages.0.text)"
check W10 "peek 带回 total" "$TOTAL" "$(jget total)"

# ⑤ 隔离契约：另一台设备读不到本设备的留言
CODE=$(curl -sS -o "$TMP" -w '%{http_code}' -m 15 -H "X-Device-Id: $OTHER_ID" "$BASE/api/wall")
check W10b "另一设备 GET 返回 200" 200 "$CODE"
check W10c "另一设备不会读到自检设备的留言" 0 "$(jget total)"

# ⑥ CORS 预检（必须允许 X-Device-Id，否则跨域 GET 会被浏览器拦下）
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -m 10 -X OPTIONS "$BASE/api/wall" \
  -H "Origin: $ORIGIN" \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,x-device-id')
check W11 "OPTIONS 预检 204（允许 X-Device-Id）" 204 "$CODE"

# ⑦ 可选：真实提交（只写进自检设备）
if [ "$DO_POST" = "1" ]; then
  echo "${c_yellow}注意：接下来会向「自检设备 ${DEVICE_ID}」写入一条测试留言，访客看不到。${c_off}"
  BODY='{"name":"wall-check","text":"自检脚本自动发送的测试留言，可删除。"}'
  CODE=$(curl -sS -o "$TMP" -w '%{http_code}' -m 15 -X POST "$BASE/api/wall" \
    "${DEV[@]}" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' -d "$BODY")
  check W12 "POST 返回 201" 201 "$CODE"
  check W13 "提交后返回第一页" true "$(jget ok)"
  NEW_ID=$(jget messages.0.id)
  if [ -n "$NEW_ID" ]; then
    printf '%sPASS%s  W14   新留言拿到 id（%s）\n' "$c_green" "$c_off" "${NEW_ID}"
    PASS=$((PASS+1))
    # 对照设备仍应读不到这条
    CODE=$(curl -sS -o "$TMP" -w '%{http_code}' -m 15 -H "X-Device-Id: $OTHER_ID" "$BASE/api/wall")
    check W15 "对照设备读不到新留言" 0 "$(jget total)"
    if [ -n "$ADMIN_TOKEN" ]; then
      CODE=$(curl -sS -o "$TMP" -w '%{http_code}' -m 15 -X DELETE "$BASE/api/wall" \
        -H "Origin: $ORIGIN" -H "X-Admin-Token: $ADMIN_TOKEN" \
        -H 'Content-Type: application/json' -d "{\"id\":\"$NEW_ID\"}")
      check W16 "测试留言已用管理令牌删除" 200 "$CODE"
      CODE=$(curl -sS -o /dev/null -w '%{http_code}' -m 10 -H "X-Admin-Token: $ADMIN_TOKEN" "$BASE/api/admin/wall/devices?limit=5")
      # 旧后台接口已下线，日常管理走独立后台 shenge-work-admin.pages.dev
      check W17 "旧后台接口已下线" 404 "$CODE"
    else
      printf '%s%sWARN%s  测试留言仍在自检设备的留言本里；\n' "$c_dim" "$c_yellow" "$c_off"
      printf '%s      加 --admin-token=<WALL_ADMIN_TOKEN> 重跑可自动清理。%s\n' "$c_dim" "$c_off"
    fi
  else
    printf '%sFAIL%s  W14   新留言拿到 id\n' "$c_red" "$c_off"
    FAIL=$((FAIL+1))
  fi
fi

echo "───────────────────────────────────────────────"
printf '合计：%s%d 通过%s  %s%d 失败%s\n' "$c_green" "$PASS" "$c_off" "$([ "$FAIL" -eq 0 ] && echo "$c_dim" || echo "$c_red")" "$FAIL" "$c_off"
[ "$FAIL" -eq 0 ] || exit 1
