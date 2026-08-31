"""The authoritative pass: recompute every guide from its binding, and report.

The browser's positions are a hint. They were computed against geometry the
browser had in memory, in float32, possibly against an older build of the
character. This module recomputes each guide from the triangle and barycentric
weights it is bound to, against whatever geometry the reference actually
resolves to, and that recomputed value is what downstream systems use.

Drift between the two is not automatically an error - a document authored
against one build of a mesh and re-run against a denser build SHOULD move -
but it is always worth reporting, because a large drift is the signature of a
document pointed at the wrong asset.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from .document import Curve, Guide, RiserDocument, SurfaceBinding
from .mesh import TriangulatedMesh, Vec3, bounds, evaluate_barycentric


class Severity(str, Enum):
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


@dataclass(frozen=True)
class Issue:
    """One finding. ``code`` is the stable identifier; ``message`` is prose."""

    severity: Severity
    code: str
    message: str
    #: Guide or curve id the issue is about, or "" for whole-document issues.
    subject: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "severity": self.severity.value,
            "code": self.code,
            "message": self.message,
            "subject": self.subject,
        }


@dataclass
class ResolvedGuide:
    """A guide with its position recomputed from real geometry.

    This is what a pipeline should consume. ``position`` is the answer;
    everything else is there so a consumer can decide how much to trust it.
    """

    id: str
    group: str
    #: Position recomputed from the binding - the authoritative value.
    position: Vec3
    #: What the browser stored, kept for comparison.
    authored_position: Vec3
    #: Distance between the two, in stage units.
    drift: float
    #: True when the guide carries a surface binding at all.
    bound: bool
    #: False when a binding exists but names geometry that is not there, in
    #: which case ``position`` falls back to the authored value. A consumer
    #: that ignores this flag will silently use a stale position.
    resolved: bool = True
    #: Surface normal at the pick, for orienting whatever gets built here.
    normal: Vec3 = (0.0, 1.0, 0.0)
    #: Provenance. See ``document.GuideSource``.
    source: str = "user"
    confidence: float = 1.0
    #: The binding itself, for a consumer that wants the prim and triangle.
    binding: SurfaceBinding | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "group": self.group,
            "position": list(self.position),
            "authored_position": list(self.authored_position),
            "normal": list(self.normal),
            "drift": self.drift,
            "bound": self.bound,
            "resolved": self.resolved,
            "source": self.source,
            "confidence": self.confidence,
            "binding": self.binding.to_dict() if self.binding else None,
        }


@dataclass
class ResolvedCurvePoint:
    """One control vertex with its position recomputed from its binding."""

    index: int
    position: Vec3
    authored_position: Vec3
    normal: Vec3
    drift: float
    bound: bool
    resolved: bool = True
    binding: SurfaceBinding | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": self.index,
            "position": list(self.position),
            "authored_position": list(self.authored_position),
            "normal": list(self.normal),
            "drift": self.drift,
            "bound": self.bound,
            "resolved": self.resolved,
            "binding": self.binding.to_dict() if self.binding else None,
        }


@dataclass
class ResolvedCurve:
    """A curve whose control vertices have been recomputed from geometry.

    The control vertices are the authored ones, not a tessellation. Riser
    writes a cubic B-spline ``BasisCurves``; a consumer that needs points along
    the curve rather than its hull evaluates that basis itself.
    """

    id: str
    group: str
    closed: bool
    width: float
    points: list[ResolvedCurvePoint] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "group": self.group,
            "closed": self.closed,
            "width": self.width,
            "points": [p.to_dict() for p in self.points],
        }


@dataclass
class ValidationReport:
    guides: list[ResolvedGuide] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not any(i.severity is Severity.ERROR for i in self.issues)

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.severity is Severity.ERROR]

    @property
    def warnings(self) -> list[Issue]:
        return [i for i in self.issues if i.severity is Severity.WARNING]

    def add(self, severity: Severity, code: str, message: str, subject: str = "") -> None:
        self.issues.append(Issue(severity, code, message, subject))

    def to_dict(self) -> dict[str, Any]:
        """The report as plain JSON-safe data. This shape is a contract."""
        return {
            "ok": self.ok,
            "counts": {
                "errors": len(self.errors),
                "warnings": len(self.warnings),
                "guides": len(self.guides),
            },
            "guides": [g.to_dict() for g in self.guides],
            "issues": [i.to_dict() for i in self.issues],
        }


def resolve_binding(
    binding: SurfaceBinding, meshes: dict[str, TriangulatedMesh]
) -> Vec3 | None:
    """Recompute a bound position from real geometry, or None if it cannot be."""
    mesh = meshes.get(binding.prim_path)
    if mesh is None:
        return None
    if binding.face_index < 0 or binding.face_index >= mesh.triangle_count:
        return None

    a, b, c = mesh.triangle_points(binding.face_index)
    point = evaluate_barycentric(a, b, c, binding.barycentric)
    return (
        point[0] + binding.offset[0],
        point[1] + binding.offset[1],
        point[2] + binding.offset[2],
    )


def _distance(a: Vec3, b: Vec3) -> float:
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) ** 0.5


def _resolve_guide(guide: Guide, meshes: dict[str, TriangulatedMesh]) -> ResolvedGuide:
    """Turn one authored guide into a resolved one.

    Kept separate from ``validate`` so that resolving and reporting share a
    single piece of arithmetic. Two implementations of this would eventually
    disagree, and the disagreement would show up as markers in the wrong place
    rather than as a failing test.
    """
    common = {
        "id": guide.id,
        "group": guide.group,
        "authored_position": guide.position,
        "normal": guide.normal,
        "source": guide.source,
        "confidence": guide.confidence,
        "binding": guide.binding,
    }

    if guide.binding is None:
        return ResolvedGuide(
            position=guide.position, drift=0.0, bound=False, resolved=True, **common
        )

    resolved = resolve_binding(guide.binding, meshes)
    if resolved is None:
        # Fall back to the authored position rather than dropping the guide.
        # A consumer that checks `resolved` gets to decide; one that does not
        # at least still gets the marker in roughly the right place.
        return ResolvedGuide(
            position=guide.position, drift=0.0, bound=True, resolved=False, **common
        )

    return ResolvedGuide(
        position=resolved,
        drift=_distance(resolved, guide.position),
        bound=True,
        resolved=True,
        **common,
    )


def _resolve_curve(curve: Curve, meshes: dict[str, TriangulatedMesh]) -> ResolvedCurve:
    points: list[ResolvedCurvePoint] = []
    for index, point in enumerate(curve.points):
        resolved = (
            resolve_binding(point.binding, meshes) if point.binding is not None else None
        )
        points.append(
            ResolvedCurvePoint(
                index=index,
                position=resolved if resolved is not None else point.position,
                authored_position=point.position,
                normal=point.normal,
                drift=_distance(resolved, point.position) if resolved else 0.0,
                bound=point.binding is not None,
                resolved=point.binding is None or resolved is not None,
                binding=point.binding,
            )
        )
    return ResolvedCurve(
        id=curve.id,
        group=curve.group,
        closed=curve.closed,
        width=curve.width,
        points=points,
    )


def resolve_guides(
    doc: RiserDocument, meshes: dict[str, TriangulatedMesh]
) -> list[ResolvedGuide]:
    """Every guide in the document, with its position recomputed.

    Unlike ``validate``, this returns a row for every guide including ones
    whose binding no longer resolves. A pipeline that is exporting positions
    needs to see the whole checklist, flagged, rather than a silently shorter
    list.
    """
    return [_resolve_guide(g, meshes) for g in doc.guides]


def resolve_curves(
    doc: RiserDocument, meshes: dict[str, TriangulatedMesh]
) -> list[ResolvedCurve]:
    """Every curve, with each control vertex recomputed from its binding."""
    return [_resolve_curve(c, meshes) for c in doc.curves]


def validate(
    doc: RiserDocument,
    meshes: dict[str, TriangulatedMesh],
    required_guide_ids: set[str] | None = None,
    *,
    drift_warning: float = 0.01,
) -> ValidationReport:
    """Check a document against the geometry it references.

    ``drift_warning`` is in stage units and defaults to a centimetre on a
    metre-scale character - large enough not to fire on float32 rounding, small
    enough to catch a document aimed at the wrong asset.
    """
    report = ValidationReport()

    if not meshes:
        report.add(
            Severity.ERROR,
            "no-geometry",
            "The character reference resolved to no usable meshes. Either the "
            "asset is missing, or every mesh in it uses faces Riser cannot "
            "index compatibly (n-gons with more than four sides).",
        )

    all_points = [p for mesh in meshes.values() for p in mesh.points]
    mesh_bounds = bounds(all_points)

    for guide in doc.guides:
        _validate_guide(guide, meshes, mesh_bounds, report, drift_warning)

    for curve in doc.curves:
        if len(curve.points) < 2:
            report.add(
                Severity.WARNING,
                "curve-too-short",
                f"Curve '{curve.id}' has {len(curve.points)} control "
                "vertices; at least two are needed to define a curve.",
                curve.id,
            )
        unbound = sum(1 for p in curve.points if p.binding is None)
        if unbound:
            report.add(
                Severity.WARNING,
                "curve-unbound-points",
                f"Curve '{curve.id}' has {unbound} of {len(curve.points)} control "
                "vertices not bound to the surface; those will be taken at their "
                "stored positions.",
                curve.id,
            )
        for index, point in enumerate(curve.points):
            if point.binding is None:
                continue
            if resolve_binding(point.binding, meshes) is None:
                report.add(
                    Severity.ERROR,
                    "curve-binding-unresolved",
                    f"Curve '{curve.id}' control vertex {index} is bound to "
                    f"{point.binding.prim_path} face {point.binding.face_index}, "
                    "which does not exist in the referenced geometry.",
                    curve.id,
                )

    if required_guide_ids:
        placed = {g.id for g in doc.guides}
        for missing in sorted(required_guide_ids - placed):
            report.add(
                Severity.ERROR,
                "guide-missing",
                f"Required guide '{missing}' has not been placed.",
                missing,
            )

    return report


def _validate_guide(
    guide: Guide,
    meshes: dict[str, TriangulatedMesh],
    mesh_bounds: tuple[Vec3, Vec3] | None,
    report: ValidationReport,
    drift_warning: float,
) -> None:
    entry = _resolve_guide(guide, meshes)

    if not entry.bound:
        report.add(
            Severity.INFO,
            "guide-unbound",
            f"Guide '{guide.id}' was placed free in space, so its position is "
            "taken as authored rather than recomputed.",
            guide.id,
        )
        report.guides.append(entry)
        return

    if not entry.resolved:
        assert guide.binding is not None
        mesh = meshes.get(guide.binding.prim_path)
        detail = (
            f"prim {guide.binding.prim_path} is not in the referenced asset"
            if mesh is None
            else (
                f"face {guide.binding.face_index} is out of range "
                f"({mesh.prim_path} has {mesh.triangle_count} triangles)"
            )
        )
        report.add(
            Severity.ERROR,
            "guide-binding-unresolved",
            f"Guide '{guide.id}' cannot be resolved: {detail}.",
            guide.id,
        )
        # Deliberately not appended: the report's guide list is the set of
        # positions a caller may act on, and this one has no trustworthy
        # position. resolve_guides() is where you go for the full roster.
        return

    resolved = entry.position
    drift = entry.drift
    if drift > drift_warning:
        report.add(
            Severity.WARNING,
            "guide-drift",
            f"Guide '{guide.id}' recomputes {drift:.4f} units away from its "
            "authored position. That is expected after a mesh change, and "
            "suspicious otherwise.",
            guide.id,
        )

    if mesh_bounds is not None and not _within(resolved, mesh_bounds, margin=0.5):
        report.add(
            Severity.WARNING,
            "guide-out-of-bounds",
            f"Guide '{guide.id}' resolves well outside the character's bounds.",
            guide.id,
        )

    report.guides.append(entry)


def _within(point: Vec3, box: tuple[Vec3, Vec3], margin: float) -> bool:
    lo, hi = box
    size = max(hi[i] - lo[i] for i in range(3))
    slack = size * margin
    return all(lo[i] - slack <= point[i] <= hi[i] + slack for i in range(3))
