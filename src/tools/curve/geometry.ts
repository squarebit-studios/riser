// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Curve math: interpolation between control vertices, and the queries the
// editing tools need.
//
// Only three.js math classes are used here - no renderer, no scene - so every
// function in this file is directly unit-testable.
//
// A note on the interpolation. The document stores a USD BasisCurves with a
// bspline basis, but the app DRAWS a centripetal Catmull-Rom through the same
// control vertices. That is not an inconsistency, it is the point: a
// Catmull-Rom passes through its control points, so a control vertex the user
// dropped on the corner of the mouth stays on the corner of the mouth. A
// b-spline only approximates them, which would put the drawn curve somewhere
// the user did not click. The server resamples from the stored points, so what
// is displayed and what is evaluated agree.
//
// Centripetal parameterisation specifically (rather than uniform or chordal)
// because it is the variant that cannot produce cusps or self-intersections
// between closely spaced points - and closely spaced points are exactly what
// you get when someone traces an eyelid.
// ==========================================================================

import * as THREE from 'three';
import type { Vec3 } from '../../doc/types';

export const DEFAULT_SAMPLES_PER_SEGMENT = 10;

/**
 * The degree a curve is drawn at unless something asks for another.
 *
 * Two: a quadratic. Three (the interpolating Catmull-Rom described above) is
 * the more obvious choice and it is what this drew first, on the reasoning
 * that a control vertex dropped on the corner of a mouth should stay on the
 * corner of the mouth. That reasoning still holds and it is still available,
 * but a cubic buys its exactness with a wider stencil: each span is steered by
 * two points beyond its own ends, so a control vertex placed a little off
 * pulls the curve around two spans away from itself. Tracing an eyelid means
 * putting points close together along something that turns sharply, which is
 * where that shows up worst.
 *
 * A quadratic spans three points instead of four and lies inside their hull,
 * so it cannot swing wide of the points that made it. It gives up passing
 * exactly through the middle control vertices to get that, which is the trade
 * being made here.
 */
/** Degrees this can draw: a polyline, a quadratic, or an interpolating cubic. */
export type CurveDegree = 1 | 2 | 3;

/**
 * Annotated rather than inferred, so this stays a choice between three
 * degrees instead of narrowing to a literal and making every comparison
 * against it look like dead code to the compiler.
 *
 * Three, which is the interpolating cubic, because a curve has to pass
 * through the points somebody placed. This was briefly two, to stop traced
 * eyelids coming out as a wobble, and that worked by hiding the wobble rather
 * than removing it: the real cause was every sample searching for the surface
 * along a normal taken from somewhere else on the curve, which is fixed. What
 * the quadratic left behind was a curve that visibly missed the points it was
 * drawn from, because approaching its middle control vertices instead of
 * touching them is exactly what a quadratic does.
 *
 * Two is still here and still tested, for anyone who wants the containment it
 * buys and can live with that trade.
 */
export const DEFAULT_CURVE_DEGREE: CurveDegree = 3;

export function toVector3(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v[0], v[1], v[2]);
}

export function toVec3(v: THREE.Vector3): Vec3 {
  return [v.x, v.y, v.z];
}

/**
 * Build the interpolating curve through `points`. Returns null when there are
 * too few points to interpolate, which callers render as a plain polyline.
 */
export function buildCurve(
  points: readonly Vec3[],
  closed: boolean
): THREE.CatmullRomCurve3 | null {
  if (points.length < 2) return null;
  const curve = new THREE.CatmullRomCurve3(
    points.map(toVector3),
    closed && points.length > 2,
    'centripetal'
  );
  return curve;
}

/**
 * Dense polyline through the control vertices, for rendering.
 *
 * Sample count scales with segment count so a 12-point jawline is no coarser
 * per segment than a 3-point brow.
 */
export function resampleCurve(
  points: readonly Vec3[],
  closed: boolean,
  samplesPerSegment = DEFAULT_SAMPLES_PER_SEGMENT,
  degree: CurveDegree = DEFAULT_CURVE_DEGREE
): Vec3[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [points[0] as Vec3];
  if (points.length === 2 && !closed) {
    // Two points is a straight line whatever the degree, and this skips the
    // allocation of finding that out.
    return [points[0] as Vec3, points[1] as Vec3];
  }

  if (degree === 1) return closed ? [...points, points[0] as Vec3] : points.slice();
  if (degree === 2) return sampleQuadratic(points, closed, samplesPerSegment);

  const curve = buildCurve(points, closed);
  if (!curve) return points.slice();

  const segments = closed ? points.length : points.length - 1;
  const divisions = Math.max(2, segments * samplesPerSegment);
  return curve.getPoints(divisions).map(toVec3);
}

/**
 * A uniform quadratic B-spline through `points`.
 *
 * Each span is decided by three consecutive control vertices and nothing else,
 * which is the property being bought: the curve stays inside the triangle they
 * make, so no control vertex can throw it wider than the points around it. A
 * cubic reaches two points past each end of a span and can, which is what puts
 * loops and overshoot into a tightly traced feature.
 *
 * The ends are clamped by repeating the first and last control vertex, so an
 * open curve still starts and finishes exactly where the user put those two,
 * even though the ones in between are approached rather than touched.
 *
 * Written out rather than delegated to three, which has no quadratic spline:
 * its curve classes are cubic (CatmullRomCurve3, CubicBezierCurve3) or the
 * single-span QuadraticBezierCurve3, and neither is a spline through a list.
 */
