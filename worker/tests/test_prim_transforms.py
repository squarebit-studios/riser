"""Prim transforms must be honoured, or bindings resolve in the wrong space.

The browser stores guide positions relative to the referenced asset's root -
below the units scale, up-axis flip and framing fit it applies for display, but
ABOVE any xformOp the asset itself authors on a group between its root and a
mesh. Real assets do author those: a head offset onto a body, parts placed into
an assembly.

If the worker evaluated a binding against the mesh's raw points and ignored
those transforms, it would answer in a different coordinate system, and every
guide on such a character would appear to have moved by exactly the transform.

The stock asset has identity transforms throughout, so nothing in the main
contract test can catch this. These build a stage that does have them.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from riser_worker import collect_meshes, open_stage, resolve_binding
from riser_worker.document import SurfaceBinding

# A single triangle, offset and scaled by the Xform above it. Chosen so the
# expected answers are exact in binary floating point.
LAYER = """#usda 1.0
(
    defaultPrim = "Riser"
    upAxis = "Y"
    metersPerUnit = 1
)

def Xform "Riser"
{
    def Xform "Character"
    {
        def Xform "Rig"
        {
            double3 xformOp:translate = (10, 20, 30)
            double3 xformOp:scale = (2, 2, 2)
            uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:scale"]

            def Mesh "Body"
            {
                point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]
                int[] faceVertexCounts = [3]
                int[] faceVertexIndices = [0, 1, 2]
            }
        }
    }
}
"""

MESH_PATH = "/Riser/Character/Rig/Body"


@pytest.fixture()
def meshes(tmp_path: Path):
    layer = tmp_path / "transformed.usda"
    layer.write_text(LAYER, encoding="utf-8")
    return collect_meshes(open_stage(layer))


def test_the_mesh_is_found(meshes):
    assert MESH_PATH in meshes


def test_points_are_baked_into_stage_space(meshes):
    mesh = meshes[MESH_PATH]
    # xformOpOrder = [translate, scale] composes as T * S, so the LAST op
    # listed is the one that touches the point first: scale, then translate.
    # Verified against OpenUSD rather than assumed - getting this backwards
    # would put every guide on such a character in the wrong place.
    a, b, c = mesh.triangle_points(0)
    assert a == pytest.approx((10.0, 20.0, 30.0))
    assert b == pytest.approx((12.0, 20.0, 30.0))
    assert c == pytest.approx((10.0, 22.0, 30.0))


def test_a_binding_resolves_into_stage_space(meshes):
    # The centroid of the transformed triangle, which is where a guide bound to
    # the middle of that face has to land.
    binding = SurfaceBinding(
        prim_path=MESH_PATH,
        face_index=0,
        barycentric=(1 / 3, 1 / 3, 1 / 3),
        offset=(0.0, 0.0, 0.0),
    )
    resolved = resolve_binding(binding, meshes)
    assert resolved == pytest.approx((32 / 3, 62 / 3, 30.0))


def test_the_offset_is_applied_in_the_same_space(meshes):
    binding = SurfaceBinding(
        prim_path=MESH_PATH,
        face_index=0,
        barycentric=(1.0, 0.0, 0.0),
        offset=(0.5, -0.25, 1.0),
    )
    resolved = resolve_binding(binding, meshes)
    assert resolved == pytest.approx((10.5, 19.75, 31.0))


def test_identity_transforms_leave_points_untouched(tmp_path: Path):
    # The common case, and the one the stock asset exercises: no transform
    # anywhere, so the declared float values must survive bit for bit rather
    # than being round-tripped through a matrix multiply.
    layer = tmp_path / "plain.usda"
    layer.write_text(
        LAYER.replace(
            """            double3 xformOp:translate = (10, 20, 30)
            double3 xformOp:scale = (2, 2, 2)
            uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:scale"]
""",
            "",
        ),
        encoding="utf-8",
    )
    mesh = collect_meshes(open_stage(layer))[MESH_PATH]
    a, b, c = mesh.triangle_points(0)
    assert a == (0.0, 0.0, 0.0)
    assert b == (1.0, 0.0, 0.0)
    assert c == (0.0, 1.0, 0.0)
