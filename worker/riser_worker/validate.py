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

from .document import Guide, RiserDocument, SurfaceBinding
from .mesh import TriangulatedMesh, Vec3, bounds, evaluate_barycentric


class Severity(str, Enum):
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


@dataclass(frozen=True)
class Issue:
    severity: Severity
    code: str
    message: str
    subject: str = ""


@dataclass
class ResolvedGuide:
    id: str
    group: str
    #: Position recomputed from the binding - the authoritative value.
    position: Vec3
    #: What the browser stored, kept for comparison.
    authored_position: Vec3
    #: Distance between the two, in stage units.
    drift: float
    bound: bool


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
    if guide.binding is None:
        report.add(
            Severity.INFO,
            "guide-unbound",
            f"Guide '{guide.id}' was placed free in space, so its position is "
            "taken as authored rather than recomputed.",
            guide.id,
        )
        report.guides.append(
            ResolvedGuide(
                id=guide.id,
                group=guide.group,
                position=guide.position,
                authored_position=guide.position,
                drift=0.0,
                bound=False,
            )
        )
        return

    resolved = resolve_binding(guide.binding, meshes)
    if resolved is None:
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
        return

    drift = _distance(resolved, guide.position)
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

    report.guides.append(
        ResolvedGuide(
            id=guide.id,
            group=guide.group,
            position=resolved,
            authored_position=guide.position,
            drift=drift,
            bound=True,
        )
    )


def _within(point: Vec3, box: tuple[Vec3, Vec3], margin: float) -> bool:
    lo, hi = box
    size = max(hi[i] - lo[i] for i in range(3))
    slack = size * margin
    return all(lo[i] - slack <= point[i] <= hi[i] + slack for i in range(3))
