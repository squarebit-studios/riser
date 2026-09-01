// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Making raycasts survive a production character.
//
// Every interaction in Riser is a raycast. Placing a marker casts against the
// displayed surface and the cage; measuring a volume casts through the whole
// character; the depth readout searches for the nearest point on a mesh. All
// of them are linear in triangle count out of the box, and three's own
// `Mesh.raycast` walks every face of any mesh whose bounding box the ray
// touches.
//
// On a blockout that is free - two meshes, a couple of thousand triangles. On
// the first real character it stopped being free: 33 meshes and 137k triangles
// put a single pick at 220ms, and a click that placed a mirrored marker paid
// for three of them plus a through-cast. The user reported markers taking "a
// second or two" to appear, and they were right.
//
// three-mesh-bvh builds a bounding volume hierarchy per geometry and swaps in
// a raycast that descends it. It is the standard answer, it is the same
// library three's own examples reach for, and it turns those linear scans into
// logarithmic ones.
//
// WHAT THIS DOES NOT DO. It does not change a single result. A BVH is an index
// over the same triangles - the same face is hit, the same barycentric
// coordinate comes back, the same binding is written. If that were not true it
// would be unusable here, because a binding is a promise about a specific
// triangle that the Python worker re-evaluates independently.
// ==========================================================================

import * as THREE from 'three';
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
  type MeshBVH
} from 'three-mesh-bvh';

/**
 * Install the accelerated raycast on THREE.Mesh, once.
 *
 * A prototype patch, which is how this library is designed to be used. It is
 * inert until a geometry actually has a `boundsTree`, so meshes that were
 * never prepared behave exactly as before rather than breaking.
 */
let installed = false;

/**
 * Meshes whose raycast this module replaced, so the change can be undone.
 *
 * Held here rather than on the mesh because it has to be reversible per
 * character: a posed character must go back to three's skinning-aware
 * raycast, which is slower and correct.
 */
const accelerated = new Set<THREE.Mesh>();
const originalRaycast = THREE.Mesh.prototype.raycast;

export function installAcceleratedRaycast(): void {
  if (installed) return;
  installed = true;

  (
    THREE.BufferGeometry.prototype as unknown as {
      computeBoundsTree: typeof computeBoundsTree;
    }
  ).computeBoundsTree = computeBoundsTree;
  (
    THREE.BufferGeometry.prototype as unknown as {
      disposeBoundsTree: typeof disposeBoundsTree;
    }
  ).disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
}

type WithBoundsTree = THREE.BufferGeometry & {
  boundsTree?: MeshBVH;
  computeBoundsTree?: () => void;
  disposeBoundsTree?: () => void;
};

/**
 * Build a BVH for every mesh under `root`.
 *
 * Called once when a character is loaded. Building costs time proportional to
 * the triangle count - tens of milliseconds on a heavy character - and is paid
 * once, against every pick for the life of that character.
 *
 * Geometry that already has a tree is skipped, so this is safe to call again
 * after a subdivision rebuild adds new meshes.
 */
export function accelerate(root: THREE.Object3D): number {
  installAcceleratedRaycast();

  let built = 0;
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;

    const geometry = mesh.geometry as WithBoundsTree;
    if (!geometry || geometry.boundsTree) return;
    const position = geometry.getAttribute('position');
    if (!position || position.count === 0) return;

    try {
      geometry.computeBoundsTree?.();
      // Assigned per mesh rather than left to the prototype patch, because
      // SkinnedMesh overrides `raycast` with its own skinning-aware version
      // and the prototype patch never reaches it. On a production character
      // every mesh is skinned, so without this the acceleration applied to
      // nothing at all - measured, after assuming otherwise.
      //
      // THE ASSUMPTION THIS CARRIES: a BVH indexes the REST geometry, so a
      // pick is only correct while the skeleton is at its bind pose. That is
      // true in Riser today - nothing drives the rig - but it stops being true
      // the moment animation playback exists, and a marker placed against a
      // moving character would then bind to the wrong triangle. See
      // `setPosed` below.
      mesh.raycast = acceleratedRaycast;
      accelerated.add(mesh);
      built++;
    } catch (error) {
      // A geometry the builder cannot index still raycasts the slow way, which
      // is exactly what happened before this existed. Never worth failing a
      // character load over.
      console.warn('Could not accelerate a mesh; picking it will be slower.', error);
    }
  });
  return built;
}

/**
 * A raycaster that stops at the closest hit instead of collecting every one.
 *
 * three-mesh-bvh only descends to the nearest triangle and stops when
 * `firstHitOnly` is set. Without it the accelerated raycast still walks every
 * branch the ray touches, gathers every intersection along its whole length
 * and sorts them, which on a character means every layer of clothing, the body
 * under it, and the far wall of both.
 *
 * For a caller that reads `[0]` and discards the rest, all of that work is
 * thrown away, and the answer is identical either way: the closest hit is the
 * closest hit whether or not the ones behind it were collected. The flag is
 * off by default because a caller that genuinely wants every hit needs it off,
 * which is why this is a separate constructor rather than a global change.
 */
export function firstHitRaycaster(): THREE.Raycaster {
  const raycaster = new THREE.Raycaster();
  (raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
  return raycaster;
}

/**
 * Say whether the character is currently posed away from its bind pose.
 *
 * A BVH indexes rest geometry. While the skeleton sits at bind pose that is
 * the same thing the user sees, and the fast path is exactly correct. Once
 * something drives the rig it is not, and picking has to go back to three's
 * skinning-aware raycast or markers would bind to triangles where the
 * character used to be.
 *
 * Slower and right beats faster and wrong: this is the whole reason the
 * assignment is per mesh and reversible.
 */
export function setPosed(posed: boolean): void {
  for (const mesh of accelerated) {
    mesh.raycast = posed
      ? ((mesh.constructor.prototype as THREE.Mesh).raycast ?? originalRaycast)
      : acceleratedRaycast;
  }
}

/** Release the BVHs under `root`, so a character swap does not leak them. */
export function releaseAcceleration(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry as WithBoundsTree;
    if (geometry?.boundsTree) geometry.disposeBoundsTree?.();
    accelerated.delete(mesh);
  });
}

/**
 * The nearest point on a mesh, through its BVH when it has one.
 *
 * Returns null when the mesh is not accelerated, so the caller can fall back
 * to its own brute-force search rather than this quietly returning a wrong
 * answer.
 */
export function nearestPointAccelerated(
  mesh: THREE.Mesh,
  worldPoint: THREE.Vector3
): { point: THREE.Vector3; faceIndex: number; distance: number } | null {
  const geometry = mesh.geometry as WithBoundsTree;
  const tree = geometry?.boundsTree;
  if (!tree) return null;

  mesh.updateWorldMatrix(true, false);
  const local = worldPoint
    .clone()
    .applyMatrix4(new THREE.Matrix4().copy(mesh.matrixWorld).invert());

  const target = {} as {
    point: THREE.Vector3;
    distance: number;
    faceIndex: number;
  };
  const hit = tree.closestPointToPoint(local, target);
  if (!hit || hit.faceIndex === undefined) return null;

  const world = hit.point.clone().applyMatrix4(mesh.matrixWorld);
  return {
    point: world,
    faceIndex: hit.faceIndex,
    distance: world.distanceTo(worldPoint)
  };
}
