# ==========================================================================
# Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
#
# Convert a Maya binary scene to USD, for use as a Riser test character.
#
# Run with mayapy, not python - it needs Maya's own interpreter:
#
#   "C:/Program Files/Autodesk/Maya2026/bin/mayapy.exe" tools/mb-to-usd.py \
#       --input  path/to/character.mb \
#       --output public/assets/character.usdc \
#       --usdz   public/assets/character.usdz
#
# .mb is a closed binary format. Nothing outside Maya reads it reliably, so
# this is the conversion, not a convenience wrapper around one - which is why
# it lives here rather than in the worker: the worker has usd-core but no Maya.
#
# --------------------------------------------------------------------------
# WHY THIS WRITES TWO FILES
#
# three.js reads textures out of a USD file only when the file is a USDZ. A
# standalone .usdc names its textures by asset path, and three's USDComposer
# resolves those names against the archive it was handed - which for a plain
# .usdc is empty. `_loadTexture` warns "Texture not found" and returns null.
#
# That single fact caused both symptoms the first materials attempt showed:
#
#   * unresolvable texture paths - the scene stores them as
#     "$PROJECT_ROOT/asset/..." and nothing expands that token at export time,
#     so even a USDZ had nothing to pack; and
#   * pure black base colour - not a colour conversion bug at all. In
#     USDComposer._applyTextureOrValue, a diffuseColor that HAS a texture
#     connection but whose texture fails to load falls through to the
#     attribute's fallback value. Maya's lambert/blinn store (0,0,0) in .color
#     when a file texture drives it, because the value is unused in Maya. So
#     the black was the fallback showing through the missing texture.
#
# So: .usdc for the geometry+rig (drop-in, no textures three can reach) and
# .usdz for the same thing with the images packed in. Both get a diffuseColor
# fallback set to the bound texture's MEAN colour rather than black, so the
# .usdc renders as plausibly-coloured Gary instead of a silhouette - and, more
# to the point, is not mistaken for unshaded by src/io/studioMaterial.ts.
# ==========================================================================

import argparse
import json
import math
import os
import re
import shutil
import sys

# Rig scaffolding that is not the character: bind planes the face rig drives,
# the eye projection spheres, the PSD readout. All parented under .../rig.
HELPER_PARENT = "|rig|"

# The Squarebit Eye look, read off the scene's squarebitEyeShader nodes and
# written back as the canonical squarebitEye:* custom attributes that the web
# widget already reads (SquarebitEye INTEROP section 2, web/src/eye-io.js).
EYE_SCALARS = (
    "ior", "limbusRadius", "limbusWidth", "limbusDarkening", "irisPlaneZ",
    "corneaRadius", "corneaApexZ", "corneaBulge", "refPupilRadius",
    "irisHeightScale", "causticStrength", "causticExponent",
    "causticShadowStrength", "irisWidth", "irisHeight", "pupilWidth",
    "pupilHeight", "pupilOffsetX", "pupilOffsetY", "pupilSquareness",
    "pupilNoiseAmount", "pupilNoiseFreq", "pupilNoiseSeed", "pupilNoiseType",
    "pupilBlend", "pupilBlendExp", "pupilBleedAmount", "pupilBleedWidth",
    "pupilBleedExponent", "pupilBleedLight", "pupilBleedSaturation",
    "limbusNoiseAmount", "limbusNoiseFreq", "limbusNoiseSeed",
    "limbusLightResponse", "scleraEmissive", "specPlaceX", "specPlaceY",
    "specPlaceSize", "specPlaceIntensity", "specPlaceSides",
    "specPlaceRoundness", "specPlaceWide", "specPlaceTall", "specPlaceRotate",
    "specPlaceCore", "specPlaceFalloff", "pupilRadius",
)
EYE_COLORS = ("pupilColor", "scleraColor", "specPlaceColor")
EYE_TEXTURES = (("iris", "irisTexturePath"), ("sclera", "scleraTexturePath"))
EYE_SPEC_ID = "squarebit-eye/2"
EYE_MODES = ("MESH_NORMAL", "VIRTUAL_CORNEA")


# --------------------------------------------------------------------------
# Texture paths
# --------------------------------------------------------------------------

