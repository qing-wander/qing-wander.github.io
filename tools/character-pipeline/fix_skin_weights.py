#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fix_skin_weights.py — 修复 PetSelfRigged.glb 的下肢蒙皮权重（不依赖 Blender / 原始 FBX）

## 根因

`rig_merge2.py` 用 KDTree 把 Mixamo 水密低模的蒙皮权重转移到混元 3D 高模时，
两个网格只做了「bbox 等比缩放 + 脚底对齐」，没有做关节级配准。两者的人体比例
（尤其髋/膝/踝的高度）不一致，权重沿身体轴向系统性错位，后果是：

    LeftLeg / RightLeg（小腿骨）没有任何一个顶点以它为主导权重，
    整段小腿被 LeftUpLeg（大腿骨）和 LeftFoot（脚骨）瓜分。

站立（Idle）、挥手（Wave）时腿是直的，看不出来；一旦 Sit / Lay 需要屈膝 90°，
小腿网格不跟着小腿骨旋转 → 腿部撕裂、脚收不回来 → 坐姿与 Mixamo 示例不一致。

## 修复策略

不去动骨骼动画（骨骼摆出的盘腿姿势经 FK 验证是正确的），只重建网格权重：

* 按顶点高度 y 做高斯软分区，重新分配 Hips / UpLeg / Leg / Foot / ToeBase；
  **补上缺失的小腿段**，让膝盖以下的顶点由 LeftLeg / RightLeg 驱动。
* 左右由 x 符号决定，髋部 [-0.52, -0.42] 做线性过渡带，避免硬缝。
* 只处理「髋以下 + 原本就含下肢骨骼」的顶点；上半身、手臂、头部权重一字不改。
* JOINTS_0 / WEIGHTS_0 均为 4×UNSIGNED_BYTE，位于 stride=28 的交错顶点块中
  （JOINTS_0 @ +0，WEIGHTS_0 @ +24）。原地覆写，GLB 长度与 JSON chunk 完全不变，
  因此材质、贴图、四段动画、inverseBindMatrices 全部原样保留。

## 用法

    python tools/character-pipeline/fix_skin_weights.py            # 产出 PetSelfRigged.fixed.glb
    python tools/character-pipeline/fix_skin_weights.py --apply    # 备份原文件后覆盖正式 GLB
    python tools/character-pipeline/fix_skin_weights.py --knee -0.66 --sigma 0.075  # 调参

