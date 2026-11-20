"""直接解析 Mesh2Motion 的 GLB（解压后）动画数据并重定向到本站骨架。

Mesh2Motion 把多段动画的四元数打包在同一个 bufferView 里（各 accessor 用
byteOffset 区分），Blender 的 glTF 导入器不认这种结构，只能自己读 accessor。
原 GLB 带 EXT_meshopt_compression，先用 /tmp/meshdec/decode.mjs 解压。

用法：
  python m2m_direct_bake.py -- --rig assets/skins/models/MaleRigged.glb \
    --clip /tmp/m2m/meditate_dec.glb --name Meditate \
    --out assets/character-views/model/male/MaleMeditate_raw.glb
"""
import bpy
import sys
import os
import json
import struct
import array
from mathutils import Quaternion, Vector


def argv():
    return sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    a = argv()
    return a[a.index(name) + 1] if name in a else default


def short(name):
    return name.split(':')[-1]


MAP = {
    'pelvis': 'Hips', 'spine_01': 'Spine', 'spine_02': 'Spine1', 'spine_03': 'Spine2',
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


def parse_glb(path):
    d = open(path, 'rb').read()
    clen, ctype = struct.unpack('<II', d[12:20])
    j = json.loads(d[20:20 + clen].decode('utf8'))
    binoff = 20 + clen + 8
    return j, d[binoff:]


def read_accessor(j, buf, idx):
    a = j['accessors'][idx]
    bv = j['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = a['count']
    comp = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
    arr = array.array('f')
    arr.frombytes(buf[off:off + n * comp * 4])
    # glTF 四元数是 (x,y,z,w)，Blender 是 (w,x,y,z)
    if a['type'] == 'VEC4' and comp == 4:
        return [tuple(arr[k*4:k*4+4]) for k in range(n)]
    return [tuple(arr[k*comp:(k+1)*comp]) for k in range(n)]


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

    # ---- 1. 解析源 GLB ----
    j, buf = parse_glb(clip_path)
    joints = j['skins'][0]['joints']
    node_names = [j['nodes'][i].get('name', '') for i in joints]
    anim = j['animations'][0]
    # 节点 -> 通道索引
    channels = {}
    for ch in anim['channels']:
        t = ch['target']
        if t['path'] in ('rotation', 'translation'):
            channels.setdefault(t['node'], {})[t['path']] = ch['sampler']
    # 全部时间点（取最长的一条输入）
    times = None
    for s in anim['samplers']:
        ts = read_accessor(j, buf, s['input'])
        if times is None or len(ts) > len(times):
            times = [t[0] for t in ts]
    print('CLIP', action_name, 'joints', len(joints), 'keys', len(times), 'dur', round(times[-1], 2))

    # 按 M2M 骨骼名收集旋转曲线（按最近时间点重采样）
    curves = {}  # name -> [(t, (x,y,z,w))]
    for node_idx, sdict in channels.items():
        name = j['nodes'][node_idx].get('name', '')
        if name not in MAP or 'rotation' not in sdict:
            continue
        s = anim['samplers'][sdict['rotation']]
        ts = [t[0] for t in read_accessor(j, buf, s['input'])]
        vs = read_accessor(j, buf, s['output'])
        if len(ts) != len(vs):
            print(' WARN mismatch', name, len(ts), len(vs))
            continue
        curves[name] = list(zip(ts, vs))
        # 位移曲线（pelvis 需要）
        if name == 'pelvis' and 'translation' in sdict:
            st = anim['samplers'][sdict['translation']]
            tts = [t[0] for t in read_accessor(j, buf, st['input'])]
            tvs = read_accessor(j, buf, st['output'])
            curves['pelvis_pos'] = list(zip(tts, tvs))
    print('CURVES', len(curves), 'sample:', list(curves.keys())[:6])

    def sample(curve, t):
        """线性插值，四元数用 nlerp + 半球校正"""
        if not curve:
            return None
        if t <= curve[0][0]:
            return curve[0][1]
        if t >= curve[-1][0]:
            return curve[-1][1]
        for i in range(len(curve) - 1):
            t0, v0 = curve[i]
            t1, v1 = curve[i + 1]
            if t0 <= t <= t1 and t1 > t0:
                u = (t - t0) / (t1 - t0)
                if len(v0) == 4:
                    q0 = Quaternion((v0[3], v0[0], v0[1], v0[2]))
                    q1 = Quaternion((v1[3], v1[0], v1[1], v1[2]))
                    if q0.dot(q1) < 0:
                        q1.negate()
                    q = q0.slerp(q1, u)
                    return (q.x, q.y, q.z, q.w)
                return tuple(v0[k] + (v1[k] - v0[k]) * u for k in range(len(v0)))
        return curve[-1][1]

    # ---- 2. 本站骨架 ----
    bpy.ops.wm.read_factory_settings(use_empty=True)
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=rig_path)
    new = [o for o in bpy.context.scene.objects if o not in before]
    our_arm = next(o for o in new if o.type == 'ARMATURE')
    main_mesh = next(o for o in new if o.type == 'MESH' and len(o.data.vertices) > 1000)
    our_arm.animation_data_clear()
    bpy.context.view_layer.update()
    our_by_short = {short(b.name): b for b in our_arm.pose.bones}

    # 静止姿态（世界四元数）
    our_rest = {b.name: (our_arm.matrix_world @ b.matrix).to_quaternion()
                for b in our_arm.pose.bones}
    our_rest_pos = {b.name: (our_arm.matrix_world @ b.matrix).translation.copy()
                    for b in our_arm.pose.bones}

    # M2M 静止姿态：用 t=0 之前的姿态不可得，用 rest bone 的世界旋转近似
    # 实际上 M2M 的 animation 第一帧就是起始姿态，用 t=0 作为 rest 会让动作变成相对变化消失
    # 所以采用网站通用的做法：直接用 M2M 的 absolutely rotation 作为目标世界旋转，
    # 配合骨架朝向差异做一次坐标对齐。
    # 先算 M2M rest：从 GLB nodes 的 rotation 字段
    m2m_rest_q = {}
    for node_idx, name in zip(joints, node_names):
        node = j['nodes'][node_idx]
        if 'rotation' in node:
            r = node['rotation']
            m2m_rest_q[name] = Quaternion((r[3], r[0], r[1], r[2]))
        else:
            m2m_rest_q[name] = Quaternion((1,0,0,0))

    # ---- 3. 烘焙 ----
    scn = bpy.context.scene
    new_action = bpy.data.actions.new(action_name)
    our_arm.animation_data_create()
    our_arm.animation_data.action = new_action

    # 配对：只取有曲线的骨骼
    pairs = []
    for mname, target in MAP.items():
        if mname not in curves or target not in our_by_short:
            continue
        pairs.append((our_by_short[target], mname))
    pairs.sort(key=lambda x: depth(x[0]))
    print('MAPPED', len(pairs))

    n = len(times)
    fps = 24
    for i, t in enumerate(times):
        frame = i  # 按索引均匀烘焙，保证时长一致
        for ob, mname in pairs:
            v = sample(curves[mname], t)
            if v is None:
                continue
            src_q = Quaternion((v[3], v[0], v[1], v[2]))
            # 直接把源世界旋转作为目标：两套骨架的 rest 朝向差异用
            # 每一对骨骼的「静止四元数比值」做常数校正
            rest_diff = m2m_rest_q[mname].inverted() @ m2m_rest_q[mname]
            delta = src_q @ m2m_rest_q[mname].inverted()
            target_q = delta @ our_rest[ob.name]
            base = target_q.to_matrix().to_4x4()
            base.translation = our_rest_pos[ob.name]
            ob.matrix = our_arm.matrix_world.inverted() @ base
            ob.rotation_mode = 'QUATERNION'
            ob.keyframe_insert('rotation_quaternion', frame=frame)
            ob.scale = (1, 1, 1)

        # 根位移：把源 pelvis 的位移增量搬到本站 Hips（坐姿下沉）
        if 'pelvis_pos' in curves and 'Hips' in our_by_short:
            p = sample(curves['pelvis_pos'], t)
            if p:
                hips = our_by_short['Hips']
                base = our_rest[hips.name].to_matrix().to_4x4()
                base.translation = our_rest_pos[hips.name] + Vector((p[0], p[1], p[2])) * 0.01
                hips.matrix = our_arm.matrix_world.inverted() @ base
                hips.keyframe_insert('location', frame=frame)

    # ---- 4. 清理导出 ----
    for o in list(bpy.context.scene.objects):
        if o.type == 'MESH' and o.name != main_mesh.name:
            bpy.data.objects.remove(o, do_unlink=True)
    scn.frame_start = 0
    scn.frame_end = n - 1
    scn.render.fps = fps
    for o in bpy.context.scene.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='ACTIONS',
        export_apply=False, export_yup=True,
    )
    print('EXPORTED', out, round(os.path.getsize(out)/1024), 'KB', 'frames', n)


main()
