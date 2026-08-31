// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Blend shapes: finding them on a character, and driving them.
//
// WHY A MARKER TOOL CARES. A face marker placed on a neutral face has to still
// be right when the face moves. A brow guide that sits perfectly at rest and
// slides off the brow ridge the moment the character raises an eyebrow is a
// guide that will produce a bad rig, and there is no way to notice that
// without being able to fire the shape and look.
//
// So this is a checking tool, not an animation tool. It drives shapes and puts
// them back; it does not key them, blend between them, or save them. The
// document is untouched - a marker's binding names a triangle on the neutral
// mesh, and posing the mesh for a look does not change which triangle that is.
//
// THE NAMES ARE THE ASSET'S. three exposes morph targets as
// `morphTargetDictionary` (name -> index) and `morphTargetInfluences` (a flat
// array of weights). A character usually spreads the same logical shape across
// several meshes - a smile moves the face, the teeth and the tongue - so the
// same name appears on more than one mesh and all of them have to move
// together. That grouping is what this module is for; everything else is a
// slider.
// ==========================================================================

import * as THREE from 'three';

export interface BlendShapeTarget {
  /** The mesh carrying this shape. */
  mesh: THREE.Mesh;
  /** Index into that mesh's `morphTargetInfluences`. */
  index: number;
}

export interface BlendShape {
  /** The name the asset gave it. */
  name: string;
  /** Every mesh/index pair that this name drives. */
  targets: BlendShapeTarget[];
}

/**
 * Every blend shape on a character, grouped by name.
 *
 * Sorted by name so the list is stable between loads. Meshes with morph
 * geometry but no dictionary - which is legal, and which some exporters
 * produce - are named by index so they are at least drivable rather than
 * invisible.
 */
export function findBlendShapes(meshes: readonly THREE.Mesh[]): BlendShape[] {
  const byName = new Map<string, BlendShapeTarget[]>();

  for (const mesh of meshes) {
    const influences = mesh.morphTargetInfluences;
    if (!influences || influences.length === 0) continue;

    const dictionary = mesh.morphTargetDictionary;
    if (dictionary) {
      for (const [name, index] of Object.entries(dictionary)) {
        push(byName, name, { mesh, index });
      }
      continue;
    }

    // No names. Better a numbered shape than a shape nobody can reach.
    for (let index = 0; index < influences.length; index++) {
      push(byName, `Shape ${index + 1}`, { mesh, index });
    }
  }

  return [...byName.entries()]
    .map(([name, targets]) => ({ name, targets }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function push(
  map: Map<string, BlendShapeTarget[]>,
  name: string,
  target: BlendShapeTarget
): void {
  const existing = map.get(name);
  if (existing) existing.push(target);
  else map.set(name, [target]);
}

/** The current weight of a shape, taken from its first target. */
export function weightOf(shape: BlendShape): number {
  const first = shape.targets[0];
  if (!first) return 0;
  return first.mesh.morphTargetInfluences?.[first.index] ?? 0;
}

/**
 * Drive a shape.
 *
 * Every mesh carrying the name moves together, which is the whole reason
 * shapes are grouped: a smile that moved the face and left the teeth behind
 * would look like a bug in Riser rather than a feature of the asset.
 */
export function setWeight(shape: BlendShape, weight: number): void {
  const clamped = Math.min(1, Math.max(0, weight));
  for (const target of shape.targets) {
    const influences = target.mesh.morphTargetInfluences;
    if (influences && target.index < influences.length) {
      influences[target.index] = clamped;
    }
  }
}

/** Put every shape back to rest. */
export function resetAll(shapes: readonly BlendShape[]): void {
  for (const shape of shapes) setWeight(shape, 0);
}

/** Shapes currently doing something, for the "N active" badge. */
export function activeCount(shapes: readonly BlendShape[]): number {
  return shapes.filter((shape) => weightOf(shape) > 0.001).length;
}
