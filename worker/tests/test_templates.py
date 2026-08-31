"""Templates: the checklist a document is measured against.

These are the browser's own JSON files, read rather than copied. Two things
matter here. First, that the reader understands the real files, since a second
opinion about their shape is exactly the drift the shared-file arrangement
exists to avoid. Second, that a malformed template fails at load rather than
much later as a checklist entry nobody can ever satisfy.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from riser_worker.templates import (
    TEMPLATES_DIR_ENV,
    Template,
    TemplateError,
    available_templates,
    default_templates_dir,
    find_template,
    load_template,
    load_templates,
    missing_guide_ids,
    template_from_dict,
    template_problems,
)

TEMPLATES_DIR = Path(__file__).resolve().parents[2] / "src" / "templates"

needs_checkout = pytest.mark.skipif(
    not TEMPLATES_DIR.is_dir(), reason="templates live in a source checkout"
)


@needs_checkout
class TestTheRealTemplates:
    def test_the_default_location_finds_them_with_no_configuration(self, monkeypatch):
        # A studio running the CLI out of a checkout should not have to set
        # anything. Clear the override first so this tests the search, not the
        # environment the test runner happens to have.
        monkeypatch.delenv(TEMPLATES_DIR_ENV, raising=False)
        assert default_templates_dir() == TEMPLATES_DIR

    def test_all_three_load_and_validate(self):
        templates = load_templates(TEMPLATES_DIR)
        assert set(templates) >= {"biped", "quadruped", "face"}

    def test_biped_has_required_and_optional_guides(self):
        biped = load_template(TEMPLATES_DIR / "biped.json")
        required = biped.required_guide_ids()
        assert "wristL" in required
        # Optional guides exist and are excluded from the required set, which
        # is what stops a finished document reading as incomplete.
        assert len(required) < len(biped.guide_ids())

    def test_camel_case_json_becomes_python_naming(self):
        # suggestedPoints is the one field whose name differs. If the rename
        # were dropped it would silently read as None on every curve.
        face = load_template(TEMPLATES_DIR / "face.json")
        assert any(c.suggested_points for c in face.curves)

    def test_env_var_beats_the_search(self, monkeypatch, tmp_path):
        monkeypatch.setenv(TEMPLATES_DIR_ENV, str(tmp_path))
        assert default_templates_dir() == tmp_path

    def test_find_template_takes_an_id(self, monkeypatch):
        monkeypatch.delenv(TEMPLATES_DIR_ENV, raising=False)
        assert find_template("biped").id == "biped"

    def test_find_template_takes_a_path(self):
        # So a studio with its own rig type never has to install it anywhere.
        assert find_template(TEMPLATES_DIR / "quadruped.json").id == "quadruped"


class TestValidation:
    def test_a_guide_in_an_unknown_group_is_rejected(self):
        with pytest.raises(TemplateError, match="unknown group"):
            template_from_dict(
                {
                    "id": "t",
                    "groups": [{"id": "a", "label": "A"}],
                    "guides": [{"id": "g", "group": "typo", "label": "G"}],
                }
            )

    def test_a_one_way_mirror_is_rejected(self):
        # The interesting failure: symmetry places the partner, the partner
        # does not place back, and the user reads that as a random bug.
        with pytest.raises(TemplateError, match="mirrors"):
            template_from_dict(
                {
                    "id": "t",
                    "groups": [{"id": "a", "label": "A"}],
                    "guides": [
                        {"id": "l", "group": "a", "label": "L", "mirror": "r"},
                        {"id": "r", "group": "a", "label": "R"},
                    ],
                }
            )

    def test_duplicate_ids_are_rejected(self):
        with pytest.raises(TemplateError, match="duplicate"):
            template_from_dict(
                {
                    "id": "t",
                    "groups": [{"id": "a", "label": "A"}],
                    "guides": [
                        {"id": "g", "group": "a", "label": "G"},
                        {"id": "g", "group": "a", "label": "G again"},
                    ],
                }
            )

    def test_a_template_with_no_guides_is_rejected(self):
        with pytest.raises(TemplateError, match="no guides"):
            template_from_dict({"id": "t", "groups": [], "guides": []})

    def test_problems_are_reported_together_not_one_at_a_time(self):
        # Fixing a template one error per run is miserable, so the checker
        # collects everything before it complains.
        template = Template(id="t", label="T", groups=[], guides=[])
        assert len(template_problems(template)) >= 1

    def test_a_valid_template_has_no_problems(self):
        template = template_from_dict(
            {
                "id": "t",
                "groups": [{"id": "a", "label": "A"}],
                "guides": [
                    {"id": "l", "group": "a", "label": "L", "mirror": "r"},
                    {"id": "r", "group": "a", "label": "R", "mirror": "l"},
                ],
            }
        )
        assert template_problems(template) == []


class TestLoadingFailures:
    def test_a_missing_file_says_so(self, tmp_path):
        with pytest.raises(TemplateError, match="No template file"):
            load_template(tmp_path / "gone.json")

    def test_malformed_json_names_the_file(self, tmp_path):
        path = tmp_path / "bad.json"
        path.write_text("{not json", encoding="utf-8")
        with pytest.raises(TemplateError, match="not valid JSON"):
            load_template(path)

    def test_unrelated_json_in_the_directory_is_skipped_not_fatal(self, tmp_path):
        (tmp_path / "notes.json").write_text('{"hello": 1}', encoding="utf-8")
        (tmp_path / "t.json").write_text(
            json.dumps(
                {
                    "id": "t",
                    "groups": [{"id": "a", "label": "A"}],
                    "guides": [{"id": "g", "group": "a", "label": "G"}],
                }
            ),
            encoding="utf-8",
        )
        assert set(load_templates(tmp_path)) == {"t"}

    def test_an_empty_directory_gives_an_actionable_error(self, tmp_path):
        # The message has to tell a pip-installed user what to do, since the
        # source-checkout search cannot help them.
        with pytest.raises(TemplateError, match=TEMPLATES_DIR_ENV):
            find_template("biped", tmp_path)

    def test_an_unknown_id_lists_what_is_available(self, tmp_path):
        (tmp_path / "t.json").write_text(
            json.dumps(
                {
                    "id": "t",
                    "groups": [{"id": "a", "label": "A"}],
                    "guides": [{"id": "g", "group": "a", "label": "G"}],
                }
            ),
            encoding="utf-8",
        )
        with pytest.raises(TemplateError, match="Available: t"):
            find_template("nope", tmp_path)

    def test_available_templates_is_empty_rather_than_raising_with_no_location(
        self, monkeypatch
    ):
        monkeypatch.setenv(TEMPLATES_DIR_ENV, "/definitely/not/a/directory")
        assert available_templates() == {}


class TestMissingGuideIds:
    TEMPLATE = template_from_dict(
        {
            "id": "t",
            "groups": [{"id": "a", "label": "A"}],
            "guides": [
                {"id": "first", "group": "a", "label": "First"},
                {"id": "opt", "group": "a", "label": "Opt", "optional": True},
                {"id": "last", "group": "a", "label": "Last"},
            ],
        }
    )

    def test_order_follows_the_template_not_the_document(self):
        # The checklist order is the order the user is asked to work in, so a
        # tool prompting for the next guide needs it preserved.
        assert missing_guide_ids([], self.TEMPLATE) == ["first", "last"]

    def test_optional_guides_are_not_missing(self):
        assert "opt" not in missing_guide_ids([], self.TEMPLATE)
        assert "opt" in missing_guide_ids([], self.TEMPLATE, include_optional=True)

    def test_placed_guides_drop_out(self):
        assert missing_guide_ids(["first"], self.TEMPLATE) == ["last"]

    def test_extra_guides_the_template_does_not_know_are_ignored(self):
        # A document may carry guides from an older template revision. That is
        # not this function's problem, and it must not crash on them.
        assert missing_guide_ids(["first", "last", "mystery"], self.TEMPLATE) == []
