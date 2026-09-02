// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Giving a position that already exists a binding, without moving it.
//
// A position on its own is not enough for the document. The format's one
// invariant is `position = evaluate(binding) + offset`, and the Python worker
// re-evaluates it independently, so anything that produces a point has to
// produce the triangle and the displacement that resolve back to it.
//
// THIS DOES NOT MOVE THE POINT. That is the whole difference between it and
// the ray that used to do this job. Firing a ray asks "what is the surface in
// this direction", which answers with wherever the ray happens to land, and
// mirroring a lid found eyelashes, the nose, or nothing at all depending on
// which way the reflected normal pointed. There is no direction here: it asks
// which triangle is NEAREST, records how far off it the point is, and leaves
// the point exactly where the caller put it. A mirrored point is therefore
// exactly the reflection of its source, which is what a mirror means.
// ==========================================================================

import type * as THREE from 'three';
import type { SurfaceBinding, Vec3 } from '../doc/types';
import { nearestPointOnMeshes, offsetToTarget } from '../viewport/nearest';
import { documentToWorld, worldToDocument } from '../viewport/space';

/**
 * The binding for a document-space position, or null when there is no
 * geometry to bind to at all.
 *
 * The returned position is the one that was passed in, unchanged. It is
 * returned anyway so callers read as "here is the point and its binding"
 * rather than having to remember that one of the two came back untouched.
 */
export function bindAtPosition(
  position: Vec3,
  documentRoot: THREE.Object3D,
  meshes: readonly THREE.Mesh[]
): { position: Vec3; binding: SurfaceBinding } | null {
  if (meshes.length === 0) return null;

  const world = documentToWorld(documentRoot, position);
  const nearest = nearestPointOnMeshes(meshes, world);
  if (!nearest) return null;

  return {
    // Round-tripped rather than passed straight through, so the value stored
    // is the one the space conversion actually represents.
    position: worldToDocument(documentRoot, world.clone()),
    binding: {
      primPath: nearest.primPath,
      faceIndex: nearest.faceIndex,
      barycentric: nearest.barycentric,
      // Whatever is left between the nearest triangle and the point itself.
      // Zero when the point is on the surface, which is the ordinary case for
      // a mirrored point on a symmetric character.
      offset: offsetToTarget(nearest, world)
    }
  };
}