改完务必用 model-viewer 实拍 Idle / Wave / Sit / Lay 四个动作复核。
"""

import argparse
import json
import math
import os
import shutil
import struct
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DEFAULT_GLB = os.path.join(ROOT, 'assets', 'skins', 'models', 'PetSelfRigged.glb')

# ── 顶点高度分区（POSITION 是 normalized SHORT，解码后的模型空间，y ∈ [-1, 1]）──
# 脚底 -1.0 / 脚踝 -0.845 / 膝 -0.665 / 髋 -0.470 / 臀 -0.36 / 头顶 +0.9
HIP_Y = -0.470
KNEE_Y = -0.665
ANKLE_Y = -0.845
TOE_Y = -0.955
BLEND_TOP = -0.420          # 高于此高度完全保留原权重
BLEND_BOTTOM = -0.520       # 低于此高度完全使用新权重

LOWER = {
    'Hips',
    'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'LeftToe_End',
    'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase', 'RightToe_End',
}

COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2),
        5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    with open(path, 'rb') as f:
        raw = f.read()
    magic, version, length = struct.unpack_from('<4sII', raw, 0)
    if magic != b'glTF' or version != 2:
        raise ValueError('不是有效的 GLB 2.0: %s' % path)
    off, chunks = 12, []
    while off < length:
        size, ctype = struct.unpack_from('<I4s', raw, off)
        off += 8
        chunks.append((ctype, bytearray(raw[off:off + size])))
        off += size
    doc = json.loads(bytes(chunks[0][1]).decode('utf-8').rstrip('\x00 '))
    bin_chunk = next(c for c in chunks if c[0] == b'BIN\x00')[1]
    return raw[:12], chunks, doc, bin_chunk


def accessor_view(doc, idx):
    a = doc['accessors'][idx]
    bv = doc['bufferViews'][a['bufferView']]
    fmt, size = COMP[a['componentType']]
    count = NCOMP[a['type']]
    return {
        'fmt': fmt, 'size': size, 'count': count,
        'base': bv.get('byteOffset', 0) + a.get('byteOffset', 0),
        'stride': bv.get('byteStride') or size * count,
        'n': a['count'],
        'normalized': bool(a.get('normalized')),
        'componentType': a['componentType'],
    }


def read_attr(bin_chunk, view, i):
    o = view['base'] + i * view['stride']
    return struct.unpack_from('<' + view['fmt'] * view['count'], bin_chunk, o)


def decode_short(v):
    return max(v / 32767.0, -1.0)


def build_centers(knee, ankle, sigma):
    """每根骨骼的影响中心与带宽；段与段之间自然重叠形成软过渡。"""
    hip = HIP_Y
    toe = TOE_Y
    return {
        'Hips':        (hip - 0.055, sigma * 1.35),
        'UpLeg':       ((hip + knee) / 2.0, sigma),
        'Leg':         ((knee + ankle) / 2.0, sigma),
        'Foot':        ((ankle + toe) / 2.0 - 0.010, sigma * 0.82),
        'ToeBase':     (toe, sigma * 0.66),
    }


def new_weights(x, y, centers, sigma):
    """返回 {骨骼名: 权重}，已归一化，最多 4 项。"""
    side = 'Left' if x >= 0 else 'Right'
    names = ['Hips', side + 'UpLeg', side + 'Leg', side + 'Foot', side + 'ToeBase']
    keys = ['Hips', 'UpLeg', 'Leg', 'Foot', 'ToeBase']
    raw = {}
    for name, key in zip(names, keys):
        c, s = centers[key]
        raw[name] = math.exp(-0.5 * ((y - c) / s) ** 2)
    # 裆部中线：腿内侧顶点更多交给 Hips，避免左右腿互相拉扯
    inner = max(0.0, 1.0 - abs(x) / 0.055)
    if inner > 0:
        for name in names[1:]:
            raw[name] *= (1.0 - 0.75 * inner)
        raw['Hips'] += 0.20 * inner
    total = sum(raw.values())
    if total <= 1e-9:
        return None
    picked = sorted(((n, v / total) for n, v in raw.items() if v / total > 0.004),
                    key=lambda kv: -kv[1])[:4]
    s2 = sum(v for _, v in picked)
    return {n: v / s2 for n, v in picked}


def main():
    ap = argparse.ArgumentParser(description='修复 PetSelfRigged.glb 下肢蒙皮权重')
    ap.add_argument('--in', dest='src', default=DEFAULT_GLB)
    ap.add_argument('--out', dest='dst', default=None)
    ap.add_argument('--apply', action='store_true', help='备份后覆盖正式 GLB')
    ap.add_argument('--knee', type=float, default=KNEE_Y)
    ap.add_argument('--ankle', type=float, default=ANKLE_Y)
    ap.add_argument('--sigma', type=float, default=0.070)
    args = ap.parse_args()

    dst = args.dst or (DEFAULT_GLB if args.apply else DEFAULT_GLB.replace('.glb', '.fixed.glb'))
    header, chunks, doc, bin_chunk = read_glb(args.src)
    prim = doc['meshes'][0]['primitives'][0]
    attrs = prim['attributes']
    vpos = accessor_view(doc, attrs['POSITION'])
    vjoint = accessor_view(doc, attrs['JOINTS_0'])
    vweight = accessor_view(doc, attrs['WEIGHTS_0'])
    if vjoint['componentType'] != 5121 or vweight['componentType'] != 5121:
        raise ValueError('JOINTS_0 / WEIGHTS_0 需要是 UNSIGNED_BYTE')
    if vpos['stride'] != vjoint['stride'] or vpos['stride'] != vweight['stride']:
        raise ValueError('顶点属性不是同一个交错 bufferView')

    joints = doc['skins'][0]['joints']
    jnames = [doc['nodes'][n].get('name', '').replace('mixamorig:', '') for n in joints]
    name2idx = {n: i for i, n in enumerate(jnames)}
    centers = build_centers(args.knee, args.ankle, args.sigma)

    before = defaultdict(int)
    after = defaultdict(int)
    touched = 0
    for i in range(vpos['n']):
        p = read_attr(bin_chunk, vpos, i)
        jj = read_attr(bin_chunk, vjoint, i)
        ww = read_attr(bin_chunk, vweight, i)
        old = {}
        for j, w in zip(jj, ww):
            if w:
                old[jnames[j]] = old.get(jnames[j], 0.0) + w / 255.0
        if old:
            before[max(old, key=old.get)] += 1

        x, y = decode_short(p[0]), decode_short(p[1])
        is_lower_vertex = y < BLEND_TOP and any(n in LOWER for n in old)
        if not is_lower_vertex:
            if old:
                after[max(old, key=old.get)] += 1
            continue

        fresh = new_weights(x, y, centers, args.sigma)
        if fresh is None:
            continue
        # 髋部过渡带：原权重 → 新权重 线性混合
        alpha = min(1.0, max(0.0, (BLEND_TOP - y) / (BLEND_TOP - BLEND_BOTTOM)))
        merged = {}
        for n, v in old.items():
            merged[n] = merged.get(n, 0.0) + v * (1.0 - alpha)
        for n, v in fresh.items():
            merged[n] = merged.get(n, 0.0) + v * alpha
        # 只保留下肢相关的骨骼，避免把旧的上半身权重带进腿部
        merged = {n: v for n, v in merged.items() if n in LOWER and v > 0.004}
        total = sum(merged.values())
        if total <= 1e-9:
            continue
        picked = sorted(merged.items(), key=lambda kv: -kv[1])[:4]
        s3 = sum(v for _, v in picked)
        final = [(name2idx[n], v / s3) for n, v in picked if n in name2idx]

        jo = vjoint['base'] + i * vjoint['stride']
        wo = vweight['base'] + i * vweight['stride']
        jb = [0] * 4
        wb = [0] * 4
        for k, (jidx, w) in enumerate(final[:4]):
            jb[k] = jidx
            wb[k] = max(0, min(255, int(round(w * 255))))
        # 归一化到 255，避免舍入导致权重和不足
        diff = 255 - sum(wb)
        if diff and wb:
            wb[0] = max(0, min(255, wb[0] + diff))
        struct.pack_into('<4B', bin_chunk, jo, *jb)
        struct.pack_into('<4B', bin_chunk, wo, *wb)
        touched += 1
        after[max(final, key=lambda t: t[1])[0]] += 0  # 占位，下面另行统计
        after[jnames[max(final, key=lambda t: t[1])[0]]] += 1

    # 把修好的 BIN 写回 chunk 并重新封装 GLB（长度不变）
    for k, c in enumerate(chunks):
        if c[0] == b'BIN\x00':
            chunks[k] = (c[0], bin_chunk)
    out = bytearray(header)
    for ctype, data in chunks:
        out += struct.pack('<I4s', len(data), ctype)
        out += data
    if len(out) != len(header) + sum(8 + len(d) for _, d in chunks):
        raise RuntimeError('GLB 封装长度异常')

    tmp = dst + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(out)
    if args.apply:
        backup = os.path.join(os.environ.get('TEMP', '/tmp'), 'PetSelfRigged.original.glb')
        if not os.path.exists(backup):
            shutil.copy2(args.src, backup)
        print('备份原文件 ->', backup)
    os.replace(tmp, dst)
    print('输出 ->', dst, '(%d bytes, 原 %d)' % (len(out), os.path.getsize(args.src)))
    print('重写顶点数:', touched, '/', vpos['n'])
    print('\n主导骨骼顶点数（修复前 → 修复后）：')
    for n in ('Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
              'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'):
        print('  %-14s %6d → %6d' % (n, before.get(n, 0), after.get(n, 0)))
    print('\n注意：after 只统计被重写顶点 + 未改动顶点的主导骨骼，仅供快速核对。')


if __name__ == '__main__':
    main()
