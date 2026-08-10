"""Export the canonical CharacterBase as one uncompressed animated runtime GLB.

Run this file from Blender in background mode after opening the canonical blend::

    blender --background --factory-startup --disable-autoexec CharacterBase.blend \
      --python scripts/character/export_runtime_glb.py -- \
      --working-blend CharacterBase.blend \
      --output CharacterRuntime.glb \
      --report CharacterRuntime_export.json

The source blend is never saved. The export is committed atomically only after
the generated GLB and the unchanged source file have both passed validation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import struct
import sys

import bpy


EXPECTED_ACTIONS = {
    "Idle": (1, 251),
    "Walk": (1, 32),
    "Run": (1, 20),
    "Jump": (1, 58),
}
EXPECTED_FPS = 30.0
EXPECTED_BONE_COUNT = 49
GLB_JSON_CHUNK = 0x4E4F534A


def parse_args() -> argparse.Namespace:
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--working-blend", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    return parser.parse_args(arguments)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def blend_files(directory: Path) -> list[str]:
    return sorted(
        str(path.resolve())
        for path in directory.glob("*.blend*")
        if path.is_file()
    )


def require_single_canonical_blend(working_blend: Path) -> list[str]:
    files = blend_files(working_blend.parent)
    expected = [str(working_blend)]
    if files != expected:
        raise RuntimeError(
            "The character directory must contain only the canonical blend: "
            f"expected {expected}, found {files}"
        )
    return files


def validate_source_scene() -> tuple[bpy.types.Object, list[bpy.types.Object], dict]:
    character = bpy.data.objects.get("CharacterBase")
    rig = bpy.data.objects.get("CharacterRig")
    if character is None or character.type != "MESH":
        raise RuntimeError("CharacterBase mesh is missing")
    if rig is None or rig.type != "ARMATURE":
        raise RuntimeError("CharacterRig armature is missing")
    if len(rig.data.bones) != EXPECTED_BONE_COUNT:
        raise RuntimeError(
            f"CharacterRig must contain {EXPECTED_BONE_COUNT} bones, "
            f"found {len(rig.data.bones)}"
        )

    all_action_names = {action.name for action in bpy.data.actions}
    if all_action_names != set(EXPECTED_ACTIONS):
        raise RuntimeError(
            f"Expected only {sorted(EXPECTED_ACTIONS)} actions, "
            f"found {sorted(all_action_names)}"
        )

    action_report = {}
    for name, expected_range in EXPECTED_ACTIONS.items():
        action = bpy.data.actions.get(name)
        if action is None or action.get("codex_basic_animation") is not True:
            raise RuntimeError(f"Managed action {name!r} is missing or untrusted")
        actual_range = tuple(int(round(value)) for value in action.frame_range)
        if actual_range != expected_range:
            raise RuntimeError(
                f"Action {name!r} has range {actual_range}, expected {expected_range}"
            )
        object_slots = [
            slot.identifier
            for slot in action.slots
            if slot.target_id_type == "OBJECT"
        ]
        if object_slots != ["OBCharacterRig"]:
            raise RuntimeError(
                f"Action {name!r} must target only CharacterRig, found {object_slots}"
            )
        action_report[name] = {
            "frame_range": list(actual_range),
            "expected_duration_seconds": (
                expected_range[1] - expected_range[0]
            ) / EXPECTED_FPS,
            "slot": object_slots[0],
        }

    scene = bpy.context.scene
    fps = scene.render.fps / scene.render.fps_base
    if not math.isclose(fps, EXPECTED_FPS, rel_tol=0.0, abs_tol=1e-9):
        raise RuntimeError(f"Expected {EXPECTED_FPS:g} FPS, found {fps}")

    garments = sorted(
        (
            obj
            for obj in bpy.data.objects
            if obj.type == "MESH" and obj.get("codex_clothing") is True
        ),
        key=lambda obj: obj.name.casefold(),
    )
    meshes = [character, *garments]
    for mesh in meshes:
        armatures = {
            modifier.object
            for modifier in mesh.modifiers
            if modifier.type == "ARMATURE" and modifier.object is not None
        }
        if rig not in armatures:
            raise RuntimeError(f"{mesh.name} is not skinned to CharacterRig")

    return rig, meshes, {
        "fps": fps,
        "bone_count": len(rig.data.bones),
        "bone_names": sorted(bone.name for bone in rig.data.bones),
        "mesh_objects": [mesh.name for mesh in meshes],
        "actions": action_report,
    }


def prepare_export_selection(
    rig: bpy.types.Object,
    meshes: list[bpy.types.Object],
) -> None:
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="DESELECT")
    for obj in [rig, *meshes]:
        obj.hide_viewport = False
        obj.hide_render = False
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig

    animation_data = rig.animation_data_create()
    animation_data.action = None
    for track in animation_data.nla_tracks:
        track.mute = True
    rig.data.pose_position = "POSE"
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()


def needs_tangent_export(meshes: list[bpy.types.Object]) -> bool:
    materials = {
        material
        for mesh in meshes
        for material in mesh.data.materials
        if material is not None
    }
    return any(
        node.type == "NORMAL_MAP" and any(output.is_linked for output in node.outputs)
        for material in materials
        if material.node_tree is not None
        for node in material.node_tree.nodes
    )


def export_glb(path: Path, export_tangents: bool) -> dict:
    options = {
        "filepath": str(path),
        "check_existing": False,
        "export_format": "GLB",
        "use_selection": True,
        "export_yup": True,
        "export_apply": True,
        "export_extras": True,
        "export_cameras": False,
        "export_lights": False,
        "export_materials": "EXPORT",
        "export_texcoords": True,
        "export_normals": True,
        "export_tangents": export_tangents,
        "export_vertex_color": "MATERIAL",
        "export_animations": True,
        "export_animation_mode": "ACTIONS",
        "export_action_filter": False,
        "export_merge_animation": "ACTION",
        "export_anim_single_armature": True,
        "export_anim_scene_split_object": False,
        "export_force_sampling": True,
        "export_frame_step": 1,
        "export_anim_slide_to_zero": True,
        "export_optimize_animation_size": False,
        "export_bake_animation": False,
        "export_nla_strips": False,
        "export_skins": True,
        "export_all_influences": False,
        "export_influence_nb": 4,
        "export_rest_position_armature": True,
        "export_armature_object_remove": False,
        "export_def_bones": False,
        "export_leaf_bone": False,
        "export_reset_pose_bones": True,
        "export_morph": False,
        "export_morph_animation": False,
        "export_draco_mesh_compression_enable": False,
        "export_use_gltfpack": False,
    }
    result = bpy.ops.export_scene.gltf(**options)
    if "FINISHED" not in result or not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError(f"Runtime GLB export failed: {result}")
    return options


def parse_glb_json(path: Path) -> dict:
    payload = path.read_bytes()
    if len(payload) < 20:
        raise RuntimeError("Runtime GLB is truncated")
    magic, version, declared_length = struct.unpack_from("<4sII", payload, 0)
    if magic != b"glTF" or version != 2 or declared_length != len(payload):
        raise RuntimeError(
            "Invalid GLB header: "
            f"magic={magic!r}, version={version}, "
            f"declared={declared_length}, actual={len(payload)}"
        )
    offset = 12
    document = None
    while offset < len(payload):
        if offset + 8 > len(payload):
            raise RuntimeError("Runtime GLB has a truncated chunk header")
        chunk_length, chunk_type = struct.unpack_from("<II", payload, offset)
        offset += 8
        end = offset + chunk_length
        if end > len(payload):
            raise RuntimeError("Runtime GLB has a truncated chunk payload")
        if chunk_type == GLB_JSON_CHUNK:
            if document is not None:
                raise RuntimeError("Runtime GLB contains multiple JSON chunks")
            document = json.loads(payload[offset:end].rstrip(b" \x00").decode("utf-8"))
        offset = end
    if offset != len(payload) or document is None:
        raise RuntimeError("Runtime GLB chunk table is invalid")
    return document


def accessor_time_range(document: dict, accessor_index: int) -> tuple[float, float]:
    accessor = document["accessors"][accessor_index]
    minimum = accessor.get("min")
    maximum = accessor.get("max")
    if not minimum or not maximum:
        raise RuntimeError(f"Animation time accessor {accessor_index} has no bounds")
    return float(minimum[0]), float(maximum[0])


def validate_glb(document: dict) -> dict:
    serialized = json.dumps(document, sort_keys=True, separators=(",", ":"))
    extensions_used = set(document.get("extensionsUsed", []))
    extensions_required = set(document.get("extensionsRequired", []))
    uses_draco = (
        "KHR_draco_mesh_compression" in serialized
        or "KHR_draco_mesh_compression" in extensions_used
        or "KHR_draco_mesh_compression" in extensions_required
    )
    if uses_draco:
        raise RuntimeError("CharacterRuntime.glb must not use Draco compression")

    animations = document.get("animations", [])
    animation_names = [animation.get("name") for animation in animations]
    if len(animation_names) != len(EXPECTED_ACTIONS) or set(animation_names) != set(EXPECTED_ACTIONS):
        raise RuntimeError(
            f"Runtime GLB animations are {animation_names}, "
            f"expected exactly {sorted(EXPECTED_ACTIONS)}"
        )

    animation_report = {}
    for animation in animations:
        name = animation["name"]
        samplers = animation.get("samplers", [])
        channels = animation.get("channels", [])
        if not samplers or not channels:
            raise RuntimeError(f"Animation {name!r} has no samplers or channels")
        time_ranges = [
            accessor_time_range(document, sampler["input"])
            for sampler in samplers
        ]
        start = min(value[0] for value in time_ranges)
        end = max(value[1] for value in time_ranges)
        if not math.isclose(start, 0.0, rel_tol=0.0, abs_tol=1e-6):
            raise RuntimeError(
                f"Animation {name!r} starts at {start}; runtime clips must start at zero"
            )
        duration = end - start
        expected_range = EXPECTED_ACTIONS[name]
        expected_duration = (expected_range[1] - expected_range[0]) / EXPECTED_FPS
        if not math.isclose(duration, expected_duration, rel_tol=0.0, abs_tol=1e-4):
            raise RuntimeError(
                f"Animation {name!r} duration is {duration}, "
                f"expected {expected_duration}"
            )
        invalid_paths = sorted(
            {
                channel.get("target", {}).get("path")
                for channel in channels
                if channel.get("target", {}).get("path")
                not in {"translation", "rotation", "scale"}
            },
            key=str,
        )
        if invalid_paths:
            raise RuntimeError(f"Animation {name!r} has invalid paths: {invalid_paths}")
        animation_report[name] = {
            "start_seconds": start,
            "duration_seconds": duration,
            "sampler_count": len(samplers),
            "channel_count": len(channels),
        }

    skins = document.get("skins", [])
    joint_counts = [len(skin.get("joints", [])) for skin in skins]
    if not skins or any(count != EXPECTED_BONE_COUNT for count in joint_counts):
        raise RuntimeError(
            f"Every runtime skin must contain {EXPECTED_BONE_COUNT} joints, "
            f"found {joint_counts}"
        )

    node_names = sorted(
        node["name"]
        for node in document.get("nodes", [])
        if isinstance(node.get("name"), str)
    )
    required_nodes = {"CharacterBase", "CharacterRig", "Pants", "LongSleeveShirt"}
    missing_nodes = sorted(required_nodes - set(node_names))
    if missing_nodes:
        raise RuntimeError(f"Runtime GLB is missing nodes: {missing_nodes}")

    return {
        "animations": animation_report,
        "animation_names": animation_names,
        "draco": False,
        "extensions_used": sorted(extensions_used),
        "extensions_required": sorted(extensions_required),
        "skin_count": len(skins),
        "skin_joint_counts": joint_counts,
        "mesh_count": len(document.get("meshes", [])),
        "material_count": len(document.get("materials", [])),
        "node_count": len(document.get("nodes", [])),
        "required_nodes": sorted(required_nodes),
    }


def write_json_atomic(path: Path, data: dict) -> None:
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(
        json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def main() -> int:
    args = parse_args()
    working_blend = Path(args.working_blend).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()
    loaded_blend = Path(bpy.data.filepath).resolve()
    if loaded_blend != working_blend:
        raise RuntimeError(
            f"Loaded blend does not match --working-blend: "
            f"{loaded_blend} != {working_blend}"
        )
    if output.suffix.lower() != ".glb":
        raise RuntimeError("--output must use the .glb extension")
    if len({working_blend, output, report_path}) != 3:
        raise RuntimeError("Source, runtime GLB, and report paths must be distinct")

    output.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_output = output.with_name(f".{output.stem}.tmp.glb")
    temporary_output.unlink(missing_ok=True)

    source_hash_before = sha256_file(working_blend)
    source_blends_before = require_single_canonical_blend(working_blend)
    rig, meshes, source_report = validate_source_scene()
    prepare_export_selection(rig, meshes)

    try:
        export_options = export_glb(temporary_output, needs_tangent_export(meshes))
        glb_report = validate_glb(parse_glb_json(temporary_output))
        source_hash_after_export = sha256_file(working_blend)
        if source_hash_after_export != source_hash_before:
            raise RuntimeError("Canonical blend changed during runtime export")
        source_blends_after = require_single_canonical_blend(working_blend)
        os.replace(temporary_output, output)

        report = {
            "passed": True,
            "blender_version": bpy.app.version_string,
            "source_blend": working_blend.name,
            "source_sha256_before": source_hash_before,
            "source_sha256_after": source_hash_after_export,
            "source_unchanged": True,
            "source_blends_before": [Path(path).name for path in source_blends_before],
            "source_blends_after": [Path(path).name for path in source_blends_after],
            "source_saved": False,
            "runtime_glb": output.name,
            "runtime_glb_bytes": output.stat().st_size,
            "runtime_glb_sha256": sha256_file(output),
            "source": source_report,
            "glb": glb_report,
            "export_options": {
                key: sorted(value) if isinstance(value, set) else value
                for key, value in export_options.items()
                if key != "filepath"
            },
        }
        write_json_atomic(report_path, report)

        source_hash_after_report = sha256_file(working_blend)
        if source_hash_after_report != source_hash_before:
            output.unlink(missing_ok=True)
            report_path.unlink(missing_ok=True)
            raise RuntimeError("Canonical blend changed while writing the export report")
    finally:
        temporary_output.unlink(missing_ok=True)

    print(f"CHARACTER_RUNTIME_GLB={output}")
    print(f"CHARACTER_RUNTIME_REPORT={report_path}")
    print(f"CHARACTER_RUNTIME_SHA256={sha256_file(output)}")
    print(f"CHARACTER_SOURCE_SHA256={source_hash_before}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
