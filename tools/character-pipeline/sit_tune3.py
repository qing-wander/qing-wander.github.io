import bpy, sys, math
from mathutils import Vector, Matrix

bpy.ops.wm.open_mainfile(filepath="/tmp/gltfwork/merged.blend")
sc = bpy.context.scene
arm = [o for o in sc.objects if o.type == 'ARMATURE'][0]
acts = {a.name: a for a in bpy.data.actions}
pb = arm.pose.bones
AW = arm.matrix_world
AWi = AW.inverted()

def foot(sub):
    return [x for x in pb if x.name.endswith(sub)][0]

# ① 站立（Idle）时的脚掌世界朝向 —— 此时鞋底天然贴地
arm.animation_data.action = acts['Idle']
sc.frame_set(int(acts['Idle'].frame_range[0]))
bpy.context.view_layer.update()
ref = {}
for sub in ('LeftFoot', 'RightFoot'):
    b = foot(sub)
    R = (AW @ b.matrix).to_3x3()
    R.normalize()
    ref[sub] = R.copy()
    print(sub, 'idle Y', [round(c, 2) for c in R.col[1]])

# ② 坐姿：把脚掌世界朝向改成站立时的朝向（脚掌自然平放）
sit = acts['Sit']
arm.animation_data.action = sit
f1, f2 = int(sit.frame_range[0]), int(sit.frame_range[1])
sc.frame_set(f1)
bpy.context.view_layer.update()

for sub in ('LeftFoot', 'RightFoot'):
    b = foot(sub)
    W = AW @ b.matrix
    loc = W.to_translation()
    scl = W.to_3x3().median_scale
    R = ref[sub]
    b.matrix = AWi @ (Matrix.Translation(loc) @ (R @ Matrix.Scale(scl, 3)).to_4x4())
    for ch in ('rotation_quaternion', 'location'):
        b.keyframe_insert(data_path=ch, frame=f1)
        b.keyframe_insert(data_path=ch, frame=f2)

sc.frame_set(f1)
bpy.context.view_layer.update()
for sub in ('LeftFoot', 'RightFoot'):
    R = (AW @ foot(sub).matrix).to_3x3(); R.normalize()
    print(sub, 'sit now Y', [round(c, 2) for c in R.col[1]])

sc.render.engine = 'BLENDER_WORKBENCH'
sc.render.resolution_x = 620
sc.render.resolution_y = 760
cam_data = bpy.data.cameras.new("cam"); cam_data.type = 'ORTHO'; cam_data.ortho_scale = 230
cam = bpy.data.objects.new("cam", cam_data); sc.collection.objects.link(cam)
sc.camera = cam

def shot(loc, rot, path):
    cam.location = loc; cam.rotation_euler = rot
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("RENDER", path)

shot(Vector((0, -300, 55)), (math.radians(78), 0, 0), sys.argv[-2])
shot(Vector((-300, 0, 55)), (math.radians(78), 0, math.radians(-90)), sys.argv[-1])

if '--save' in sys.argv:
    arm.animation_data.action = sit
    for o in list(sc.objects):
        if o.type == 'CAMERA':
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.wm.save_as_mainfile(filepath="/tmp/gltfwork/merged_sit.blend")
    print("SAVED")
print("DONE")
