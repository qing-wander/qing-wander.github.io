#!/usr/bin/env python3
"""把 data/company-profiles.json 生成 file:// 预览用的 JS 快照 data/company-profiles.js。

为什么需要这一步：
  · 简历页徽章 / 首页徽章 / 公司档案抽屉共用一份数据；
  · 双击打开（file://）时浏览器禁止 fetch，只能靠 JS 快照；
  · 后台（Pages CMS）只编辑 JSON，快照必须自动重建，避免数据漂移。

用法：
  python3 scripts/sync_company_profiles.py          # 生成 / 覆盖 data/company-profiles.js
  python3 scripts/sync_company_profiles.py --check  # 只校验是否最新（CI 用）
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "company-profiles.json"
DST = ROOT / "data" / "company-profiles.js"

HEADER = (
    "/* 本文件由 data/company-profiles.json 自动生成，请勿手动编辑。\n"
    "   生成方式：python3 scripts/sync_company_profiles.py（或「本地预览.command」）。\n"
    "   作用：file:// 双击打开时浏览器无法 fetch JSON（安全限制），\n"
    "   此 JS 快照作为公司档案数据源，保证双击打开也能展示最新数据。 */\n"
)


def render(text: str) -> str:
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("顶层必须是 JSON 对象")
    companies = data.get("companies")
    if not isinstance(companies, dict) or not companies:
        raise ValueError("缺少 companies 字段（至少一家公司档案）")
    for cid, c in companies.items():
        if not isinstance(c, dict) or not c.get("name"):
            raise ValueError(f"companies.{cid} 结构不完整（缺 name）")
    return HEADER + "window.COMPANY_PROFILES = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n"


def main() -> int:
    if not SRC.exists():
        print(f"✗ 找不到 {SRC}")
        return 1

    try:
        text = SRC.read_text(encoding="utf-8")
    except UnicodeDecodeError as e:
        print(f"✗ data/company-profiles.json 不是 UTF-8 编码：{e}")
        return 1

    try:
        content = render(text)
    except json.JSONDecodeError as e:
        print(f"✗ data/company-profiles.json 不是合法 JSON：第 {e.lineno} 行第 {e.colno} 列 — {e.msg}")
        return 1
    except ValueError as e:
        print(f"✗ data/company-profiles.json 结构不完整：{e}")
        return 1

    if "--check" in sys.argv:
        if DST.exists() and DST.read_text(encoding="utf-8") == content:
            print("✓ data/company-profiles.js 与 JSON 一致")
            return 0
        print("✗ data/company-profiles.js 与 JSON 不同步，请运行 python3 scripts/sync_company_profiles.py")
        return 1

    DST.write_text(content, encoding="utf-8")
    print(f"✓ 已生成 data/company-profiles.js（{len(content)} 字符）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
