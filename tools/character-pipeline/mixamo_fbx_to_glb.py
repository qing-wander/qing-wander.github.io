"""把 Mixamo 导出的「基础模型 FBX + N 个动画 FBX」合并为一个带动作 GLB。

用法（Blender 4.2+）：
  Blender --background --python tools/character-pipeline/mixamo_fbx_to_glb.py -- \
      --dir /path/to/mixamo_exports \
      --base male.fbx \
      --map "Breathing Idle.fbx=Idle" "Waving.fbx=Wave" "Sitting Idle.fbx=Sit" \
      --out /path/to/MaleRigged_raw.glb

说明：Mixamo 每个动画 FBX 都自带同一套蒙皮网格与骨架；本脚本只保留基础 FBX 的
网格/骨架，把其余 FBX 的 Action 改名后挂到同一骨架上导出，避免重复网格。
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
    p.add_argument('--base', default='male.fbx')
    p.add_argument('--map', nargs='*', default=[])
    p.add_argument('--out', required=True)
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

    # 1) 基础 FBX：保留它的网格 + 骨架
    base_path = os.path.join(a.dir, a.base)
    bpy.ops.import_scene.fbx(filepath=base_path)
    arm = objs('ARMATURE')[0]
    meshes = objs('MESH')
    # Mixamo FBX 是厘米单位，与上一轮流水线保持一致
    arm.scale = (100.0, 100.0, 100.0)
    bpy.context.view_layer.update()
    print('BASE bones', len(arm.data.bones), 'meshes', len(meshes),
          'verts', sum(len(m.data.vertices) for m in meshes))

    # 基础文件若自带 idle 动作，也保留为 Idle
    if arm.animation_data and arm.animation_data.action:
        act = arm.animation_data.action
        act.name = 'Idle'
        act.use_fake_user = True

    # 2) 每个动画 FBX：只取 Action，删掉重复网格/骨架
    for src, dst in mapping.items():
        path = os.path.join(a.dir, src)
        if not os.path.exists(path):
            print('SKIP missing', path)
            continue
        existing = set(bpy.data.actions)
        bpy.ops.import_scene.fbx(filepath=path)
        imported_actions = [x for x in bpy.data.actions if x not in existing]
        if not imported_actions:
            print('WARN no action in', src)
        else:
            imported_actions[0].name = dst
            imported_actions[0].use_fake_user = True
            print('ACTION', src, '->', dst)
        for o in objs('ARMATURE') + objs('MESH'):
            if o is not arm and o not in meshes:
                bpy.data.objects.remove(o, do_unlink=True)

    # 3) 导出：所有 Action 一条不少
    arm.animation_data_clear()
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


if __name__ == '__main__':
    main()
