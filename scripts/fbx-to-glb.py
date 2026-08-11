"""
Import a Meshy FBX (+ optional external albedo PNG) and export a GLB with
animations intact.

  blender --background --python scripts/fbx-to-glb.py -- in.fbx out.glb [albedo.png]
"""
import sys
from pathlib import Path

import bpy

argv = sys.argv
argv = argv[argv.index('--') + 1 :] if '--' in argv else []
if len(argv) < 2:
    raise SystemExit('usage: blender --background --python fbx-to-glb.py -- in.fbx out.glb [albedo.png]')

src = Path(argv[0])
dst = Path(argv[1])
albedo = Path(argv[2]) if len(argv) > 2 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(src), automatic_bone_orientation=True)

# Hook the external albedo if the FBX came without an embedded map.
if albedo and albedo.is_file():
    img = bpy.data.images.load(str(albedo))
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            mat.use_nodes = True
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        principled = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not principled:
            continue
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = img
        links.new(tex.outputs['Color'], principled.inputs['Base Color'])

dst.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(dst),
    export_format='GLB',
    export_animations=True,
    export_skins=True,
    export_apply=False,
)

# List clip names for the wiring step.
names = [a.name for a in bpy.data.actions]
print('ANIMATIONS:', ', '.join(names) if names else '(none)')
print('WROTE', dst)