def derive_project_root(source):
    """The studio project root, so $PROJECT_ROOT in a texture path resolves.

    Derived from the source path rather than the environment on purpose: `gig`
    sets this up as a substituted U: drive, and running mayapy inside that
    resolved environment crashes Maya's standalone init (rez puts its own
    OpenUSD/PySide on the path ahead of Maya's). Deriving it means the
    conversion runs in a plain shell and still finds the textures.
    """
    normalized = source.replace("\\", "/")
    marker = "/asset/"
    index = normalized.lower().rfind(marker)
    if index > 0:
        return normalized[:index]
    return os.environ.get("PROJECT_ROOT") or ""


def resolve_texture_path(raw, project_root):
    """Expand the studio's path tokens to something that exists on disk."""
    if not raw:
        return raw
    path = raw.replace("\\", "/")
    for token in ("$PROJECT_ROOT", "%PROJECT_ROOT%", "${PROJECT_ROOT}"):
        if path.startswith(token):
            path = project_root + path[len(token):]
    # `gig` substs the project root to U:. Off the studio machine it is not
    # mounted, and inside one mayapy cannot be trusted to have it either.
    if re.match(r"^[Uu]:[/\\]", path):
        path = project_root + "/" + path[3:]
    return re.sub(r"/{2,}", "/", path)


def relocate_missing(path, project_root):
    """Last resort: find a file of the same name anywhere under the look tree.

    The published scenes carry a few stale references - textures renamed after
    the shader was authored. Matching on basename recovers the ones that were
    only moved, and honestly reports the ones that are simply gone.
    """
    if not path:
        return None
    base = os.path.basename(path).lower()
    look = os.path.join(project_root, "asset", "character")
    if not os.path.isdir(look):
        return None
    for root, _dirs, files in os.walk(look):
        for name in files:
            if name.lower() == base:
                return os.path.join(root, name).replace("\\", "/")
    return None


def fix_texture_paths(cmds, project_root):
    """Rewrite every file node to an absolute path that exists. Reports both."""
    resolved, missing = 0, []
    for node in (cmds.ls(type="file") or []):
        try:
            raw = cmds.getAttr(node + ".fileTextureName")
        except Exception:  # noqa: BLE001 - a broken node is data, not a crash
            continue
        if not raw:
            continue
        path = resolve_texture_path(raw, project_root)
        if not os.path.isfile(path):
            found = relocate_missing(path, project_root)
            if found:
                print("  relocated %s -> %s" % (os.path.basename(path), found))
                path = found
            else:
                missing.append((node, raw))
                continue
        if path != raw:
            try:
                cmds.setAttr(node + ".fileTextureName", path, type="string")
                resolved += 1
            except Exception as err:  # noqa: BLE001
                print("  could not set %s: %s" % (node, err), file=sys.stderr)
    print("  texture paths resolved: %d" % resolved)
    for node, raw in missing:
        print("  MISSING texture (%s): %s" % (node, raw), file=sys.stderr)
    return missing


# --------------------------------------------------------------------------
# The eye
# --------------------------------------------------------------------------

def load_eye_plugin(cmds, plugin):
    """Load the Squarebit Eye Maya node, so its parameters can be read.

    Without it the shader survives as an unknown node - the scene still opens
    and the attribute data is preserved, but getAttr cannot reach it, so the
    look would export as whatever cached colour the last render left behind.
    """
    if not plugin:
        return False
    try:
        cmds.loadPlugin(plugin, quiet=True)
        return True
    except Exception as err:  # noqa: BLE001
        print("  eye plugin not loaded (%s): %s" % (plugin, err))
        return False


