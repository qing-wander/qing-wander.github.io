#!/usr/bin/env python3
"""把一个 Mixamo FBX 的动作追加到已有 GLB 的动画列表里（不改网格/贴图/骨骼）。

为什么需要：站点用的是已经压过 Draco + WebP 的成品 GLB，用 Blender 重新导出会把
网格和贴图整条链路重做一遍，容易画质/尺寸回退。这里只往 glTF 的 animations
数组里追加通道，其余字节原样保留。

前提：FBX 与 GLB 是同一套 Mixamo 骨骼。FBX 的骨骼旋转是「骨骼局部空间」，
glTF 节点旋转是「父节点空间」，两者差一个常量四元数（本站女性/男性都是 Hips
差 -90°X，其余骨骼为单位四元数）。用同一角色的旧动作反推这个常量即可。

用法：
  1) 在浏览器里把 FBX 转成轨道 JSON（three.js FBXLoader，约 20 行，见
     docs/ai-avatar-skins.md §12 的片段），得到 tracks.json：
       { "animations": [ { "tracks": [ {node, times[], values[]}, ... ] } ] }
  2) 反推校正并注入：
       python3 add_fbx_anim_to_glb.py \
         --glb FemaleRigged.glb --tracks tracks.json --name Think \
         --ref-glb FemaleRigged.glb --ref-anim Idle \
         --ref-tracks Idle_tracks.json \
         --out FemaleRigged_think.glb
     （--ref-* 只用来算常量校正；给出时会在同角色的既有动作上验证误差）
  3) gltf-transform inspect 确认动画列表，再把文件替换到 assets/skins/models/，
     并在 js/ai-skins.js 里把对应 GLB 的 ?v= 递增。
"""
import argparse, json, math, re, struct, sys


def read_glb(path):
    d = open(path, 'rb').read()
    magic, ver, total = struct.unpack('<III', d[:12])
    if magic != 0x46546C67 or ver != 2:
        sys.exit('只支持 GLB v2')
    off, js, bin_ = 12, None, None
    while off < total:
        clen, ctype = struct.unpack('<II', d[off:off + 8])
        body = d[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(body.decode('utf-8'))
        elif ctype == 0x004E4942:
            bin_ = bytearray(body)
        off += 8 + clen
    return js, bin_


def write_glb(path, js, bin_):
    jb = json.dumps(js, separators=(',', ':')).encode('utf-8')
    jb += b' ' * ((4 - len(jb) % 4) % 4)
    bb = bytes(bin_) + b'\x00' * ((4 - len(bin_) % 4) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(bb)))
        f.write(struct.pack('<II', len(jb), 0x4E4F534A)); f.write(jb)
        f.write(struct.pack('<II', len(bb), 0x004E4942)); f.write(bb)


def accessor(js, bin_, idx):
    a = js['accessors'][idx]
    bv = js['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride') or n * 4
    return [struct.unpack_from('<%df' % n, bin_, start + i * stride) for i in range(a['count'])]


def qnorm(q):
    n = math.sqrt(sum(x * x for x in q)) or 1
    return tuple(x / n for x in q)


def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return (aw*bx + ax*bw + ay*bz - az*by,
            aw*by - ax*bz + ay*bw + az*bx,
            aw*bz + ax*by - ay*bx + az*bw,
            aw*bw - ax*bx - ay*by - az*bz)


def qinv(q):
    x, y, z, w = q
    return (-x, -y, -z, w)


def qangle(a, b):
    d = min(1.0, abs(sum(x * y for x, y in zip(qnorm(a), qnorm(b)))))
    return math.degrees(2 * math.acos(d))


