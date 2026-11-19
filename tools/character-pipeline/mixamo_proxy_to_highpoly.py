"""把 Mixamo 在水密代理上生成的骨骼/动画，转移回原始高模，导出单文件 GLB。

流程：
  1. 导入 Mixamo 基础 FBX（代理网格 + 骨架 + 蒙皮权重，T-pose）
  2. 导入原始高模 GLB，按 bbox 对齐到代理网格
  3. KDTree 多点反距离权重转移（含左右肢体掩码、边平滑、top-4 影响）
  4. 删除代理网格，高模挂到骨架上
  5. 从 Idle/Wave/Sit 三个动画 FBX 提取 Action，改名挂到同一骨架
  6. 导出 GLB（export_animation_mode='ACTIONS'）

用法：
  Blender --background --python tools/character-pipeline/mixamo_proxy_to_highpoly.py -- \
    --mixamo-dir /path/to/mixamo_downloads \
    --base male.fbx \
    --high /Users/.../male.glb \
    --anim "Breathing Idle.fbx=Idle" "Waving.fbx=Wave" "Sitting Idle.fbx=Sit" \
    --out /path/to/MaleRigged_raw.glb
"""
import argparse
import os
import sys

import bpy
from mathutils import Vector, kdtree


def argv():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def objs(sc, kind):
    return [o for o in sc.objects if o.type == kind]


