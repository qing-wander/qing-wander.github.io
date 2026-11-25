#!/usr/bin/env python3
"""把真实导出的 PDF 逐页栅格化为「彩色 / 黑白」两版预览图。

为什么不用 CSS 模拟黑白：
  * 浏览器打印对话框里的「背景图形」开关、打印机驱动的灰阶映射都不是 CSS 能
    可靠推导的；对动态样式做规则替换只能得到近似值。
  * 这里直接拿 Chrome 打印出的 PDF（HR 收到的就是它）逐页渲染成图片，
    彩色版 = 文件原样；黑白版 = 对同一批像素做灰度化。版式、底色、文字
    都已固化在 PDF 中，不会出现「模拟时以为白字会消失」这类误判。

用法（一般由 render_print_previews.mjs 调用）：
  python3 scripts/rasterize_print_preview.py <pdf> <out_dir> <source_sha256>

环境：pypdf + Pillow；渲染优先用 macOS 的 sips（ImageIO 直接高分栅格化），
      否则回退到 poppler 的 pdftoppm。CI 只跑 --check，不需要这些工具。
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image
from pypdf import PdfReader, PdfWriter

TARGET_W = 1190  # A4 @ 96dpi × 1.5，屏幕上缩放后仍清晰


def run(cmd):
    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise RuntimeError(f"{cmd[0]} 失败: {r.stderr.decode('utf-8', 'replace')[:400]}")


def rasterize_page(pdf_path: Path, page_index: int, tmp: Path) -> Image.Image:
    """把指定页渲染成高分辨率 RGB 图。"""
    one = tmp / f"page-{page_index + 1}.pdf"
    w = PdfWriter()
    r = PdfReader(str(pdf_path))
    w.add_page(r.pages[page_index])
    with one.open("wb") as f:
        w.write(f)

    png = tmp / f"page-{page_index + 1}.png"
    if shutil.which("sips"):
        # macOS ImageIO 支持按目标宽度直接高分渲染 PDF，文字保持锐利
        run(["sips", "-s", "format", "png", "--resampleWidth", str(TARGET_W),
             str(one), "--out", str(png)])
    elif shutil.which("pdftoppm"):
        # 144dpi ≈ A4 1190px，保持与 sips 分支同一量级
        run(["pdftoppm", "-f", str(page_index + 1), "-l", str(page_index + 1),
             "-singlefile", "-png", "-r", "144", str(pdf_path),
             str(tmp / f"ppm-{page_index + 1}")])
        png = tmp / f"ppm-{page_index + 1}.png"
    else:
        raise RuntimeError("需要 sips（macOS）或 pdftoppm（poppler）才能栅格化 PDF")

    im = Image.open(png).convert("RGB")
    if im.width != TARGET_W:
        h = round(im.height * TARGET_W / im.width)
        im = im.resize((TARGET_W, h), Image.LANCZOS)
    return im


def main():
    if len(sys.argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2
    pdf = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2]).resolve()
    source_hash = sys.argv[3]

    if not pdf.is_file():
        print(f"找不到 PDF: {pdf}", file=sys.stderr)
        return 2
    out.mkdir(parents=True, exist_ok=True)

    pages = len(PdfReader(str(pdf)).pages)
    if pages < 1:
        print("PDF 没有页面", file=sys.stderr)
        return 2

    sizes = []
    with tempfile.TemporaryDirectory(prefix="pv-raster-") as td:
        tmp = Path(td)
        for i in range(pages):
            im = rasterize_page(pdf, i, tmp)
            color = out / f"color-{i + 1}.png"
            bw = out / f"bw-{i + 1}.png"
            im.save(color, "PNG", optimize=True)
            im.convert("L").save(bw, "PNG", optimize=True)
            sizes.append({"width": im.width, "height": im.height,
                          "color_bytes": color.stat().st_size,
                          "bw_bytes": bw.stat().st_size})

    manifest = {
        "source": "resume.html",
        "source_sha256": source_hash,
        "pdf_pages": pages,
        "width": TARGET_W,
        "pages": sizes,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "method": "Chrome printToPDF -> per-page raster -> pixel grayscale",
        "note": "彩色版是真实导出 PDF 的原样栅格；黑白版是对其像素灰度化，模拟黑白打印。",
    }
    (out / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"✓ 预览图已生成：{pages} 页 × 2 版 → {out}")
    for i, s in enumerate(sizes, 1):
        print(f"  第 {i} 页  {s['width']}×{s['height']}  彩色 {s['color_bytes'] // 1024}KB / "
              f"黑白 {s['bw_bytes'] // 1024}KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
