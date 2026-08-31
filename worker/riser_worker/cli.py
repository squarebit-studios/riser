"""``riser`` - the command line surface.

For a pipeline that shells out rather than importing Python. Every subcommand
takes a layer path, writes its result to stdout and its complaints to stderr,
and exits with a code that means something. That separation is the point: a
Houdini TOP or a shell script can capture stdout as data without filtering
warnings out of it.

``--json`` is the actual integration surface. The human output is allowed to be
rearranged for readability; the JSON is a contract, and keys are added over
time rather than renamed or removed.

Run it as ``riser <command>`` once installed, or ``python -m riser_worker
<command>`` from a checkout.

Exit codes
----------

0   success, and for ``validate`` no errors were reported
1   validation reported at least one error
2   usage error (argparse's own code: bad flag, missing argument)
3   the file is not a Riser layer, or OpenUSD could not open it
4   the layer file does not exist
5   the template could not be found or is invalid
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any, TextIO

from . import __version__
from .api import RiserLayer
from .document import RiserLayerError
from .templates import TemplateError, find_template
from .validate import ResolvedGuide, Severity, ValidationReport

EXIT_OK = 0
EXIT_VALIDATION_FAILED = 1
EXIT_USAGE = 2
EXIT_BAD_LAYER = 3
EXIT_NOT_FOUND = 4
EXIT_TEMPLATE = 5


def main(argv: Sequence[str] | None = None) -> int:
    """Entry point. Returns the process exit code rather than calling exit().

    Returning lets the tests call it directly, which is the only way to assert
    on exit codes and captured output without spawning a subprocess per case.
    """
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return EXIT_USAGE

    handler = {
        "inspect": _cmd_inspect,
        "validate": _cmd_validate,
        "resolve": _cmd_resolve,
        "export-json": _cmd_export_json,
    }[args.command]

    try:
        return handler(args)
    except FileNotFoundError as err:
        _fail(f"{err}")
        return EXIT_NOT_FOUND
    except TemplateError as err:
        _fail(str(err))
        return EXIT_TEMPLATE
    except RiserLayerError as err:
        _fail(str(err))
        return EXIT_BAD_LAYER
    except BrokenPipeError:
        # `riser resolve big.usda | head` closes the pipe early. That is the
        # caller getting what it asked for, not a failure of ours.
        return EXIT_OK


# -------------------------------------------------------------------------
# Argument parsing
# -------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="riser",
        description=(
            "Read, check and export Riser USD layers. Positions printed here "
            "are recomputed from each guide's surface binding against the "
            "geometry the layer references, not read back from the file."
        ),
        epilog=(
            "Exit codes: 0 ok, 1 validation errors, 2 usage, 3 bad layer, "
            "4 file not found, 5 template problem."
        ),
    )
    parser.add_argument("--version", action="version", version=f"riser {__version__}")
    subs = parser.add_subparsers(dest="command", metavar="<command>")

    def layer_arg(sub: argparse.ArgumentParser) -> None:
        sub.add_argument("layer", type=Path, help="Path to a Riser .usda/.usdc layer.")

    def json_arg(sub: argparse.ArgumentParser) -> None:
        sub.add_argument(
            "--json",
            action="store_true",
            help="Emit machine-readable JSON on stdout instead of a table.",
        )

    inspect = subs.add_parser(
        "inspect",
        help="Summarise a layer: template, character reference, counts, sources.",
        description=(
            "Metadata and counts only. Does not open the referenced geometry, "
            "so it stays fast on a dense character and works even when the "
            "asset is missing."
        ),
    )
    layer_arg(inspect)
    json_arg(inspect)

    validate_cmd = subs.add_parser(
        "validate",
        help="Check bindings and completeness. Exits 1 if anything is an error.",
        description=(
            "Recomputes every binding against real geometry and reports what "
            "does not hold up. Pass --template to also require that the "
            "checklist is complete."
        ),
    )
    layer_arg(validate_cmd)
    json_arg(validate_cmd)
    validate_cmd.add_argument(
        "--template",
        metavar="ID_OR_PATH",
        help=(
            "Template to check completeness against, by id or by path to its "
            "JSON. Use 'auto' to take the id the document was authored with."
        ),
    )
    validate_cmd.add_argument(
        "--template-dir",
        type=Path,
        metavar="DIR",
        help="Directory of template JSON files. Overrides $RISER_TEMPLATES_DIR.",
    )
    validate_cmd.add_argument(
        "--include-optional",
        action="store_true",
        help="Treat optional template guides as required too.",
    )
    validate_cmd.add_argument(
        "--drift-warning",
        type=float,
        default=0.01,
        metavar="UNITS",
        help=(
            "Warn when a guide recomputes further than this from its authored "
            "position, in stage units (default: 0.01)."
        ),
    )

    resolve = subs.add_parser(
        "resolve",
        help="Print resolved guide and curve positions.",
        description=(
            "The authoritative positions: evaluate(binding) + offset, computed "
            "against the geometry the character reference resolves to."
        ),
    )
    layer_arg(resolve)
    json_arg(resolve)
    resolve.add_argument(
        "--guide",
        action="append",
        metavar="ID",
        help="Only this guide. Repeatable. Curves are omitted when it is used.",
    )

    export = subs.add_parser(
        "export-json",
        help="The whole document as JSON, for a pipeline that has no USD.",
        description=(
            "Everything: metadata, resolved guides and curves, and the raw "
            "authored document. Enough to drive a rig build without linking "
            "OpenUSD."
        ),
    )
    layer_arg(export)
    export.add_argument(
        "-o",
        "--output",
        type=Path,
        metavar="FILE",
        help="Write here instead of stdout.",
    )
    export.add_argument(
        "--indent",
        type=int,
        default=2,
        metavar="N",
        help="JSON indent; 0 for one dense line (default: 2).",
    )

    return parser


# -------------------------------------------------------------------------
# Commands
# -------------------------------------------------------------------------


def _cmd_inspect(args: argparse.Namespace) -> int:
    layer = _open(args.layer)
    summary = layer.summary()

    if args.json:
        _emit_json(summary)
        return EXIT_OK

    counts = summary["counts"]
    _print(f"{summary['name']}  ({args.layer})")
    _print(f"  document version   {summary['doc_version'] or '(unset)'}")
    _print(f"  template           {summary['template_id'] or '(unset)'}")
    _print(f"  character          {summary['character_ref'] or '(none)'}")
    _print(
        f"  stage              up {summary['up_axis']}, "
        f"{summary['meters_per_unit']} m per unit"
    )
    _print(
        f"  guides             {counts['guides']} "
        f"({counts['bound_guides']} bound to the surface)"
    )
    _print(
        f"  curves             {counts['curves']} "
        f"({counts['curve_points']} control vertices)"
    )
    if summary["guide_sources"]:
        parts = ", ".join(f"{k} {v}" for k, v in summary["guide_sources"].items())
        _print(f"  guide sources      {parts}")
    return EXIT_OK


def _cmd_validate(args: argparse.Namespace) -> int:
    layer = _open(args.layer)
    template = _template_for(layer, args.template, args.template_dir)

    report = layer.validate(
        template,
        drift_warning=args.drift_warning,
        include_optional=args.include_optional,
    )

    if args.json:
        payload = report.to_dict()
        payload["layer"] = layer.summary()
        payload["template_id"] = template.id if template is not None else None
        _emit_json(payload)
    else:
        _print_report(report, layer)

    return EXIT_OK if report.ok else EXIT_VALIDATION_FAILED


def _cmd_resolve(args: argparse.Namespace) -> int:
    layer = _open(args.layer)

    guides = layer.guides()
    if args.guide:
        wanted = set(args.guide)
        guides = [g for g in guides if g.id in wanted]
        missing = sorted(wanted - {g.id for g in guides})
        for guide_id in missing:
            # A warning rather than an error: asking for a guide the artist has
            # not placed yet is a normal state mid-checklist, and a pipeline
            # that batches ids should not fall over on the first gap.
            _warn(f"no guide '{guide_id}' in this document")

    curves = [] if args.guide else layer.curves()

    if args.json:
        _emit_json(
            {
                "layer": layer.summary(),
                "guides": [g.to_dict() for g in guides],
                "curves": [c.to_dict() for c in curves],
            }
        )
        return EXIT_OK

    for guide in guides:
        _print(_guide_line(guide))
    for curve in curves:
        state = "closed" if curve.closed else "open"
        _print(f"{curve.id}  ({curve.group}, {state}, {len(curve.points)} cvs)")
        for point in curve.points:
            flag = "" if point.resolved else "  UNRESOLVED"
            _print(f"    [{point.index}]  {_vec(point.position)}{flag}")
    return EXIT_OK


def _cmd_export_json(args: argparse.Namespace) -> int:
    layer = _open(args.layer)
    text = json.dumps(layer.to_dict(), indent=args.indent or None)

    if args.output:
        args.output.write_text(text + "\n", encoding="utf-8")
        _warn(f"wrote {args.output}")
    else:
        _print(text)
    return EXIT_OK


# -------------------------------------------------------------------------
# Helpers
# -------------------------------------------------------------------------


def _open(path: Path) -> RiserLayer:
    # Checked here rather than left to OpenUSD, which reports a missing file
    # and a malformed one the same way, and those deserve different exit codes.
    if not path.exists():
        raise FileNotFoundError(f"no such layer: {path}")
    return RiserLayer.open(path)


def _template_for(
    layer: RiserLayer, requested: str | None, directory: Path | None
) -> Any:
    """Resolve --template, where 'auto' means the document's own template id."""
    if requested is None:
        return None
    if requested == "auto":
        template_id = layer.document.template_id
        if not template_id:
            raise TemplateError(
                "--template auto was given but the layer declares no "
                "riser:template. Name a template explicitly."
            )
        return find_template(template_id, directory)
    return find_template(requested, directory)


