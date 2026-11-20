"""把 Ready Player Me 的男性站姿动画重定向到本站 Mixamo 骨架，导出可播放的 GLB。

难点：两套骨架静止姿态不同（RPM = A-pose，本站 = T-pose），不能照抄局部四元数。
做法：取 RPM 「动画帧相对静止帧」的世界空间旋转增量，叠加到本站骨架的静止姿态，
逐帧烘焙成新 Action，保留本站网格与材质。

用法：
  python rpm_thinking_to_glb.py -- \
    --rig assets/skins/models/MaleRigged.glb \
    --clip /tmp/rpm/M_Standing_Expressions_018.fbx \
    --out assets/character-views/model/male/MaleThinkingRPM_raw.glb
"""
import bpy
import sys
import os
from mathutils import Vector


def argv():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    a = argv()
    return a[a.index(name) + 1] if name in a else default


def short(name):
    return name.split(':')[-1]


def find_action(arm):
    ad = arm.animation_data
    if not ad:
        return None
    if ad.action:
        return ad.action
    for tr in ad.nla_tracks:
        for st in tr.strips:
            if st.action:
                return st.action
    return None


def snapshot(arm, names):
    bpy.context.view_layer.update()
    return {n: (arm.matrix_world @ arm.pose.bones[n].matrix).to_quaternion()
            for n in names}


def main():
    rig_path = arg('--rig')
    clip_path = arg('--clip')
    out = arg('--out')

    bpy.ops.wm.read_factory_settings(use_empty=True)

    # ---- 1. 本站骨架（带材质网格）----
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=rig_path)
    new = [o for o in bpy.context.scene.objects if o not in before]
    our_arm = next(o for o in new if o.type == 'ARMATURE')
    main_mesh = next(o for o in new if o.type == 'MESH' and len(o.data.vertices) > 1000)
    print('RIG bones', len(our_arm.pose.bones), 'mesh', main_mesh.name,
          'verts', len(main_mesh.data.vertices), 'mats', len(main_mesh.data.materials))
    # 清掉原有动画，避免与新 Action 叠加
    our_arm.animation_data_clear()

    # ---- 2. RPM 动作源 ----
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.fbx(filepath=clip_path)
    rpm_new = [o for o in bpy.context.scene.objects if o not in before]
    rpm_arm = next(o for o in rpm_new if o.type == 'ARMATURE')
    rpm_action = find_action(rpm_arm)
    f0, f1 = int(rpm_action.frame_range[0]), int(rpm_action.frame_range[1])
    print('CLIP frames', f0, f1, 'bones', len(rpm_arm.pose.bones))

    # ---- 3. 骨骼映射 ----
    rpm_map = {short(b.name): b.name for b in rpm_arm.pose.bones}
    pairs = []
    for b in our_arm.pose.bones:
        n = short(b.name)
        if n in rpm_map:
            pairs.append((b, rpm_map[n]))
    print('MAPPED', len(pairs), '/', len(our_arm.pose.bones))

    def depth(b):
        d, p = 0, b.parent
        while p:
            d, p = d + 1, p.parent
        return d

    ordered = sorted(pairs, key=lambda x: depth(x[0]))
    our_names = [b.name for b, _ in ordered]
    rpm_names = [short(rname) for _, rname in ordered]

    # ---- 4. 静止姿态快照（两边都先摘掉动画）----
    rpm_ad = rpm_arm.animation_data
    saved_action = rpm_ad.action if rpm_ad else None
    if rpm_ad and rpm_ad.action:
        rpm_ad.action = None
    rpm_rest = snapshot(rpm_arm, rpm_names)
    if rpm_ad and saved_action:
        rpm_ad.action = saved_action
    our_rest = snapshot(our_arm, our_names)

    # ---- 5. 逐帧烘焙 ----
    scn = bpy.context.scene
    new_action = bpy.data.actions.new('Thinking')
    our_arm.animation_data_create()
    our_arm.animation_data.action = new_action
    n = f1 - f0 + 1

    for i, f in enumerate(range(f0, f1 + 1)):
        scn.frame_set(f)
        bpy.context.view_layer.update()
        rpm_anim = snapshot(rpm_arm, rpm_names)
        # b.matrix 是绝对世界矩阵赋值，Blender 会按当前父骨骼状态反解 basis。
        # 不能先把骨骼 reset 到 identity——那样父骨骼矩阵变了，子骨骼反解会错位
        # （实测会导致整个人躺倒）。按 depth 顺序逐个覆盖即可。
        for b, rname in ordered:
            k = short(rname)
            delta = rpm_anim[k] @ rpm_rest[k].inverted()
            target_q = delta @ our_rest[b.name]
            base = target_q.to_matrix().to_4x4()
            base.translation = (our_arm.matrix_world @ b.bone.matrix_local).translation
            b.matrix = our_arm.matrix_world.inverted() @ base
            b.location = (0, 0, 0)
            b.scale = (1, 1, 1)
            b.rotation_mode = 'QUATERNION'
            b.keyframe_insert('rotation_quaternion', frame=i)

        if i % 30 == 0:
            print(' baked', i, '/', n)

    # ---- 6. 清理：删掉 RPM 骨架与多余网格 ----
    # 注意：导出器会把场景里残留的 action 一起导出，RPM 原始曲线必须
    # 连数据块一起删，否则它会覆盖重定向后的 Thinking。
    rpm_action_name = rpm_action.name
    for o in rpm_new:
        bpy.data.objects.remove(o, do_unlink=True)
    if rpm_action_name in bpy.data.actions:
        bpy.data.actions.remove(bpy.data.actions[rpm_action_name])
    for o in list(bpy.context.scene.objects):
        if o.type == 'MESH' and o.name != main_mesh.name:
            bpy.data.objects.remove(o, do_unlink=True)

    scn.frame_start = 0
    scn.frame_end = n - 1
    scn.render.fps = 24
    for o in bpy.context.scene.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format='GLB',
        use_selection=True,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_apply=False,
        export_yup=True,
    )
    print('EXPORTED', out, round(os.path.getsize(out) / 1024), 'KB', 'frames', n)


main()
