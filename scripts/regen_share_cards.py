#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""重绘作品集分享卡里的二维码与卡面域名。

用途：自定义域名变更后，分享卡是静态 PNG，二维码与印刷文字不会自动跟着变，
      必须重新生成。脚本是幂等的：覆盖区域固定，重复执行结果一致。

做法（只改两块，其余像素原样保留）：
  1. 二维码区域：填白后用新 URL 生成 QR 模块，贴回原来的 391x391 位置；
     外圈 quiet zone 与黑色细边框属于卡片设计，不动。
  2. 黑底域名条：整块填黑，用等宽粗体居中写新域名。

同时由新原图重生 1080px 预览（webp + png），供主页弹窗使用。

用法：
  python3 scripts/regen_share_cards.py                         # 默认 https://chenpeisheng.cn / chenpeisheng.cn
  python3 scripts/regen_share_cards.py --url https://x.cn --label x.cn
  python3 scripts/regen_share_cards.py --verify                # 额外用 OpenCV 回读二维码

依赖：pip install pillow qrcode（--verify 另需 opencv-python）
"""

import argparse
from pathlib import Path

import qrcode
from qrcode.constants import ERROR_CORRECT_M
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
IMG_DIR = ROOT / "images"
BASE = "陈培胜-作品集-分享卡"

# 由 OpenCV QRCodeDetector 在 2160px 原图上实测得到，勿凭目测改。
CARDS = [
    dict(key="竖版", qr=(234, 2218, 391, 391), bar=(750, 2471, 605, 81), preview=(1080, 1440)),
    dict(key="方形", qr=(226, 1557, 391, 391), bar=(742, 1834, 605, 81), preview=(1080, 1080)),
]

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Courier New Bold.ttf",
    "/System/Library/Fonts/SFNSMono.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
]

OLD_LABEL = "shenge-work.github.io"  # 仅用于反推原字号，保证新文字视觉大小一致
BAR_PADDING = 24


def pick_font():
    for p in FONT_CANDIDATES:
        if Path(p).exists():
            return p
    raise SystemExit("找不到等宽粗体字体，请在 FONT_CANDIDATES 里补一个")


def font_size_matching(font_path, bar_w):
    """让旧域名在黑条里的宽度接近 bar_w - 2*padding，从而反推原字号。"""
    target = bar_w - BAR_PADDING * 2
    best, best_diff = 40, 1e9
    for size in range(30, 100):
        f = ImageFont.truetype(font_path, size)
        w = f.getbbox(OLD_LABEL)[2] - f.getbbox(OLD_LABEL)[0]
        diff = abs(w - target)
        if diff < best_diff:
            best, best_diff = size, diff
    return best


def qr_tile(url, size):
    """生成 size x size 的白底二维码（模块边缘保持硬边，四周留白）。"""
    q = qrcode.QRCode(version=None, error_correction=ERROR_CORRECT_M, box_size=1, border=0)
    q.add_data(url)
    q.make(fit=True)
    matrix = q.get_matrix()
    n = len(matrix)
    box = max(1, size // n)
    span = n * box
    off = (size - span) // 2
    im = Image.new("RGB", (size, size), "white")
    d = ImageDraw.Draw(im)
    for r, row in enumerate(matrix):
        for c, dark in enumerate(row):
            if dark:
                x, y = off + c * box, off + r * box
                d.rectangle([x, y, x + box - 1, y + box - 1], fill="black")
    return im, n


def redraw(card, url, label, font_path):
    src = IMG_DIR / f"{BASE}-{card['key']}.png"
    im = Image.open(src).convert("RGB")
    d = ImageDraw.Draw(im)

    # ① 二维码
    qx, qy, qs, _ = card["qr"]
    tile, modules = qr_tile(url, qs)
    im.paste(tile, (qx, qy))

    # ② 黑底域名条
    bx, by, bw, bh = card["bar"]
    d.rectangle([bx, by, bx + bw - 1, by + bh - 1], fill="black")
    font = ImageFont.truetype(font_path, font_size_matching(font_path, bw))
    box = font.getbbox(label)
    tw, th = box[2] - box[0], box[3] - box[1]
    tx = bx + (bw - tw) // 2 - box[0]
    ty = by + (bh - th) // 2 - box[1]
    d.text((tx, ty), label, font=font, fill="white")

    im.save(src, "PNG", optimize=True)

    # ③ 预览图
    small = im.resize(card["preview"], Image.LANCZOS)
    small.save(IMG_DIR / f"{BASE}-{card['key']}-预览.webp", "WEBP", quality=82, method=6)
    small.save(IMG_DIR / f"{BASE}-{card['key']}-预览.png", "PNG", optimize=True)

    print(f"  ✓ {card['key']}: QR {modules}x{modules} → {url}，域名条 → {label}，原图 {im.size}，预览 {small.size}")
    return src


def verify(url):
    try:
        import cv2
    except ImportError:
        print("  (跳过回读：未装 opencv-python)")
        return
    for card in CARDS:
        p = IMG_DIR / f"{BASE}-{card['key']}.png"
        data, _, _ = cv2.QRCodeDetector().detectAndDecode(cv2.imread(str(p)))
        ok = data == url
        print(f"  {'✓' if ok else '✗'} 回读 {p.name}: {data!r}")
        if not ok:
            raise SystemExit("二维码回读不一致，请检查")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="https://chenpeisheng.cn", help="二维码目标 URL")
    ap.add_argument("--label", default="chenpeisheng.cn", help="卡面黑底条上显示的域名")
    ap.add_argument("--verify", action="store_true", help="用 OpenCV 回读二维码")
    a = ap.parse_args()

    font = pick_font()
    print(f"分享卡重绘：{a.url} / {a.label}（字体 {Path(font).name}）")
    for c in CARDS:
        redraw(c, a.url, a.label, font)
    if a.verify:
        verify(a.url)


if __name__ == "__main__":
    main()
