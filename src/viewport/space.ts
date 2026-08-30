// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Converting between the two coordinate spaces the app lives in.
//
//   DOCUMENT space   what a RiserDocument stores, and what the server
//                    evaluates. Equal to the character root's local space, so
//                    it is unaffected by the framing transform normalize.ts
//                    applies on load.
//
//   WORLD space      what the renderer and every raycast work in.
//
// Overlays are drawn in world space rather than parented under the character,
// because marker size is computed from distance to camera and a scaled parent
// would silently rescale every marker. That makes this conversion a real
// boundary, so it lives in one place instead of being re-derived per tool.
// ==========================================================================

import * as THREE from 'three';
import type { Vec3 } from '../doc/types';

const _matrix3 = new THREE.Matrix3();

export function documentToWorld(
  characterRoot: THREE.Object3D,
  point: Vec3,
  target = new THREE.Vector3()
): THREE.Vector3 {
  characterRoot.updateWorldMatrix(true, false);
  return target.set(point[0], point[1], point[2]).applyMatrix4(characterRoot.matrixWorld);
}

export function worldToDocument(
  characterRoot: THREE.Object3D,
  world: THREE.Vector3
): Vec3 {
  characterRoot.updateWorldMatrix(true, false);
  const local = world.clone().applyMatrix4(
    new THREE.Matrix4().copy(characterRoot.matrixWorld).invert()
  );
  return [local.x, local.y, local.z];
}

/** Directions ignore translation and need the inverse-transpose for scale. */
export function documentToWorldDirection(
  characterRoot: THREE.Object3D,
  dir: Vec3,
  target = new THREE.Vector3()
): THREE.Vector3 {
  characterRoot.updateWorldMatrix(true, false);
  _matrix3.getNormalMatrix(characterRoot.matrixWorld);
  return target.set(dir[0], dir[1], dir[2]).applyMatrix3(_matrix3).normalize();
}

export function worldToDocumentDirection(
  characterRoot: THREE.Object3D,
  dir: THREE.Vector3
): Vec3 {
  characterRoot.updateWorldMatrix(true, false);
  _matrix3.setFromMatrix4(characterRoot.matrixWorld).invert();
  const local = dir.clone().applyMatrix3(_matrix3).normalize();
  return [local.x, local.y, local.z];
}

/**
 * Uniform scale factor from document to world. Normalization only ever applies
 * a uniform scale (see normalize.ts), so one number is the whole story, and
 * lengths - offsets, curve widths, click tolerances - convert by multiplying.
 */
export function documentToWorldScale(characterRoot: THREE.Object3D): number {
  characterRoot.updateWorldMatrix(true, false);
  return characterRoot.matrixWorld.getMaxScaleOnAxis() || 1;
}
