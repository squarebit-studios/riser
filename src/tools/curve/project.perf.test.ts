// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Why curve drawing was slow, and proof the fix did not move any curve.
//
// Projection is the most expensive thing in the app: ten raycasts per curve
// segment, each against the whole character. It is also the least forgiving
// place to be clever, because a curve's control vertices are bound to
// triangles that the Python worker re-evaluates on its own. A projection that
// drifted here would disagree with the server.
//
// So the assertion that matters is EQUALITY against a brute-force cast that
// considers every mesh. The timings are printed rather than asserted: a
// threshold on wall-clock time fails on a busy machine and teaches people to
// ignore the suite.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh';
import { firstHitRaycaster } from '../../viewport/acceleration';
import { projectSamplesToSurface, type ProjectOptions } from './project';
import type { Vec3 } from '../../doc/types';

function accelerated(geometry: THREE.BufferGeometry): THREE.Mesh {
  (geometry as unknown as { computeBoundsTree: () => void }).computeBoundsTree =
    computeBoundsTree;
  (geometry as unknown as { computeBoundsTree: () => void }).computeBoundsTree();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.raycast = acceleratedRaycast;
  return mesh;
}

/**
 * The shape of the real thing: many pieces, each carrying its subdivided self.
 *
 * A character is not one mesh. It arrives as roughly thirty pieces, and with
 * smoothing on each one has its limit surface hanging off it as a child. Both
 * facts drive the cost, because the cast is charged per OBJECT as much as per
 * triangle: it transforms the ray into every mesh's own space to discover it
 * was nowhere near.
 */
function character(): THREE.Object3D[] {
  const root = new THREE.Object3D();
  for (let i = 0; i < 29; i++) {
    // Pieces spread around the body rather than stacked, so a local curve has
    // genuine neighbours and genuine distant strangers, as a real one does.
    const angle = (i / 29) * Math.PI * 2;
    const cage = accelerated(new THREE.SphereGeometry(0.3, 24, 24));
    cage.add(accelerated(new THREE.SphereGeometry(0.3, 64, 64)));
    cage.position.set(Math.cos(angle) * 1.6, (i % 5) * 0.4 - 0.8, Math.sin(angle) * 1.6);
    root.add(cage);
  }
  root.updateMatrixWorld(true);
  return root.children;
}

/** An arc lying on ONE piece: a brow, a lip, a jawline. The common case. */
function localCurve(count: number): { points: Vec3[]; normals: Vec3[] } {
  const points: Vec3[] = [];
  const normals: Vec3[] = [];
  const centre = new THREE.Vector3(Math.cos(0) * 1.6, -0.8, Math.sin(0) * 1.6);
  for (let i = 0; i < count; i++) {
    const t = (i / Math.max(count - 1, 1) - 0.5) * 0.9;
    const n = new THREE.Vector3(Math.cos(t), Math.sin(t) * 0.5, 0).normalize();
    points.push([
      centre.x + n.x * 0.32,
      centre.y + n.y * 0.32,
      centre.z + n.z * 0.32
    ]);
    normals.push([n.x, n.y, n.z]);
  }
  return { points, normals };
}

/** What the cast did before it was narrowed: consider absolutely everything. */
function bruteForce(
  samples: readonly Vec3[],
  normals: readonly Vec3[],
  meshes: readonly THREE.Object3D[],
  options: ProjectOptions
): Vec3[] {
  const raycaster = new THREE.Raycaster();
  const out: Vec3[] = [];
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] as Vec3;
    if (options.pinned?.has(i)) {
      out.push(s);
      continue;
    }
    const n = normals[i] as Vec3;
    direction.set(n[0], n[1], n[2]);
    if (direction.lengthSq() < 1e-12) {
      out.push(s);
      continue;
    }
    direction.normalize();
    origin.set(s[0], s[1], s[2]).addScaledVector(direction, options.searchDistance);
    raycaster.set(origin, direction.clone().negate());
    raycaster.near = 0;
    raycaster.far = options.searchDistance * 2;
    const hit = raycaster.intersectObjects(meshes as THREE.Object3D[], true)[0];
    out.push(hit ? [hit.point.x, hit.point.y, hit.point.z] : s);
    raycaster.far = Infinity;
  }
  return out;
}

describe('projecting a curve onto an accelerated character', () => {
  const meshes = character();
  const options: ProjectOptions = { searchDistance: 0.06 };

  it('narrowing the cast does not move a single sample', () => {
    const { points, normals } = localCurve(120);
    const reference = bruteForce(points, normals, meshes, options);
    const narrowed = projectSamplesToSurface(
      points,
      normals,
      meshes,
      firstHitRaycaster(),
      options
    );

    expect(narrowed).toHaveLength(reference.length);
    for (let i = 0; i < reference.length; i++) {
      const a = reference[i] as Vec3;
      const b = narrowed[i] as Vec3;
      // Identical, not close. It is the same triangle and the same hit; the
      // meshes that were skipped could not have been reached.
      expect(b[0]).toBe(a[0]);
      expect(b[1]).toBe(a[1]);
      expect(b[2]).toBe(a[2]);
    }
  });

  it('really is landing on the surface, not passing everything through', () => {
    // Guards the test above: without this, both paths missing everything
    // would agree perfectly and prove nothing.
    const { points, normals } = localCurve(120);
    const out = projectSamplesToSurface(
      points,
      normals,
      meshes,
      firstHitRaycaster(),
      options
    );
    let moved = 0;
    for (let i = 0; i < out.length; i++) {
      const before = points[i] as Vec3;
      const after = out[i] as Vec3;
      if (
        Math.hypot(
          after[0] - before[0],
          after[1] - before[1],
          after[2] - before[2]
        ) > 1e-9
      ) {
        moved++;
      }
    }
    expect(moved).toBeGreaterThan(out.length * 0.9);
  });

  it('reports what narrowing the cast is worth', () => {
    const shapes: Array<[string, ReturnType<typeof localCurve>]> = [
      ['a 41 sample curve (5 control vertices)', localCurve(41)],
      ['a 201 sample curve (21 control vertices)', localCurve(201)]
    ];

    for (const [label, { points, normals }] of shapes) {
      const time = (fn: () => void): number => {
        for (let i = 0; i < 3; i++) fn(); // warm
        const started = performance.now();
        for (let i = 0; i < 10; i++) fn();
        return (performance.now() - started) / 10;
      };

      const before = time(() => bruteForce(points, normals, meshes, options));
      const after = time(() =>
        projectSamplesToSurface(points, normals, meshes, firstHitRaycaster(), options)
      );
      console.log(
        `  ${label}: every mesh ${before.toFixed(1)}ms, ` +
          `narrowed ${after.toFixed(1)}ms ` +
          `(${(before / Math.max(after, 1e-6)).toFixed(1)}x)`
      );
      expect(after).toBeGreaterThan(0);
    }
  });
});
