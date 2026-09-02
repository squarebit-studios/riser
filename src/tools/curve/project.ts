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
import { resampleCurve, type CurveDegree } from './geometry';

/**
 * How far to search either side of a sample, as a fraction of character
 * height. Large enough to cross the gap a smooth curve leaves over a nose,
 * small enough not to snap the jawline onto the shoulder behind it.
 */
export const SEARCH_FRACTION = 0.03;

/**
 * How far a sample may be re-seated, relative to the gap between control
 * vertices.
 *
 * The search exists to correct a smooth curve that sags off a surface between
 * the points it was drawn through, and that sag is small: for points a gap `d`
 * apart on a surface of radius `R` it is about `d*d/(8R)`, always a small
 * fraction of `d` itself. So a search wider than the gap is not buying
 * accuracy, it is buying the chance to find something else entirely.
 *
 * That is what a traced eyelid ran into. Sizing the search off the CHARACTER
 * gives centimetres, and a lid is traced with points a couple of millimetres
 * apart with an eyeball right behind it, so the correction had licence to
 * travel many times the distance between the points and drag the curve
 * somewhere nobody put it.
 */
export const SEARCH_GAP_FRACTION = 0.5;

/**
 * How far to search either side of a curve, given the character and the curve.
 *
 * The smaller of what the character allows and what the curve's own spacing
 * justifies, so a jawline drawn with wide steps still gets a useful search and
 * a lid traced with tight ones gets a tight one.
 */
export function searchDistanceFor(
  points: readonly Vec3[],
  characterHeight: number
): number {
  const byCharacter = characterHeight * SEARCH_FRACTION;

  const gaps: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Vec3;
    const b = points[i] as Vec3;
    gaps.push(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  if (gaps.length === 0) return Math.max(byCharacter, 1e-4);

  // The median rather than the mean: one deliberately long step across a gap
  // in the mesh should not license a wide search for the whole curve.
  gaps.sort((x, y) => x - y);
  const median = gaps[Math.floor(gaps.length / 2)] as number;

  return Math.max(Math.min(byCharacter, median * SEARCH_GAP_FRACTION), 1e-4);
}

const _origin = new THREE.Vector3();
const _direction = new THREE.Vector3();
const _sample = new THREE.Vector3();
const _reach = new THREE.Box3();
const _meshBox = new THREE.Box3();

/**
 * The meshes a curve could possibly touch, out of everything handed in.
 *
 * A curve is a local thing. A brow sits in a few centimetres of face, and the
 * search either side of it is a few centimetres more, so it cannot reach the
 * boots, the belt, or the far side of the head. The cast does not know that:
 * `intersectObjects` walks every mesh for every sample, and transforms the ray
 * into each one's local space to find out it was nowhere near. On a character
 * of thirty pieces, each carrying its subdivided self, that is around sixty
 * of those per sample and several hundred samples per curve, and it was most
 * of the cost of drawing.
 *
 * Rejecting them once, against a box, replaces all of it. The filter is
 * deliberately generous: it takes anything whose world bounds come within
 * `reach` of the curve, so a mesh that could hold a hit is never dropped and
 * the result is the same set of hits the unfiltered cast would have found.
 * Being wrong here would be invisible and serious, because a curve that misses
 * the surface still draws, just in the wrong place.
 */
function meshesNear(
  targets: readonly THREE.Object3D[],
  samples: readonly Vec3[],
  reach: number
): THREE.Object3D[] {
  _reach.makeEmpty();
  for (const sample of samples)
    _reach.expandByPoint(_sample.set(sample[0], sample[1], sample[2]));
  // Everything the ray can see from anywhere on the curve, and a little more:
  // the rays start `reach` out along the normal and run twice that far.
  _reach.expandByScalar(reach * 2 + 1e-6);

  const near: THREE.Object3D[] = [];
  for (const target of targets) {
    target.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || mesh.visible === false) return;
      const geometry = mesh.geometry;
      if (!geometry) return;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      if (!box) return;
      _meshBox.copy(box).applyMatrix4(mesh.matrixWorld);
      if (_meshBox.intersectsBox(_reach)) near.push(mesh);
    });
  }
  return near;
}

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
  // Narrowed once for the whole curve rather than reconsidered per sample.
  // Already flat, so the cast does not need to recurse either.
  const targets = meshesNear(meshes, samples, searchDistance);
  if (targets.length === 0) return samples.slice();

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

    const hit = raycaster.intersectObjects(targets, false)[0];
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
 * Search directions for every sample, through the SAME basis as the positions.
 *
 * The direction a sample searches along has to belong to that sample. Deriving
 * it separately means two parameterisations that have to agree by argument
 * rather than by construction, and they stopped agreeing the moment the drawn
 * curve changed degree: `interpolateNormals` spreads the control normals
 * assuming the cubic's layout, where an open curve has one fewer span than it
 * has points and every tenth sample sits exactly on a control vertex. A
 * quadratic has a span per point and sits on none of them, so each sample was
 * handed a normal from slightly the wrong place along the curve.
 *
 * The error is small, and on a gently curved surface it disappears entirely
 * because a slightly wrong normal still points at the same skin. Around an eye
 * or a lip, where the surface turns fast and there is another surface just
 * behind it, a slightly wrong direction finds a different piece of the
 * character. The samples that miss snap somewhere else and the drawn curve
 * zig-zags between the two.
 *
 * Running the control normals through the same resampler as the positions
 * removes the class of bug rather than this instance of it: whatever basis the
 * positions are drawn with, the directions are built by it too, so sample i's
 * direction is always sample i's.
 */
export function sampleDirections(
  controlNormals: readonly Vec3[],
  closed: boolean,
  samplesPerSegment: number,
  degree: CurveDegree
): Vec3[] {
  // Interpolating a direction gives a vector that is short in the turns and
  // is not a direction until it is normalised.
  return resampleCurve(controlNormals, closed, samplesPerSegment, degree).map((n) => {
    const length = Math.hypot(n[0], n[1], n[2]);
    return (length < 1e-12 ? n : [n[0] / length, n[1] / length, n[2] / length]) as Vec3;
  });
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