def capture_eye_looks(cmds, project_root):
    """Read every squarebitEyeShader in the scene into a canonical look dict."""
    looks = {}
    try:
        nodes = cmds.ls(type="squarebitEyeShader") or []
    except Exception:  # noqa: BLE001 - node type unknown = plugin not loaded
        nodes = []
    for node in nodes:
        look = {}
        for name in EYE_SCALARS:
            if cmds.attributeQuery(name, node=node, exists=True):
                try:
                    look[name] = float(cmds.getAttr(node + "." + name))
                except Exception:  # noqa: BLE001
                    pass
        for name in EYE_COLORS:
            if cmds.attributeQuery(name, node=node, exists=True):
                try:
                    value = cmds.getAttr(node + "." + name)[0]
                    look[name] = [float(v) for v in value]
                except Exception:  # noqa: BLE001
                    pass
        try:
            mode = int(cmds.getAttr(node + ".refractionMode"))
            look["refractionMode"] = EYE_MODES[mode] if mode < len(EYE_MODES) else EYE_MODES[0]
        except Exception:  # noqa: BLE001
            pass

        textures = {}
        for key, attr in EYE_TEXTURES:
            if cmds.attributeQuery(attr, node=node, exists=True):
                raw = cmds.getAttr(node + "." + attr)
                if raw:
                    path = resolve_texture_path(raw, project_root)
                    if not os.path.isfile(path):
                        path = relocate_missing(path, project_root) or None
                    if path:
                        textures[key] = path

        # The projector transform is the whole point of the shader: the iris is
        # projected from it, not from the mesh's UVs. Its world matrix carries
        # position, aim and (in its scale) the eye radius.
        matrix = None
        for source in (cmds.listConnections(node + ".projectorWorldMatrix",
                                            s=True, d=False) or []):
            try:
                matrix = cmds.xform(source, q=True, ws=True, m=True)
            except Exception:  # noqa: BLE001
                pass
        # Which mesh wears it. The eye node does not reach the shading engine
        # directly - it drives a standardSurface's baseColor, and that is what
        # the engine holds - so this has to walk the whole downstream graph.
        meshes = []
        downstream = cmds.listHistory(node, future=True, allFuture=True) or []
        for engine in [n for n in downstream
                       if cmds.nodeType(n) == "shadingEngine"]:
            for member in (cmds.sets(engine, q=True) or []):
                meshes.append(member.split(".")[0])
        looks[node] = {"look": look, "textures": textures,
                       "projector": matrix, "meshes": sorted(set(meshes))}
    return looks


# --------------------------------------------------------------------------
# Images
# --------------------------------------------------------------------------

def process_texture(source, out_dir, max_size):
    """Resize a texture for the web and report its mean colour.

    Maya's own MImage does the decode/resize/encode, which keeps this free of
    a Pillow dependency mayapy does not ship. Returns (filename, mean_linear).
    """
    import maya.api.OpenMaya as om
    import numpy

    image = om.MImage()
    try:
        image.readFromFile(source)
    except Exception as err:  # noqa: BLE001
        print("  could not read %s: %s" % (source, err), file=sys.stderr)
        return None, None

    width, height = image.getSize()
    longest = max(width, height)
    if longest > max_size:
        scale = float(max_size) / longest
        width = max(1, int(round(width * scale)))
        height = max(1, int(round(height * scale)))
        image.resize(width, height, True)
        width, height = image.getSize()

    # MImage in the 2.0 API hands back the address of its pixel block, not the
    # bytes; ctypes is what turns one into the other. readFromFile always
    # normalises to 8-bit RGBA, so the stride is known.
    import ctypes

    count = width * height * 4
    block = (ctypes.c_ubyte * count).from_address(image.pixels())
    pixels = numpy.frombuffer(bytearray(block), dtype=numpy.uint8).reshape(-1, 4)
    channels = 4

    # sRGB -> linear before averaging: the mean of encoded values is not the
    # encoded mean, and USD's diffuseColor is linear.
    srgb = pixels[:, :3].astype(numpy.float64) / 255.0
    linear = numpy.where(srgb <= 0.04045, srgb / 12.92,
                         ((srgb + 0.055) / 1.055) ** 2.4)
    mean = [float(v) for v in linear.mean(axis=0)]

    # Alpha only earns a PNG if it is actually doing something.
    has_alpha = channels == 4 and bool((pixels[:, 3] < 250).any())
    stem = os.path.splitext(os.path.basename(source))[0]
    stem = re.sub(r"[^A-Za-z0-9_.-]", "_", stem)
    if has_alpha:
        name, fmt = stem + ".png", "png"
    else:
        name, fmt = stem + ".jpg", "jpg"

    target = os.path.join(out_dir, name)
    try:
        image.writeToFile(target, fmt)
    except Exception as err:  # noqa: BLE001
        print("  could not write %s: %s" % (target, err), file=sys.stderr)
        return None, mean
    return name, mean


