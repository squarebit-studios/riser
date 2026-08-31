"""The public API a studio integrates against.

These tests exist to pin the SHAPE, not just the arithmetic. test_document.py
already proves the numbers are right; what these hold still is the promise made
to a pipeline engineer: that RiserLayer.open gives back resolved positions in
three lines, that a broken binding is flagged rather than dropped, and that the
JSON keys stay where they were.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from riser_worker import (
    GuideSource,
    RiserLayer,
    RiserLayerError,
    Template,
    TemplateError,
    resolve_curves,
    resolve_guides,
)

FIXTURE = Path(__file__).parent / "fixtures" / "sample-layer.usda"
TEMPLATES_DIR = Path(__file__).resolve().parents[2] / "src" / "templates"


@pytest.fixture(scope="module")
def layer() -> RiserLayer:
    if not FIXTURE.exists():
        pytest.skip(
            f"{FIXTURE.name} is missing. Generate it with "
            "`npx vitest run src/doc/fixture.test.ts`."
        )
    return RiserLayer.open(FIXTURE)


class TestOpening:
    def test_the_three_line_case_works(self, layer):
        # The example in the module docstring and in API.md. If this stops
        # working, every integration guide we have shipped is wrong.
        positions = {g.id: g.position for g in layer.guides()}
        assert positions["pelvis"] == pytest.approx(
            (0.2560967, 1.485, -0.0107767), abs=1e-6
        )

    def test_source_path_is_remembered(self, layer):
        assert layer.source_path == FIXTURE

    def test_a_missing_file_raises_rather_than_returning_an_empty_layer(self, tmp_path):
        # OpenUSD returns None for a file it cannot open, which would otherwise
        # surface much later as an AttributeError with no mention of the path.
        with pytest.raises(RiserLayerError):
            RiserLayer.open(tmp_path / "nothing.usda")

    def test_from_text_resolves_a_relative_reference_against_asset_dir(self):
        # The service path: the layer never touches disk in its own right, so
        # the reference can only compose if we say where the asset lives.
        text = FIXTURE.read_text(encoding="utf-8")
        layer = RiserLayer.from_text(text, asset_dir=FIXTURE.parent)
        assert layer.mesh_paths == [
            "/Riser/Character/Geom/Body",
            "/Riser/Character/Geom/Head",
        ]

    def test_from_text_geometry_survives_the_temporary_file(self):
        # from_text deletes the file it wrote. If mesh points were still being
        # read lazily off that layer, this would come back empty.
        text = FIXTURE.read_text(encoding="utf-8")
        layer = RiserLayer.from_text(text, asset_dir=FIXTURE.parent)
        mesh = layer.meshes["/Riser/Character/Geom/Body"]
        assert mesh.triangle_count > 0
        assert mesh.triangle_points(0)[0] is not None
        assert layer.source_path is None


class TestResolvedGuides:
    def test_every_guide_comes_back_including_the_unbound_one(self, layer):
        # validate() drops guides it cannot vouch for. guides() must not: a
        # pipeline exporting a checklist needs to see the whole roster.
        assert len(layer.guides()) == len(layer.document.guides) == 8

    def test_position_is_recomputed_not_read_back(self, layer):
        # Same property the contract test proves, asserted through the public
        # entry point so a refactor of the facade cannot quietly lose it.
        for guide in layer.guides():
            if not guide.bound:
                continue
            drift = (
                sum(
                    (guide.position[i] - guide.authored_position[i]) ** 2
                    for i in range(3)
                )
                ** 0.5
            )
            assert drift < 1e-5

    def test_the_free_guide_reports_itself_as_unbound(self, layer):
        root = layer.guide("root")
        assert root is not None
        assert root.bound is False
        assert root.resolved is True
        assert root.position == root.authored_position

    def test_provenance_reaches_the_consumer(self, layer):
        # The whole reason for reading riser:guide:source. A pipeline must be
        # able to tell a hand-placed guide from a guessed one.
        for guide in layer.guides():
            assert guide.source == GuideSource.USER
            assert guide.confidence == pytest.approx(1.0)

    def test_the_binding_travels_with_the_resolved_guide(self, layer):
        elbow = layer.guide("elbowL")
        assert elbow is not None
        assert elbow.binding is not None
        assert elbow.binding.prim_path == "/Riser/Character/Geom/Body"
        assert elbow.binding.offset[0] == pytest.approx(-0.02, abs=1e-6)

    def test_a_broken_binding_is_flagged_not_dropped(self, layer):
        broken = copy.deepcopy(layer.document)
        guide = next(g for g in broken.guides if g.binding is not None)
        object.__setattr__(guide.binding, "face_index", 10_000_000)

        resolved = {g.id: g for g in resolve_guides(broken, layer.meshes)}
        assert len(resolved) == len(broken.guides)
        entry = resolved[guide.id]
        assert entry.resolved is False
        assert entry.bound is True
        # Falls back to what was authored, so a naive consumer still gets a
        # roughly-right marker rather than a None it will not check for.
        assert entry.position == guide.position

    def test_an_unknown_guide_id_is_none_rather_than_an_error(self, layer):
        assert layer.guide("noSuchGuide") is None


class TestResolvedCurves:
    def test_control_vertices_resolve(self, layer):
        jawline = layer.curve("jawline")
        assert jawline is not None
        assert len(jawline.points) == 5
        assert all(p.resolved for p in jawline.points)

    def test_indices_are_present_so_order_survives_a_json_round_trip(self, layer):
        jawline = layer.curve("jawline")
        assert [p.index for p in jawline.points] == [0, 1, 2, 3, 4]

    def test_closedness_and_width_survive(self, layer):
        assert layer.curve("lipOuter").closed is True
        assert layer.curve("jawline").width == pytest.approx(0.004, abs=1e-6)

    def test_a_broken_curve_binding_is_flagged(self, layer):
        broken = copy.deepcopy(layer.document)
        point = next(p for p in broken.curves[0].points if p.binding is not None)
        object.__setattr__(point.binding, "prim_path", "/Riser/Character/Geom/Nope")

        curves = resolve_curves(broken, layer.meshes)
        flagged = [p for c in curves for p in c.points if not p.resolved]
        assert len(flagged) == 1
        assert flagged[0].position == point.position


class TestValidateThroughTheFacade:
    def test_no_template_means_only_bindings_are_checked(self, layer):
        # A pipeline stage that just wants to know the bindings still resolve
        # must not be told the artist has not finished the checklist.
        report = layer.validate()
        assert report.ok

    def test_a_template_makes_completeness_matter(self, layer):
        report = layer.validate(["pelvis", "headTop"])
        assert not report.ok
        assert {i.subject for i in report.errors} == {"headTop"}

    @pytest.mark.skipif(not TEMPLATES_DIR.is_dir(), reason="no template checkout")
    def test_a_template_id_resolves_to_the_real_checklist(self, layer):
        report = layer.validate("biped")
        # The fixture places 8 of the biped template's guides, so it is
        # legitimately incomplete. What matters is that the ids came from the
        # template file rather than from thin air.
        assert not report.ok
        assert "headTop" in {i.subject for i in report.errors}


class TestMissingGuides:
    def test_a_plain_id_set_works_without_any_template_machinery(self, layer):
        assert layer.missing_guides(["pelvis", "chest", "tail"]) == ["tail"]

    def test_optional_guides_are_excluded_by_default(self):
        template = Template(
            id="t",
            label="T",
            groups=[_group("g")],
            guides=[_guide("a", "g"), _guide("b", "g", optional=True)],
        )
        layer = _empty_layer()
        assert layer.missing_guides(template) == ["a"]
        assert layer.missing_guides(template, include_optional=True) == ["a", "b"]

    @pytest.mark.skipif(not TEMPLATES_DIR.is_dir(), reason="no template checkout")
    def test_missing_ids_come_back_in_template_order(self, layer):
        missing = layer.missing_guides("biped")
        template = layer.template()
        order = template.required_guide_ids()
        assert missing == [gid for gid in order if gid in set(missing)]


class TestJsonShape:
    """The keys are a contract. Renaming one breaks a pipeline silently."""

    def test_summary_keys(self, layer):
        summary = layer.summary()
        assert set(summary) == {
            "path",
            "doc_version",
            "template_id",
            "name",
            "character_ref",
            "up_axis",
            "meters_per_unit",
            "counts",
            "guide_sources",
        }
        assert summary["guide_sources"] == {"user": 8}

    def test_summary_does_not_need_geometry(self):
        # A layer whose asset is missing must still summarise, because that is
        # exactly when someone runs inspect to find out what went wrong.
        text = FIXTURE.read_text(encoding="utf-8").replace(
            "../../../public/assets/biped-blockout.usda", "./gone.usda"
        )
        layer = RiserLayer.from_text(text)
        assert layer.summary()["counts"]["guides"] == 8

    def test_to_dict_is_json_serialisable(self, layer):
        text = json.dumps(layer.to_dict())
        assert json.loads(text)["summary"]["template_id"] == "biped"

    def test_to_dict_top_level_keys(self, layer):
        assert set(layer.to_dict()) == {
            "summary",
            "mesh_paths",
            "guides",
            "curves",
            "document",
        }

    def test_resolved_guide_keys(self, layer):
        entry = layer.guide("pelvis").to_dict()
        assert set(entry) == {
            "id",
            "group",
            "position",
            "authored_position",
            "normal",
            "drift",
            "bound",
            "resolved",
            "source",
            "confidence",
            "binding",
        }
        assert set(entry["binding"]) == {
            "prim_path",
            "face_index",
            "barycentric",
            "offset",
        }

    def test_vectors_are_lists_not_tuples(self, layer):
        # json.dumps turns a tuple into an array anyway, but a caller that
        # compares to_dict() output against parsed JSON would otherwise see a
        # difference that is not really there.
        entry = layer.guide("pelvis").to_dict()
        assert isinstance(entry["position"], list)

    def test_report_to_dict_keys(self, layer):
        payload = layer.validate().to_dict()
        assert set(payload) == {"ok", "counts", "guides", "issues"}
        assert set(payload["issues"][0]) == {
            "severity",
            "code",
            "message",
            "subject",
        }


class TestTemplateLookupFailsLoudly:
    def test_an_unknown_template_id_raises(self, layer):
        with pytest.raises(TemplateError):
            layer.missing_guides("no-such-template")


# -------------------------------------------------------------------------
# Small builders, so the shape tests do not need a fixture on disk.
# -------------------------------------------------------------------------


def _group(group_id: str):
    from riser_worker.templates import TemplateGroup

    return TemplateGroup(id=group_id, label=group_id)


def _guide(guide_id: str, group: str, **kwargs):
    from riser_worker.templates import GuideDef

    return GuideDef(id=guide_id, group=group, label=guide_id, **kwargs)


def _empty_layer() -> RiserLayer:
    from riser_worker.document import RiserDocument

    doc = RiserDocument(
        doc_version="1.0.0",
        template_id="t",
        name="empty",
        character_ref="",
        up_axis="Y",
        meters_per_unit=1.0,
    )
    return RiserLayer(stage=None, document=doc, meshes={})
