"""Templates: what a document is supposed to contain.

A template is the checklist the user was working from - which guides and curves
a biped, a quadruped or a face needs, in what order, and which of them are
optional. The worker needs it for exactly one question: given this document,
what is still missing?

Templates are JSON data rather than code, so a studio can add a rig type by
writing a file. They are the same files the browser bundles
(``src/templates/*.json``), read here rather than copied, because a second copy
would drift from the first and the drift would show up as a checklist that can
never be satisfied.

Where they are found, in order:

1. an explicit directory passed to ``load_templates`` or ``find_template``,
2. ``$RISER_TEMPLATES_DIR``,
3. ``src/templates`` in an enclosing Riser checkout.

Step 3 only works from a source checkout. A studio that has pip-installed the
worker on its own should set the environment variable or pass the directory,
and ``TemplateError`` says so rather than pretending no templates exist.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

TEMPLATES_DIR_ENV = "RISER_TEMPLATES_DIR"


class TemplateError(ValueError):
    """A template is missing, unreadable, or violates its own invariants."""


@dataclass(frozen=True)
class TemplateGroup:
    """A checklist heading. Grouping only; nothing downstream depends on it."""

    id: str
    label: str


@dataclass(frozen=True)
class GuideDef:
    """One entry in a template's guide checklist."""

    id: str
    group: str
    label: str
    hint: str = ""
    #: An optional guide never makes a document invalid by its absence.
    optional: bool = False
    #: Id of the mirrored counterpart, e.g. wristL <-> wristR.
    mirror: str | None = None
    #: True for guides that belong inside the volume rather than on the skin -
    #: joint centres. Such a guide normally carries a non-zero binding offset.
    interior: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "group": self.group,
            "label": self.label,
            "hint": self.hint,
            "optional": self.optional,
            "mirror": self.mirror,
            "interior": self.interior,
        }


@dataclass(frozen=True)
class CurveDef:
    """One entry in a template's curve checklist."""

    id: str
    group: str
    label: str
    hint: str = ""
    optional: bool = False
    mirror: str | None = None
    closed: bool = False
    #: A suggestion shown in the UI. The user is not held to it, so do not
    #: treat a different control vertex count as an error.
    suggested_points: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "group": self.group,
            "label": self.label,
            "hint": self.hint,
            "optional": self.optional,
            "mirror": self.mirror,
            "closed": self.closed,
            "suggested_points": self.suggested_points,
        }


@dataclass(frozen=True)
class Template:
    """A named rig layout: what the user is asked to place, and in what order."""

    id: str
    label: str
    description: str = ""
    groups: list[TemplateGroup] = field(default_factory=list)
    guides: list[GuideDef] = field(default_factory=list)
    curves: list[CurveDef] = field(default_factory=list)

    def guide(self, guide_id: str) -> GuideDef | None:
        return next((g for g in self.guides if g.id == guide_id), None)

    def curve(self, curve_id: str) -> CurveDef | None:
        return next((c for c in self.curves if c.id == curve_id), None)

    def guide_ids(self, *, include_optional: bool = True) -> list[str]:
        """Checklist ids in template order, which is the order to place them in."""
        return [g.id for g in self.guides if include_optional or not g.optional]

    def required_guide_ids(self) -> list[str]:
        return self.guide_ids(include_optional=False)

    def curve_ids(self, *, include_optional: bool = True) -> list[str]:
        return [c.id for c in self.curves if include_optional or not c.optional]

    def required_curve_ids(self) -> list[str]:
        return self.curve_ids(include_optional=False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "description": self.description,
            "groups": [{"id": g.id, "label": g.label} for g in self.groups],
            "guides": [g.to_dict() for g in self.guides],
            "curves": [c.to_dict() for c in self.curves],
        }


def template_problems(template: Template) -> list[str]:
    """Invariants a consumer relies on, checked at load time.

    A broken template does not fail loudly on its own. It fails much later, as
    a checklist entry that can never be satisfied or a mirror that resolves to
    nothing, and by then the cause is a long way from the symptom.
    """
    problems: list[str] = []
    group_ids = {g.id for g in template.groups}

    for kind, items in (("guide", template.guides), ("curve", template.curves)):
        seen: dict[str, Any] = {}
        for item in items:
            if item.id in seen:
                problems.append(f'duplicate {kind} id "{item.id}"')
            seen[item.id] = item
            if item.group not in group_ids:
                problems.append(
                    f'{kind} "{item.id}" is in unknown group "{item.group}"'
                )
        for item in items:
            if not item.mirror:
                continue
            partner = seen.get(item.mirror)
            if partner is None:
                problems.append(f'{kind} "{item.id}" mirrors unknown "{item.mirror}"')
            elif partner.mirror != item.id:
                # A one-way mirror is the interesting case: symmetry places the
                # partner but the partner does not place back, which reads to a
                # user as a random failure rather than a data error.
                problems.append(
                    f'{kind} "{item.id}" mirrors "{item.mirror}", '
                    f'but it mirrors "{partner.mirror or "nothing"}"'
                )

    if not template.guides:
        problems.append("template has no guides")
    return problems


