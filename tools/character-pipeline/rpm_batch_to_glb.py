"""把 Ready Player Me 全部男性站姿动画重定向到本站骨架，烘焙进同一个 GLB。

共用一套网格/材质，17 段动画作为独立 Action，测试页可即时切换播放，不必重新加载模型。

用法：
  python rpm_batch_to_glb.py -- \
    --rig assets/skins/models/MaleRigged.glb \
    --clips-dir /tmp/rpm \
    --out assets/character-views/model/male/MaleRpmActions_raw.glb
"""
import bpy
import sys
import os
import glob
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


def import_fbx(path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    new = [o for o in bpy.context.scene.objects if o not in before]
    arm = next((o for o in new if o.type == 'ARMATURE'), None)
    return arm, new


def bake_one(our_arm, ordered, our_rest, clip_path, action_name):
    """把一个 RPM FBX 烘焙成 our_arm 上的新 Action，返回帧数。"""
    scn = bpy.context.scene
    rpm_arm, rpm_new = import_fbx(clip_path)
    rpm_action = find_action(rpm_arm)
    f0, f1 = int(rpm_action.frame_range[0]), int(rpm_action.frame_range[1])
    n = f1 - f0 + 1

    rpm_map = {short(b.name): b.name for b in rpm_arm.pose.bones}
    rpm_names = []
    usable = []
    for b, _ in ordered:
        k = short(b.name)
        if k in rpm_map:
            usable.append((b, rpm_map[k]))
            rpm_names.append(short(rpm_map[k]))
    # 缺骨骼映射时用静止四元数顶上（新建一个身份动作快照）
    rpm_rest = snapshot(rpm_arm, rpm_names)

    new_action = bpy.data.actions.new(action_name)
    our_arm.animation_data_create()
    our_arm.animation_data.action = new_action

    for i, f in enumerate(range(f0, f1 + 1)):
        scn.frame_set(f)
        bpy.context.view_layer.update()
        rpm_anim = snapshot(rpm_arm, rpm_names)
        for b, rname in usable:
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

    # 删除 RPM 临时骨架与原始 action 数据块，避免被导出器一起导出
    rpm_action_name = rpm_action.name
    for o in rpm_new:
        bpy.data.objects.remove(o, do_unlink=True)
    if rpm_action_name in bpy.data.actions:
        bpy.data.actions.remove(bpy.data.actions[rpm_action_name])
    return n


def main():
    rig_path = arg('--rig')
    clips_dir = arg('--clips-dir')
    out = arg('--out')

    bpy.ops.wm.read_factory_settings(use_empty=True)

    # ---- 本站骨架 ----
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=rig_path)
    new = [o for o in bpy.context.scene.objects if o not in before]
    our_arm = next(o for o in new if o.type == 'ARMATURE')
    main_mesh = next(o for o in new if o.type == 'MESH' and len(o.data.vertices) > 1000)
    print('RIG bones', len(our_arm.pose.bones), 'mesh verts', len(main_mesh.data.vertices))
    # 保留原有 Idle/Sit/Wave 三个 Action，清掉挂载但保住数据块
    kept = {}
    if our_arm.animation_data:
        for tr in our_arm.animation_data.nla_tracks:
            for st in tr.strips:
                if st.action:
                    kept[st.action.name] = st.action
        if our_arm.animation_data.action:
            kept[our_arm.animation_data.action.name] = our_arm.animation_data.action
    print('KEPT actions', list(kept.keys()))

    # ---- 骨骼映射（按 depth 排序）----
    def depth(b):
        d, p = 0, b.parent
        while p:
            d, p = d + 1, p.parent
        return d

    ordered = sorted(our_arm.pose.bones, key=depth)
    # 静止姿态快照：先确保无动画挂在当前骨架上
    our_arm.animation_data_clear()
    bpy.context.view_layer.update()
    our_names = [b.name for b in ordered]
    our_rest = snapshot(our_arm, our_names)

    # ---- 逐个烘焙 17 段 ----
    clips = sorted(glob.glob(os.path.join(clips_dir, 'M_Standing_Expressions_*.fbx')))
    print('CLIPS', len(clips))
    for path in clips:
        num = os.path.basename(path).split('_')[-1].replace('.fbx', '')
        name = 'RPM' + num
        n = bake_one(our_arm, [(b, None) for b in ordered], our_rest, path, name)
        print(' BAKED', name, n, 'frames')

    # ---- 清理多余网格 ----
    for o in list(bpy.context.scene.objects):
        if o.type == 'MESH' and o.name != main_mesh.name:
            bpy.data.objects.remove(o, do_unlink=True)

    scn = bpy.context.scene
    scn.frame_start = 0
    scn.frame_end = 120
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
    print('EXPORTED', out, round(os.path.getsize(out) / 1024), 'KB')


main()
