// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Reflecting a surface pick across the character's symmetry plane.
//
// Characters are modelled symmetric about local x = 0 essentially without
// exception, so that is the plane, and it is not worth detecting: a wrong
// guess would mirror everything to the wrong place, whereas a fixed plane
// fails visibly on the rare asymmetric asset and the user turns symmetry off.
//
// The important part is that reflecting a POSITION is not enough. A binding
// has to name a triangle, and the reflected point is only a point in space -
// on an asymmetric mesh there may be no triangle there at all. So the mirror
// is completed by casting a ray back at the reflected point along the
// reflected normal, and a miss returns null rather than a fabricated binding.
// ==========================================================================

import * as THREE from 'three';
import type { SurfacePick, SurfacePicker } from '../viewport/Picker';
import {
  documentToWorld,
  documentToWorldDirection,
  worldToDocument,
  worldToDocumentDirection
} from '../viewport/space';

export interface MirrorContext {
  picker: SurfacePicker;
  characterRoot: THREE.Object3D;
  meshes: THREE.Object3D[];
  /** Character height in world units; sets the search range. */
  characterHeight: number;
}

/**
 * Mirror a pick, or return null when the far side has no surface to bind to.
 *
 * Reflection happens on the DISPLAYED surface - the point and normal the user
 * actually clicked - and the mirrored ray is then resolved into a fresh
 * two-surface pick. Reflecting the cage binding instead would be wrong twice
 * over: the cage triangulation is not perfectly mirror-symmetric, and the
 * cage-to-limit offset does not simply negate.
 */
export function mirrorPick(pick: SurfacePick, ctx: MirrorContext): SurfacePick | null {
  const { picker, characterRoot, meshes, characterHeight } = ctx;
  if (meshes.length === 0) return null;

  const local = worldToDocument(characterRoot, pick.worldPoint.clone());
  const localNormal = worldToDocumentDirection(characterRoot, pick.normal.clone());

  const reflected = documentToWorld(characterRoot, [-local[0], local[1], local[2]]);
  const reflectedNormal = documentToWorldDirection(characterRoot, [
    -localNormal[0],
    localNormal[1],
    localNormal[2]
  ]);

  // Back off along the normal so the ray starts outside the mesh and hits the
  // near face, then search twice that far to be sure of crossing the surface.
  const reach = Math.max(characterHeight * 0.5, 1e-3);
  const origin = reflected.clone().addScaledVector(reflectedNormal, reach);
  const direction = reflectedNormal.clone().negate();

  return picker.pickAlongRay(origin, direction, meshes, reach * 2);
}

/** Reflect a document-space position across the symmetry plane. */
export function mirrorPosition(
  position: readonly [number, number, number]
): [number, number, number] {
  return [-position[0], position[1], position[2]];
}
