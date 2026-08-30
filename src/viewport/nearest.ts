// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Nearest point on a mesh's surface to an arbitrary point in space.
//
// Picking answers "what did the user click", which is a ray question. This
// answers a different one: "which triangle is this point nearest to". Automatic
// placement needs it because a skeleton joint sits INSIDE the character - an
// elbow is in the middle of the arm - so there is no ray from the camera that
// finds it, and a binding still has to name a triangle.
//
// Deliberately brute force. A character is a few thousand triangles and this
// runs once per guide on a button press, not per frame: ~20 guides over ~2,000
// triangles is 40,000 point-triangle tests, which is microseconds. A BVH would
// be faster and would also be a data structure to build, invalidate and get
// wrong. The triangle reject below is enough to keep a dense upload from
// turning this into a stall, and it is a proof rather than a guess.
// ==========================================================================

import * as THREE from 'three';
import { barycentricAt, readTriangle, triangleCount } from './Picker';
import type { Vec3 } from '../doc/types';

export interface NearestSurfacePoint {
  mesh: THREE.Mesh;
  primPath: string;
  faceIndex: number;
  barycentric: Vec3;
  /** The closest point, in the mesh's local space. */
  localPoint: THREE.Vector3;
  /** The closest point, in world space. */
  worldPoint: THREE.Vector3;
  /** Distance from the query point, in world units. */
  distance: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _local = new THREE.Vector3();
const _triangle = new THREE.Triangle();
const _inverse = new THREE.Matrix4();

/**
 * Nearest point on a single mesh, or null if it has no usable triangles.
 *
 * `worldPoint` is in world space; the search runs in the mesh's local space,
 * which is where its vertices already live and where the binding will be
 * expressed. That is only valid for a uniform scale - which is what the
 * character pipeline produces (see normalize.ts) - and `worldDistance` is
 * corrected for it so results across meshes stay comparable.
 */
export function nearestPointOnMesh(
  mesh: THREE.Mesh,
  worldPoint: THREE.Vector3
): NearestSurfacePoint | null {
  const count = triangleCount(mesh.geometry);
  if (count === 0) return null;

  mesh.updateWorldMatrix(true, false);
  _inverse.copy(mesh.matrixWorld).invert();
  const query = worldPoint.clone().applyMatrix4(_inverse);

  const scale = mesh.matrixWorld.getMaxScaleOnAxis() || 1;

  let bestDistanceSq = Infinity;
  let bestFace = -1;
  const bestPoint = new THREE.Vector3();

  for (let faceIndex = 0; faceIndex < count; faceIndex++) {
    if (!readTriangle(mesh.geometry, faceIndex, _a, _b, _c)) continue;

    // Conservative reject, not a heuristic. Every point of a triangle lies
    // within `maxEdge` of corner A, so the closest point cannot be nearer than
    // (distance to A - maxEdge). If even that lower bound loses, the triangle
    // cannot win and the exact test can be skipped. An approximate reject here
    // would silently bind a marker to the wrong triangle.
    if (bestFace !== -1) {
      const toCorner = _a.distanceTo(query);
      const maxEdge = Math.sqrt(
        Math.max(_a.distanceToSquared(_b), _a.distanceToSquared(_c))
      );
      const lowerBound = toCorner - maxEdge;
      if (lowerBound > 0 && lowerBound * lowerBound > bestDistanceSq) continue;
    }

    _triangle.set(_a, _b, _c);
    _triangle.closestPointToPoint(query, _closest);
    const distanceSq = _closest.distanceToSquared(query);

    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestFace = faceIndex;
      bestPoint.copy(_closest);
    }
  }

  if (bestFace === -1) return null;

  const barycentric = barycentricAt(mesh.geometry, bestFace, bestPoint);
  // A degenerate winning triangle has no barycentric coordinate, so it cannot
  // carry a binding. Rare, and the caller falls back to leaving the guide
  // unbound rather than inventing one.
  if (!barycentric) return null;

  return {
    mesh,
    primPath: (mesh.userData.primPath as string) ?? '',
    faceIndex: bestFace,
    barycentric,
    localPoint: bestPoint.clone(),
    worldPoint: bestPoint.clone().applyMatrix4(mesh.matrixWorld),
    distance: Math.sqrt(bestDistanceSq) * scale
  };
}

/** Nearest point across several meshes - the character's body and head, say. */
export function nearestPointOnMeshes(
  meshes: readonly THREE.Mesh[],
  worldPoint: THREE.Vector3
): NearestSurfacePoint | null {
  let best: NearestSurfacePoint | null = null;
  for (const mesh of meshes) {
    const hit = nearestPointOnMesh(mesh, worldPoint);
    if (hit && (!best || hit.distance < best.distance)) best = hit;
  }
  return best;
}

/**
 * The offset that makes a binding resolve to `worldTarget` exactly.
 *
 * This is the piece that lets an interior joint be expressed as a surface
 * binding at all: bind to the nearest triangle, then record how far off that
 * surface the real point is. `position = evaluate(binding) + offset` then holds
 * for a point the surface never touches, and the server needs to know nothing
 * about skeletons.
 */
export function offsetToTarget(
  nearest: NearestSurfacePoint,
  worldTarget: THREE.Vector3
): Vec3 {
  nearest.mesh.updateWorldMatrix(true, false);
  _inverse.copy(nearest.mesh.matrixWorld).invert();
  _local.copy(worldTarget).applyMatrix4(_inverse);
  return [
    _local.x - nearest.localPoint.x,
    _local.y - nearest.localPoint.y,
    _local.z - nearest.localPoint.z
  ];
}
