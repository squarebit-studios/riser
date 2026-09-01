// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The eyelid case: a small feature with something big directly behind it.
//
// Re-seating a curve sample means casting a short ray along the surface
// normal and taking what it finds. "Short" was a fixed fraction of the whole
// CHARACTER's height, which is a reasonable size for a jawline and enormous
// for an eyelid: on a person-sized character it is centimetres, and a lid is
// a few millimetres of skin with an eyeball immediately behind it.
//
// So the ray goes straight past the lid and lands on the eye. It happens to
// some samples and not others, depending on which way the interpolated normal
// happens to point, and the result is a curve that jumps between two surfaces
// several times along its length. That is the zig-zag.
//
// The scene below is that situation and nothing else: a narrow strip of "lid"
// with a big "eye" behind it, and a curve traced along the strip.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { projectSamplesToSurface } from './project';
import type { Vec3 } from '../../doc/types';

const EYE_RADIUS = 0.9;
const LID_RADIUS = 1.0;

/**
 * A lid strip in front of an eyeball.
 *
 * The strip is deliberately narrow. A lid does not wrap the eye, it covers a
 * band of it, and the interesting samples are the ones near its edge where an
 * interpolated normal can point just off the strip and find nothing but eye.
 */
function eyeAndLid(): THREE.Object3D[] {
  const root = new THREE.Object3D();

  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(EYE_RADIUS, 64, 64),
    new THREE.MeshBasicMaterial()
  );
  root.add(eye);

  // phiLength/thetaLength keep it a band rather than a shell.
  const lid = new THREE.Mesh(
    new THREE.SphereGeometry(LID_RADIUS, 64, 64, 0, 0.9, 1.2, 0.5),
    new THREE.MeshBasicMaterial()
  );
  root.add(lid);

  root.updateMatrixWorld(true);
  return root.children;
}

/** A curve traced along the lid strip, as someone would draw it. */
function lidCurve(count: number): { points: Vec3[]; normals: Vec3[] } {
  const points: Vec3[] = [];
  const normals: Vec3[] = [];
  for (let i = 0; i < count; i++) {
    const phi = 0.1 + (i / (count - 1)) * 0.7;
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

/** How far each sample moved from where the smooth curve put it. */
function displacements(before: readonly Vec3[], after: readonly Vec3[]): number[] {
  return before.map((p, i) => {
    const q = after[i] as Vec3;
    return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
  });
}

describe('a curve traced on an eyelid', () => {
  const meshes = eyeAndLid();
  const { points, normals } = lidCurve(60);

  // 3% of a person-sized character, which is what the old rule produced.
  const CHARACTER_SCALE_SEARCH = 0.06;

  it('does not fall through the lid onto the eye behind it', () => {
    const out = projectSamplesToSurface(
      points,
      normals,
      meshes,
      new THREE.Raycaster(),
      { searchDistance: CHARACTER_SCALE_SEARCH }
    );

    // Anything landing at the eye's radius rather than the lid's has fallen
    // through to the wrong surface.
    const onTheEye = out.filter((p) => {
      const r = Math.hypot(p[0], p[1], p[2]);
      return Math.abs(r - EYE_RADIUS) < 0.02;
    });
    expect(onTheEye).toHaveLength(0);
  });

  it('never moves a sample further than the search allows', () => {
    const out = projectSamplesToSurface(
      points,
      normals,
      meshes,
      new THREE.Raycaster(),
      { searchDistance: CHARACTER_SCALE_SEARCH }
    );
    // A projection is a correction. A sample that travels the better part of a
    // centimetre on a millimetre-scale feature is not being corrected, it has
    // been relocated onto something else.
    const moved = displacements(points, out);
    expect(Math.max(...moved)).toBeLessThan(CHARACTER_SCALE_SEARCH);
  });

  it('stays smooth: no sample lurches away from its neighbours', () => {
    const out = projectSamplesToSurface(
      points,
      normals,
      meshes,
      new THREE.Raycaster(),
      { searchDistance: CHARACTER_SCALE_SEARCH }
    );

    // The zig-zag, measured. Consecutive samples on a traced lid sit a
    // fraction of a millimetre apart; a jump to another surface and back is
    // orders of magnitude larger than the step either side of it.
    const steps: number[] = [];
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1] as Vec3;
      const b = out[i] as Vec3;
      steps.push(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    const median = [...steps].sort((x, y) => x - y)[Math.floor(steps.length / 2)] ?? 0;
    expect(Math.max(...steps)).toBeLessThan(median * 4 + 1e-6);
  });
});
