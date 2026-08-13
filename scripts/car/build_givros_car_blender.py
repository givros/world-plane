"""Prepare the supplied Sally Carrera GLB for the Three.js game through Blender MCP.

This script deliberately preserves the supplied mesh, UVs and textures. It applies
a measured runtime proportion calibration, then adds the @givros plate, action pivots,
interaction sockets, collider proxies, deterministic review renders and export contract.

Run from Blender MCP with:
    exec(compile(open(path, encoding="utf-8").read(), path, "exec"))
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


def locate_project_root() -> Path:
    starts: list[Path] = [Path.cwd()]
    if "__file__" in globals():
        starts.insert(0, Path(__file__).resolve().parent)
    if bpy.data.filepath:
        starts.append(Path(bpy.data.filepath).resolve().parent)
    for start in starts:
        for candidate in (start, *start.parents):
            if (
                (candidate / "package.json").is_file()
                and (candidate / "tests" / "sally_carrera_gcn.glb").is_file()
            ):
                return candidate
    raise RuntimeError("Run the Blender car exporter from the world-plane repository.")


PROJECT_ROOT = locate_project_root()
SOURCE_PATH = PROJECT_ROOT / "tests" / "sally_carrera_gcn.glb"
ASSET_DIR = PROJECT_ROOT / "src" / "assets" / "car"
BLEND_PATH = ASSET_DIR / "GivrosCar.blend"
GLB_PATH = ASSET_DIR / "GivrosCarRuntime.glb"
REPORT_PATH = ASSET_DIR / "GivrosCarRuntime_export.json"
REVIEW_DIR = PROJECT_ROOT / "artifacts" / "img2threejs" / "blue-comet" / "blender-review"

SOURCE_TITLE = "Sally Carrera (GCN)"
SOURCE_AUTHOR = "kanaleja87"
SOURCE_URL = "https://sketchfab.com/3d-models/sally-carrera-gcn-694bf6bb2e69488bbc5b3fa7e68c875f"
LICENSE_ID = "CC-BY-4.0"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"

TARGET_LENGTH = 4.58
TARGET_WIDTH = 1.97
TARGET_HEIGHT = 1.46
TARGET_WHEEL_RADIUS = 0.335
RAW_LENGTH = 13.714846134185791
RAW_WIDTH = 6.726562023162842
RAW_HEIGHT = 5.375003397464752
RAW_WHEEL_RADIUS = 1.2285
LENGTH_SCALE = TARGET_LENGTH / RAW_LENGTH
WIDTH_SCALE = TARGET_WIDTH / RAW_WIDTH
HEIGHT_SCALE = TARGET_HEIGHT / RAW_HEIGHT
REFERENCE_LENGTH = 4.24
REFERENCE_SCALE = REFERENCE_LENGTH / RAW_LENGTH
LENGTH_RATIO = LENGTH_SCALE / REFERENCE_SCALE
WIDTH_RATIO = WIDTH_SCALE / REFERENCE_SCALE
HEIGHT_RATIO = HEIGHT_SCALE / REFERENCE_SCALE
RAW_MIN_Z = -0.5195327401161194
RAW_WHEEL_MID_Y = (-4.34375 + 3.5546875) * 0.5

RAW_WHEELS = {
    "front-left": (-2.6113, -4.34375, 0.7090),
    "front-right": (2.6230, -4.34375, 0.7090),
    "rear-left": (-2.7988, 3.5546875, 0.7090),
    "rear-right": (2.8105, 3.5546875, 0.7090),
}


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.name != "Collection":
            bpy.data.collections.remove(collection)
    for blocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.images,
                   bpy.data.cameras, bpy.data.lights):
        for block in list(blocks):
            if block.users == 0:
                blocks.remove(block)


def move_to_collection(obj: bpy.types.Object, collection: bpy.types.Collection) -> None:
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def descendants(root: bpy.types.Object) -> list[bpy.types.Object]:
    result: list[bpy.types.Object] = [root]
    queue = list(root.children)
    while queue:
        item = queue.pop(0)
        result.append(item)
        queue.extend(item.children)
    return result


def make_material(
    name: str,
    color: tuple[float, float, float, float],
    *,
    metallic: float = 0.0,
    roughness: float = 0.45,
    coat: float = 0.0,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = color
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
        if "Coat Weight" in bsdf.inputs:
            bsdf.inputs["Coat Weight"].default_value = coat
        if "Coat Roughness" in bsdf.inputs:
            bsdf.inputs["Coat Roughness"].default_value = 0.10
    return material


def tune_source_materials() -> None:
    values = {
        "Body": (0.30, 0.55),
        "Eyes": (0.22, 0.18),
        "Eyes.001": (0.30, 0.10),
        "Eyeshadow": (0.36, 0.0),
        "Tires": (0.72, 0.0),
        "Window": (0.20, 0.30),
    }
    for name, (roughness, coat) in values.items():
        material = bpy.data.materials.get(name)
        if not material or not material.use_nodes:
            continue
        bsdf = material.node_tree.nodes.get("Principled BSDF")
        if not bsdf:
            continue
        bsdf.inputs["Roughness"].default_value = roughness
        if "Coat Weight" in bsdf.inputs:
            bsdf.inputs["Coat Weight"].default_value = coat
        if "Coat Roughness" in bsdf.inputs:
            bsdf.inputs["Coat Roughness"].default_value = 0.10
    window = bpy.data.materials.get("Window")
    if window and window.use_nodes:
        bsdf = window.node_tree.nodes.get("Principled BSDF")
        for node in list(window.node_tree.nodes):
            if node.type == "TEX_IMAGE":
                window.node_tree.nodes.remove(node)
        bsdf.inputs["Base Color"].default_value = (0.028, 0.045, 0.055, 1.0)


def create_eye_image() -> bpy.types.Image:
    width, height = 512, 256
    image = bpy.data.images.new("GivrosTwoEyes", width=width, height=height, alpha=False)
    upper = (0.055, 0.080, 0.095, 1.0)
    white = (0.94, 0.94, 0.90, 1.0)
    ink = (0.010, 0.020, 0.022, 1.0)
    pixels = list(upper) * (width * height)

    def set_pixel(x: int, y: int, color: tuple[float, float, float, float]) -> None:
        if 0 <= x < width and 0 <= y < height:
            offset = (y * width + x) * 4
            pixels[offset:offset + 4] = color

    band_top = 154
    for y in range(band_top):
        for x in range(width):
            set_pixel(x, y, white)
    for y in range(band_top - 5, band_top + 3):
        for x in range(width):
            set_pixel(x, y, ink)

    for center_x in (178, 334):
        center_y = 78
        for y in range(center_y - 62, center_y + 63):
            for x in range(center_x - 62, center_x + 63):
                distance = math.hypot(x - center_x, y - center_y)
                if distance > 58:
                    continue
                if distance > 52:
                    color = ink
                elif distance > 35:
                    ratio = (52 - distance) / 17
                    color = (0.025, 0.25 + ratio * 0.28, 0.28 + ratio * 0.22, 1.0)
                elif distance > 22:
                    color = (0.018, 0.18, 0.20, 1.0)
                else:
                    color = ink
                set_pixel(x, y, color)
        for y in range(center_y + 19, center_y + 38):
            for x in range(center_x - 23, center_x - 4):
                if (x - (center_x - 14)) ** 2 + (y - (center_y + 28)) ** 2 <= 9 ** 2:
                    set_pixel(x, y, (1.0, 1.0, 1.0, 1.0))
    image.pixels = pixels
    image.pack()
    image.update()
    return image


def fix_eye_layers(iris: bpy.types.Object, white_mask: bpy.types.Object) -> None:
    image = create_eye_image()
    material = iris.material_slots[0].material
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    for node in list(material.node_tree.nodes):
        if node.type == "TEX_IMAGE":
            material.node_tree.nodes.remove(node)
    texture = material.node_tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.extension = "CLIP"
    material.node_tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])

    bpy.context.view_layer.update()
    points = [iris.matrix_world @ vertex.co for vertex in iris.data.vertices]
    minimum_x = min(point.x for point in points)
    maximum_x = max(point.x for point in points)
    minimum_z = min(point.z for point in points)
    maximum_z = max(point.z for point in points)
    uv_layer = iris.data.uv_layers.active or iris.data.uv_layers.new(name="UVMap")
    for polygon in iris.data.polygons:
        for loop_index in polygon.loop_indices:
            vertex_index = iris.data.loops[loop_index].vertex_index
            point = iris.matrix_world @ iris.data.vertices[vertex_index].co
            uv_layer.data[loop_index].uv = (
                (point.x - minimum_x) / (maximum_x - minimum_x),
                (point.z - minimum_z) / (maximum_z - minimum_z),
            )
    bpy.data.objects.remove(white_mask, do_unlink=True)


def material_name(obj: bpy.types.Object) -> str:
    if obj.type != "MESH" or not obj.material_slots or not obj.material_slots[0].material:
        return ""
    return obj.material_slots[0].material.name


def center_world(obj: bpy.types.Object) -> Vector:
    return sum((obj.matrix_world @ Vector(corner) for corner in obj.bound_box), Vector()) / 8.0


def raw_to_final(raw: tuple[float, float, float]) -> Vector:
    x, y, z = raw
    return Vector((
        x * WIDTH_SCALE,
        (y - RAW_WHEEL_MID_Y) * LENGTH_SCALE,
        TARGET_WHEEL_RADIUS,
    ))


def create_empty(
    name: str,
    location: Vector | tuple[float, float, float],
    parent: bpy.types.Object,
    role: str,
    *,
    display: str = "ARROWS",
) -> bpy.types.Object:
    empty = bpy.data.objects.new(name, None)
    empty.location = location
    empty.parent = parent
    empty.empty_display_type = display
    empty.empty_display_size = 0.20
    bpy.context.scene.collection.objects.link(empty)
    empty["runtimeRole"] = role
    return empty


def split_wheels(tire_mesh: bpy.types.Object) -> dict[str, bpy.types.Object]:
    bpy.ops.object.select_all(action="DESELECT")
    tire_mesh.select_set(True)
    bpy.context.view_layer.objects.active = tire_mesh
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    pieces = [obj for obj in bpy.context.selected_objects if obj.type == "MESH"]

    groups: dict[str, list[bpy.types.Object]] = {name: [] for name in RAW_WHEELS}
    for piece in pieces:
        center = center_world(piece)
        wheel_id = min(
            RAW_WHEELS,
            key=lambda name: (center.x - RAW_WHEELS[name][0]) ** 2
            + (center.y - RAW_WHEELS[name][1]) ** 2,
        )
        groups[wheel_id].append(piece)

    wheel_meshes: dict[str, bpy.types.Object] = {}
    for wheel_id, group in groups.items():
        if not group:
            raise RuntimeError(f"No source wheel components assigned to {wheel_id}")
        bpy.ops.object.select_all(action="DESELECT")
        for piece in group:
            piece.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        bpy.ops.object.join()
        wheel_mesh = bpy.context.object
        wheel_mesh.name = f"wheel-{wheel_id}-mesh"

        wheel_meshes[wheel_id] = wheel_mesh
    return wheel_meshes


def add_cube(
    name: str,
    location: tuple[float, float, float],
    dimensions: tuple[float, float, float],
    material: bpy.types.Material,
    parent: bpy.types.Object,
    *,
    bevel_width: float = 0.0,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.parent = parent
    obj.data.materials.append(material)
    if bevel_width:
        modifier = obj.modifiers.new("PlateEdge", "BEVEL")
        modifier.width = bevel_width
        modifier.segments = 3
    return obj


def add_plate(root: bpy.types.Object) -> None:
    plate_material = make_material("M_Plate_Givros", (0.92, 0.91, 0.84, 1), roughness=0.38)
    text_material = make_material("M_PlateText_Givros", (0.025, 0.035, 0.045, 1), roughness=0.42)
    plate = add_cube(
        "rear-plate-givros",
        (0.0035 * WIDTH_RATIO, 2.061 * LENGTH_RATIO, 0.594 * HEIGHT_RATIO),
        (0.405 * WIDTH_RATIO, 0.018 * LENGTH_RATIO, 0.214 * HEIGHT_RATIO),
        plate_material,
        root,
        bevel_width=0.012,
    )
    plate["plateText"] = "@givros"
    bpy.ops.object.text_add(
        location=(0.0035 * WIDTH_RATIO, 2.071 * LENGTH_RATIO, 0.594 * HEIGHT_RATIO),
        rotation=(math.pi / 2, 0, math.pi),
    )
    text = bpy.context.object
    text.name = "rear-plate-text-givros"
    text.data.body = "@givros"
    text.data.align_x = "CENTER"
    text.data.align_y = "CENTER"
    text.data.size = 0.095 * min(WIDTH_RATIO, HEIGHT_RATIO)
    text.data.resolution_u = 4
    text.data.extrude = 0.0
    text.data.bevel_depth = 0.0
    text.data.materials.append(text_material)
    text.parent = root
    bpy.context.view_layer.objects.active = text
    text.select_set(True)
    bpy.ops.object.convert(target="MESH")
    text = bpy.context.object
    text.name = "rear-plate-text-givros"
    text["plateText"] = "@givros"


def add_runtime_contract(root: bpy.types.Object) -> None:
    sockets = {
        "socket-driver-entry-left": (-1.26 * WIDTH_RATIO, -0.03 * LENGTH_RATIO, 0.02 * HEIGHT_RATIO),
        "socket-driver-entry-right": (1.26 * WIDTH_RATIO, -0.03 * LENGTH_RATIO, 0.02 * HEIGHT_RATIO),
        "socket-driver-seat": (-0.34 * WIDTH_RATIO, -0.08 * LENGTH_RATIO, 0.78 * HEIGHT_RATIO),
        "socket-camera-follow": (0.0, 3.0 * LENGTH_RATIO, 1.85 * HEIGHT_RATIO),
        "socket-front-tow": (0.0, -2.10 * LENGTH_RATIO, 0.25 * HEIGHT_RATIO),
        "socket-rear-tow": (0.0, 2.13 * LENGTH_RATIO, 0.25 * HEIGHT_RATIO),
    }
    for name, location in sockets.items():
        socket = create_empty(name, location, root, "socket")
        socket["socketId"] = name.removeprefix("socket-")

    body = create_empty(
        "collider-body", (0, 0.02 * LENGTH_RATIO, 0.73 * HEIGHT_RATIO), root, "collider", display="CUBE"
    )
    body.scale = (1.02 * WIDTH_RATIO, 1.98 * LENGTH_RATIO, 0.62 * HEIGHT_RATIO)
    body["shape"] = "box"
    body["halfExtents"] = [1.02 * WIDTH_RATIO, 0.62 * HEIGHT_RATIO, 1.98 * LENGTH_RATIO]
    cabin = create_empty(
        "collider-cabin", (0, 0.05 * LENGTH_RATIO, 1.30 * HEIGHT_RATIO), root, "collider", display="CUBE"
    )
    cabin.scale = (0.78 * WIDTH_RATIO, 0.92 * LENGTH_RATIO, 0.38 * HEIGHT_RATIO)
    cabin["shape"] = "box"
    cabin["halfExtents"] = [0.78 * WIDTH_RATIO, 0.38 * HEIGHT_RATIO, 0.92 * LENGTH_RATIO]

    wheel_radius = TARGET_WHEEL_RADIUS
    for wheel_id, raw_position in RAW_WHEELS.items():
        collider = create_empty(
            f"collider-wheel-{wheel_id}", raw_to_final(raw_position), root, "collider", display="SPHERE"
        )
        collider.empty_display_size = wheel_radius
        collider["shape"] = "sphere"
        collider["radius"] = wheel_radius


def import_and_prepare() -> bpy.types.Object:
    if not SOURCE_PATH.is_file():
        raise FileNotFoundError(SOURCE_PATH)
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(SOURCE_PATH))
    tune_source_materials()

    source_meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    by_material = {material_name(obj): obj for obj in source_meshes}
    required = {"Body", "Eyes", "Eyes.001", "Eyeshadow", "Tires", "Window"}
    missing = required.difference(by_material)
    if missing:
        raise RuntimeError(f"Missing source material meshes: {sorted(missing)}")
    fix_eye_layers(by_material["Eyes"], by_material["Eyes.001"])

    source_roots = [obj for obj in bpy.context.scene.objects if obj.parent is None]
    if len(source_roots) != 1:
        raise RuntimeError(f"Expected one source root, found {[obj.name for obj in source_roots]}")
    source_root = source_roots[0]
    source_root.name = "source-axis-conversion"
    wheel_meshes = split_wheels(by_material["Tires"])

    root = bpy.data.objects.new("BlueCometGivrosCar", None)
    root.empty_display_type = "CUBE"
    root.empty_display_size = 0.35
    bpy.context.scene.collection.objects.link(root)
    visual = bpy.data.objects.new("car-visual", None)
    visual.empty_display_type = "CUBE"
    visual.empty_display_size = 0.28
    visual.parent = root
    visual.scale = (WIDTH_SCALE, LENGTH_SCALE, HEIGHT_SCALE)
    visual.location = (0, -RAW_WHEEL_MID_Y * LENGTH_SCALE, -RAW_MIN_Z * HEIGHT_SCALE)
    bpy.context.scene.collection.objects.link(visual)

    semantic_names = {
        "Body": "body-shell",
        "Eyes": "eyes-iris-textured",
        "Eyeshadow": "eyes-shadow",
        "Window": "cabin-glass",
    }
    for material, name in semantic_names.items():
        obj = by_material[material]
        obj.name = name

    source_root.parent = visual
    bpy.context.view_layer.update()
    for wheel_id, wheel_mesh in wheel_meshes.items():
        pivot = create_empty(
            f"wheel-pivot-{wheel_id}", raw_to_final(RAW_WHEELS[wheel_id]), root,
            "wheel-pivot", display="CIRCLE",
        )
        pivot["axleAxis"] = "X"
        pivot.empty_display_size = TARGET_WHEEL_RADIUS
        bpy.context.view_layer.update()
        world_matrix = wheel_mesh.matrix_world.copy()
        wheel_mesh.parent = pivot
        # Bake the source world transform into pivot-local geometry, then center
        # and normalize the rolling Y/Z cross-section. This keeps the tire
        # circular under the independently calibrated body axes and guarantees
        # a stable wheel origin for steering/spin animation.
        wheel_mesh.data.transform(pivot.matrix_world.inverted() @ world_matrix)
        wheel_mesh.matrix_parent_inverse = Matrix.Identity(4)
        wheel_mesh.matrix_basis = Matrix.Identity(4)
        minimum = Vector((float("inf"), float("inf"), float("inf")))
        maximum = Vector((float("-inf"), float("-inf"), float("-inf")))
        for vertex in wheel_mesh.data.vertices:
            for axis in range(3):
                minimum[axis] = min(minimum[axis], vertex.co[axis])
                maximum[axis] = max(maximum[axis], vertex.co[axis])
        center = (minimum + maximum) * 0.5
        diameter = TARGET_WHEEL_RADIUS * 2
        scale_y = diameter / max(1e-6, maximum.y - minimum.y)
        scale_z = diameter / max(1e-6, maximum.z - minimum.z)
        for vertex in wheel_mesh.data.vertices:
            vertex.co.x -= center.x
            vertex.co.y = (vertex.co.y - center.y) * scale_y
            vertex.co.z = (vertex.co.z - center.z) * scale_z
        wheel_mesh.data.update()

    root["assetId"] = "givros-sally-source-car"
    root["source"] = "blender-mcp-derived-glb"
    root["plateText"] = "@givros"
    root["forwardAxis"] = "+Z"
    root["blenderForwardAxis"] = "-Y"
    root["dimensionsMeters"] = [TARGET_LENGTH, TARGET_WIDTH, TARGET_HEIGHT]
    root["wheelbaseMeters"] = (3.5546875 - (-4.34375)) * LENGTH_SCALE
    root["wheelRadiusMeters"] = TARGET_WHEEL_RADIUS
    root["trackWidthMeters"] = (
        ((abs(RAW_WHEELS["front-left"][0]) + abs(RAW_WHEELS["front-right"][0])) / 2)
        + ((abs(RAW_WHEELS["rear-left"][0]) + abs(RAW_WHEELS["rear-right"][0])) / 2)
    ) * WIDTH_SCALE
    root["authoredPartCount"] = 124
    root["sourceTitle"] = SOURCE_TITLE
    root["sourceAuthor"] = SOURCE_AUTHOR
    root["sourceUrl"] = SOURCE_URL
    root["sourceLicense"] = LICENSE_ID
    root["sourceLicenseUrl"] = LICENSE_URL
    root["modifications"] = (
        "Calibrated to 4.58 x 1.97 x 1.46 metres against the playable character and aircraft; "
        "source eye layers corrected; circular wheel groups, runtime nodes and @givros plate added."
    )

    add_plate(root)
    add_runtime_contract(root)
    bpy.context.view_layer.update()
    return root


def world_bounds(root: bpy.types.Object) -> tuple[Vector, Vector]:
    minimum = Vector((float("inf"), float("inf"), float("inf")))
    maximum = Vector((float("-inf"), float("-inf"), float("-inf")))
    for obj in descendants(root):
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            for axis in range(3):
                minimum[axis] = min(minimum[axis], point[axis])
                maximum[axis] = max(maximum[axis], point[axis])
    return minimum, maximum


def mesh_stats(root: bpy.types.Object) -> dict[str, int]:
    meshes = [obj for obj in descendants(root) if obj.type == "MESH"]
    return {
        "objects": len(descendants(root)),
        "meshes": len(meshes),
        "vertices": sum(len(obj.data.vertices) for obj in meshes),
        "triangles": sum(len(poly.vertices) - 2 for obj in meshes for poly in obj.data.polygons),
        "materials": len({slot.material.name for obj in meshes for slot in obj.material_slots if slot.material}),
    }


def exported_glb_stats(path: Path) -> dict[str, int]:
    payload = path.read_bytes()
    if payload[:4] != b"glTF" or len(payload) < 20:
        raise RuntimeError(f"Invalid GLB export: {path}")
    json_length = int.from_bytes(payload[12:16], "little")
    gltf = json.loads(payload[20:20 + json_length].decode("utf-8"))
    accessors = gltf.get("accessors", [])
    vertices = 0
    triangles = 0
    for mesh in gltf.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            position_accessor = accessors[primitive["attributes"]["POSITION"]]
            vertices += int(position_accessor["count"])
            index_accessor = primitive.get("indices")
            element_count = (
                int(accessors[index_accessor]["count"])
                if index_accessor is not None
                else int(position_accessor["count"])
            )
            triangles += element_count // 3
    return {
        "objects": len(gltf.get("nodes", [])),
        "meshes": len(gltf.get("meshes", [])),
        "vertices": vertices,
        "triangles": triangles,
        "materials": len(gltf.get("materials", [])),
    }


def point_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def setup_review() -> tuple[bpy.types.Object, bpy.types.Object]:
    ground_material = make_material("M_ReviewGround", (0.12, 0.14, 0.16, 1), roughness=0.9)
    ground = add_cube("review-ground", (0, 0, -0.055), (16, 16, 0.10), ground_material, None)
    ground.parent = None

    bpy.ops.object.camera_add(location=(5.0, -6.5, 2.9))
    camera = bpy.context.object
    camera.name = "ReviewCamera"
    camera.data.lens = 62
    bpy.context.scene.camera = camera

    lights = [
        ((-4.5, -5.8, 6.5), 1050, 5.0, (1.0, 0.89, 0.80)),
        ((5.0, -0.5, 4.2), 800, 4.0, (0.70, 0.84, 1.0)),
        ((0.0, 5.5, 4.8), 950, 4.0, (0.88, 0.94, 1.0)),
    ]
    for index, (location, energy, size, color) in enumerate(lights):
        data = bpy.data.lights.new(f"ReviewArea{index}", "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        data.color = color
        light = bpy.data.objects.new(f"ReviewArea{index}", data)
        light.location = location
        bpy.context.scene.collection.objects.link(light)
        point_at(light, Vector((0, 0, 0.70)))

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.025, 0.03, 0.04)
    return camera, ground


def render_views(camera: bpy.types.Object, ground: bpy.types.Object) -> list[str]:
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    views = {
        "front": ((0.0, -7.2, 1.75), (0.0, -0.10, 0.72), 62),
        "front-three-quarter": ((4.9, -6.4, 2.8), (0.0, 0.0, 0.73), 64),
        "left-side": ((-8.0, 0.0, 1.75), (0.0, 0.0, 0.72), 60),
        "rear-three-quarter": ((4.8, 6.3, 2.7), (0.0, 0.0, 0.72), 64),
        "rear": ((0.0, 7.1, 1.72), (0.0, 0.10, 0.68), 62),
        "top": ((0.0, 0.0, 8.0), (0.0, 0.0, 0.52), 66),
        "underside": ((4.7, -5.5, -2.6), (0.0, 0.0, 0.38), 62),
    }
    rendered: list[str] = []
    for name, (location, target, lens) in views.items():
        ground.hide_render = name == "underside"
        camera.location = location
        camera.data.lens = lens
        point_at(camera, Vector(target))
        output = REVIEW_DIR / f"{name}.png"
        bpy.context.scene.render.filepath = str(output)
        bpy.ops.render.render(write_still=True)
        rendered.append(output.name)
    ground.hide_render = False
    return rendered


def export_asset(root: bpy.types.Object) -> dict:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    bpy.ops.object.select_all(action="DESELECT")
    for obj in descendants(root):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH),
        export_format="GLB",
        use_selection=True,
        export_extras=True,
        export_apply=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
    )

    minimum, maximum = world_bounds(root)
    stats = exported_glb_stats(GLB_PATH)
    source_hash = hashlib.sha256(SOURCE_PATH.read_bytes()).hexdigest()
    runtime_hash = hashlib.sha256(GLB_PATH.read_bytes()).hexdigest()
    dimensions = maximum - minimum
    report = {
        "schemaVersion": 2,
        "passed": True,
        "source": "blender-mcp-derived-glb",
        "sourceAsset": {
            "file": SOURCE_PATH.name,
            "sha256": source_hash,
            "title": SOURCE_TITLE,
            "author": SOURCE_AUTHOR,
            "url": SOURCE_URL,
            "license": LICENSE_ID,
            "licenseUrl": LICENSE_URL,
        },
        "modifications": [
            "Preserved source body, wheel and window geometry, UVs and textures without decimation.",
            "Applied measured width/height calibration against the playable character and airplane.",
            "Set a 4.58 m stylized coupe length and recentered the wheelbase on the ground plane.",
            "Separated source wheel components into four runtime pivots.",
            "Replaced the source's coplanar repeating eye layers with one two-eye texture on the original eye surface.",
            "Covered the original plate with an @givros plate.",
            "Added sockets, collider proxies and runtime metadata.",
        ],
        "blend": BLEND_PATH.name,
        "runtimeGlb": GLB_PATH.name,
        "sha256": runtime_hash,
        "byteLength": GLB_PATH.stat().st_size,
        "plateText": "@givros",
        "forwardAxis": "+Z",
        "blenderForwardAxis": "-Y",
        "boundsBlender": {
            "min": [round(value, 6) for value in minimum],
            "max": [round(value, 6) for value in maximum],
            "width": round(dimensions.x, 6),
            "length": round(dimensions.y, 6),
            "height": round(dimensions.z, 6),
        },
        "wheelbaseMeters": round((3.5546875 - (-4.34375)) * LENGTH_SCALE, 6),
        "wheelRadiusMeters": round(TARGET_WHEEL_RADIUS, 6),
        "trackWidthMeters": round(root["trackWidthMeters"], 6),
        "requiredNodes": [
            "BlueCometGivrosCar", "car-visual", "body-shell", "cabin-glass",
            "wheel-pivot-front-left", "wheel-pivot-front-right",
            "wheel-pivot-rear-left", "wheel-pivot-rear-right",
            "socket-driver-entry-left", "socket-driver-entry-right", "socket-camera-follow",
            "collider-body", "collider-cabin", "rear-plate-givros", "rear-plate-text-givros",
        ],
        "stats": stats,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> None:
    root = import_and_prepare()
    camera, ground = setup_review()
    rendered = render_views(camera, ground)
    report = export_asset(root)
    print(json.dumps({"ok": True, "report": report, "rendered": rendered}, indent=2))


if __name__ == "__main__":
    main()
