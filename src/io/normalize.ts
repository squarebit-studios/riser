// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Putting an arbitrary character into a known pose in world space.
//
// INVARIANT, and the reason this file is careful: normalization is only ever
// applied to the ROOT GROUP's transform. It is never baked into vertex data.
// Surface bindings are expressed in each mesh's own local space, so as long as
// we only touch ancestors, a marker placed before a rescale is still correct
// after it. Bake a scale into a BufferGeometry here and every stored binding
// silently moves.
// ==========================================================================

import * as THREE from 'three';
import type { Vec3 } from '../doc/types';

export interface FitOptions {
  /**
   * Height in metres to scale the character to, or null to leave its scale
   * alone. Used only when the source format did not tell us its units.
   */
  targetHeight?: number | null;
  /** Sit the lowest point on y = 0. */
  groundAlign?: boolean;
  /** Centre the character on the world Y axis. */
  recenterXZ?: boolean;
}

export interface FitTransform {
  scale: number;
  offset: Vec3;
}

export const IDENTITY_FIT: FitTransform = { scale: 1, offset: [0, 0, 0] };

/**
 * Work out the root transform that puts `box` where we want it.
 *
 * Order matters and is fixed: scale about the origin first, then translate.
 * `applyFit` composes them the same way, and so does the server.
 */
export function computeFitTransform(
  box: THREE.Box3,
  options: FitOptions = {}
): FitTransform {
  if (box.isEmpty()) return IDENTITY_FIT;

  const { targetHeight = null, groundAlign = true, recenterXZ = true } = options;

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  let scale = 1;
  if (targetHeight && size.y > 1e-9) scale = targetHeight / size.y;

  const offset: [number, number, number] = [0, 0, 0];
  if (recenterXZ) {
    offset[0] = -center.x * scale;
    offset[2] = -center.z * scale;
  }
  if (groundAlign) {
    offset[1] = -box.min.y * scale;
  }

  return { scale, offset };
}

/** Apply a fit to a root object, composing with whatever transform it has. */
export function applyFit(root: THREE.Object3D, fit: FitTransform): void {
  root.scale.multiplyScalar(fit.scale);
  root.position.set(
    root.position.x * fit.scale + fit.offset[0],
    root.position.y * fit.scale + fit.offset[1],
    root.position.z * fit.scale + fit.offset[2]
  );
  root.updateMatrixWorld(true);
}

/**
 * Best guess at the unit scale of a file that did not declare one - OBJ always,
 * FBX often.
 *
 * The heuristic assumes the subject is roughly person-sized, which is true of
 * the characters this app exists for. It is only ever a fallback: USD and glTF
 * both state their units, and we believe them.
 */
export function guessUnitScale(box: THREE.Box3): number {
  if (box.isEmpty()) return 1;
  const height = box.getSize(new THREE.Vector3()).y;
  if (height > 500) return 0.001; // millimetres
  if (height > 8) return 0.01; // centimetres
  return 1; // already metres
}

/** Rotate a Z-up hierarchy into three.js's Y-up world. */
export function applyZUpToYUp(root: THREE.Object3D): void {
  root.rotation.x -= Math.PI / 2;
  root.updateMatrixWorld(true);
}

/** Bounding box of an object in world space, ignoring anything invisible. */
export function visibleBounds(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible || !mesh.geometry) return;
    mesh.geometry.computeBoundingBox();
    const b = mesh.geometry.boundingBox;
    if (!b) return;
    box.union(b.clone().applyMatrix4(mesh.matrixWorld));
  });
  return box;
}