def nn(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def anim_rotations(js, bin_, name):
    for anim in js.get('animations', []):
        if anim.get('name') != name:
            continue
        out = {}
        for ch in anim['channels']:
            if ch['target'].get('path') != 'rotation':
                continue
            s = anim['samplers'][ch['sampler']]
            node = js['nodes'][ch['target']['node']].get('name')
            out[nn(node)] = (accessor(js, bin_, s['input']), accessor(js, bin_, s['output']))
        return out
    sys.exit('GLB 里没有动画：' + name)


def tracks_map(path):
    a = json.load(open(path))['animations'][0]
    return {nn(t['node']): t for t in a['tracks']}


def derive_correction(js, bin_, ref_anim, ref_tracks):
    glb = anim_rotations(js, bin_, ref_anim)
    fbx = tracks_map(ref_tracks)
    corr = {}
    for key, (times, quats) in glb.items():
        tr = fbx.get(key)
        if not tr:
            continue
        corr[key] = qmul(qnorm(quats[0]), qinv(qnorm(tr['values'][:4])))
    return corr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--glb', required=True)
    ap.add_argument('--tracks', required=True)
    ap.add_argument('--name', default='Think')
    ap.add_argument('--ref-glb')
    ap.add_argument('--ref-anim', default='Idle')
    ap.add_argument('--ref-tracks')
    ap.add_argument('--ref-check', default='Sit')
    ap.add_argument('--ref-check-tracks')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    js, bin_ = read_glb(a.glb)
    nodes = js['nodes']
    by_name = {nn(n.get('name')): i for i, n in enumerate(nodes)}

    corr = {}
    if a.ref_glb and a.ref_tracks:
        ref_js, ref_bin = read_glb(a.ref_glb)
        corr = derive_correction(ref_js, ref_bin, a.ref_anim, a.ref_tracks)
        print('校正骨骼 %d 根' % len(corr))
        # 用另一段动作验证常量校正是否成立
        if a.ref_check and a.ref_check_tracks:
            errs = []
            for key, (times, quats) in anim_rotations(ref_js, ref_bin, a.ref_check).items():
                tr = tracks_map(a.ref_check_tracks).get(key)
                if not tr:
                    continue
                qc = corr.get(key, (0, 0, 0, 1))
                pred = [qmul(qc, qnorm(tr['values'][i*4:i*4+4])) for i in range(len(tr['times']))]
                for i in range(len(quats)):
                    j = min(len(pred) - 1, round(i * (len(pred) - 1) / max(1, len(quats) - 1)))
                    errs.append(qangle(quats[i], pred[j]))
            if errs:
                errs.sort()
                print('%s 校验：中位 %.2f° / p95 %.2f° / 最大 %.2f°' % (
                    a.ref_check, errs[len(errs)//2], errs[int(len(errs)*0.95)], errs[-1]))

    src = json.load(open(a.tracks))['animations'][0]

    def add_view(data, target=None):
        if len(bin_) % 4:
            bin_.extend(b'\x00' * (4 - len(bin_) % 4))
        off = len(bin_)
        bin_.extend(data)
        bv = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            bv['target'] = target
        js['bufferViews'].append(bv)
        return len(js['bufferViews']) - 1

    time_cache = {}

    def time_accessor(times):
        key = tuple(times)
        if key in time_cache:
            return time_cache[key]
        view = add_view(struct.pack('<%df' % len(times), *times))
        js['accessors'].append({'bufferView': view, 'componentType': 5126, 'count': len(times),
                                'type': 'SCALAR', 'min': [min(times)], 'max': [max(times)]})
        time_cache[key] = len(js['accessors']) - 1
        return time_cache[key]

    channels, samplers, skipped = [], [], []
    for tr in src['tracks']:
        idx = by_name.get(nn(tr['node']))
        if idx is None:
            skipped.append(tr['node']); continue
        qc = corr.get(nn(tr['node']), (0, 0, 0, 1))
        vals = []
        for i in range(len(tr['times'])):
            vals.extend(qmul(qc, qnorm(tr['values'][i*4:i*4+4])))
        view = add_view(struct.pack('<%df' % len(vals), *vals))
        js['accessors'].append({'bufferView': view, 'componentType': 5126,
                                'count': len(tr['times']), 'type': 'VEC4'})
        out_acc = len(js['accessors']) - 1
        # 注意：先取 out_acc 再建时间轴，否则 time_accessor 先 append 会让 output 指到时间轴上
        in_acc = time_accessor(tr['times'])
        samplers.append({'input': in_acc, 'output': out_acc, 'interpolation': 'LINEAR'})
        channels.append({'sampler': len(samplers) - 1,
                         'target': {'node': idx, 'path': 'rotation'}})

    js.setdefault('animations', []).append({'name': a.name, 'channels': channels, 'samplers': samplers})
    js['buffers'][0]['byteLength'] = len(bin_) + (4 - len(bin_) % 4) % 4
    write_glb(a.out, js, bin_)
    print('写入 %s：动画 %s，通道 %d，跳过 %s' % (a.out, a.name, len(channels), skipped or '无'))
    print('现有动画：', [x.get('name') for x in js['animations']])


if __name__ == '__main__':
    main()