function sampleQuadratic(
  points: readonly Vec3[],
  closed: boolean,
  samplesPerSegment: number
): Vec3[] {
  const n = points.length;
  const at = (i: number): Vec3 =>
    (closed
      ? points[((i % n) + n) % n]
      : points[Math.min(Math.max(i, 0), n - 1)]) as Vec3;

  // Open curves repeat the end points once, which is what pins the ends down.
  const hull: Vec3[] = closed
    ? Array.from({ length: n + 2 }, (_, i) => at(i))
    : [at(0), ...points, at(n - 1)];

  const spans = hull.length - 2;
  const per = Math.max(1, samplesPerSegment);
  const out: Vec3[] = [];

  for (let span = 0; span < spans; span++) {
    const a = hull[span] as Vec3;
    const b = hull[span + 1] as Vec3;
    const c = hull[span + 2] as Vec3;
    // The last sample of a span is the first of the next, so it is emitted
    // once, by the next span. The final point is added after the loop.
    for (let step = 0; step < per; step++) {
      const t = step / per;
      const w0 = 0.5 * (1 - t) * (1 - t);
      const w1 = 0.5 + t * (1 - t);
      const w2 = 0.5 * t * t;
      out.push([
        w0 * a[0] + w1 * b[0] + w2 * c[0],
        w0 * a[1] + w1 * b[1] + w2 * c[1],
        w0 * a[2] + w1 * b[2] + w2 * c[2]
      ]);
    }
  }

  const last = hull[hull.length - 2] as Vec3;
  const tail = hull[hull.length - 1] as Vec3;
  out.push([
    0.5 * (last[0] + tail[0]),
    0.5 * (last[1] + tail[1]),
    0.5 * (last[2] + tail[2])
  ]);
  return out;
}

/** Total length of the polyline through the control vertices. */
export function controlPolygonLength(points: readonly Vec3[], closed = false): number {
  if (points.length < 2) return 0;
  let total = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i < points.length - 1; i++) {
    a.set(...(points[i] as Vec3));
    b.set(...(points[i + 1] as Vec3));
    total += a.distanceTo(b);
  }
  if (closed && points.length > 2) {
    a.set(...(points[points.length - 1] as Vec3));
    b.set(...(points[0] as Vec3));
    total += a.distanceTo(b);
  }
  return total;
}

export interface SegmentHit {
  /** Index of the segment's first control vertex. */
  index: number;
  /** Position along that segment, 0..1. */
  t: number;
  /** Distance from the query point to the segment. */
  distance: number;
  /** Closest point on the segment. */
  point: Vec3;
}

/**
 * Nearest point on the CONTROL POLYGON to `query`.
 *
 * Used for "insert a control vertex where I clicked". Deliberately measured
 * against the straight segments rather than the smooth curve: the answer is
 * exact and cheap, and the difference is well under the click tolerance at any
 * sane control vertex spacing.
 */
export function nearestSegment(
  points: readonly Vec3[],
  query: Vec3,
  closed = false
): SegmentHit | null {
  if (points.length < 2) return null;

  const q = toVector3(query);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const aq = new THREE.Vector3();
  const closest = new THREE.Vector3();

  let best: SegmentHit | null = null;
  const last = closed && points.length > 2 ? points.length : points.length - 1;

  for (let i = 0; i < last; i++) {
    a.set(...(points[i] as Vec3));
    b.set(...(points[(i + 1) % points.length] as Vec3));
    ab.subVectors(b, a);
    const lengthSq = ab.lengthSq();

    // Degenerate segment: both ends coincide, so the nearest point is the end.
    const t = lengthSq < 1e-12 ? 0 : clamp01(aq.subVectors(q, a).dot(ab) / lengthSq);
    closest.copy(a).addScaledVector(ab, t);
    const distance = closest.distanceTo(q);

    if (!best || distance < best.distance) {
      best = { index: i, t, distance, point: toVec3(closest) };
    }
  }
  return best;
}

/**
 * Index of the control vertex nearest `query`, with its distance. Returns null
 * for an empty curve.
 */
export function nearestPoint(
  points: readonly Vec3[],
  query: Vec3
): { index: number; distance: number } | null {
  if (points.length === 0) return null;
  const q = toVector3(query);
  const p = new THREE.Vector3();
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < points.length; i++) {
    p.set(...(points[i] as Vec3));
    const d = p.distanceTo(q);
    if (d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  }
  return { index: bestIndex, distance: bestDistance };
}

/**
 * Where a new control vertex should be inserted so the curve keeps its shape.
 *
 * Appending is right when the user clicks past either END of the curve;
 * inserting is right when they click between two existing vertices. The test
 * is whether the nearest segment point is at a segment's extreme - if the
 * closest approach is the very first or very last vertex, the click is off the
 * end rather than beside the middle.
 */
export function insertionIndex(
  points: readonly Vec3[],
  query: Vec3,
  closed = false
): number {
  if (points.length < 2) return points.length;

  const hit = nearestSegment(points, query, closed);
  if (!hit) return points.length;

  if (!closed) {
    if (hit.index === 0 && hit.t <= 0) return 0;
    if (hit.index === points.length - 2 && hit.t >= 1) return points.length;
  }
  return hit.index + 1;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