def template_from_dict(data: dict[str, Any]) -> Template:
    """Build a template from already-parsed JSON, validating it.

    Field names are the browser's camelCase, because these are the browser's
    files. Only ``suggestedPoints`` differs from Python convention, and it is
    renamed here rather than leaking into the dataclass.
    """
    if not isinstance(data, dict) or "id" not in data:
        raise TemplateError("Template JSON must be an object with an 'id'.")

    template = Template(
        id=str(data["id"]),
        label=str(data.get("label", data["id"])),
        description=str(data.get("description", "")),
        groups=[
            TemplateGroup(id=str(g["id"]), label=str(g.get("label", g["id"])))
            for g in data.get("groups", [])
        ],
        guides=[
            GuideDef(
                id=str(g["id"]),
                group=str(g.get("group", "")),
                label=str(g.get("label", g["id"])),
                hint=str(g.get("hint", "")),
                optional=bool(g.get("optional", False)),
                mirror=g.get("mirror"),
                interior=bool(g.get("interior", False)),
            )
            for g in data.get("guides", [])
        ],
        curves=[
            CurveDef(
                id=str(c["id"]),
                group=str(c.get("group", "")),
                label=str(c.get("label", c["id"])),
                hint=str(c.get("hint", "")),
                optional=bool(c.get("optional", False)),
                mirror=c.get("mirror"),
                closed=bool(c.get("closed", False)),
                suggested_points=c.get("suggestedPoints"),
            )
            for c in data.get("curves", [])
        ],
    )

    problems = template_problems(template)
    if problems:
        raise TemplateError(
            f'Template "{template.id}" is invalid:\n  ' + "\n  ".join(problems)
        )
    return template


def load_template(path: str | Path) -> Template:
    """Read one template JSON file."""
    path = Path(path)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as err:
        raise TemplateError(f"No template file at {path}") from err
    except json.JSONDecodeError as err:
        raise TemplateError(f"{path} is not valid JSON: {err}") from err
    return template_from_dict(data)


def load_templates(directory: str | Path) -> dict[str, Template]:
    """Every ``*.json`` in a directory, keyed by template id.

    Files that are not templates are skipped rather than fatal, so a directory
    that also holds unrelated JSON still works.
    """
    directory = Path(directory)
    if not directory.is_dir():
        raise TemplateError(f"{directory} is not a directory")

    templates: dict[str, Template] = {}
    for path in sorted(directory.glob("*.json")):
        try:
            template = load_template(path)
        except TemplateError:
            continue
        templates[template.id] = template
    return templates


def default_templates_dir() -> Path | None:
    """Where templates live when the caller did not say, or None if unknown."""
    from_env = os.environ.get(TEMPLATES_DIR_ENV)
    if from_env:
        candidate = Path(from_env)
        return candidate if candidate.is_dir() else None

    # Walk up out of worker/riser_worker looking for a Riser checkout. Cheap,
    # and it means the CLI works with no configuration in the repo.
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "src" / "templates"
        if (candidate / "biped.json").is_file():
            return candidate
    return None


def available_templates(directory: str | Path | None = None) -> dict[str, Template]:
    """Templates from ``directory``, or from the default location."""
    resolved = Path(directory) if directory is not None else default_templates_dir()
    if resolved is None:
        return {}
    return load_templates(resolved)


def find_template(
    id_or_path: str | Path, directory: str | Path | None = None
) -> Template:
    """Resolve a template by id or by path.

    Accepting both means a caller never has to care which it has: a CLI flag,
    a value read out of ``document.template_id``, or a studio's own file all go
    through the same call.
    """
    candidate = Path(id_or_path)
    if candidate.suffix == ".json" or candidate.is_file():
        return load_template(candidate)

    templates = available_templates(directory)
    if not templates:
        where = directory or os.environ.get(TEMPLATES_DIR_ENV) or "the default location"
        raise TemplateError(
            f"No templates found in {where}. Point at a directory of template "
            f"JSON files with ${TEMPLATES_DIR_ENV}, or pass a path to one."
        )
    template = templates.get(str(id_or_path))
    if template is None:
        raise TemplateError(
            f'Unknown template "{id_or_path}". '
            f"Available: {', '.join(sorted(templates))}"
        )
    return template


def missing_guide_ids(
    placed: Iterable[str], template: Template, *, include_optional: bool = False
) -> list[str]:
    """Checklist ids not present in ``placed``, in template order.

    Optional guides are excluded by default: their absence is a choice, not an
    omission, and reporting them would make every finished document look
    incomplete.
    """
    have = set(placed)
    return [
        g.id
        for g in template.guides
        if (include_optional or not g.optional) and g.id not in have
    ]