# --------------------------------------------------------------------------
# USD post-process
# --------------------------------------------------------------------------

def postprocess(target, tex_dir_name, max_size, eye_looks, unit_scale,
                helper_names, want_materials):
    """Localise textures, kill the black fallbacks, and write the eye look."""
    from pxr import Gf, Sdf, Usd, UsdGeom, UsdShade, Vt

    stage = Usd.Stage.Open(target)

    # 0. Drop the rig scaffolding meshes. Removing a Mesh prim leaves the
    #    Skeleton and every other mesh's binding to it untouched.
    pruned = 0
    if helper_names:
        # Paths first, then remove: dropping a prim expires the handles the
        # traversal is still holding, including its siblings' children.
        doomed = [prim.GetPath() for prim in stage.Traverse()
                  if prim.GetTypeName() == "Mesh"
                  and prim.GetName() in helper_names]
        for path in doomed:
            if stage.RemovePrim(path):
                pruned += 1
        print("  helper mesh prims pruned: %d" % pruned)

    # 0b. And the rig's control hierarchy. Exporting the whole scene is what
    #     gets the Skeleton written at the path the meshes bind to, but it also
    #     writes every follicle, null and constraint space as an Xform - about
    #     5,000 prims of pure animation scaffolding. three's USDComposer walks
    #     into them and throws on the first xformOp:translate that carries no
    #     default value, so this is not merely weight, it is a hard failure.
    #
    #     What survives is what an asset is: geometry, the skeleton that drives
    #     it, and the materials. Anything holding none of those goes.
    keep_types = {"Mesh", "Skeleton", "SkelAnimation", "Material", "Shader",
                  "NodeGraph", "GeomSubset"}

    def carries_content(prim):
        if str(prim.GetTypeName()) in keep_types:
            return True
        for child in prim.GetChildren():
            if carries_content(child):
                return True
        return False

    scaffolding = []
    for prim in stage.Traverse():
        if str(prim.GetTypeName()) in keep_types:
            continue
        if not carries_content(prim):
            scaffolding.append(prim.GetPath())
    # Deepest last, so removing a parent does not strand a queued child path.
    dropped = 0
    for path in sorted(scaffolding, key=lambda p: len(str(p).split("/"))):
        if stage.GetPrimAtPath(path) and stage.RemovePrim(path):
            dropped += 1
    print("  empty rig scaffolding prims pruned: %d" % dropped)

    if not want_materials:
        stage.GetRootLayer().Save()
        return None

    out_dir = os.path.join(os.path.dirname(target), tex_dir_name)
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    processed = {}   # absolute source -> (relative name, mean linear colour)
    report = []

    # 1. Every UsdUVTexture: copy the image in at web size, repoint at it.
    for prim in stage.Traverse():
        shader = UsdShade.Shader(prim)
        if not shader:
            continue
        if shader.GetIdAttr().Get() != "UsdUVTexture":
            continue
        file_input = shader.GetInput("file")
        if not file_input:
            continue
        asset = file_input.Get()
        if not asset:
            continue
        source = asset.resolvedPath or asset.path
        source = source.replace("\\", "/")
        if not os.path.isfile(source):
            print("  texture not on disk, left as-is: %s" % source, file=sys.stderr)
            continue
        if source not in processed:
            name, mean = process_texture(source, out_dir, max_size)
            processed[source] = (name, mean)
            if name:
                report.append((os.path.basename(source), name,
                               os.path.getsize(os.path.join(out_dir, name))))
        name, mean = processed[source]
        if not name:
            continue
        file_input.Set(Sdf.AssetPath("./%s/%s" % (tex_dir_name, name)))

    # 2. The fallback colour behind a texture.
    #
    #    three reads a textured diffuseColor by following the connection; if the
    #    texture cannot be loaded it falls back to the attribute's own value
    #    (USDComposer._applyTextureOrValue). Maya leaves that value either unset
    #    or at the (0,0,0) its shader parks in .color while a file drives it -
    #    so the fallback is white-by-default or black, and neither is Gary.
    #
    #    Setting it to the texture's mean makes the plain .usdc - which three
    #    cannot pull images from at all - render in the right colours instead of
    #    a silhouette, and costs the .usdz nothing, because a material whose map
    #    did load never reads the value.
    recoloured = 0
    for prim in stage.Traverse():
        shader = UsdShade.Shader(prim)
        if not shader:
            continue
        if shader.GetIdAttr().Get() != "UsdPreviewSurface":
            continue
        diffuse = shader.GetInput("diffuseColor")
        if not diffuse:
            continue
        sources = diffuse.GetConnectedSources()
        connected = bool(sources and sources[0])
        if not connected:
            continue
        value = diffuse.Get()
        useless = value is None or max(value[0], value[1], value[2]) <= 1e-6
        if not useless:
            continue
        # Walk to the texture that drives it and reuse its mean.
        mean = None
        try:
            src = sources[0][0].source
            tex = UsdShade.Shader(src.GetPrim())
            asset = tex.GetInput("file").Get()
            for _original, (name, m) in processed.items():
                if name and asset and name in asset.path:
                    mean = m
                    break
        except Exception:  # noqa: BLE001
            pass
        if mean is None:
            mean = [0.5, 0.5, 0.5]
        diffuse.Set(Gf.Vec3f(*[max(0.0, min(1.0, c)) for c in mean]))
        recoloured += 1

    # 3. The eye. UsdPreviewSurface cannot express a refracted iris projection,
    #    so it gets an honest stand-in (a glossy sclera-coloured eyeball) and
    #    the real look rides along as squarebitEye:* custom attributes - the
    #    same interop format web/src/eye-io.js already imports.
    eyes_written = 0
    mesh_by_name = {}
    for prim in stage.Traverse():
        if prim.GetTypeName() == "Mesh":
            mesh_by_name.setdefault(prim.GetName(), prim)

    for node, entry in (eye_looks or {}).items():
        look = entry["look"]
        for mesh_name in entry["meshes"]:
            base = re.sub(r"Shape$", "", mesh_name)
            prim = mesh_by_name.get(base) or mesh_by_name.get(mesh_name)
            if not prim:
                continue
            prim.SetCustomDataByKey("squarebitEye:source", node)
            prim.CreateAttribute("squarebitEye:spec", Sdf.ValueTypeNames.String,
                                 custom=True).Set(EYE_SPEC_ID)
            for name, value in sorted(look.items()):
                if name in EYE_COLORS:
                    prim.CreateAttribute("squarebitEye:" + name,
                                         Sdf.ValueTypeNames.Color3f,
                                         custom=True).Set(Gf.Vec3f(*value))
                elif name == "refractionMode":
                    prim.CreateAttribute("squarebitEye:refractionMode",
                                         Sdf.ValueTypeNames.Token,
                                         custom=True).Set(value)
                else:
                    prim.CreateAttribute("squarebitEye:" + name,
                                         Sdf.ValueTypeNames.Float,
                                         custom=True).Set(float(value))
            for key, _attr in EYE_TEXTURES:
                source = entry["textures"].get(key)
                if not source:
                    continue
                if source not in processed:
                    name, mean = process_texture(source, out_dir, max_size)
                    processed[source] = (name, mean)
                    if name:
                        report.append((os.path.basename(source), name,
                                       os.path.getsize(os.path.join(out_dir, name))))
                name, _mean = processed[source]
                if name:
                    prim.CreateAttribute(
                        "squarebitEye:%sTexture" % key,
                        Sdf.ValueTypeNames.Asset, custom=True
                    ).Set(Sdf.AssetPath("./%s/%s" % (tex_dir_name, name)))
            if entry.get("projector"):
                m = entry["projector"]
                # Maya is column-major row-vector, same as Gf.Matrix4d rows.
                # The whole linear part converts, not just the translation: the
                # basis vectors' length IS the eye radius (SquarebitEye web
                # README, "Scale = eye radius"), so leaving the 3x3 in
                # centimetres while the position is in metres would put a 4.5
                # metre eyeball on a 1.87 metre character.
                rows = [[v * unit_scale for v in m[0:3]] + [m[3]],
                        [v * unit_scale for v in m[4:7]] + [m[7]],
                        [v * unit_scale for v in m[8:11]] + [m[11]],
                        [v * unit_scale for v in m[12:15]] + [m[15]]]
                prim.CreateAttribute("squarebitEye:projectorMatrix",
                                     Sdf.ValueTypeNames.Matrix4d,
                                     custom=True).Set(Gf.Matrix4d(*[
                                         v for row in rows for v in row]))

            # The stand-in surface.
            binding = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()
            material = binding[0] if binding else None
            if material:
                for child in material.GetPrim().GetChildren():
                    shader = UsdShade.Shader(child)
                    if not shader or shader.GetIdAttr().Get() != "UsdPreviewSurface":
                        continue
                    sclera = look.get("scleraColor") or [1.0, 1.0, 1.0]
                    clamped = [max(0.0, min(1.0, c)) for c in sclera]
                    shader.CreateInput("diffuseColor",
                                       Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*clamped))
                    shader.CreateInput("roughness",
                                       Sdf.ValueTypeNames.Float).Set(0.05)
                    shader.CreateInput("metallic",
                                       Sdf.ValueTypeNames.Float).Set(0.0)
            eyes_written += 1

    stage.GetRootLayer().Save()

    print("  textures written: %d" % len(report))
    total = 0
    for original, name, size in sorted(report):
        total += size
        print("    %-34s -> %-30s %6.0f KB" % (original, name, size / 1024.0))
    print("  texture bytes: %.1f MB" % (total / 1e6))
    print("  black diffuse fallbacks replaced: %d" % recoloured)
    print("  eye prims carrying squarebitEye:*: %d" % eyes_written)
    return out_dir


