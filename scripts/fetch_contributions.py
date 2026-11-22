#!/usr/bin/env python3
"""拉取 GitHub 个人贡献数据，写成前端可直接读取的 data/contributions.json。

为什么不走前端直连：
  · GitHub 官方按天贡献数据只在 GraphQL 的 contributionsCollection 里，
    REST API 没有按天聚合；而 GraphQL 必须带认证，token 不能进前端；
  · 纯静态 Pages 没有服务端，所以由 Actions 定时拉取、落成静态 JSON，
    前端只 fetch 这个文件，不接触任何凭证。

数据口径：
  · 窗口为「过去 365 天」，与 GitHub 主页 "contributions in the last year" 一致；
  · days 只保留 date + count（0 也保留，保证热力图格子对齐）；
  · currentStreak / longestStreak 在此预算好，前端不再重复计算。

用法：
  GITHUB_TOKEN=xxxx python3 scripts/fetch_contributions.py
    · token 只需公开资料读取权限（classic 选 public_repo 之外的最小范围即可，
      实际上 viewer 查询用 Actions 内置 GITHUB_TOKEN 就够，无需额外配置 secret）。
  环境变量 GH_LOGIN 可指定查询的登录名；缺省用 viewer（当前 token 本人）。
"""

import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DST = ROOT / "data" / "contributions.json"

GRAPHQL = "https://api.github.com/graphql"

QUERY = """
query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    login
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
          }
        }
      }
    }
  }
}
"""


def gql(token: str, variables: dict) -> dict:
    req = urllib.request.Request(
        GRAPHQL,
        data=json.dumps({"query": QUERY, "variables": variables}).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "shenge-work.github.io-contributions",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        raise SystemExit("GraphQL 请求失败 HTTP %s：%s" % (e.code, body))
    if payload.get("errors"):
        raise SystemExit("GraphQL 返回错误：" + json.dumps(payload["errors"], ensure_ascii=False))
    return payload["data"]


def calc_streaks(days: list) -> tuple:
    """返回 (currentStreak, longestStreak)。

    口径与 GitHub 一致：今天尚无贡献不中断当前 streak，从昨天往前数；
    连续以 count > 0 计。
    """
    counts = [d["count"] for d in days]
    longest = run = 0
    for c in counts:
        run = run + 1 if c > 0 else 0
        longest = max(longest, run)

    current = 0
    # 从末尾往前；末尾若为 0（今天还没提交）跳过一格再数
    i = len(counts) - 1
    if i >= 0 and counts[i] == 0:
        i -= 1
    while i >= 0 and counts[i] > 0:
        current += 1
        i -= 1
    return current, longest


def main() -> int:
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not token:
        print("::error::缺少 GITHUB_TOKEN 环境变量", file=sys.stderr)
        return 1

    now = datetime.now(timezone.utc)
    to = now.replace(hour=0, minute=0, second=0, microsecond=0)
    fr = to - timedelta(days=365)
    login = os.environ.get("GH_LOGIN", "shenge-work")

    data = gql(token, {"login": login, "from": fr.isoformat(), "to": to.isoformat()})
    user = data["user"]
    coll = user["contributionsCollection"]
    cal = coll["contributionCalendar"]

    days = []
    weeks = []
    for week in cal["weeks"]:
        col = []
        for day in week["contributionDays"]:
            cell = {"date": day["date"][:10], "count": day["contributionCount"]}
            days.append(cell)
            col.append(cell)
        weeks.append(col)

    current, longest = calc_streaks(days)
    out = {
        "username": user["login"],
        "updatedAt": now.isoformat(timespec="seconds"),
        "range": {"from": fr.date().isoformat(), "to": to.date().isoformat()},
        "total": cal["totalContributions"],
        "currentStreak": current,
        "longestStreak": longest,
        "days": days,
        "weeks": weeks,
    }

    DST.parent.mkdir(parents=True, exist_ok=True)
    DST.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("已写入 %s：%d 次贡献 / 当前连续 %d 天 / 最长 %d 天"
          % (DST.relative_to(ROOT), out["total"], current, longest))
    return 0


if __name__ == "__main__":
    sys.exit(main())
