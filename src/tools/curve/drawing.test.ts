// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The whole drawing path, end to end, on a character shaped thing.
//
// The pieces are each tested on their own and each passed while the drawn
// curve was visibly wrong, which is the reason this exists: the fault was in
// how they are wired together, not in any one of them. So this runs exactly
// what the app runs, in the same order and with the same arguments, and asks
// only whether the result is a curve lying on the surface.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import { firstHitRaycaster } from '../../viewport/acceleration';
import {
  DEFAULT_CURVE_DEGREE,
  DEFAULT_SAMPLES_PER_SEGMENT,
  resampleCurve
} from './geometry';
import {
  interpolateNormals,
  projectSamplesToSurface,
  sampleDirections,
  SEARCH_FRACTION
} from './project';
import type { Vec3 } from '../../doc/types';

const RADIUS = 1;

function sphere(): THREE.Object3D[] {
  const geometry = new THREE.SphereGeometry(RADIUS, 64, 64);
  (geometry as unknown as { computeBoundsTree: () => void }).computeBoundsTree =
    computeBoundsTree;
  (geometry as unknown as { computeBoundsTree: () => void }).computeBoundsTree();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.raycast = acceleratedRaycast;
  mesh.updateMatrixWorld(true);
  return [mesh];
}

/** Control vertices clicked onto the surface, with the normals a pick gives. */
function clickedOnSurface(count: number): { points: Vec3[]; normals: Vec3[] } {
  const points: Vec3[] = [];
  const normals: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1)) * 1.2 - 0.6;
    const n = new THREE.Vector3(Math.cos(t), Math.sin(t) * 0.8, 0.25).normalize();
    points.push([n.x * RADIUS, n.y * RADIUS, n.z * RADIUS]);
    normals.push([n.x, n.y, n.z]);
  }
  return { points, normals };
}

/** Exactly what RiserApp.projectCurve does, with the app's own constants. */
function drawnCurve(points: Vec3[], normals: Vec3[], closed = false): Vec3[] {
  const samples = resampleCurve(
    points,
    closed,
    DEFAULT_SAMPLES_PER_SEGMENT,
    DEFAULT_CURVE_DEGREE
  );
  // The character's height, which is what the search distance is a fraction of.
  const height = RADIUS * 2;
  return projectSamplesToSurface(
    samples,
    sampleDirections(normals, closed, DEFAULT_SAMPLES_PER_SEGMENT, DEFAULT_CURVE_DEGREE),
    sphere(),
    firstHitRaycaster(),
    { searchDistance: Math.max(height * SEARCH_FRACTION, 1e-4) }
  );
}

describe('drawing a curve on a character', () => {
  it('produces a line, not just the points that were clicked', () => {
    const { points, normals } = clickedOnSurface(6);
    const drawn = drawnCurve(points, normals);
    // Two samples is the minimum the renderer will draw a line from at all.
    expect(drawn.length).toBeGreaterThanOrEqual(2);
    expect(drawn.length).toBeGreaterThan(points.length);
  });

  it('lies on the surface it was drawn on', () => {
    const { points, normals } = clickedOnSurface(6);
    for (const p of drawnCurve(points, normals)) {
      const r = Math.hypot(p[0], p[1], p[2]);
      expect(r).toBeGreaterThan(RADIUS - 0.02);
      expect(r).toBeLessThan(RADIUS + 0.02);
    }
  });

  it('does not zig-zag: every step is the size of its neighbours', () => {
    const { points, normals } = clickedOnSurface(6);
    const drawn = drawnCurve(points, normals);

    const steps: number[] = [];
    for (let i = 1; i < drawn.length; i++) {
      const a = drawn[i - 1] as Vec3;
      const b = drawn[i] as Vec3;
      steps.push(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    const sorted = [...steps].sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    // A sample that jumped to another part of the surface, or that was left
    // behind while its neighbours moved, shows up here and nowhere else.
    expect(Math.max(...steps)).toBeLessThan(median * 5 + 1e-9);
  });

  it('runs in order, without doubling back on itself', () => {
    // The failure this catches is a curve whose samples are correct
    // individually but arrive out of order, which draws as a tangle.
    const { points, normals } = clickedOnSurface(6);
    const drawn = drawnCurve(points, normals);

    let reversals = 0;
    for (let i = 2; i < drawn.length; i++) {
      const a = drawn[i - 2] as Vec3;
      const b = drawn[i - 1] as Vec3;
      const c = drawn[i] as Vec3;
      const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v: Vec3 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
      if (u[0] * v[0] + u[1] * v[1] + u[2] * v[2] < 0) reversals++;
    }
    expect(reversals).toBe(0);
  });

  it('still works with only two control vertices', () => {
    const { points, normals } = clickedOnSurface(2);
    const drawn = drawnCurve(points, normals);
    expect(drawn.length).toBeGreaterThanOrEqual(2);
  });
  it('gives each sample the direction that belongs to it', () => {
    // The bug this pins down: the positions and the search directions were
    // built by two different parameterisations, which agreed while the curve
    // was a cubic and stopped agreeing when it became a quadratic. Nothing
    // about the counts changed, so nothing complained; each sample simply
    // searched along a normal taken from somewhere else on the curve.
    //
    // On this sphere the control normals ARE the normalised control positions,
    // so a correctly paired direction points straight out through its own
    // sample and the error is measurable as an angle.
    const { points, normals } = clickedOnSurface(6);
    const samples = resampleCurve(
      points,
      false,
      DEFAULT_SAMPLES_PER_SEGMENT,
      DEFAULT_CURVE_DEGREE
    );

    const angleTo = (dirs: Vec3[]): number => {
      let worst = 0;
      for (let i = 0; i < samples.length; i++) {
        const p = samples[i] as Vec3;
        const d = dirs[i] as Vec3;
        const lp = Math.hypot(p[0], p[1], p[2]);
        if (lp < 1e-12) continue;
        const dot = (p[0] * d[0] + p[1] * d[1] + p[2] * d[2]) / lp;
        worst = Math.max(worst, Math.acos(Math.min(1, Math.max(-1, dot))));
      }
      return worst;
    };

    const paired = angleTo(
      sampleDirections(normals, false, DEFAULT_SAMPLES_PER_SEGMENT, DEFAULT_CURVE_DEGREE)
    );
    const mismatched = angleTo(interpolateNormals(normals, samples.length, false));

    // Built by the same basis, a direction belongs to its sample.
    expect(paired).toBeLessThan(0.02);
    // Built by the cubic's layout, it does not, and that gap is the defect.
    expect(mismatched).toBeGreaterThan(paired * 2);
  });

  it('pairs directions one for one with samples, at every degree', () => {
    const { points, normals } = clickedOnSurface(7);
    for (const degree of [1, 2, 3] as const) {
      for (const closed of [false, true]) {
        const samples = resampleCurve(points, closed, DEFAULT_SAMPLES_PER_SEGMENT, degree);
        const dirs = sampleDirections(normals, closed, DEFAULT_SAMPLES_PER_SEGMENT, degree);
        expect(dirs).toHaveLength(samples.length);
        for (const d of dirs) {
          expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 6);
        }
      }
    }
  });
});
