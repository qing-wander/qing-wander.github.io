"""把 Mixamo 动画 FBX 自带的蒙皮网格+骨架直接合并为一个带三段动作的 GLB。

适用：混元 3D 直接导出最终面数模型（如 50K）上传 Mixamo 的场景——
Mixamo 下载的每个动画 FBX 已经带完整模型的蒙皮网格与权重，无需再做
"代理→高模"权重转移（那一步在躺倒朝向的源 GLB 上会把网格挂错而糊掉）。

流程：
  1. 导入 base FBX（选一个动画 FBX，如 Idle），保留它自带的蒙皮网格 + 骨架 + 权重
  2. 其余动画 FBX 只取 Action，改名挂到同一骨架，删除重复网格/骨架
  3. 每条 Action 建一条 NLA track（ACTIONS 导出模式靠 NLA strip 决定帧范围）
  4. 导出 GLB，再由 @gltf-transform/cli 压缩

用法：
  Blender --background --python tools/character-pipeline/mixamo_fbx_nla_to_glb.py -- \
    --dir assets/character-views/model/male/mixamo-downloads \
    --base Idle.fbx \
    --map "Idle.fbx=Idle" "Wave.fbx=Wave" "Sit.fbx=Sit" \
    --out /path/to/MaleRigged50K_raw2.glb
"""
import argparse
import os
import sys

import bpy


def argv():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--dir', required=True)
    p.add_argument('--base', default='Idle.fbx')
    p.add_argument('--map', nargs='*', default=[])
    p.add_argument('--out', required=True)
    p.add_argument('--material-blend', default=None,
                   help='可选：包含源模型材质的 .blend，按 UV 一致把材质贴回 FBX 网格')
    a = p.parse_args(argv())

    mapping = {}
    for item in a.map:
        if '=' not in item:
            raise SystemExit('bad --map item: ' + item)
        src, dst = item.split('=', 1)
        mapping[src] = dst

    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene

    def objs(kind):
        return [o for o in sc.objects if o.type == kind]

    # 1) 基础 FBX：自带蒙皮网格 + 骨架 + 权重，原样保留
    base_path = os.path.join(a.dir, a.base)
    bpy.ops.import_scene.fbx(filepath=base_path)
    arm = objs('ARMATURE')[0]
    keep_meshes = objs('MESH')
    arm.scale = (100.0, 100.0, 100.0)   # Mixamo FBX 厘米 → 米
    bpy.context.view_layer.update()
    print('BASE bones', len(arm.data.bones), 'meshes', len(keep_meshes),
          'verts', sum(len(m.data.vertices) for m in keep_meshes))

    # 1b) 把源模型材质贴回 FBX 网格（FBX 自带 UV 但与源 GLB 逐顶点一致，可直接复用）
    if a.material_blend and os.path.exists(a.material_blend):
        with bpy.data.libraries.load(a.material_blend, link=False) as (data_from, data_to):
            want = [n for n in data_from.materials if n.startswith('Material')]
            data_to.materials = want
        if data_to.materials:
            mat = data_to.materials[0]
            for m in keep_meshes:
                m.data.materials.clear()
                m.data.materials.append(mat)
            print('MATERIAL', mat.name, '->', [m.name for m in keep_meshes])

    # 清掉基础文件自带 action，避免混入动画列表（我们会按 map 重新挂）
    if arm.animation_data and arm.animation_data.action:
        base_act = arm.animation_data.action
        arm.animation_data_clear()
        bpy.data.actions.remove(base_act)

    # 2) 每个动画 FBX 只取 Action：先改名挂 fake user，再删重复对象
    for src, dst in mapping.items():
        path = os.path.join(a.dir, src)
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
        else:
            print('WARN no action', src)
        for o in objs('ARMATURE') + objs('MESH'):
            if o is not arm and o not in keep_meshes:
                bpy.data.objects.remove(o, do_unlink=True)

    # 3) NLA tracks：每条 track 一个动画，strip 固定 action 帧范围
    arm.animation_data_clear()
    arm.animation_data_create()
    for dst in mapping.values():
        act = bpy.data.actions.get(dst)
        if not act:
            print('MISSING ACTION', dst)
            continue
        tr = arm.animation_data.nla_tracks.new()
        tr.name = dst
        fr = act.frame_range
        tr.strips.new(dst, int(fr[0]), act)
        print('NLA', dst, tuple(round(x, 2) for x in fr))

    # 4) 导出前清理：只保留骨架 + 从 base 带来的主网格，删掉导入动画时混入的杂项网格
    for o in list(objs('MESH')):
        if o not in keep_meshes:
            bpy.data.objects.remove(o, do_unlink=True)

    # 4) 导出
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
