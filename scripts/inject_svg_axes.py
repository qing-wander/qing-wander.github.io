#!/usr/bin/env python3
"""给 Platane/snk 生成的贡献蛇图注入月份 / 星期坐标轴。

snk 的 SVG 本身就是 53 列 × 7 行的贡献网格（格子按贡献着色 + 蛇身动画），
但缺少 GitHub 热力图那样的月份行和星期列标签。本脚本把标签写进 SVG，
与格子共用同一套 viewBox 坐标，因此缩放时永远对齐。

网格坐标（由 snk v3 输出实测）：
  x = 2 + 16 * 列号   （53 列）
  y = 2 + 16 * 行号   （7 行，0=周日）
  viewBox = "-16 -32 880 192"

月份标签来自 data/contributions.json 的 weeks（与前端热力图同一口径）：
以每周周三判断月份，换月后至少隔 3 列再标注，避免缩写压字。
星期只标 Mon / Wed / Fri，与 GitHub 一致。

用法：python3 scripts/inject_svg_axes.py
可重复执行：先移除上次注入的 <g id="gh-axes">，再写入新标签。
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CONTRIB = DATA / "contributions.json"
SVGS = [DATA / "snake.svg", DATA / "snake-dark.svg"]

MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
# 只标 Mon/Wed/Fri，对应周日为第 0 行的行号
WEEKDAYS = [(1, 'Mon'), (3, 'Wed'), (5, 'Fri')]

CELL = 16
CELL_X0 = 2
CELL_Y0 = 2
AXIS_RE = re.compile(r'<g id="gh-axes".*?</g>', re.S)

# snk 原始 viewBox / 宽度；注入前先复位再扩展，保证脚本可重复执行
ORIG_VIEWBOX = '-16 -32 880 192'
ORIG_WIDTH = '880'
LEFT_PAD = 24                       # 左侧给星期标签留的额外空间
AXIS_VIEWBOX = '-40 -32 904 192'    # 左扩 24，右边界不变
AXIS_WIDTH = '904'


def month_marks(weeks):
    marks = []
    last_col = -99
    labeled = -1
    for i, week in enumerate(weeks):
        mid = week[3] if len(week) > 3 else week[0]
        month = datetime.strptime(mid["date"][:10], "%Y-%m-%d").month - 1
        if month != labeled and i - last_col >= 3:
            marks.append((i, MONTHS[month]))
            labeled = month
            last_col = i
    return marks


def axes_svg(weeks, dark):
    color = "#8B949E" if dark else "#57606A"  # GitHub 次级文字色
    parts = ['<g id="gh-axes" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" '
             'font-size="10" fill="%s" aria-hidden="true">' % color]

    # 月份：标签基线在格子上缘之上；viewBox 顶部 -32，留得下
    for col, label in month_marks(weeks):
        x = CELL_X0 + CELL * col
        parts.append('<text x="%d" y="-10">%s</text>' % (x, label))

    # 星期：右对齐贴在网格左侧（x=-5），垂直居中于对应行；
    # viewBox 左边界已扩到 -40，三个缩写不会被裁
    for row, label in WEEKDAYS:
        y = CELL_Y0 + CELL * row + 9
        parts.append('<text x="-5" y="%d" text-anchor="end">%s</text>' % (y, label))

    parts.append('</g>')
    return ''.join(parts)


def patch(path, weeks, dark):
    text = path.read_text(encoding="utf-8")
    # 幂等：先移除旧标签，并把 viewBox / width 复位到 snk 原始值
    text = AXIS_RE.sub("", text)
    text = text.replace(AXIS_VIEWBOX, ORIG_VIEWBOX).replace(
        'width="%s"' % AXIS_WIDTH, 'width="%s"' % ORIG_WIDTH, 1)
    if ORIG_VIEWBOX not in text:
        raise SystemExit("%s 的 viewBox 不是预期的 snk 输出" % path.name)
    text = text.replace(ORIG_VIEWBOX, AXIS_VIEWBOX, 1)
    text = text.replace('width="%s"' % ORIG_WIDTH, 'width="%s"' % AXIS_WIDTH, 1)

    axes = axes_svg(weeks, dark)
    if '</svg>' not in text:
        raise SystemExit("%s 缺少 </svg>，不是预期的 snk 输出" % path.name)
    text = text.replace('</svg>', axes + '</svg>')
    path.write_text(text, encoding="utf-8")
    print("已注入 %s：%d 个月份标签 + %d 个星期标签"
          % (path.name, len(month_marks(weeks)), len(WEEKDAYS)))


def main():
    if not CONTRIB.exists():
        print("缺少 %s，无法计算月份标签" % CONTRIB.relative_to(ROOT), file=sys.stderr)
        return 1
    weeks = json.loads(CONTRIB.read_text(encoding="utf-8")).get("weeks") or []
    if len(weeks) != 53:
        print("weeks 数量异常：%d（期望 53）" % len(weeks), file=sys.stderr)
        return 1
    for svg in SVGS:
        if svg.exists():
            patch(svg, weeks, dark="dark" in svg.name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
