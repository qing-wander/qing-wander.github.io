#!/usr/bin/env python3
"""把 data/people.json 生成 data/people.js 快照（页脚「推荐的人」用）。

与 site-data 同一套思路：
  · 页脚先尝试读 JSON（file:// 下浏览器禁止 fetch，只能靠 JS 快照）；
  · index.html 只引用 data/people.js，渲染逻辑在 js/main.js；
  · 名单是低频内容，一个人改 JSON 就够，不需要后台。

用法：
  python3 scripts/sync_people.py          # 生成 / 覆盖 data/people.js
  python3 scripts/sync_people.py --check  # 只校验是否最新，不写文件（CI 用）
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "people.json"
DST = ROOT / "data" / "people.js"

HEADER = (
    "/* 本文件由 data/people.json 自动生成，请勿手动编辑。\n"
    "   生成方式：python3 scripts/sync_people.py\n"
    "   作用：页脚「推荐的人」只有一份名单，避免 JSON / JS 两份数据漂移。 */\n"
)


def render(text: str) -> str:
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("顶层必须是 JSON 对象")
    if not isinstance(data.get("people"), list):
        raise ValueError("缺少 people 数组（没有推荐人时给空数组）")
    body = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False)
    # 行尾统一，避免 Windows 检出后 --check 误报
    return HEADER + "window.PEOPLE = " + body + ";\n"


def main() -> int:
    if not SRC.exists():
        print("data/people.json 不存在，跳过（页脚引荐模块会保持隐藏）")
        return 0
    text = SRC.read_text(encoding="utf-8")
    try:
        out = render(text)
    except ValueError as e:
        print(f"✗ data/people.json 结构有问题：{e}")
        return 1

    if "--check" in sys.argv:
        cur = DST.read_text(encoding="utf-8") if DST.exists() else ""
        if cur == out:
            print("✓ data/people.js 与 JSON 一致")
            return 0
        print("✗ data/people.js 已过期，请运行 python3 scripts/sync_people.py")
        return 1

    DST.write_text(out, encoding="utf-8")
    count = len(json.loads(text)["people"])
    print(f"✓ 已生成 data/people.js（{count} 位推荐人）")
    return 0


if __name__ == "__main__":
    sys.exit(main())