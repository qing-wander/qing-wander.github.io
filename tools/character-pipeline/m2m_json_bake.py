"""从 gltf-transform 导出的动画 JSON 重定向 Mesh2Motion 动作到本站骨架。

Mesh2Motion 的 GLB 用 EXT_meshopt_compression 且四元数是 QUATERNION filter
的 int16 编码，bpy 和现成工具链都解不对。流程：
  1) Node + gltf-transform 读原始 GLB，导出 decode 前的 accessor 原始数组
     （见 /tmp/meshdec/export_anim.mjs）
  2) 本脚本手动 decodeFilterQuat（int16 -> 单位四元数）
  3) 世界空间增量重定向到本站 41 骨骼，逐帧烘焙

用法：
  python m2m_json_bake.py -- --rig assets/skins/models/MaleRigged.glb \
    --json /tmp/m2m/meditate_anim.json --name Meditate \
    --out assets/character-views/model/male/MaleMeditate_raw.glb
"""
import bpy
import sys
import os
import json
import math
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


def decode_quat(v):
    """meshopt decodeFilterQuat：4 个 int16 编码 -> (x,y,z,w) 单位四元数"""
    q = [x / 32767.0 for x in v[:4]]
    k = max(range(4), key=lambda i: abs(q[i]))
    sign = 1.0 if q[k] >= 0 else -1.0
    others = [q[i] for i in range(4) if i != k]
    q[k] = sign * math.sqrt(max(0.0, 1.0 - sum(x*x for x in others)))
    return (q[0], q[1], q[2], q[3])  # glTF 顺序 x,y,z,w


def depth(b):
    d, p = 0, b.parent
    while p:
        d, p = d + 1, p.parent
    return d


def main():
    rig_path = arg('--rig')
    json_path = arg('--json')
    out = arg('--out')
    action_name = arg('--name', 'M2M')

    data = json.load(open(json_path))
    anim = data['animations'][0]
    print('CLIP', anim['name'], 'channels', len(anim['channels']))

    # 收集 channel：name -> {path: (times, values)}
    channels = {}
    for ch in anim['channels']:
        channels.setdefault(ch['node'], {})[ch['path']] = (ch['times'], ch['values'])

    # 全局时间轴
    times = None
    for node_ch in channels.values():
        for path, (ts, _) in node_ch.items():
            if times is None or len(ts) > len(times):
                times = ts
    n = len(times)
    print('FRAMES', n, 'dur', round(times[-1], 2))

    def sample_rot(name, t):
        if name not in channels or 'rotation' not in channels[name]:
            return None
        ts, vs = channels[name]['rotation']
        if t <= ts[0]:
            return decode_quat(vs[0])
        if t >= ts[-1]:
            return decode_quat(vs[-1])
        for i in range(len(ts)-1):
            if ts[i] <= t <= ts[i+1] and ts[i+1] > ts[i]:
                u = (t-ts[i])/(ts[i+1]-ts[i])
                q0 = Quaternion(tuple(decode_quat(vs[i])[k] for k in (3,0,1,2)))
                q1 = Quaternion(tuple(decode_quat(vs[i+1])[k] for k in (3,0,1,2)))
                if q0.dot(q1) < 0:
                    q1.negate()
                q = q0.slerp(q1, u)
                return (q.x, q.y, q.z, q.w)
        return decode_quat(vs[-1])

    def sample_vec(name, path, t):
        if name not in channels or path not in channels[name]:
            return None
        ts, vs = channels[name][path]
        if t <= ts[0]:
            return vs[0][:3]
        if t >= ts[-1]:
            return vs[-1][:3]
        return vs[len(vs)//2][:3]

    # ---- 本站骨架 ----
    bpy.ops.wm.read_factory_settings(use_empty=True)
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=rig_path)
    new = [o for o in bpy.context.scene.objects if o not in before]
    our_arm = next(o for o in new if o.type == 'ARMATURE')
    main_mesh = next(o for o in new if o.type == 'MESH' and len(o.data.vertices) > 1000)
    our_arm.animation_data_clear()
    bpy.context.view_layer.update()
    our_by_short = {short(b.name): b for b in our_arm.pose.bones}
    our_rest = {b.name: (our_arm.matrix_world @ b.matrix).to_quaternion() for b in our_arm.pose.bones}
    our_rest_pos = {b.name: (our_arm.matrix_world @ b.matrix).translation.copy() for b in our_arm.pose.bones}

    # M2M 静止四元数必须从 GLB 的 nodes[].rotation 取（骨架 rest pose），
    # 不能用 t=0 的动画值——冥想动作第一帧就是盘腿，用它当 rest 会让增量≈0。
    import struct
    glb = arg('--glb')
    if not glb:
        glb = json_path.replace('_anim.json', '.glb')
    gd = open(glb,'rb').read()
    gclen,_ = struct.unpack('<II', gd[12:20])
    gj = json.loads(gd[20:20+gclen].decode('utf8'))
    node_rot = {}
    for node in gj['nodes']:
        if 'rotation' in node:
            r = node['rotation']  # glTF x,y,z,w
            node_rot[node.get('name','')] = Quaternion((r[3], r[0], r[1], r[2]))
    m2m_rest = {k: node_rot[k] for k in MAP if k in node_rot}
    print('REST from GLB nodes', len(m2m_rest))

    pairs = []
    for mname, target in MAP.items():
        if mname in channels and 'rotation' in channels[mname] and target in our_by_short:
            pairs.append((our_by_short[target], mname))
    pairs.sort(key=lambda x: depth(x[0]))
    print('MAPPED', len(pairs))

    # ---- 烘焙 ----
    scn = bpy.context.scene
    new_action = bpy.data.actions.new(action_name)
    our_arm.animation_data_create()
    our_arm.animation_data.action = new_action

    for i, t in enumerate(times):
        for ob, mname in pairs:
            v = sample_rot(mname, t)
            if v is None:
                continue
            src_q = Quaternion((v[3], v[0], v[1], v[2]))
            # 世界空间旋转增量：源帧相对源静止的增量，叠加到本站静止姿态
            delta = src_q @ m2m_rest[mname].inverted()
            target_q = delta @ our_rest[ob.name]
            base = target_q.to_matrix().to_4x4()
            base.translation = our_rest_pos[ob.name]
            ob.matrix = our_arm.matrix_world.inverted() @ base
            ob.rotation_mode = 'QUATERNION'
            ob.keyframe_insert('rotation_quaternion', frame=i)
            ob.scale = (1, 1, 1)

        # 根位移：不写 Hips 的 location 曲线。源骨架 Y-up 且绝对高度与本站不兼容，
        # 照搬会把整个人顶出画面；坐姿下沉完全靠腿部骨骼旋转实现。

    # ---- 导出 ----
    for o in list(bpy.context.scene.objects):
        if o.type == 'MESH' and o.name != main_mesh.name:
            bpy.data.objects.remove(o, do_unlink=True)
    scn.frame_start = 0
    scn.frame_end = n - 1
    scn.render.fps = 24
    for o in bpy.context.scene.objects:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='ACTIONS',
        export_apply=False, export_yup=True,
    )
    print('EXPORTED', out, round(os.path.getsize(out)/1024), 'KB', 'frames', n)


main()
