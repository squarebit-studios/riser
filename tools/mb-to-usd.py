# ==========================================================================
# Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
#
# Convert a Maya binary scene to USD, for use as a Riser test character.
#
# Run with mayapy, not python - it needs Maya's own interpreter:
#
#   "C:/Program Files/Autodesk/Maya2026/bin/mayapy.exe" tools/mb-to-usd.py \
#       --input  path/to/character.mb \
#       --output public/assets/character.usdc
#
# .mb is a closed binary format. Nothing outside Maya reads it reliably, so
# this is the conversion, not a convenience wrapper around one - which is why
# it lives here rather than in the worker: the worker has usd-core but no Maya.
# ==========================================================================

import argparse
import os
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Source .mb or .ma file")
    parser.add_argument("--output", required=True, help="Destination .usd/.usdc/.usda")
    parser.add_argument(
        "--no-materials",
        action="store_true",
        help="Skip materials. Riser shades characters itself, and a Maya "
        "material graph converts to something much larger and rarely better.",
    )
    args = parser.parse_args()

    source = os.path.abspath(args.input)
    target = os.path.abspath(args.output)
    if not os.path.isfile(source):
        print("No such file: %s" % source, file=sys.stderr)
        return 2
    os.makedirs(os.path.dirname(target), exist_ok=True)

    import maya.standalone

    maya.standalone.initialize(name="python")

    import maya.cmds as cmds

    try:
        cmds.loadPlugin("mayaUsdPlugin", quiet=True)
    except Exception as err:  # noqa: BLE001 - report and stop, do not guess
        print("Could not load mayaUsdPlugin: %s" % err, file=sys.stderr)
        return 3

    # ignoreVersion, because a scene saved in a newer Maya otherwise refuses to
    # open at all rather than opening with a warning.
    cmds.file(source, open=True, force=True, ignoreVersion=True, prompt=False)

    # Report what came in. A conversion that silently produces an empty stage
    # is the failure mode worth catching, and the mesh count catches it.
    meshes = cmds.ls(type="mesh", noIntermediate=True) or []
    joints = cmds.ls(type="joint") or []
    print("Opened %s" % source)
    print("  meshes: %d" % len(meshes))
    print("  joints: %d" % len(joints))
    if not meshes:
        print("Nothing to export - no meshes in the scene.", file=sys.stderr)
        return 4

    options = {
        "file": target,
        "defaultUSDFormat": "usdc" if target.endswith(".usdc") else "usda",
        "exportUVs": True,
        "exportDisplayColor": True,
        "exportColorSets": True,
        # Skeletons and skin weights are the point: Riser reads a rig to place
        # guides exactly, so an export that drops them loses the best tier.
        "exportSkels": "auto",
        "exportSkin": "auto",
        "exportBlendShapes": True,
        "mergeTransformAndShape": True,
        "stripNamespaces": True,
        "shadingMode": "none" if args.no_materials else "useRegistry",
    }
    if joints:
        print("  exporting with UsdSkel")

    cmds.mayaUSDExport(**options)

    size = os.path.getsize(target) if os.path.isfile(target) else 0
    print("Wrote %s (%.1f MB)" % (target, size / 1e6))
    return 0 if size > 0 else 5


if __name__ == "__main__":
    sys.exit(main())
