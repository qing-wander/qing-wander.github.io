"""把 Ready Player Me 动画库的 FBX 动作套到本站男模上，渲一张姿态预览图。

用途：候选动作人工筛选——一次跑一批，出 contact sheet 再挑。

用法：
  python rpm_anim_preview.py -- --rig assets/skins/models/MaleRigged.glb \
      --clip /tmp/rpm/M_Standing_Expressions_001.fbx --out /tmp/rpm/preview/e001.png
  可选 --frame-ratio 0.5 指定取哪一帧（默认 0.5）
"""
import bpy
import sys
import os
import math
from mathutils import Vector


def argv():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    a = argv()
    return a[a.index(name) + 1] if name in a else default


def clean():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.engine = 'BLENDER_WORKBENCH'
    bpy.context.scene.display.shading.light = 'STUDIO'
    bpy.context.scene.display.shading.color_type = 'SINGLE'
    bpy.context.scene.display.shading.single_color = (0.72, 0.72, 0.72)
    bpy.context.scene.display.shading.show_shadows = True
    bpy.context.scene.display.shading.show_cavity = True


def import_any(path):
    before = set(bpy.context.scene.objects)
    if path.lower().endswith('.glb') or path.lower().endswith('.gltf'):
        bpy.ops.import_scene.gltf(filepath=path)
    else:
        bpy.ops.import_scene.fbx(filepath=path)
    new = [o for o in bpy.context.scene.objects if o not in before]
    arms = [o for o in new if o.type == 'ARMATURE']
    return (arms[0] if arms else None), new


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


def short(name):
    return name.split(':')[-1]


def world_bbox(objs):
    """用求值后的顶点算包围盒：蒙皮网格的 bound_box 只有静置尺寸，量不准"""
    dg = bpy.context.evaluated_depsgraph_get()
    lo = Vector((1e18, 1e18, 1e18))
    hi = Vector((-1e18, -1e18, -1e18))
    for o in objs:
        if o.type != 'MESH':
            continue
        e = o.evaluated_get(dg)
        try:
            me = e.to_mesh()
        except RuntimeError:
            continue
        step = max(1, len(me.vertices) // 4000)
        for i in range(0, len(me.vertices), step):
            w = e.matrix_world @ me.vertices[i].co
            lo = Vector((min(lo[i], w[i]) for i in range(3)))
            hi = Vector((max(hi[i], w[i]) for i in range(3)))
        e.to_mesh_clear()
    return lo, hi


def main():
    rig_path = arg('--rig')
    clip_path = arg('--clip')
    out = arg('--out')
    ratio = float(arg('--frame-ratio', '0.5'))

    clean()
    our_arm, our_new = import_any(rig_path)
    if not our_arm:
        raise SystemExit('rig 里没有骨架')

    # 用骨架 pose bone 的世界位置定身高（FBX 导入常带 0.01 缩放，网格顶点采样不稳）。
    bpy.context.view_layer.update()
    bz = [(our_arm.matrix_world @ pb.matrix).translation.z for pb in our_arm.pose.bones]
    lo, hi = min(bz), max(bz)
    height = (hi - lo) or 0.01
    print('BBOX z', round(lo, 4), round(hi, 4), 'H', round(height, 4))

    # 导入候选动作，把旋转逐帧搬到本站骨架上
    rpm_arm, rpm_new = import_any(clip_path)
    rpm_act = find_action(rpm_arm)
    if not rpm_act:
        raise SystemExit('候选 FBX 没有 action')
    f0, f1 = int(rpm_act.frame_range[0]), int(rpm_act.frame_range[1])
    target = f0 + int((f1 - f0) * ratio)

    # 关掉本站骨架原有的动作，避免叠加
    if our_arm.animation_data:
        our_arm.animation_data_clear()
    if not our_arm.animation_data:
        our_arm.animation_data_create()

    # 两套骨架的静止姿态不同（RPM 是 A-pose，本站是 T-pose），
    # 所以不能照抄局部四元数。正确做法：取 RPM「动画帧相对静止帧」的
    # 世界空间旋转增量，再叠加到本站骨架的静止姿态上。
    def snapshot(arm, names):
        bpy.context.view_layer.update()
        return {n: (arm.matrix_world @ arm.pose.bones[n].matrix).to_quaternion()
                for n in names}

    rpm_names = [short(b.name) for b in rpm_arm.pose.bones]
    rpm_map = {short(b.name): b.name for b in rpm_arm.pose.bones}
    pairs = []
    for b in our_arm.pose.bones:
        n = short(b.name)
        if n in rpm_map:
            pairs.append((b, rpm_map[n]))
    print('mapped bones', len(pairs), '/', len(our_arm.pose.bones))

    # RPM 静止姿态：先摘掉动画再取快照
    rpm_ad = rpm_arm.animation_data
    rpm_action = rpm_ad.action if rpm_ad else None
    if rpm_action:
        rpm_ad.action = None
    rpm_rest = snapshot(rpm_arm, [rpm_map[b.name.split(':')[-1]] for b, _ in pairs])
    if rpm_action:
        rpm_ad.action = rpm_action

    # 本站骨架也在无动画状态下取一次（前面已 animation_data_clear）
    our_rest = snapshot(our_arm, [b.name for b, _ in pairs])

    scn = bpy.context.scene
    scn.frame_start, scn.frame_end = f0, f1
    scn.frame_set(target)
    bpy.context.view_layer.update()
    rpm_anim = snapshot(rpm_arm, [rpm_map[b.name.split(':')[-1]] for b, _ in pairs])

    def depth(b):
        d, p = 0, b.parent
        while p:
            d, p = d + 1, p.parent
        return d

    for b, rname in sorted(pairs, key=lambda x: depth(x[0])):
        key_r = short(rname)
        delta = rpm_anim[key_r] @ rpm_rest[key_r].inverted()
        target_q = delta @ our_rest[b.name]
        # 目标世界矩阵 = 目标旋转 + 本站静止位置；随后 location 归零，
        # 让父子层级自然带动子骨骼，避免增量位置把骨架拉散。
        b.rotation_mode = 'QUATERNION'
        base = target_q.to_matrix().to_4x4()
        base.translation = (our_arm.matrix_world @ b.bone.matrix_local).translation
        b.matrix = our_arm.matrix_world.inverted() @ base
        b.location = (0, 0, 0)
        b.scale = (1, 1, 1)
        bpy.context.view_layer.update()

    # 隐藏候选 FBX 带来的多余物体（通常是另一个骨架/网格）
    for o in rpm_new:
        o.hide_render = True
        o.hide_viewport = True

    bpy.context.view_layer.update()

    # 机位：正面略偏、正交，按身高取景
    cam_data = bpy.data.cameras.new('Cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = height * 1.55
    cam_data.clip_start = max(height * 0.02, 1e-4)
    cam_data.clip_end = height * 40
    cam = bpy.data.objects.new('Cam', cam_data)
    scn.collection.objects.link(cam)
    mid_z = lo + height * 0.5
    cam.location = (height * 0.10, -height * 3.0, mid_z)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scn.camera = cam

    scn.render.resolution_x = 420
    scn.render.resolution_y = 640
    scn.render.film_transparent = False
    scn.world = bpy.data.worlds.new('W')
    scn.world.color = (0.9, 0.9, 0.9)
    scn.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print('WROTE', out)


main()
