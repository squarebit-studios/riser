"""The cross-language contract test.

worker/tests/fixtures/sample-layer.usda is written by the TypeScript writer
(src/doc/fixture.test.ts) from real picks on the real stock asset. This file
opens it with Pixar's OpenUSD.

That pairing is the point. The TypeScript round-trip test proves our writer and
our reader agree with each other - which they could do while both being wrong
about USD. Only OpenUSD can settle whether what the browser writes is actually
USD, and only these tests can settle whether the server recovers the same
positions the browser had.

Regenerate the fixture with:  npx vitest run src/doc/fixture.test.ts
"""

from __future__ import annotations

from pathlib import Path

import pytest

from riser_worker import (
    RiserLayerError,
    collect_meshes,
    open_stage,
    read_document,
    resolve_binding,
    validate,
)
from riser_worker.validate import Severity

FIXTURE = Path(__file__).parent / "fixtures" / "sample-layer.usda"


@pytest.fixture(scope="module")
def stage():
    if not FIXTURE.exists():
        pytest.skip(
            f"{FIXTURE.name} is missing. Generate it with "
            "`npx vitest run src/doc/fixture.test.ts`."
        )
    return open_stage(FIXTURE)


@pytest.fixture(scope="module")
def doc(stage):
    return read_document(stage)


@pytest.fixture(scope="module")
def meshes(stage):
    return collect_meshes(stage)


class TestLayerIsValidUsd:
    def test_openusd_opens_it(self, stage):
        assert stage is not None

    def test_stage_metadata_survives(self, doc):
        assert doc.up_axis == "Y"
        assert doc.meters_per_unit == pytest.approx(1.0)

    def test_riser_metadata_survives(self, doc):
        assert doc.doc_version == "1.0.0"
        assert doc.template_id == "biped"
        assert doc.name == "Contract fixture"

    def test_character_reference_survives(self, doc):
        assert doc.character_ref.endswith("biped-blockout.usda")

    def test_reference_actually_composes(self, meshes):
        # If the reference did not resolve, the stage would carry no geometry
        # at all - which is the failure mode a malformed asset path produces.
        assert set(meshes) == {
            "/Riser/Character/Geom/Body",
            "/Riser/Character/Geom/Head",
        }


class TestGuides:
    def test_all_guides_are_read(self, doc):
        assert len(doc.guides) == 8
        assert {g.id for g in doc.guides} == {
            "pelvis",
            "chest",
            "wristL",
            "kneeR",
            "chin",
            "elbowL",
            "root",
            "chestSubdiv",
        }

    def test_groups_survive(self, doc):
        by_id = {g.id: g for g in doc.guides}
        assert by_id["wristL"].group == "armL"
        assert by_id["chin"].group == "face"

    def test_bound_and_unbound_guides_stay_distinguishable(self, doc):
        by_id = {g.id: g for g in doc.guides}
        assert by_id["root"].binding is None
        assert by_id["pelvis"].binding is not None

    def test_bindings_point_at_layer_paths(self, doc):
        for guide in doc.guides:
            if guide.binding is None:
                continue
            assert guide.binding.prim_path.startswith("/Riser/Character/")

    def test_offsets_survive(self, doc):
        elbow = next(g for g in doc.guides if g.id == "elbowL")
        assert elbow.binding is not None
        assert elbow.binding.offset[0] == pytest.approx(-0.02, abs=1e-6)
        assert elbow.binding.offset[2] == pytest.approx(0.01, abs=1e-6)


class TestBindingsResolveToTheSamePlace:
    """The property the whole format exists to provide."""

    def test_every_binding_resolves(self, doc, meshes):
        for guide in doc.guides:
            if guide.binding is None:
                continue
            assert (
                resolve_binding(guide.binding, meshes) is not None
            ), f"{guide.id} did not resolve"

    def test_resolved_positions_match_what_the_browser_stored(self, doc, meshes):
        # This is the assertion that proves browser and server agree. The
        # browser wrote both the binding and the position it computed from it;
        # OpenUSD recomputes the position here from the binding alone. Agreement
        # to within float32 print precision means the two implementations of
        # triangulation and barycentric evaluation are the same function.
        for guide in doc.guides:
            if guide.binding is None:
                continue
            resolved = resolve_binding(guide.binding, meshes)
            distance = sum(
                (resolved[i] - guide.position[i]) ** 2 for i in range(3)
            ) ** 0.5
            assert distance < 1e-5, (
                f"{guide.id}: server recomputed {resolved}, "
                f"browser stored {guide.position} ({distance:.2e} apart)"
            )

    def test_curve_points_resolve_too(self, doc, meshes):
        for curve in doc.curves:
            for index, point in enumerate(curve.points):
                if point.binding is None:
                    continue
                resolved = resolve_binding(point.binding, meshes)
                assert resolved is not None, f"{curve.id}[{index}] did not resolve"
                distance = sum(
                    (resolved[i] - point.position[i]) ** 2 for i in range(3)
                ) ** 0.5
                assert distance < 1e-5, f"{curve.id}[{index}] is {distance:.2e} off"


