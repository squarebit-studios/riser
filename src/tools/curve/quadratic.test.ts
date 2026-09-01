// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The quadratic default: what it guarantees that the cubic does not.
//
// A cubic spline is steered by two control vertices beyond each end of the
// span it is drawing, so one point placed a little off pulls the curve around
// spans that are not next to it, and the curve can swing outside the points
// that made it. On a jawline that is invisible. On an eyelid, where the points
// are close together and the surface turns hard, it is the difference between
// a traced line and a wobble.
//
// A quadratic span sees three consecutive points and nothing else, and stays
// inside them. These tests assert that containment directly, because it is
// the entire reason for the change.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CURVE_DEGREE,
  DEFAULT_SAMPLES_PER_SEGMENT,
  resampleCurve
} from './geometry';
import type { Vec3 } from '../../doc/types';

const near = (a: Vec3, b: Vec3, tol = 1e-9): boolean =>
  Math.abs(a[0] - b[0]) < tol &&
  Math.abs(a[1] - b[1]) < tol &&
  Math.abs(a[2] - b[2]) < tol;

describe('the default curve degree', () => {
  it('is two', () => {
    expect(DEFAULT_CURVE_DEGREE).toBe(2);
  });

  it('starts and ends exactly on the first and last control vertex', () => {
    // The ends are the two points a user is most deliberate about: the corner
    // of a mouth, the inner corner of an eye. Approaching those would be wrong
    // even though approaching the middle ones is the trade being made.
    const points: Vec3[] = [
      [0, 0, 0],
      [1, 2, 0],
      [2, -1, 0],
      [3, 1, 0],
      [4, 0, 0]
    ];
    const out = resampleCurve(points, false, DEFAULT_SAMPLES_PER_SEGMENT, 2);
    expect(near(out[0] as Vec3, points[0] as Vec3)).toBe(true);
    expect(near(out[out.length - 1] as Vec3, points[points.length - 1] as Vec3)).toBe(
      true
    );
  });

  it('never swings outside the points that made it', () => {
    // A zig-zag traced along a feature: alternating, closely spaced, exactly
    // the input that makes a cubic overshoot.
    const points: Vec3[] = [];
    for (let i = 0; i < 12; i++) points.push([i * 0.1, (i % 2 ? 1 : -1) * 0.05, 0]);

    const quadratic = resampleCurve(points, false, DEFAULT_SAMPLES_PER_SEGMENT, 2);
    const cubic = resampleCurve(points, false, DEFAULT_SAMPLES_PER_SEGMENT, 3);

    const spread = (samples: Vec3[]): number =>
      Math.max(...samples.map((p) => Math.abs(p[1])));

    // The control points reach 0.05 either side. The quadratic cannot exceed
    // that; the cubic is free to, and on this input it does.
    expect(spread(quadratic)).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(spread(cubic)).toBeGreaterThan(spread(quadratic));
  });

  it('is smooth: no corner between one sample and the next', () => {
    const points: Vec3[] = [
      [0, 0, 0],
      [1, 1, 0],
      [2, 0, 0],
      [3, 1, 0]
    ];
    const out = resampleCurve(points, false, 20, 2);

    // Turning angle per step stays small everywhere. A polyline through the
    // control points would show a hard corner at each one.
    let worst = 0;
    for (let i = 2; i < out.length; i++) {
      const a = out[i - 2] as Vec3;
      const b = out[i - 1] as Vec3;
      const c = out[i] as Vec3;
      const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v: Vec3 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
      const lu = Math.hypot(u[0], u[1], u[2]);
      const lv = Math.hypot(v[0], v[1], v[2]);
      if (lu < 1e-12 || lv < 1e-12) continue;
      const dot = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (lu * lv);
      worst = Math.max(worst, Math.acos(Math.min(1, Math.max(-1, dot))));
    }
    expect(worst).toBeLessThan(0.35);
  });

  it('closes without a seam', () => {
    const points: Vec3[] = [
      [1, 0, 0],
      [0, 1, 0],
      [-1, 0, 0],
      [0, -1, 0]
    ];
    const out = resampleCurve(points, true, DEFAULT_SAMPLES_PER_SEGMENT, 2);
    // Last sample meets the first, so the ring has no gap and no doubled point.
    expect(near(out[0] as Vec3, out[out.length - 1] as Vec3, 1e-9)).toBe(true);
  });

  it('degree one is the control polygon itself', () => {
    const points: Vec3[] = [
      [0, 0, 0],
      [1, 1, 0],
      [2, 0, 0]
    ];
    expect(resampleCurve(points, false, DEFAULT_SAMPLES_PER_SEGMENT, 1)).toEqual(points);
  });
});
