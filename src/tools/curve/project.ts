// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Pulling an interpolated curve back onto the character's surface.
//
// A Catmull-Rom through control vertices that all sit on the skin does NOT
// itself sit on the skin: between two vertices it takes the shortest smooth
// path, which cuts through a convex form (across the bridge of a nose) and
// floats off a concave one (across an eye socket). Drawn as-is, half of a
// traced jawline disappears inside the head.
//
// So every sample between control vertices is re-seated on the surface by
// casting a short ray along the local normal. Control vertices themselves are
// left exactly where the user put them - they are already bound to a triangle,
// and moving them would contradict the binding the server will evaluate.
//
// Samples that find no surface are kept where they are rather than dropped:
// the curve stays continuous, and a curve that briefly leaves the mesh (across
// the gap between lips, say) is what the user drew.
// ==========================================================================

import * as THREE from 'three';
import type { Vec3 } from '../../doc/types';

/**
 * How far to search either side of a sample, as a fraction of character
 * height. Large enough to cross the gap a smooth curve leaves over a nose,
 * small enough not to snap the jawline onto the shoulder behind it.
 */
export const SEARCH_FRACTION = 0.03;

const _origin = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _sample = new THREE.Vector3();

export interface ProjectOptions {
  /** Search distance in world units. */
  searchDistance: number;
  /**
   * Indices in `samples` that are control vertices and must not move. The
   * resampler emits them at predictable positions, and honouring them is what
   * keeps the drawn curve consistent with the stored bindings.
   */
  pinned?: ReadonlySet<number>;
}

/**
 * Re-seat interpolated samples on the nearest surface along their normal.
 *
 * Normals are interpolated from the control vertices rather than recomputed,
 * because a sample has no surface of its own until it finds one - the normal
 * is the search direction, not a property of the result.
 */
export function projectSamplesToSurface(
  samples: readonly Vec3[],
  normals: readonly Vec3[],
  meshes: readonly THREE.Object3D[],
  raycaster: THREE.Raycaster,
  options: ProjectOptions
): Vec3[] {
  const { searchDistance, pinned } = options;
  if (samples.length === 0 || meshes.length === 0 || searchDistance <= 0) {
    return samples.slice();
  }

  const out: Vec3[] = new Array(samples.length);
  const targets = meshes as THREE.Object3D[];

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i] as Vec3;

    if (pinned?.has(i)) {
      out[i] = sample;
      continue;
    }

    const normal = normals[i] ?? ([0, 1, 0] as Vec3);
    _sample.set(sample[0], sample[1], sample[2]);
    _direction.set(normal[0], normal[1], normal[2]);
    if (_direction.lengthSq() < 1e-12) {
      out[i] = sample;
      continue;
    }
    _direction.normalize();

    // Start outside and shoot inwards, so the first hit is the front face
    // rather than the inside of the far wall.
    _origin.copy(_sample).addScaledVector(_direction, searchDistance);
    raycaster.set(_origin, _direction.clone().negate());
    raycaster.far = searchDistance * 2;
    raycaster.near = 0;

    const hit = raycaster.intersectObjects(targets, true)[0];
    out[i] = hit ? [hit.point.x, hit.point.y, hit.point.z] : sample;
  }

  raycaster.far = Infinity;
  return out;
}

/**
 * Normals for every sample, interpolated from the control vertices.
 *
 * `resampleCurve` distributes samples uniformly in curve parameter, so sample
 * i belongs to the segment at `i / samplesPerSegment` - which is what lets the
 * two arrays line up without re-deriving the parameterisation.
 */
export function interpolateNormals(
  controlNormals: readonly Vec3[],
  sampleCount: number,
  closed: boolean
): Vec3[] {
  if (controlNormals.length === 0) {
    return new Array(sampleCount).fill([0, 1, 0] as Vec3);
  }
  if (controlNormals.length === 1 || sampleCount <= 1) {
    return new Array(sampleCount).fill(controlNormals[0] as Vec3);
  }

  const segments = closed ? controlNormals.length : controlNormals.length - 1;
  const out: Vec3[] = new Array(sampleCount);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i < sampleCount; i++) {
    const u = (i / (sampleCount - 1)) * segments;
    const segment = Math.min(Math.floor(u), segments - 1);
    const t = u - segment;

    const from = controlNormals[segment % controlNormals.length] as Vec3;
    const to = controlNormals[(segment + 1) % controlNormals.length] as Vec3;

    a.set(from[0], from[1], from[2]);
    b.set(to[0], to[1], to[2]);
    n.copy(a).lerp(b, t);
    if (n.lengthSq() < 1e-12) n.copy(a);
    n.normalize();
    out[i] = [n.x, n.y, n.z];
  }
  return out;
}

/**
 * Sample indices that coincide with control vertices, for `ProjectOptions.pinned`.
 * `resampleCurve` uses `divisions = segments * samplesPerSegment` and
 * `getPoints` returns `divisions + 1` evenly spaced points, so control vertex
 * k lands exactly on index `k * samplesPerSegment`.
 */
export function controlVertexSampleIndices(
  controlCount: number,
  samplesPerSegment: number,
  closed: boolean
): Set<number> {
  const indices = new Set<number>();
  const segments = closed ? controlCount : controlCount - 1;
  if (segments < 1) return indices;
  for (let k = 0; k <= segments; k++) indices.add(k * samplesPerSegment);
  return indices;
}