def write_usdz(target, usdz):
    """Pack the layer and its textures into the one format three reads maps from."""
    from pxr import Sdf, UsdUtils

    if os.path.isfile(usdz):
        os.remove(usdz)
    cwd = os.getcwd()
    try:
        # CreateNewUsdzPackage resolves the relative asset paths against the
        # layer, so it has to run with the layer's directory as the root.
        os.chdir(os.path.dirname(target) or ".")
        ok = UsdUtils.CreateNewUsdzPackage(
            Sdf.AssetPath(os.path.basename(target)),
            os.path.abspath(usdz),
        )
    finally:
        os.chdir(cwd)
    if not ok or not os.path.isfile(usdz):
        print("  usdz packaging failed", file=sys.stderr)
        return False
    print("  wrote %s (%.1f MB)" % (usdz, os.path.getsize(usdz) / 1e6))
    return True


# --------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Source .mb or .ma file")
    parser.add_argument("--output", required=True, help="Destination .usd/.usdc/.usda")
    parser.add_argument(
        "--no-materials",
        action="store_true",
        help="Skip materials entirely. Riser shades unshaded characters itself.",
    )
    parser.add_argument("--usdz", help="Also write a USDZ, with textures packed in")
    parser.add_argument("--project-root", help="Expands $PROJECT_ROOT in texture paths")
    parser.add_argument("--texture-size", type=int, default=1024,
                        help="Longest edge for exported textures (default 1024)")
    parser.add_argument("--textures-dir", default=None,
                        help="Folder name for textures (default <output stem>_tex)")
    parser.add_argument("--eye-plugin",
                        default="C:/Users/walte/Documents/dev/squarebit/"
                                "SquarebitEye/maya/plug-ins/2026/squarebitEye.mll",
                        help="squarebitEye.mll, so the eye look can be read")
    parser.add_argument("--blend-shapes", action="store_true",
                        help="Export blend shapes. A face rig's worth of them is "
                             "tens of MB, so this is off by default for the web.")
    parser.add_argument("--keep-rig-helpers", action="store_true",
                        help="Keep bind planes and projection spheres")
    args = parser.parse_args()

    source = os.path.abspath(args.input)
    target = os.path.abspath(args.output)
    if not os.path.isfile(source):
        print("No such file: %s" % source, file=sys.stderr)
        return 2
    os.makedirs(os.path.dirname(target), exist_ok=True)

    project_root = args.project_root or derive_project_root(source)
    tex_dir_name = args.textures_dir or (
        os.path.splitext(os.path.basename(target))[0] + "_tex")

    import maya.standalone

    maya.standalone.initialize(name="python")

    import maya.cmds as cmds

    try:
        cmds.loadPlugin("mayaUsdPlugin", quiet=True)
    except Exception as err:  # noqa: BLE001 - report and stop, do not guess
        print("Could not load mayaUsdPlugin: %s" % err, file=sys.stderr)
        return 3

    want_materials = not args.no_materials
    if want_materials:
        load_eye_plugin(cmds, args.eye_plugin)

    # ignoreVersion, because a scene saved in a newer Maya otherwise refuses to
    # open at all rather than opening with a warning.
    cmds.file(source, open=True, force=True, ignoreVersion=True, prompt=False)

    # Report what came in. A conversion that silently produces an empty stage
    # is the failure mode worth catching, and the mesh count catches it.
    meshes = cmds.ls(type="mesh", noIntermediate=True) or []
    joints = cmds.ls(type="joint") or []
    blend_shapes = cmds.ls(type="blendShape") or []
    skins = cmds.ls(type="skinCluster") or []
    print("Opened %s" % source)
    print("  project root: %s" % project_root)
    print("  meshes: %d" % len(meshes))
    print("  joints: %d" % len(joints))
    print("  skinClusters: %d" % len(skins))
    print("  blendShape nodes: %d" % len(blend_shapes))
    if not meshes:
        print("Nothing to export - no meshes in the scene.", file=sys.stderr)
        return 4

    eye_looks = {}
    if want_materials:
        print("Materials:")
        fix_texture_paths(cmds, project_root)
        eye_looks = capture_eye_looks(cmds, project_root)
        print("  squarebitEyeShader nodes: %d" % len(eye_looks))

    # The character, not the rig scaffolding it is built on: bind planes, the
    # eye projection spheres, the PSD readout. All live under .../rig and all
    # export as untextured grey quads floating inside the character.
    #
    # They cannot be dropped by exporting a selection, though, and that is the
    # trap this walked into once: the skeleton lives under .../rig too. The 777
    # bound joints are scattered across hundreds of follicle and offset chains,
    # so the only Maya selection containing all of them also contains every
    # bind plane. Exporting the model group alone wrote meshes whose
    # skel:skeleton relationship pointed at a Skeleton prim that was not in the
    # file, and three built 33 SkinnedMeshes with no Skeleton behind them.
    #
    # So: export the lot, and prune the helper meshes from the stage afterwards,
    # where a Mesh can be removed without disturbing the skeleton at all.
    helper_names = set()
    if not args.keep_rig_helpers:
        for mesh in meshes:
            full = (cmds.ls(mesh, long=True) or [mesh])[0]
            if HELPER_PARENT in full:
                parent = cmds.listRelatives(mesh, parent=True) or []
                helper_names.add(re.sub(r"Shape$", "", mesh.split("|")[-1]))
                if parent:
                    helper_names.add(parent[0].split("|")[-1])
        print("  rig helper meshes to prune: %d" % len(
            [m for m in meshes if HELPER_PARENT in (cmds.ls(m, long=True) or [m])[0]]))

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
        "exportBlendShapes": bool(args.blend_shapes),
        "mergeTransformAndShape": True,
        "stripNamespaces": True,
        "shadingMode": "useRegistry" if want_materials else "none",
    }
    if want_materials:
        # Without this the registry writes whatever native surface it can, and
        # three only understands UsdPreviewSurface.
        options["convertMaterialsTo"] = ["UsdPreviewSurface"]
    if joints:
        print("  exporting with UsdSkel")

    cmds.mayaUSDExport(**options)

    if not os.path.isfile(target):
        print("Export wrote nothing.", file=sys.stderr)
        return 5
    print("Wrote %s (%.1f MB)" % (target, os.path.getsize(target) / 1e6))

    # Maya is in centimetres and the export writes metres; the eye projector
    # matrix is captured in scene units, so it needs the same conversion.
    unit_scale = 0.01 if cmds.currentUnit(q=True, linear=True) == "cm" else 1.0
    print("Post-process:")
    postprocess(target, tex_dir_name, args.texture_size, eye_looks,
                unit_scale, helper_names, want_materials)
    print("Wrote %s (%.1f MB)" % (target, os.path.getsize(target) / 1e6))
    if args.usdz:
        write_usdz(target, os.path.abspath(args.usdz))

    return 0


if __name__ == "__main__":
    sys.exit(main())
