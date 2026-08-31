"""A layer exported by Riser must open somewhere other than Riser.

The browser writes the character reference as a relative path beside the layer,
such as ``@./hero.usdc@``. That is the conventional and most portable choice in
USD: put the two files in one directory and it resolves, for any tool, on any
machine.

It was not always so. Riser used to write whatever URL it had fetched the
character from, so an exported layer carried a served path like
``/assets/biped-blockout.usda`` and composed to nothing outside the app. The
guides were all present and every one of them was unresolvable, which is the
worst kind of broken - it looks fine until something tries to use it.

These tests are the proof that the export is usable, run through Pixar's
OpenUSD rather than through our own reader.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from riser_worker import collect_meshes, open_stage, read_document, resolve_binding

ASSETS = Path(__file__).resolve().parents[2] / "public" / "assets"
ASSET_NAME = "biped-blockout.usda"

LAYER = """#usda 1.0
(
    defaultPrim = "Riser"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "Riser" (
    kind = "assembly"
)
{
    string riser:docVersion = "1.0.0"
    string riser:template = "biped"
    string riser:name = "Exported"

    def "Character" (
        prepend references = @{ref}@
    )
    {
    }

    def Scope "Guides"
    {
        def Xform "pelvis"
        {
            double3 xformOp:translate = (0, 0.9, 0)
            uniform token[] xformOpOrder = ["xformOp:translate"]

            uniform token riser:guide:id = "pelvis"
            uniform token riser:guide:group = "spine"
            float3 riser:guide:normal = (0, 1, 0)
            uniform token riser:guide:source = "user"
            float riser:guide:confidence = 1
            uniform token riser:guide:bound = "surface"
            rel riser:guide:bindPrim = </Riser/Character/Geom/Body>
            int riser:guide:faceIndex = 10
            float3 riser:guide:barycentric = (0.3333333, 0.3333333, 0.3333333)
            float3 riser:guide:offset = (0, 0, 0)
        }
    }

    def Scope "Curves"
    {
    }
}
"""


def _write_pair(directory: Path, ref: str) -> Path:
    """A layer and the asset it references, side by side, as an export would be."""
    shutil.copy(ASSETS / ASSET_NAME, directory / ASSET_NAME)
    layer = directory / "exported.usda"
    layer.write_text(LAYER.replace("{ref}", ref), encoding="utf-8")
    return layer


@pytest.fixture(autouse=True)
def _require_asset():
    if not (ASSETS / ASSET_NAME).exists():
        pytest.skip(f"{ASSET_NAME} is missing; run `node tools/make-stock-assets.mjs`")


def test_a_relative_reference_resolves(tmp_path: Path):
    # The shape Riser exports.
    layer = _write_pair(tmp_path, f"./{ASSET_NAME}")
    meshes = collect_meshes(open_stage(layer))

    assert set(meshes) == {
        "/Riser/Character/Geom/Body",
        "/Riser/Character/Geom/Head",
    }


def test_a_bare_filename_resolves_too(tmp_path: Path):
    # USD resolves a bare name against the layer's directory as well, so an
    # upload whose reference is just its own file name still works when kept
    # beside the layer.
    layer = _write_pair(tmp_path, ASSET_NAME)
    assert len(collect_meshes(open_stage(layer))) == 2


def test_a_served_path_resolves_to_nothing(tmp_path: Path):
    # The old behaviour, kept as a test so it cannot come back. The layer opens
    # perfectly well and contains every guide; there is simply no geometry, and
    # nothing about the file says so.
    layer = _write_pair(tmp_path, f"/assets/{ASSET_NAME}")
    stage = open_stage(layer)

    doc = read_document(stage)
    assert len(doc.guides) == 1, "the layer itself still parses"
    assert collect_meshes(stage) == {}, "a served path must not silently resolve"


def test_guides_resolve_through_a_relative_reference(tmp_path: Path):
    # The end of the chain: the reference composes, the mesh is found, and the
    # binding evaluates to a real position.
    layer = _write_pair(tmp_path, f"./{ASSET_NAME}")
    stage = open_stage(layer)
    meshes = collect_meshes(stage)
    doc = read_document(stage)

    guide = doc.guides[0]
    assert guide.binding is not None
    resolved = resolve_binding(guide.binding, meshes)

    assert resolved is not None, "the binding did not resolve"
    # Somewhere on a 1.8m character, rather than at the origin.
    assert 0.0 < resolved[1] < 2.0


def test_the_layer_still_opens_when_the_asset_is_absent(tmp_path: Path):
    # A missing asset must not stop the document being read. Validation reports
    # it; opening does not throw.
    layer = tmp_path / "lonely.usda"
    layer.write_text(LAYER.replace("{ref}", "./nowhere.usda"), encoding="utf-8")

    stage = open_stage(layer)
    assert len(read_document(stage).guides) == 1
    assert collect_meshes(stage) == {}
