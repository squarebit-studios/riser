"""Triangulation must match three.js exactly, or every binding is wrong."""

from __future__ import annotations

import pytest

from riser_worker.mesh import (
    MeshTriangulationError,
    bounds,
    evaluate_barycentric,
    triangle_normal,
    triangulate,
)

# A unit quad in the XY plane: 3 ---- 2
#                              |      |
#                              0 ---- 1
QUAD_POINTS = [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (1.0, 1.0, 0.0), (0.0, 1.0, 0.0)]


def test_triangle_passes_through_unchanged():
    mesh = triangulate("/M", QUAD_POINTS[:3], [3], [0, 1, 2])
    assert mesh.triangles == [(0, 1, 2)]


def test_quad_fans_from_the_first_corner():
    # This is USDComposer.js's rule verbatim: (0,1,2) then (0,2,3). Any other
    # split - the (0,1,3),(1,2,3) diagonal, say - would put the browser's face
    # index on a different triangle.
    mesh = triangulate("/M", QUAD_POINTS, [4], [0, 1, 2, 3])
    assert mesh.triangles == [(0, 1, 2), (0, 2, 3)]


def test_face_indices_are_global_and_sequential():
    # Two quads become four triangles numbered 0..3 across the whole mesh, not
    # restarted per face.
    points = QUAD_POINTS + [(2.0, 0.0, 0.0), (2.0, 1.0, 0.0)]
    mesh = triangulate("/M", points, [4, 4], [0, 1, 2, 3, 1, 4, 5, 2])
    assert mesh.triangle_count == 4
    assert mesh.triangles == [(0, 1, 2), (0, 2, 3), (1, 4, 5), (1, 5, 2)]


def test_mixed_triangle_and_quad_faces():
    points = QUAD_POINTS + [(0.5, 2.0, 0.0)]
    mesh = triangulate("/M", points, [4, 3], [0, 1, 2, 3, 3, 2, 4])
    assert mesh.triangles == [(0, 1, 2), (0, 2, 3), (3, 2, 4)]


def test_ngon_is_refused_rather_than_guessed():
    # three triangulates 5+ sided faces by ear clipping, which cannot be
    # reproduced here. Refusing loudly beats resolving to the wrong triangle.
    points = QUAD_POINTS + [(0.5, 2.0, 0.0)]
    with pytest.raises(MeshTriangulationError, match="5-gon"):
        triangulate("/M", points, [5], [0, 1, 2, 3, 4])


def test_degenerate_face_count_is_refused():
    with pytest.raises(MeshTriangulationError, match="2 vertices"):
        triangulate("/M", QUAD_POINTS, [2], [0, 1])


def test_truncated_indices_are_refused():
    with pytest.raises(MeshTriangulationError, match="shorter"):
        triangulate("/M", QUAD_POINTS, [4], [0, 1])


def test_triangle_points_range_check():
    mesh = triangulate("/M", QUAD_POINTS, [4], [0, 1, 2, 3])
    with pytest.raises(IndexError, match="out of range"):
        mesh.triangle_points(2)


class TestEvaluateBarycentric:
    def test_corners(self):
        a, b, c = (0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)
        assert evaluate_barycentric(a, b, c, (1, 0, 0)) == a
        assert evaluate_barycentric(a, b, c, (0, 1, 0)) == b
        assert evaluate_barycentric(a, b, c, (0, 0, 1)) == c

    def test_centroid(self):
        a, b, c = (0.0, 0.0, 0.0), (3.0, 0.0, 0.0), (0.0, 3.0, 0.0)
        p = evaluate_barycentric(a, b, c, (1 / 3, 1 / 3, 1 / 3))
        assert p[0] == pytest.approx(1.0)
        assert p[1] == pytest.approx(1.0)
        assert p[2] == pytest.approx(0.0)


class TestTriangleNormal:
    def test_counter_clockwise_faces_positive_z(self):
        n = triangle_normal((0, 0, 0), (1, 0, 0), (0, 1, 0))
        assert n == pytest.approx((0.0, 0.0, 1.0))

    def test_degenerate_returns_none(self):
        assert triangle_normal((0, 0, 0), (1, 0, 0), (2, 0, 0)) is None


class TestBounds:
    def test_empty(self):
        assert bounds([]) is None

    def test_extents(self):
        lo, hi = bounds([(0, 1, 2), (-1, 5, 0), (3, 0, 1)])
        assert lo == (-1, 0, 0)
        assert hi == (3, 5, 2)