def _guide_line(guide: ResolvedGuide) -> str:
    if not guide.bound:
        state = "free"
    elif not guide.resolved:
        state = "UNRESOLVED"
    else:
        state = "bound"
    return (
        f"{guide.id:<20} {_vec(guide.position)}  {state:<10} "
        f"{guide.source:<12} {guide.group}"
    )


def _vec(v: Sequence[float]) -> str:
    return f"({v[0]:>11.6f}, {v[1]:>11.6f}, {v[2]:>11.6f})"


def _print_report(report: ValidationReport, layer: RiserLayer) -> None:
    summary = layer.summary()
    _print(f"{summary['name']}  [{summary['template_id'] or 'no template'}]")
    _print(
        f"  {len(report.guides)} of {summary['counts']['guides']} guides resolved "
        f"against {len(layer.mesh_paths)} mesh(es)"
    )

    # Missing guides are not listed separately here: validate() already raised
    # one issue per missing guide, and printing the same facts twice is how a
    # validator teaches people to skim past its output.
    order = {Severity.ERROR: 0, Severity.WARNING: 1, Severity.INFO: 2}
    for issue in sorted(report.issues, key=lambda i: order[i.severity]):
        _print(f"  {issue.severity.value:<8} {issue.code:<26} {issue.message}")

    worst = max((g.drift for g in report.guides), default=0.0)
    _print(f"  worst drift {worst:.6f} units")
    _print(
        "  OK"
        if report.ok
        else f"  FAILED with {len(report.errors)} error(s)"
    )


def _emit_json(payload: dict[str, Any]) -> None:
    json.dump(payload, sys.stdout, indent=2)
    sys.stdout.write("\n")


def _print(text: str, stream: TextIO | None = None) -> None:
    print(text, file=stream or sys.stdout)


def _warn(text: str) -> None:
    """Diagnostics go to stderr so --json stdout stays parseable."""
    print(f"riser: {text}", file=sys.stderr)


def _fail(text: str) -> None:
    print(f"riser: error: {text}", file=sys.stderr)
