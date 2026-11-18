#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
recolor_glb.py — 给 GLB 里的材质改基色（不改网格、不改动画、不重新导出）

为什么需要这一步
  1. three.js 官方示例里的人物多是 Mixamo 素模，原始基色是粉肉色 / 暗棕，
     直接放在本站档案纸底色上会「脏」。只改 baseColorFactor 就能重出一版，
     骨骼、动画、蒙皮全部原样保留，体积也不变（JSON 里改几个浮点数）。
  2. glTF 的 baseColorFactor 是**线性**色彩空间，不能把 CSS 的 #RRGGBB 直接塞进去，
     必须先做 sRGB → linear 转换，否则屏幕上会偏亮偏白。

用法
  # Xbot 档案风配色（象牙白身体 + 墨黑关节）
  python3 scripts/recolor_glb.py assets/skins/models/Xbot.glb \\
      assets/skins/models/Xbot-ivory.glb --preset archive

  # 自定义：按材质名子串匹配（区分大小写，写多少条匹配多少条）
  python3 scripts/recolor_glb.py in.glb out.glb \\
      --color "Joints=#141311" --color "HighLimbs=#F0E9DA"

  # 顺带调金属度 / 粗糙度（不写则保持原值）
  python3 scripts/recolor_glb.py in.glb out.glb \\
      --color "Joints=#141311" --metallic "Joints=0.15" --roughness "Joints=0.65"

校验
  python3 scripts/recolor_glb.py out.glb  — 只读模式：打印每个材质的当前基色（sRGB 与线性两种）
"""

import argparse
import json
import struct
import sys

JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942

# 本站档案主题（css/style.css :root）
PRESETS = {
    "archive": {
        "colors": [("Joints", "#141311"), ("HighLimbs", "#F0E9DA")],
        "metallic": [("Joints", 0.15), ("HighLimbs", 0.0)],
        "roughness": [("Joints", 0.65), ("HighLimbs", 0.72)],
    },
    "blueprint": {
        "colors": [("Joints", "#123A5C"), ("HighLimbs", "#E9F1F8")],
        "metallic": [("Joints", 0.15), ("HighLimbs", 0.0)],
        "roughness": [("Joints", 0.65), ("HighLimbs", 0.72)],
    },
}


def srgb_hex_to_linear(hex_color):
    """#RRGGBB → glTF 线性 baseColorFactor（含 alpha=1）"""
    h = hex_color.strip().lstrip("#")
    if len(h) != 6:
        raise ValueError("颜色必须是 #RRGGBB 形式：" + hex_color)
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return out + [1.0]


def linear_to_srgb_hex(factor):
    def one(c):
        c = max(0.0, min(1.0, c))
        c = 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055
        return int(round(c * 255))
    return "#%02X%02X%02X" % (one(factor[0]), one(factor[1]), one(factor[2]))


def read_glb(path):
    data = open(path, "rb").read()
    magic, version, total = struct.unpack("<III", data[:12])
    if magic != 0x46546C67:
        raise ValueError("不是 GLB 文件：" + path)
    if version != 2:
        raise ValueError("只支持 glTF 2.0 的 GLB，当前版本 %d" % version)
    off = 12
    js, bin_chunk = None, b""
    while off < total:
        clen, ctype = struct.unpack("<II", data[off:off + 8])
        off += 8
        chunk = data[off:off + clen]
        off += clen
        if ctype == JSON_CHUNK:
            js = json.loads(chunk.decode("utf-8"))
        elif ctype == BIN_CHUNK:
            bin_chunk = chunk
    if js is None:
        raise ValueError("GLB 里没有 JSON chunk")
    return js, bin_chunk


def write_glb(path, js, bin_chunk):
    jb = json.dumps(js, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    jb += b" " * ((4 - len(jb) % 4) % 4)          # JSON chunk 用空格补齐到 4 字节
    bin_pad = b""
    if bin_chunk:
        bin_pad = bin_chunk + b"\x00" * ((4 - len(bin_chunk) % 4) % 4)
    total = 12 + 8 + len(jb) + (8 + len(bin_pad) if bin_pad else 0)
    out = struct.pack("<III", 0x46546C67, 2, total)
    out += struct.pack("<II", len(jb), JSON_CHUNK) + jb
    if bin_pad:
        out += struct.pack("<II", len(bin_pad), BIN_CHUNK) + bin_pad
    open(path, "wb").write(out)
    return len(out)


def parse_pairs(items):
    pairs = []
    for it in items or []:
        if "=" not in it:
            raise ValueError("参数要写成 材质名子串=值：" + it)
        k, v = it.split("=", 1)
        pairs.append((k.strip(), v.strip()))
    return pairs


def main(argv):
    ap = argparse.ArgumentParser(description="改 GLB 材质基色（保留骨骼与动画）")
    ap.add_argument("src", help="源 GLB")
    ap.add_argument("dst", nargs="?", help="输出 GLB；省略则只打印材质信息")
    ap.add_argument("--preset", choices=sorted(PRESETS), help="内置配色方案")
    ap.add_argument("--color", action="append", help="材质名子串=#RRGGBB，可重复")
    ap.add_argument("--metallic", action="append", help="材质名子串=0~1，可重复")
    ap.add_argument("--roughness", action="append", help="材质名子串=0~1，可重复")
    args = ap.parse_args(argv)

    js, bin_chunk = read_glb(args.src)
    mats = js.get("materials", [])

    if not args.dst:
        print("%-40s %-9s %s" % ("material", "sRGB", "linear"))
        for m in mats:
            f = m.get("pbrMetallicRoughness", {}).get("baseColorFactor", [1, 1, 1, 1])
            print("%-40s %-9s %s" % (m.get("name", "?"), linear_to_srgb_hex(f),
                                     [round(x, 4) for x in f[:3]]))
        return 0

    colors, metallics, roughnesses = [], [], []
    if args.preset:
        p = PRESETS[args.preset]
        colors += p["colors"]
        metallics += p["metallic"]
        roughnesses += p["roughness"]
    colors += parse_pairs(args.color)
    metallics += [(k, float(v)) for k, v in parse_pairs(args.metallic)]
    roughnesses += [(k, float(v)) for k, v in parse_pairs(args.roughness)]

    touched = set()
    for m in mats:
        name = m.get("name", "")
        pbr = m.setdefault("pbrMetallicRoughness", {})
        for key, hexv in colors:
            if key in name:
                pbr["baseColorFactor"] = srgb_hex_to_linear(hexv)
                touched.add(name)
                print("  color   %-38s → %s" % (name, hexv))
        for key, v in metallics:
            if key in name:
                pbr["metallicFactor"] = v
                touched.add(name)
                print("  metallic %-37s → %s" % (name, v))
        for key, v in roughnesses:
            if key in name:
                pbr["roughnessFactor"] = v
                touched.add(name)
                print("  rough   %-38s → %s" % (name, v))

    if not touched:
        print("✗ 没有任何材质被匹配到，检查子串大小写：")
        for m in mats:
            print("   ", m.get("name"))
        return 1

    size = write_glb(args.dst, js, bin_chunk)
    print("✓ 写出 %s（%.0f KB），动画段 %d 条保持不变" %
          (args.dst, size / 1024, len(js.get("animations", []))))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
