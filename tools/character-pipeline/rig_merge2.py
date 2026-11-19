import bpy, os, math
from mathutils import Vector, kdtree

DL = "/Users/shenge/Downloads"
FBXS = ["Breathing Idle.fbx", "Waving.fbx", "Sitting Idle.fbx", "Sitting Idle(1).fbx"]
NAMES = ["Idle", "Wave", "Sit", "Lay"]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def meshes(): return [o for o in scene.objects if o.type == 'MESH']
def arms(): return [o for o in scene.objects if o.type == 'ARMATURE']
def wbbox(ob):
    mw = ob.matrix_world
    pts = [mw @ Vector(c) for c in ob.bound_box]
    return (Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
            Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))))

bpy.ops.import_scene.fbx(filepath=os.path.join(DL, FBXS[0]))
arm = arms()[0]; vox = meshes()[0]
act_idle = [a for a in bpy.data.actions][0]
arm.scale = (100.0, 100.0, 100.0)
bpy.context.view_layer.update()
mn, mx = wbbox(vox)
print("VOX bbox", [round(v,3) for v in mn], [round(v,3) for v in mx])

bpy.ops.import_scene.gltf(filepath="/tmp/gltfwork/tpose_plain.glb")
det = [o for o in meshes() if o is not vox][0]
mn2, mx2 = wbbox(det)
s = (mx.z - mn.z) / (mx2.z - mn2.z)
det.scale = tuple(d * s for d in det.scale)
bpy.context.view_layer.update()
mn2, mx2 = wbbox(det)
det.location.x += (mn.x + mx.x) / 2 - (mn2.x + mx2.x) / 2
det.location.y += (mn.y + mx.y) / 2 - (mn2.y + mx2.y) / 2
det.location.z += mn.z - mn2.z
bpy.context.view_layer.update()
print("DET bbox", [round(v,3) for v in wbbox(det)[0]], [round(v,3) for v in wbbox(det)[1]])

# ── 多点混合权重转移（而不是最近点单点刚性拷贝） ──
K = 16
kd = kdtree.KDTree(len(vox.data.vertices))
mvox = vox.matrix_world
for i, v in enumerate(vox.data.vertices):
    kd.insert(mvox @ v.co, i)
kd.balance()

gname = {g.index: g.name for g in vox.vertex_groups}
lb_w = [[(gname.get(ge.group), ge.weight) for ge in v.groups] for v in vox.data.vertices]

mdet = det.matrix_world
n_verts = len(det.data.vertices)
weights = [None] * n_verts
for i, v in enumerate(det.data.vertices):
    co = mdet @ v.co
    hits = kd.find_n(co, K)
    tot = 0.0
    acc = {}
    for (_p, idx, dist) in hits:
        # 距离加权（平方反比，最远点权重自然衰减）
        w = 1.0 / max(dist * dist, 1e-6)
        tot += w
        for name, bw in lb_w[idx]:
            if name:
                acc[name] = acc.get(name, 0.0) + bw * w
    if tot <= 0: continue
    # 左右侧掩码：四肢骨骼只允许同侧顶点接收，避免跨腿/跨臂串权重
    cx = (mdet @ v.co).x
    limb = ('UpLeg','Leg','Foot','ToeBase','Toe_End','Arm','ForeArm','Hand','Shoulder')
    for n in list(acc.keys()):
        if any(k in n for k in limb):
            if 'Left' in n and cx < -1.0: acc.pop(n)
            if 'Right' in n and cx > 1.0: acc.pop(n)
    tot2 = sum(acc.values())
    if tot2 <= 0: continue
    weights[i] = {n: v2 / tot2 for n, v2 in acc.items()}

print("raw transferred", sum(1 for w in weights if w))

# ── 沿网格边做两轮权重平滑，消除拼接硬边 ──
edges = [(e.vertices[0], e.vertices[1]) for e in det.data.edges]
print("edges", len(edges))
adj = [[] for _ in range(n_verts)]
for a, b in edges:
    adj[a].append(b); adj[b].append(a)

for it in range(5):
    new = [None] * n_verts
    for i in range(n_verts):
        w0 = weights[i]
        nb = adj[i]
        if not nb:
            new[i] = w0; continue
        acc = {}
        for n, v2 in (w0 or {}).items():
            acc[n] = acc.get(n, 0.0) + v2 * 0.45
        share = 0.55 / len(nb)
        for j in nb:
            wj = weights[j]
            if not wj: continue
            for n, v2 in wj.items():
                acc[n] = acc.get(n, 0.0) + v2 * share
        s2 = sum(acc.values())
        if s2 > 0:
            for n in acc: acc[n] /= s2
        new[i] = acc
    weights = new
print("smoothed")

# 只保留前 4 个影响并写入顶点组
for g in list(det.vertex_groups):
    det.vertex_groups.remove(g)
needed = set()
for w in weights:
    if w:
        for n in w: needed.add(n)
for name in sorted(needed):
    det.vertex_groups.new(name=name)
vgi = {g.name: g for g in det.vertex_groups}
for i, w in enumerate(weights):
    if not w: continue
    top = sorted(w.items(), key=lambda kv: -kv[1])[:4]
    s3 = sum(x[1] for x in top)
    if s3 <= 0: continue
    for n, v2 in top:
        vgi[n].add([i], v2 / s3, 'REPLACE')
print("DET vgroups", len(det.vertex_groups))

bpy.ops.object.select_all(action='DESELECT')
det.select_set(True)
bpy.context.view_layer.objects.active = det
mod = det.modifiers.new(name="Armature", type='ARMATURE')
mod.object = arm
det.parent = arm
det.matrix_parent_inverse = arm.matrix_world.inverted()
bpy.data.objects.remove(vox, do_unlink=True)

acts = [act_idle]
for f in FBXS[1:]:
    before_obj = set(scene.objects); before_act = set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=os.path.join(DL, f))
    for o in list(scene.objects):
        if o not in before_obj and o.type in ('MESH', 'ARMATURE'):
            bpy.data.objects.remove(o, do_unlink=True)
    acts.extend([a for a in bpy.data.actions if a not in before_act])

for a, n in zip(acts, NAMES):
    a.use_fake_user = True; a.name = n
print("ACTIONS", [a.name for a in bpy.data.actions])

for o in list(scene.objects):
    if o.type == 'MESH' and o is not det:
        bpy.data.objects.remove(o, do_unlink=True)

bpy.ops.wm.save_as_mainfile(filepath="/tmp/gltfwork/merged.blend")
print("SAVED blend")
out = "/tmp/gltfwork/PetSelfRigged_raw.glb"
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animation_mode='ACTIONS',
                          export_skins=True, export_apply=False)
print("EXPORTED", out, os.path.getsize(out))
