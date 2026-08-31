"""Triangulating USD meshes exactly the way the browser does.

Riser bindings name a TRIANGLE index. The browser gets that index from
three.js, which triangulates a ``UsdGeomMesh`` on load; this module has to
reproduce the same triangulation, or the server evaluates the binding on a
different triangle and every marker moves.

three's rule (USDComposer.js ``_triangulateIndicesWithPattern``) is:

    3 vertices   one triangle, unchanged
    4 vertices   a fan from the first corner: (0,1,2), (0,2,3)
    5 or more    EAR CLIPPING over the actual vertex positions

The first two are exactly reproducible and cover essentially every character
mesh in practice, since DCC exports are quads or triangles. The third is not
reproducible without reimplementing three's ear clipper bit for bit - and a
subtly different clipper is worse than no clipper, because it fails silently
on a handful of faces rather than loudly on all of them.

So this module refuses n-gons instead of guessing, and the pipeline is expected
to triangulate uploads on the way in. ``MeshTriangulationError`` names the
offending prim so the validation report can tell the user which mesh to fix.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

Vec3 = tuple[float, float, float]

# Faces with more corners than this cannot be triangulated compatibly.
MAX_SUPPORTED_FACE_SIZE = 4


class MeshTriangulationError(ValueError):
    """A mesh cannot be triangulated the same way the browser triangulated it."""


@dataclass(frozen=True)
class TriangulatedMesh:
    """A USD mesh flattened to triangles, in the browser's triangle order."""

    prim_path: str
    points: list[Vec3]
    #: Three point indices per triangle, in the same order three.js produced.
    triangles: list[tuple[int, int, int]]

    @property
    def triangle_count(self) -> int:
        return len(self.triangles)

    def triangle_points(self, face_index: int) -> tuple[Vec3, Vec3, Vec3]:
        if face_index < 0 or face_index >= len(self.triangles):
            raise IndexError(
                f"{self.prim_path}: triangle {face_index} out of range "
                f"(mesh has {len(self.triangles)})"
            )
        a, b, c = self.triangles[face_index]
        return self.points[a], self.points[b], self.points[c]


def triangulate(
    prim_path: str,
    points: Sequence[Vec3],
    face_vertex_counts: Sequence[int],
    face_vertex_indices: Sequence[int],
) -> TriangulatedMesh:
    """Flatten a USD mesh's faces into triangles in three.js's order."""
    triangles: list[tuple[int, int, int]] = []
    offset = 0

    for face_number, count in enumerate(face_vertex_counts):
        if count < 3:
            raise MeshTriangulationError(
                f"{prim_path}: face {face_number} has {count} vertices"
            )
        if count > MAX_SUPPORTED_FACE_SIZE:
            raise MeshTriangulationError(
                f"{prim_path}: face {face_number} is an {count}-gon. Riser can only "
                "guarantee triangle indices for triangles and quads - triangulate "
                "this mesh before authoring guides against it."
            )

        if offset + count > len(face_vertex_indices):
            raise MeshTriangulationError(
                f"{prim_path}: faceVertexIndices is shorter than faceVertexCounts "
                "implies"
            )

        corners = tuple(face_vertex_indices[offset : offset + count])
        if count == 3:
            triangles.append((corners[0], corners[1], corners[2]))
        else:
            # Fan from the first corner, matching USDComposer.js.
            triangles.append((corners[0], corners[1], corners[2]))
            triangles.append((corners[0], corners[2], corners[3]))

        offset += count

    return TriangulatedMesh(
        prim_path=prim_path, points=list(points), triangles=triangles
    )


def evaluate_barycentric(
    a: Vec3, b: Vec3, c: Vec3, barycentric: Sequence[float]
) -> Vec3:
    """Point inside a triangle from its barycentric weights.

    The exact counterpart of ``evaluateBinding`` in src/viewport/Picker.ts.
    """
    u, v, w = barycentric[0], barycentric[1], barycentric[2]
    return (
        a[0] * u + b[0] * v + c[0] * w,
        a[1] * u + b[1] * v + c[1] * w,
        a[2] * u + b[2] * v + c[2] * w,
    )


def triangle_normal(a: Vec3, b: Vec3, c: Vec3) -> Vec3 | None:
    """Unit geometric normal, or None for a degenerate triangle."""
    ab = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    ac = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
    n = (
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
    )
    length = (n[0] ** 2 + n[1] ** 2 + n[2] ** 2) ** 0.5
    if length < 1e-12:
        return None
    return (n[0] / length, n[1] / length, n[2] / length)


def bounds(points: Iterable[Vec3]) -> tuple[Vec3, Vec3] | None:
    """Axis-aligned bounds of a point set, or None if it is empty."""
    lo: list[float] | None = None
    hi: list[float] | None = None
    for p in points:
        if lo is None or hi is None:
            lo, hi = [p[0], p[1], p[2]], [p[0], p[1], p[2]]
            continue
        for i in range(3):
            if p[i] < lo[i]:
                lo[i] = p[i]
            if p[i] > hi[i]:
                hi[i] = p[i]
    if lo is None or hi is None:
        return None
    return (lo[0], lo[1], lo[2]), (hi[0], hi[1], hi[2])
