import { describe, it, expect } from 'vitest';
import {
  buildCurve,
  resampleCurve,
  controlPolygonLength,
  nearestSegment,
  nearestPoint,
  insertionIndex,
  toVec3,
  toVector3
} from './geometry';
import type { Vec3 } from '../../doc/types';

const LINE: Vec3[] = [
  [0, 0, 0],
  [1, 0, 0],
  [2, 0, 0],
  [3, 0, 0]
];

describe('toVector3 / toVec3', () => {
  it('round-trips', () => {
    expect(toVec3(toVector3([1, 2, 3]))).toEqual([1, 2, 3]);
  });
});

describe('buildCurve', () => {
  it('returns null with fewer than two points', () => {
    expect(buildCurve([], false)).toBeNull();
    expect(buildCurve([[0, 0, 0]], false)).toBeNull();
  });

  it('does not close a two-point curve', () => {
    // Closing two points produces a degenerate loop, so the flag is ignored.
    const curve = buildCurve(
      [
        [0, 0, 0],
        [1, 0, 0]
      ],
      true
    );
    expect(curve!.closed).toBe(false);
  });

  it('closes a three-point curve when asked', () => {
    expect(buildCurve(LINE.slice(0, 3), true)!.closed).toBe(true);
  });
});

describe('resampleCurve', () => {
  it('passes through every control vertex', () => {
    // The property that justifies Catmull-Rom over a b-spline: a control
    // vertex the user placed on a feature stays on that feature.
    const points: Vec3[] = [
      [0, 0, 0],
      [1, 1, 0],
      [2, 0, 0],
      [3, 1, 0]
    ];
    const samples = resampleCurve(points, false, 12);
    for (const cv of points) {
      const nearest = Math.min(
        ...samples.map((s) =>
          Math.hypot(s[0] - cv[0], s[1] - cv[1], s[2] - cv[2])
        )
      );
      expect(nearest, `curve misses control vertex ${cv}`).toBeLessThan(1e-6);
    }
  });

  it('keeps a straight line straight', () => {
    for (const p of resampleCurve(LINE, false, 8)) {
      expect(p[1]).toBeCloseTo(0, 6);
      expect(p[2]).toBeCloseTo(0, 6);
    }
  });

  it('returns the input unchanged for degenerate cases', () => {
    expect(resampleCurve([], false)).toEqual([]);
    expect(resampleCurve([[1, 2, 3]], false)).toEqual([[1, 2, 3]]);
    expect(
      resampleCurve(
        [
          [0, 0, 0],
          [1, 0, 0]
        ],
        false
      )
    ).toEqual([
      [0, 0, 0],
      [1, 0, 0]
    ]);
  });

  it('produces more samples for more segments', () => {
    const few = resampleCurve(LINE.slice(0, 3), false, 10);
    const many = resampleCurve(LINE, false, 10);
    expect(many.length).toBeGreaterThan(few.length);
  });

  it('returns to the start on a closed curve', () => {
    const square: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0]
    ];
    const samples = resampleCurve(square, true, 8);
    const first = samples[0]!;
    const last = samples[samples.length - 1]!;
    expect(Math.hypot(first[0] - last[0], first[1] - last[1])).toBeLessThan(1e-6);
  });

  it('does not produce cusps between tightly spaced points', () => {
    // Centripetal parameterisation exists for this case: an eyelid traced with
    // two nearly-coincident points must not loop back on itself.
    const tight: Vec3[] = [
      [0, 0, 0],
      [0.001, 0.0005, 0],
      [1, 0.2, 0],
      [2, 0, 0]
    ];
    const samples = resampleCurve(tight, false, 16);
    // Monotonic in x means no backtracking.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]![0]).toBeGreaterThanOrEqual(samples[i - 1]![0] - 1e-9);
    }
  });
});

describe('controlPolygonLength', () => {
  it('measures an open polyline', () => {
    expect(controlPolygonLength(LINE)).toBeCloseTo(3, 9);
  });

  it('adds the closing segment when closed', () => {
    const square: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0]
    ];
    expect(controlPolygonLength(square, false)).toBeCloseTo(3, 9);
    expect(controlPolygonLength(square, true)).toBeCloseTo(4, 9);
  });

  it('is zero for fewer than two points', () => {
    expect(controlPolygonLength([])).toBe(0);
    expect(controlPolygonLength([[1, 1, 1]])).toBe(0);
  });
});

describe('nearestSegment', () => {
  it('finds the segment under a point', () => {
    const hit = nearestSegment(LINE, [1.5, 0.2, 0]);
    expect(hit!.index).toBe(1);
    expect(hit!.t).toBeCloseTo(0.5, 6);
    expect(hit!.distance).toBeCloseTo(0.2, 6);
  });

  it('clamps past the start', () => {
    const hit = nearestSegment(LINE, [-5, 0, 0]);
    expect(hit!.index).toBe(0);
    expect(hit!.t).toBe(0);
    expect(hit!.point).toEqual([0, 0, 0]);
  });

  it('clamps past the end', () => {
    const hit = nearestSegment(LINE, [99, 0, 0]);
    expect(hit!.index).toBe(LINE.length - 2);
    expect(hit!.t).toBe(1);
  });

  it('considers the closing segment when closed', () => {
    const square: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0]
    ];
    // Left edge exists only as the wrap-around segment.
    const hit = nearestSegment(square, [-0.1, 0.5, 0], true);
    expect(hit!.index).toBe(3);
    expect(hit!.distance).toBeCloseTo(0.1, 6);
  });

  it('survives a degenerate segment', () => {
    const dup: Vec3[] = [
      [0, 0, 0],
      [0, 0, 0]
    ];
    const hit = nearestSegment(dup, [1, 0, 0]);
    expect(hit).not.toBeNull();
    expect(Number.isFinite(hit!.distance)).toBe(true);
  });

  it('returns null with fewer than two points', () => {
    expect(nearestSegment([[0, 0, 0]], [1, 1, 1])).toBeNull();
  });
});

describe('nearestPoint', () => {
  it('finds the closest control vertex', () => {
    const hit = nearestPoint(LINE, [2.1, 0, 0]);
    expect(hit!.index).toBe(2);
    expect(hit!.distance).toBeCloseTo(0.1, 6);
  });

  it('returns null for an empty curve', () => {
    expect(nearestPoint([], [0, 0, 0])).toBeNull();
  });
});

describe('insertionIndex', () => {
  it('appends when clicking past the end', () => {
    expect(insertionIndex(LINE, [10, 0, 0])).toBe(LINE.length);
  });

  it('prepends when clicking before the start', () => {
    expect(insertionIndex(LINE, [-10, 0, 0])).toBe(0);
  });

  it('inserts between the two nearest vertices', () => {
    expect(insertionIndex(LINE, [1.5, 0.1, 0])).toBe(2);
  });

  it('appends to a curve that is too short to interpolate', () => {
    expect(insertionIndex([], [0, 0, 0])).toBe(0);
    expect(insertionIndex([[0, 0, 0]], [1, 0, 0])).toBe(1);
  });

  it('never appends past the end of a closed curve', () => {
    const square: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0]
    ];
    const index = insertionIndex(square, [10, 0.5, 0], true);
    expect(index).toBeGreaterThan(0);
    expect(index).toBeLessThanOrEqual(square.length);
  });
});
