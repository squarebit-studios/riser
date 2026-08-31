// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Sampling points evenly across a character's surface.
//
// Shape analysis cannot use raw vertices. Where a modeller put edge loops is an
// artifact of how the mesh was built, not of what the character looks like: a
// capsule's vertices sit in rings with nothing between them, so slicing the
// blockout biped into height bands left ten consecutive bands completely empty
// while the legs passed straight through them. Crotch detection needs to see
// the legs in every band they occupy, and only area-weighted surface samples
// give that.
//
// Deterministic on purpose. Automatic placement must produce the same guides
// every time it runs, so this uses a Halton sequence rather than Math.random -
// well distributed, reproducible, and no seed to thread through.
// ==========================================================================

import * as THREE from 'three';
import { readTriangle, triangleCount } from '../../viewport/Picker';
import type { Vec3 } from '../../doc/types';

/**
 * Roughly how many points to spread over the whole character.
 *
 * Enough that a 64-band profile has hundreds of points per band even at the
 * ankles, and small enough that generating them is imperceptible.
 */
export const DEFAULT_SAMPLE_COUNT = 24_000;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();

/** Radical inverse in `base`, the building block of a Halton sequence. */
function halton(index: number, base: number): number {
  let result = 0;
  let f = 1 / base;
  let i = index;
  while (i > 0) {
    result += f * (i % base);
    i = Math.floor(i / base);
    f /= base;
  }
  return result;
}

/**
 * Points spread over the surface of `meshes`, in world space.
 *
 * Triangles receive samples in proportion to their area, so a large flat torso
 * panel is not under-represented next to a finely tessellated hand. Every
 * triangle gets at least one sample regardless, because a thin limb made of
 * small triangles is exactly what the analysis is looking for.
 */
export function sampleSurfacePoints(
  meshes: readonly THREE.Mesh[],
  targetCount = DEFAULT_SAMPLE_COUNT
): Vec3[] {
  interface Face {
    mesh: THREE.Mesh;
    faceIndex: number;
    area: number;
  }

  const faces: Face[] = [];
  let totalArea = 0;

  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const count = triangleCount(mesh.geometry);
    for (let faceIndex = 0; faceIndex < count; faceIndex++) {
      if (!readTriangle(mesh.geometry, faceIndex, _a, _b, _c)) continue;
      _ab.subVectors(_b, _a);
      _ac.subVectors(_c, _a);
      // Half the cross product's length, in the mesh's own space. World scale
      // is uniform across the character, so relative areas are unaffected and
      // there is no need to transform three points per triangle twice.
      const area = _ab.cross(_ac).length() * 0.5;
      if (!(area > 0)) continue;
      faces.push({ mesh, faceIndex, area });
      totalArea += area;
    }
  }

  if (faces.length === 0 || totalArea <= 0) return [];

  const points: Vec3[] = [];
  const world = new THREE.Vector3();
  let haltonIndex = 1;

  for (const face of faces) {
    const share = (face.area / totalArea) * targetCount;
    const count = Math.max(1, Math.round(share));

    readTriangle(face.mesh.geometry, face.faceIndex, _a, _b, _c);

    for (let i = 0; i < count; i++) {
      let u = halton(haltonIndex, 2);
      let v = halton(haltonIndex, 3);
      haltonIndex++;

      // Fold the unit square onto the triangle. Reflecting the far half is the
      // standard trick and keeps the distribution uniform.
      if (u + v > 1) {
        u = 1 - u;
        v = 1 - v;
      }
      const w = 1 - u - v;

      world.set(0, 0, 0);
      world.addScaledVector(_a, w);
      world.addScaledVector(_b, u);
      world.addScaledVector(_c, v);
      world.applyMatrix4(face.mesh.matrixWorld);

      points.push([world.x, world.y, world.z]);
    }
  }

  return points;
}
