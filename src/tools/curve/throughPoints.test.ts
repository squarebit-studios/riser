// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The promise a drawn curve makes: it goes through the points you placed.
//
// This is the property a person checks by eye the moment they draw anything,
// and it had two separate ways of being broken at once.
//
// The curve was a quadratic, which approaches its middle control vertices
// rather than passing through them. That is not a bug in a quadratic, it is
// what a quadratic is, and it is the wrong shape for a tool where every point
// was placed deliberately on a feature.
//
// And the samples were re-seated onto the surface with a search sized off the
// CHARACTER, so a lid traced with points a couple of millimetres apart was
// corrected with centimetres of licence, which is enough to reach the eye
// behind it and drag the curve there.
//
// The scene is a lid strip over an eyeball, at the spacing someone actually
// traces a lid with.
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
  controlVertexSampleIndices,
  projectSamplesToSurface,
  sampleDirections,
  searchDistanceFor
} from './project';
import type { Vec3 } from '../../doc/types';

/** A person-sized character: the search distance is a fraction of this. */
const CHARACTER_HEIGHT = 1.8;
const EYE_RADIUS = 0.012;
const LID_RADIUS = 0.0135;

function accelerated(geometry: THREE.BufferGeometry): THREE.Mesh {
  (geometry as unknown as { computeBoundsTree: () => void }).computeBoundsTree =
    computeBoundsTree;
  (geometry as unknown as { computeBoundsTree: () => void }).computeBoundsTree();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.raycast = acceleratedRaycast;
  return mesh;
}

function eyeAndLid(): THREE.Object3D[] {
  const root = new THREE.Object3D();
  root.add(accelerated(new THREE.SphereGeometry(EYE_RADIUS, 48, 48)));
  root.add(
    accelerated(new THREE.SphereGeometry(LID_RADIUS, 48, 48, 0, 1.1, 1.2, 0.45))
  );
  root.updateMatrixWorld(true);
  return root.children;
}

/** Points clicked along the lid, a couple of millimetres apart. */
function tracedLid(count: number): { points: Vec3[]; normals: Vec3[] } {
  const points: Vec3[] = [];
  const normals: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const phi = 0.2 + (i / (count - 1)) * 0.7;
    const theta = 1.35;
    const n = new THREE.Vector3(
      Math.sin(theta) * Math.cos(phi),
      Math.cos(theta),
      Math.sin(theta) * Math.sin(phi)
    ).normalize();
    points.push([n.x * LID_RADIUS, n.y * LID_RADIUS, n.z * LID_RADIUS]);
    normals.push([n.x, n.y, n.z]);
  }
  return { points, normals };
}

/** Exactly the app's own path, constants included. */
function drawn(points: Vec3[], normals: Vec3[], closed = false): Vec3[] {
  const samples = resampleCurve(
    points,
    closed,
    DEFAULT_SAMPLES_PER_SEGMENT,
    DEFAULT_CURVE_DEGREE
  );
  return projectSamplesToSurface(
    samples,
    sampleDirections(normals, closed, DEFAULT_SAMPLES_PER_SEGMENT, DEFAULT_CURVE_DEGREE),
    eyeAndLid(),
    firstHitRaycaster(),
    {
      searchDistance: searchDistanceFor(points, CHARACTER_HEIGHT),
      pinned:
        DEFAULT_CURVE_DEGREE === 3
          ? controlVertexSampleIndices(points.length, DEFAULT_SAMPLES_PER_SEGMENT, closed)
          : undefined
    }
  );
}

describe('a curve drawn on a traced eyelid', () => {
  const { points, normals } = tracedLid(8);

  it('passes exactly through every point that was placed', () => {
    const curve = drawn(points, normals);
    for (const placed of points) {
      const nearest = Math.min(
        ...curve.map((s) =>
          Math.hypot(s[0] - placed[0], s[1] - placed[1], s[2] - placed[2])
        )
      );
      // Exactly, not nearby. A control vertex is bound to a triangle the
      // worker re-evaluates, so the drawn curve missing it means the picture
      // and the data disagree.
      expect(nearest).toBeLessThan(1e-9);
    }
  });

  it('searches no further than the points are apart', () => {
    const gaps: number[] = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1] as Vec3;
      const b = points[i] as Vec3;
      gaps.push(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    const smallest = Math.min(...gaps);
    const search = searchDistanceFor(points, CHARACTER_HEIGHT);

    expect(search).toBeLessThan(smallest);
    // And far short of what the character alone would have allowed, which is
    // the whole point: 3% of 1.8m is 54mm, against a lid a few mm across.
    expect(search).toBeLessThan(CHARACTER_HEIGHT * 0.03);
  });

  it('never reaches through the lid to the eye behind it', () => {
    for (const p of drawn(points, normals)) {
      const r = Math.hypot(p[0], p[1], p[2]);
      expect(Math.abs(r - EYE_RADIUS)).toBeGreaterThan(1e-4);
    }
  });

  it('stays smooth between the points as well as on them', () => {
    const curve = drawn(points, normals);
    const steps: number[] = [];
    for (let i = 1; i < curve.length; i++) {
      const a = curve[i - 1] as Vec3;
      const b = curve[i] as Vec3;
      steps.push(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    const sorted = [...steps].sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    expect(Math.max(...steps)).toBeLessThan(median * 4 + 1e-9);
  });

  it('a wide jawline still gets the character sized search', () => {
    // The cap must not punish a curve drawn with big deliberate steps, which
    // is the case the character sized number was right for all along.
    const wide: Vec3[] = [
      [0, 0, 0],
      [0.12, 0.02, 0],
      [0.24, 0, 0]
    ];
    expect(searchDistanceFor(wide, CHARACTER_HEIGHT)).toBeCloseTo(
      CHARACTER_HEIGHT * 0.03,
      6
    );
  });
});
