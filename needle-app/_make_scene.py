import bpy, sys
argv = sys.argv[sys.argv.index("--")+1:]
src, dst = argv
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
# Create AR root matching Unity hierarchy: Content scale 0.25, lift Y
root = bpy.data.objects.new("ARSessionRoot", None)
bpy.context.collection.objects.link(root)
content = bpy.data.objects.new("Content", None)
bpy.context.collection.objects.link(content)
content.parent = root
content.scale = (0.25, 0.25, 0.25)
# parent imported objects under content and offset Y
for obj in list(bpy.context.scene.objects):
    if obj.name in ("ARSessionRoot", "Content"):
        continue
    if obj.parent is None:
        obj.parent = content
# Move content children up like Unity turbofan local Y 1.67 (local space before scale)
# Apply offset on content location in local units
content.location.y = 0.0
# The Unity turbofan child had local Y=1.67 under Content(0.25) => world lift 0.4175
# Keep mesh as-is; Content scale handles size. Slight lift so it sits on floor:
for obj in content.children:
    obj.location.y += 1.67
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=False, export_apply=True)
print("WROTE", dst)