class TestSubdivisionIsInvisibleHere:
    """The worker must never need to know subdivision happened.

    `chestSubdiv` was placed by clicking the smooth Catmull-Clark limit
    surface. The binding names a triangle of the CONTROL CAGE - the actual USD
    mesh - and the gap between cage and limit rides in the offset. If the
    design is right, this file resolves it with the same arithmetic as every
    other guide, with no subdivision code anywhere on the server.
    """

    def test_the_subdivided_guide_exists_and_is_bound(self, doc):
        guide = next(g for g in doc.guides if g.id == "chestSubdiv")
        assert guide.binding is not None
        assert guide.binding.prim_path.startswith("/Riser/Character/")

    def test_it_carries_a_real_cage_to_limit_offset(self, doc):
        guide = next(g for g in doc.guides if g.id == "chestSubdiv")
        gap = sum(c * c for c in guide.binding.offset) ** 0.5
        # The limit surface sits inside the cage, so the offset is not zero.
        # A zero here would mean the fixture silently lost its subdivision.
        assert gap > 1e-4, f"offset {guide.binding.offset} has no cage-to-limit gap"

    def test_it_resolves_to_the_point_that_was_clicked(self, doc, meshes):
        guide = next(g for g in doc.guides if g.id == "chestSubdiv")
        resolved = resolve_binding(guide.binding, meshes)
        assert resolved is not None
        distance = sum((resolved[i] - guide.position[i]) ** 2 for i in range(3)) ** 0.5
        assert distance < 1e-5, (
            f"server recomputed {resolved}, browser clicked {guide.position} "
            f"({distance:.2e} apart)"
        )

    def test_the_cage_triangle_it_names_really_exists(self, doc, meshes):
        guide = next(g for g in doc.guides if g.id == "chestSubdiv")
        mesh = meshes[guide.binding.prim_path]
        assert 0 <= guide.binding.face_index < mesh.triangle_count


class TestCurves:
    def test_curves_are_read(self, doc):
        assert {c.id for c in doc.curves} == {"jawline", "lipOuter"}

    def test_point_counts_survive(self, doc):
        by_id = {c.id: c for c in doc.curves}
        assert len(by_id["jawline"].points) == 5
        assert len(by_id["lipOuter"].points) == 4

    def test_closed_flag_survives(self, doc):
        by_id = {c.id: c for c in doc.curves}
        assert by_id["jawline"].closed is False
        assert by_id["lipOuter"].closed is True

    def test_width_survives(self, doc):
        by_id = {c.id: c for c in doc.curves}
        assert by_id["jawline"].width == pytest.approx(0.004, abs=1e-6)


class TestValidation:
    def test_a_good_document_passes(self, doc, meshes):
        report = validate(doc, meshes)
        assert report.ok, [i.message for i in report.errors]

    def test_no_drift_on_a_freshly_authored_document(self, doc, meshes):
        report = validate(doc, meshes)
        assert all(g.drift < 1e-5 for g in report.guides if g.bound)

    def test_unbound_guide_is_reported_as_info_not_error(self, doc, meshes):
        report = validate(doc, meshes)
        codes = {i.code for i in report.issues if i.subject == "root"}
        assert "guide-unbound" in codes
        assert report.ok

    def test_missing_required_guides_are_errors(self, doc, meshes):
        report = validate(doc, meshes, required_guide_ids={"pelvis", "headTop", "jaw"})
        missing = {i.subject for i in report.errors if i.code == "guide-missing"}
        assert missing == {"headTop", "jaw"}
        assert not report.ok

    def test_a_binding_to_a_missing_prim_is_an_error(self, doc, meshes):
        report = validate(doc, {})
        assert not report.ok
        assert any(i.code == "no-geometry" for i in report.errors)

    def test_a_face_index_past_the_end_is_an_error(self, doc, meshes):
        import copy

        broken = copy.deepcopy(doc)
        guide = next(g for g in broken.guides if g.binding is not None)
        object.__setattr__(guide.binding, "face_index", 10_000_000)
        report = validate(broken, meshes)
        assert any(i.code == "guide-binding-unresolved" for i in report.errors)
        assert any("out of range" in i.message for i in report.errors)


class TestErrors:
    def test_a_non_riser_layer_is_rejected(self, tmp_path):
        path = tmp_path / "other.usda"
        path.write_text(
            '#usda 1.0\n(\n    defaultPrim = "World"\n)\n\ndef Xform "World"\n{\n}\n',
            encoding="utf-8",
        )
        with pytest.raises(RiserLayerError, match="Not a Riser layer"):
            read_document(open_stage(path))


def test_severity_values_are_stable():
    # These strings cross the wire to the backend and into email templates.
    assert Severity.ERROR.value == "error"
    assert Severity.WARNING.value == "warning"
    assert Severity.INFO.value == "info"
