"""把 Mixamo Thinking 动画改造成男性化版本。

思路：Thinking 原动作 = 右手托腮 + 左手叉腰 + 双腿交叉。
改造：保留上半身（含右手托腮），把【左臂链】与【双腿链】的旋转曲线
换成同一角色 Idle 动画的曲线（手臂自然下垂、双腿并拢站立）。

用法：
  python fix_thinking.py -- --think A.fbx --idle B.fbx [--material-blend mat.blend] --out out.glb
"""
import bpy
import sys
import os


def argv():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


# 要替换成 Idle 姿态的骨骼（左臂 + 双腿）
TARGET_SUFFIXES = [
    'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
    'LeftHandIndex1', 'LeftHandIndex2', 'LeftHandIndex3',
    'LeftHandMiddle1', 'LeftHandMiddle2', 'LeftHandMiddle3',
    'LeftHandPinky1', 'LeftHandPinky2', 'LeftHandPinky3',
    'LeftHandRing1', 'LeftHandRing2', 'LeftHandRing3',
    'LeftHandThumb1', 'LeftHandThumb2', 'LeftHandThumb3',
    'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'LeftToe_End',
    'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase', 'RightToe_End',
]


def clean_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fbx(path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    new = [o for o in bpy.context.scene.objects if o not in before]
    arms = [o for o in new if o.type == 'ARMATURE']
    meshes = [o for o in new if o.type == 'MESH']
    return (arms[0] if arms else None), (meshes[0] if meshes else None), new


def get_action(arm):
    ad = arm.animation_data
    if not ad:
        return None
    if ad.action:
        return ad.action
    # 可能在 NLA 里
    for tr in ad.nla_tracks:
        for st in tr.strips:
            if st.action:
                return st.action
    return None


def bone_short(name):
    return name.split(':')[-1]


def sample_pose(arm, action, bones, n_frames):
    """按帧采样骨骼的局部四元数 + 位置，循环补齐到 n_frames。"""
    arm.animation_data.action = action
    fstart, fend = action.frame_range
    samples = {b: [] for b in bones}
    for f in range(int(fstart), int(fend) + 1):
        bpy.context.scene.frame_set(f)
        for b in bones:
            pb = arm.pose.bones.get(b)
            if pb is None:
                continue
            samples[b].append((tuple(pb.rotation_quaternion), tuple(pb.location)))
    out = {}
    for b, seq in samples.items():
        if not seq:
            continue
        full = [seq[i % len(seq)] for i in range(n_frames)]
        out[b] = full
    return out


def main():
    a = argv()
    think = a[a.index('--think') + 1]
    idle = a[a.index('--idle') + 1]
    out = a[a.index('--out') + 1]
    mat_blend = a[a.index('--material-blend') + 1] if '--material-blend' in a else None

    # ---- 1. 先读 Idle，采样目标骨骼 ----
    clean_scene()
    arm_i, mesh_i, objs_i = import_fbx(idle)
    act_i = get_action(arm_i)
    print('IDLE action', act_i.name if act_i else None,
          'range', [round(x, 1) for x in act_i.frame_range] if act_i else None)
    idle_bones = [b.name for b in arm_i.pose.bones
                  if bone_short(b.name) in TARGET_SUFFIXES]
    print('IDLE target bones', len(idle_bones))

    # ---- 2. 读 Thinking，拿到帧数 ----
    clean_scene()
    arm_t, mesh_t, objs_t = import_fbx(think)
    act_t = get_action(arm_t)
    f0, f1 = act_t.frame_range
    n_frames = int(f1 - f0 + 1)
    print('THINK action', act_t.name, 'range', [round(f0, 1), round(f1, 1)],
          'frames', n_frames, 'bones', len(arm_t.data.bones),
          'verts', len(mesh_t.data.vertices))

    # 采样 Idle（在临时场景里做，避免对象冲突）
    clean_scene()
    arm_i2, mesh_i2, _ = import_fbx(idle)
    act_i2 = get_action(arm_i2)
    idle_bones2 = [b.name for b in arm_i2.pose.bones
                   if bone_short(b.name) in TARGET_SUFFIXES]
    samples = sample_pose(arm_i2, act_i2, idle_bones2, n_frames)
    print('sampled', {k: len(v) for k, v in list(samples.items())[:3]}, '...')

    # ---- 3. 回到 Thinking，替换目标骨骼曲线 ----
    clean_scene()
    arm_t, mesh_t, objs_t = import_fbx(think)
    act_t = get_action(arm_t)
    arm_t.animation_data.action = act_t

    replace_names = [b.name for b in arm_t.pose.bones
                     if bone_short(b.name) in TARGET_SUFFIXES]
    # 删除原有 rotation/location 曲线
    removed = 0
    for fc in list(act_t.fcurves):
        dp = fc.data_path
        if not dp.startswith('pose.bones['):
            continue
        nm = dp.split('"')[1]
        if nm in replace_names and (dp.endswith('rotation_quaternion')
                                    or dp.endswith('rotation_euler')
                                    or dp.endswith('location')):
            act_t.fcurves.remove(fc)
            removed += 1
    print('removed fcurves', removed, 'for', len(replace_names), 'bones')

    # 写入 Idle 采样值
    for b in replace_names:
        pb = arm_t.pose.bones.get(b)
        if pb is None or b not in samples:
            continue
        pb.rotation_mode = 'QUATERNION'
        for i in range(n_frames):
            frame = int(f0) + i
            q, loc = samples[b][i]
            pb.rotation_quaternion = q
            pb.location = loc
            pb.keyframe_insert('rotation_quaternion', frame=frame)
            pb.keyframe_insert('location', frame=frame)

    # ---- 4. 材质（从 50K 源 GLB 提取的 blend 里取）----
    if mat_blend and os.path.exists(mat_blend):
        with bpy.data.libraries.load(mat_blend, link=False) as (df, dt):
            names = [n for n in df.materials if n.startswith('Material')]
            dt.materials = names
        mats = [m for m in bpy.data.materials if m and m.name in names]
        if mats:
            mesh_t.data.materials.clear()
            for m in mats:
                mesh_t.data.materials.append(m)
            print('assigned materials', [m.name for m in mats])

    # ---- 5. 清掉非主体网格（材质库可能带入杂物）----
    keep = {mesh_t.name}
    for o in list(bpy.context.scene.objects):
        if o.type == 'MESH' and o.name not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
            print('removed stray mesh')

    # ---- 6. 导出 ----
    bpy.context.scene.frame_start = int(f0)
    bpy.context.scene.frame_end = int(f1)
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
    print('EXPORTED', out, round(os.path.getsize(out) / 1048576, 2), 'MB')


main()
