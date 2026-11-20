"""把 Mesh2Motion 的人形动画（UE 风格 66 骨骼）重定向到本站 Mixamo 41 骨骼。

站点角色缺中指/无名指/小指，只映射共有的骨骼；坐姿类动画需要把根骨骼
的位移也搬过来（否则悬空），因此 Hips 用「源根相对位移」驱动。

流程：EXT_meshopt 压缩的 GLB 先用 /tmp/meshdec/decode.mjs 解成普通 GLB。

用法：
  python m2m_to_glb.py -- --rig assets/skins/models/MaleRigged.glb \
    --clip /tmp/m2m/meditate_dec.glb --name Meditate \
    --out assets/character-views/model/male/MaleMeditate_raw.glb
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


# M2M(UE) -> 本站(Mixamo) 骨骼名映射（只列命名不同的）
MAP = {
    'root': None,
    'pelvis': 'Hips',
    'spine_01': 'Spine', 'spine_02': 'Spine1', 'spine_03': 'Spine2',
    'neck_01': 'Neck', 'head': 'Head', 'head_leaf': 'HeadTop_End',
    'clavicle_l': 'LeftShoulder', 'upperarm_l': 'LeftArm', 'lowerarm_l': 'LeftForeArm', 'hand_l': 'LeftHand',
    'clavicle_r': 'RightShoulder', 'upperarm_r': 'RightArm', 'lowerarm_r': 'RightForeArm', 'hand_r': 'RightHand',
    'thigh_l': 'LeftUpLeg', 'calf_l': 'LeftLeg', 'foot_l': 'LeftFoot', 'ball_l': 'LeftToeBase',
    'thigh_r': 'RightUpLeg', 'calf_r': 'RightLeg', 'foot_r': 'RightFoot', 'ball_r': 'RightToeBase',
}
for side in ('l', 'r'):
    S = 'Left' if side == 'l' else 'Right'
    MAP[f'thumb_01_{side}'] = f'{S}HandThumb1'
    MAP[f'thumb_02_{side}'] = f'{S}HandThumb2'
    MAP[f'thumb_03_{side}'] = f'{S}HandThumb3'
    MAP[f'index_01_{side}'] = f'{S}HandIndex1'
    MAP[f'index_02_{side}'] = f'{S}HandIndex2'
    MAP[f'index_03_{side}'] = f'{S}HandIndex3'


def snapshot(arm, names, with_pos=False):
    bpy.context.view_layer.update()
    out = {}
    for n in names:
        pb = arm.pose.bones[n]
        m = arm.matrix_world @ pb.matrix
        out[n] = (m.to_quaternion(), m.translation.copy()) if with_pos else m.to_quaternion()
    return out


def depth(b):
    d, p = 0, b.parent
    while p:
        d, p = d + 1, p.parent
    return d


def main():
    rig_path = arg('--rig')
    clip_path = arg('--clip')
    out = arg('--out')
    action_name = arg('--name', 'M2M')

    bpy.ops.wm.read_factory_settings(use_empty=True)

    # ---- 本站骨架 ----
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=rig_path)
    new = [o for o in bpy.context.scene.objects if o not in before]
    our_arm = next(o for o in new if o.type == 'ARMATURE')
    main_mesh = next(o for o in new if o.type == 'MESH' and len(o.data.vertices) > 1000)
    kept = {}
    if our_arm.animation_data:
        for tr in our_arm.animation_data.nla_tracks:
            for st in tr.strips:
                if st.action:
                    kept[st.action.name] = st.action
        if our_arm.animation_data.action:
            kept[our_arm.animation_data.action.name] = our_arm.animation_data.action
    our_arm.animation_data_clear()
    print('RIG bones', len(our_arm.pose.bones), 'kept', list(kept.keys()))

    # ---- M2M 动画 ----
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=clip_path)
    m2m_new = [o for o in bpy.context.scene.objects if o not in before]
    m2m_arm = next(o for o in m2m_new if o.type == 'ARMATURE')
    act = m2m_arm.animation_data.action
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    print('CLIP', action_name, 'frames', f0, f1)

    # ---- 配对 ----
    our_by_short = {short(b.name): b for b in our_arm.pose.bones}
    pairs = []  # (our_bone, m2m_bone_name, apply_root_pos?)
    for mb in m2m_arm.pose.bones:
        target = MAP.get(mb.name)
        if target and target in our_by_short:
            pairs.append((our_by_short[target], mb.name, mb.name == 'pelvis'))
    pairs.sort(key=lambda x: depth(x[0]))
    our_names = [p[0].name for p in pairs]
    m2m_names = [p[1] for p in pairs]
    print('MAPPED', len(pairs), '/', len(m2m_arm.pose.bones))

    # ---- 静止快照 ----
    # M2M 摘掉动画取 rest
    saved = m2m_arm.animation_data.action
    m2m_arm.animation_data.action = None
    m2m_rest = snapshot(m2m_arm, m2m_names, with_pos=True)
    m2m_arm.animation_data.action = saved
    our_arm.animation_data_clear()
    bpy.context.view_layer.update()
    our_rest = snapshot(our_arm, our_names, with_pos=True)
    our_rest_root_pos = our_rest[our_names[0]][1].copy()

    # ---- 逐帧烘焙 ----
    scn = bpy.context.scene
    new_action = bpy.data.actions.new(action_name)
    our_arm.animation_data_create()
    our_arm.animation_data.action = new_action
    n = f1 - f0 + 1

    for i, f in enumerate(range(f0, f1 + 1)):
        scn.frame_set(f)
        bpy.context.view_layer.update()
        m2m_anim = snapshot(m2m_arm, m2m_names, with_pos=True)

        for ob, mname, is_root in pairs:
            delta = m2m_anim[mname][0] @ m2m_rest[mname][0].inverted()
            target_q = delta @ our_rest[ob.name][0]
            base = target_q.to_matrix().to_4x4()
            base.translation = our_rest[ob.name][1]
            # 根骨骼：把源位移（相对静止）按比例搬到本站 Hips，坐姿才会下沉
            if is_root:
                move = m2m_anim[mname][1] - m2m_rest[mname][1]
                base.translation = our_rest_root_pos + move
            ob.matrix = our_arm.matrix_world.inverted() @ base
            ob.rotation_mode = 'QUATERNION'
            ob.keyframe_insert('rotation_quaternion', frame=i)
            if is_root:
                ob.keyframe_insert('location', frame=i)
            ob.scale = (1, 1, 1)
        if i % 10 == 0:
            print(' baked', i, '/', n)

    # ---- 清理与导出 ----
    for o in m2m_new:
        bpy.data.objects.remove(o, do_unlink=True)
    if act.name in bpy.data.actions:
        bpy.data.actions.remove(bpy.data.actions[act.name])
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
