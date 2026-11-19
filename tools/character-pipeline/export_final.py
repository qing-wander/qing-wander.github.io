import bpy, os
bpy.ops.wm.open_mainfile(filepath="/tmp/gltfwork/merged_sit.blend")
sc = bpy.context.scene
arm = [o for o in sc.objects if o.type == 'ARMATURE'][0]
print("ACTIONS", [a.name for a in bpy.data.actions])
print("ACTIVE", arm.animation_data.action.name)
out = "/tmp/gltfwork/PetSelfRigged_raw.glb"
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animation_mode='ACTIONS',
                          export_skins=True, export_apply=False)
print("EXPORTED", out, os.path.getsize(out))