def wbbox(ob):
    mw = ob.matrix_world
    pts = [mw @ Vector(c) for c in ob.bound_box]
    return (Vector(tuple(min(p[i] for p in pts) for i in range(3))),
            Vector(tuple(max(p[i] for p in pts) for i in range(3))))


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--mixamo-dir', required=True)
    p.add_argument('--base', default='male.fbx')
    p.add_argument('--high', required=True)
    p.add_argument('--anim', nargs='*', default=[])
    p.add_argument('--out', required=True)
    a = p.parse_args(argv())

    anims = {}
    for item in a.anim:
        src, dst = item.split('=', 1)
        anims[src] = dst

    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene

    # 1) 基础：Mixamo 绑好骨的代理网格（含权重）
    base_path = os.path.join(a.mixamo_dir, a.base)
    bpy.ops.import_scene.fbx(filepath=base_path)
    arm = objs(sc, 'ARMATURE')[0]
    proxy = objs(sc, 'MESH')[0]
    # Mixamo FBX 单位厘米
    arm.scale = (100.0, 100.0, 100.0)
    bpy.context.view_layer.update()
    print('MIXAMO bones', len(arm.data.bones), 'proxy verts', len(proxy.data.vertices))
    print('PROXY bbox', [round(v, 4) for v in wbbox(proxy)[0]],
          [round(v, 4) for v in wbbox(proxy)[1]])


    # 基础 FBX 自带的动作直接删除，避免它混入导出动画列表
    if arm.animation_data and arm.animation_data.action:
        base_act = arm.animation_data.action
        arm.animation_data_clear()
        bpy.data.actions.remove(base_act)

    # 2) 原始高模
    bpy.ops.import_scene.gltf(filepath=a.high)
    high = [o for o in objs(sc, 'MESH') if o is not proxy][0]
    pmin, pmax = wbbox(proxy)
    hmin, hmax = wbbox(high)
    print('HIGH bbox before', [round(v, 4) for v in hmin], [round(v, 4) for v in hmax])

    # 按高度比例缩放 + 三轴对齐（同源模型，比例应接近 1）
    s = (pmax.z - pmin.z) / (hmax.z - hmin.z)
    high.scale = tuple(d * s for d in high.scale)
    bpy.context.view_layer.update()
    hmin, hmax = wbbox(high)
    high.location.x += (pmin.x + pmax.x) / 2 - (hmin.x + hmax.x) / 2
    high.location.y += (pmin.y + pmax.y) / 2 - (hmin.y + hmax.y) / 2
    high.location.z += pmin.z - hmin.z
    bpy.context.view_layer.update()
    print('HIGH bbox after ', [round(v, 4) for v in wbbox(high)[0]],
          [round(v, 4) for v in wbbox(high)[1]], 'scale', round(s, 6))

    # 把高模的缩放/位移烘焙进顶点，方便 KDTree 计算与挂骨
    bpy.context.view_layer.objects.active = high
    bpy.ops.object.select_all(action='DESELECT')
    high.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # 3) KDTree 权重转移
    K = 16
    kd = kdtree.KDTree(len(proxy.data.vertices))
    mvox = proxy.matrix_world
    for i, v in enumerate(proxy.data.vertices):
        kd.insert(mvox @ v.co, i)
    kd.balance()

    gname = {g.index: g.name for g in proxy.vertex_groups}
    lb_w = [[(gname.get(ge.group), ge.weight) for ge in v.groups]
            for v in proxy.data.vertices]

    mdet = high.matrix_world
    n_verts = len(high.data.vertices)
    weights = [None] * n_verts
    limb = ('UpLeg', 'Leg', 'Foot', 'ToeBase', 'Toe_End',
            'Arm', 'ForeArm', 'Hand', 'Shoulder')

    for i, v in enumerate(high.data.vertices):
        co = mdet @ v.co
        hits = kd.find_n(co, K)
        tot = 0.0
        acc = {}
        for _p, idx, dist in hits:
            w = 1.0 / max(dist * dist, 1e-8)
            tot += w
            for name, bw in lb_w[idx]:
                if name:
                    acc[name] = acc.get(name, 0.0) + bw * w
        if tot <= 0:
            continue
        # 左右侧肢体掩码：x<0 禁止接收 Right*，x>0 禁止接收 Left*
        cx = co.x - (pmin.x + pmax.x) / 2
        for n in list(acc.keys()):
            if any(k in n for k in limb):
                if 'Left' in n and cx < -0.02:
                    acc.pop(n)
                if 'Right' in n and cx > 0.02:
                    acc.pop(n)
        tot2 = sum(acc.values())
        if tot2 <= 0:
            continue
        # 只保留前 4 个影响，重新归一化
        top = sorted(acc.items(), key=lambda x: -x[1])[:4]
        s2 = sum(x[1] for x in top)
        weights[i] = {n: w / s2 for n, w in top}

    print('transferred', sum(1 for w in weights if w), '/', n_verts)

    # 沿网格边做 5 轮平滑，消除拼接硬边
    adj = [[] for _ in range(n_verts)]
    for e in high.data.edges:
        adj[e.vertices[0]].append(e.vertices[1])
        adj[e.vertices[1]].append(e.vertices[0])

    for _round in range(5):
        new = []
        for i in range(n_verts):
            if not weights[i]:
                new.append(None)
                continue
            nb = [weights[j] for j in adj[i] if weights[j]]
            acc = {}
            for n, w in weights[i].items():
                acc[n] = acc.get(n, 0.0) + w
            cnt = 1
            for d in nb:
                cnt += 1
                for n, w in d.items():
                    acc[n] = acc.get(n, 0.0) + w
            top = sorted(acc.items(), key=lambda x: -x[1])[:4]
            s2 = sum(x[1] for x in top) or 1.0
            new.append({n: w / s2 for n, w in top})
        weights = new

    # 写入高模顶点组
    names = sorted({n for w in weights if w for n in w})
    vgroups = {n: high.vertex_groups.new(name=n) for n in names}
    for i, w in enumerate(weights):
        if not w:
            continue
        for n, val in w.items():
            vgroups[n].add([i], val, 'REPLACE')

    # 高模挂骨架
    mod = high.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    high.parent = arm
    high.matrix_parent_inverse = arm.matrix_world.inverted()

    # 删除代理网格
    bpy.data.objects.remove(proxy, do_unlink=True)

    # 4) 动画
    for src, dst in anims.items():
        path = os.path.join(a.mixamo_dir, src)
        if not os.path.exists(path):
            print('SKIP missing', path)
            continue
        existing = set(bpy.data.actions)
        bpy.ops.import_scene.fbx(filepath=path)
        imported = [x for x in bpy.data.actions if x not in existing]
        if imported:
            imported[0].name = dst
            imported[0].use_fake_user = True
            print('ACTION', src, '->', dst)
        for o in objs(sc, 'ARMATURE') + objs(sc, 'MESH'):
            if o is not arm and o is not high:
                bpy.data.objects.remove(o, do_unlink=True)

    # 5) 导出：用 NLA strip 固定每个 action 的帧范围，ACTIONS 模式才能正确写入 GLB。
    #    直接靠 action.use_fake_user 在部分 Blender 4.x 版本会导出空动画数组。
    arm.animation_data_clear()
    arm.animation_data_create()
    for dst in anims.values():
        src_act = bpy.data.actions.get(dst)
        if not src_act:
            print('MISSING ACTION', dst)
            continue
        tr = arm.animation_data.nla_tracks.new()
        tr.name = dst
        fr = src_act.frame_range
        strip = tr.strips.new(dst, int(fr[0]), src_act)
        print('NLA strip', dst, 'range', tuple(round(x, 2) for x in fr))
    # 每条 NLA track 会成为 GLB 的一个 animation clip，名字取 track 名
    bpy.ops.export_scene.gltf(
        filepath=a.out,
        export_format='GLB',
        export_animation_mode='ACTIONS',
        export_skins=True,
        export_apply=False,
        export_yup=True,
    )
    print('EXPORTED', a.out, os.path.getsize(a.out))
    print('ACTIONS', [x.name for x in bpy.data.actions])
    print('NLA_TRACKS', [t.name for t in arm.animation_data.nla_tracks])


if __name__ == '__main__':
    main()
