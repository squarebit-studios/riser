"""The CLI, invoked.

A shell-based pipeline reads two things from this program: the exit code and
whatever landed on stdout. Both are the integration surface, so both are tested
by actually running the thing rather than by calling the functions underneath.

The stdout/stderr split matters more than it looks. A Houdini TOP that pipes
`riser resolve --json` into a JSON parser breaks the moment a warning leaks
onto stdout, and it breaks with a parse error a long way from the cause.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from riser_worker.cli import (
    EXIT_BAD_LAYER,
    EXIT_NOT_FOUND,
    EXIT_OK,
    EXIT_TEMPLATE,
    EXIT_USAGE,
    EXIT_VALIDATION_FAILED,
    main,
)

FIXTURE = Path(__file__).parent / "fixtures" / "sample-layer.usda"
TEMPLATES_DIR = Path(__file__).resolve().parents[2] / "src" / "templates"
WORKER_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def _require_fixture():
    if not FIXTURE.exists():
        pytest.skip(
            f"{FIXTURE.name} is missing. Generate it with "
            "`npx vitest run src/doc/fixture.test.ts`."
        )


def run(capsys, *args: str) -> tuple[int, str, str]:
    """Invoke the CLI in-process and hand back (code, stdout, stderr)."""
    code = main(list(args))
    captured = capsys.readouterr()
    return code, captured.out, captured.err


class TestItRunsAsAModule:
    def test_python_m_riser_worker_works(self):
        # The documented invocation for a studio running out of a checkout,
        # and the one thing an in-process test cannot prove.
        result = subprocess.run(
            [sys.executable, "-m", "riser_worker", "inspect", str(FIXTURE)],
            capture_output=True,
            text=True,
            cwd=WORKER_ROOT,
        )
        assert result.returncode == EXIT_OK
        assert "Contract fixture" in result.stdout

    def test_no_subcommand_prints_help_and_fails(self, capsys):
        code, out, _ = run(capsys)
        assert code == EXIT_USAGE
        assert "inspect" in out and "validate" in out


class TestInspect:
    def test_it_summarises_without_touching_geometry(self, capsys):
        code, out, err = run(capsys, "inspect", str(FIXTURE))
        assert code == EXIT_OK
        assert "biped" in out
        assert "biped-blockout.usda" in out
        assert err == ""

    def test_json_reports_sources(self, capsys):
        code, out, _ = run(capsys, "inspect", str(FIXTURE), "--json")
        assert code == EXIT_OK
        payload = json.loads(out)
        assert payload["template_id"] == "biped"
        assert payload["counts"] == {
            "guides": 8,
            "bound_guides": 7,
            "curves": 2,
            "curve_points": 9,
        }
        assert payload["guide_sources"] == {"user": 8}


class TestValidate:
    def test_a_good_layer_with_no_template_passes(self, capsys):
        code, out, _ = run(capsys, "validate", str(FIXTURE))
        assert code == EXIT_OK
        assert "OK" in out

    def test_errors_exit_non_zero(self, capsys, tmp_path):
        # A CI step is only as useful as its exit code.
        broken = tmp_path / "broken.usda"
        broken.write_text(
            FIXTURE.read_text(encoding="utf-8").replace(
                "int riser:guide:faceIndex = 136",
                "int riser:guide:faceIndex = 9999999",
            ),
            encoding="utf-8",
        )
        code, out, _ = run(capsys, "validate", str(broken))
        assert code == EXIT_VALIDATION_FAILED
        assert "FAILED" in out

    def test_json_carries_the_report_and_the_layer(self, capsys):
        code, out, _ = run(capsys, "validate", str(FIXTURE), "--json")
        assert code == EXIT_OK
        payload = json.loads(out)
        assert payload["ok"] is True
        assert set(payload) == {
            "ok",
            "counts",
            "guides",
            "issues",
            "layer",
            "template_id",
        }
        assert payload["template_id"] is None

    @pytest.mark.skipif(not TEMPLATES_DIR.is_dir(), reason="no template checkout")
    def test_template_auto_uses_the_documents_own_id(self, capsys):
        code, out, _ = run(capsys, "validate", str(FIXTURE), "--template", "auto")
        # The fixture places 8 of the biped checklist, so completeness fails.
        # What is being checked here is that "auto" resolved to biped at all.
        assert code == EXIT_VALIDATION_FAILED
        assert "guide-missing" in out

    def test_an_unknown_template_exits_five(self, capsys):
        code, _, err = run(
            capsys, "validate", str(FIXTURE), "--template", "no-such-template"
        )
        assert code == EXIT_TEMPLATE
        assert "riser: error:" in err

    def test_template_dir_can_point_anywhere(self, capsys, tmp_path):
        (tmp_path / "mine.json").write_text(
            json.dumps(
                {
                    "id": "mine",
                    "groups": [{"id": "a", "label": "A"}],
                    "guides": [
                        {"id": "pelvis", "group": "a", "label": "Pelvis"},
                        {"id": "tail", "group": "a", "label": "Tail"},
                    ],
                }
            ),
            encoding="utf-8",
        )
        code, out, _ = run(
            capsys,
            "validate",
            str(FIXTURE),
            "--template",
            "mine",
            "--template-dir",
            str(tmp_path),
            "--json",
        )
        assert code == EXIT_VALIDATION_FAILED
        issues = json.loads(out)["issues"]
        missing = [i["subject"] for i in issues if i["code"] == "guide-missing"]
        assert missing == ["tail"]

    def test_drift_warning_is_tunable(self, capsys):
        # A studio working in centimetres needs a different threshold, and one
        # that cannot be changed is one that gets ignored. Zero is the extreme:
        # it fires on the float32 print rounding the fixture necessarily has,
        # where the default threshold correctly stays quiet about it.
        _, quiet, _ = run(capsys, "validate", str(FIXTURE), "--json")
        code, loud, _ = run(
            capsys, "validate", str(FIXTURE), "--drift-warning", "0.0", "--json"
        )
        assert code == EXIT_OK  # drift is a warning, never an error
        assert "guide-drift" not in {i["code"] for i in json.loads(quiet)["issues"]}
        assert "guide-drift" in {i["code"] for i in json.loads(loud)["issues"]}


class TestResolve:
    def test_human_output_lists_every_guide(self, capsys):
        code, out, _ = run(capsys, "resolve", str(FIXTURE))
        assert code == EXIT_OK
        for guide_id in ("pelvis", "chest", "wristL", "root"):
            assert guide_id in out

    def test_the_unbound_guide_is_labelled(self, capsys):
        _, out, _ = run(capsys, "resolve", str(FIXTURE))
        root_line = next(line for line in out.splitlines() if line.startswith("root "))
        assert "free" in root_line

    def test_json_is_the_documented_shape(self, capsys):
        code, out, _ = run(capsys, "resolve", str(FIXTURE), "--json")
        assert code == EXIT_OK
        payload = json.loads(out)
        assert set(payload) == {"layer", "guides", "curves"}
        assert len(payload["guides"]) == 8
        assert len(payload["curves"]) == 2

        pelvis = next(g for g in payload["guides"] if g["id"] == "pelvis")
        assert pelvis["position"] == pytest.approx(
            [0.2560967, 1.485, -0.0107767], abs=1e-6
        )
        assert pelvis["binding"]["prim_path"] == "/Riser/Character/Geom/Body"
        assert pelvis["resolved"] is True

    def test_guide_filter_selects_and_drops_curves(self, capsys):
        code, out, _ = run(
            capsys, "resolve", str(FIXTURE), "--guide", "pelvis", "--json"
        )
        assert code == EXIT_OK
        payload = json.loads(out)
        assert [g["id"] for g in payload["guides"]] == ["pelvis"]
        assert payload["curves"] == []

    def test_a_guide_that_is_not_there_warns_on_stderr_and_still_succeeds(
        self, capsys
    ):
        # Mid-checklist a requested guide may simply not be placed yet. That is
        # a normal state, so a batch of ids must not fall over on the first gap.
        code, out, err = run(
            capsys, "resolve", str(FIXTURE), "--guide", "nope", "--json"
        )
        assert code == EXIT_OK
        assert "nope" in err
        assert json.loads(out)["guides"] == []

    def test_diagnostics_never_reach_stdout(self, capsys):
        # The property a JSON-consuming pipeline depends on.
        _, out, err = run(capsys, "resolve", str(FIXTURE), "--guide", "nope", "--json")
        json.loads(out)
        assert err != ""


class TestExportJson:
    def test_stdout_is_pure_json(self, capsys):
        code, out, err = run(capsys, "export-json", str(FIXTURE))
        assert code == EXIT_OK
        assert err == ""
        payload = json.loads(out)
        assert set(payload) == {
            "summary",
            "mesh_paths",
            "guides",
            "curves",
            "document",
        }

    def test_it_carries_both_resolved_and_authored_data(self, capsys):
        # The point of export-json: a pipeline with no USD gets the answers AND
        # enough of the original to audit them.
        _, out, _ = run(capsys, "export-json", str(FIXTURE))
        payload = json.loads(out)
        assert len(payload["document"]["guides"]) == 8
        assert payload["document"]["guides"][0]["source"] == "user"
        assert payload["mesh_paths"] == [
            "/Riser/Character/Geom/Body",
            "/Riser/Character/Geom/Head",
        ]

    def test_output_file_keeps_stdout_clean(self, capsys, tmp_path):
        target = tmp_path / "out.json"
        code, out, err = run(capsys, "export-json", str(FIXTURE), "-o", str(target))
        assert code == EXIT_OK
        assert out == ""
        assert str(target) in err
        assert json.loads(target.read_text(encoding="utf-8"))["summary"]

    def test_indent_zero_is_one_line(self, capsys):
        _, out, _ = run(capsys, "export-json", str(FIXTURE), "--indent", "0")
        assert len(out.strip().splitlines()) == 1


class TestExitCodes:
    def test_a_missing_file_is_four(self, capsys, tmp_path):
        code, _, err = run(capsys, "inspect", str(tmp_path / "gone.usda"))
        assert code == EXIT_NOT_FOUND
        assert "no such layer" in err

    def test_a_non_riser_layer_is_three(self, capsys, tmp_path):
        # Distinct from 4 on purpose: "you gave me the wrong file" and "the
        # file you gave me is not a Riser document" want different responses
        # from whatever is driving this.
        path = tmp_path / "other.usda"
        path.write_text(
            '#usda 1.0\n(\n    defaultPrim = "World"\n)\n\ndef Xform "World"\n{\n}\n',
            encoding="utf-8",
        )
        code, _, err = run(capsys, "inspect", str(path))
        assert code == EXIT_BAD_LAYER
        assert "Not a Riser layer" in err

    def test_a_bad_flag_is_two(self):
        # argparse exits the process itself, so this one has to be a subprocess.
        result = subprocess.run(
            [sys.executable, "-m", "riser_worker", "inspect", "--nonsense"],
            capture_output=True,
            text=True,
            cwd=WORKER_ROOT,
        )
        assert result.returncode == EXIT_USAGE
