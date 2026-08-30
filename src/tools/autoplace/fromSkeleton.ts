// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Placing guides from the character's own skeleton.
//
// When an asset arrives rigged, the answer is already in the file: a joint IS
// the position a guide wants, exactly, with no fitting and no guessing. This
// is the first and best tier of automatic placement, and the only one that can
// be right rather than merely plausible.
//
// The problem it has to solve is that a joint sits INSIDE the character - an
// elbow is in the middle of the arm - while a binding can only name a surface
// triangle. The resolution is the one the format already uses everywhere else:
// bind to the NEAREST triangle and record the offset from it, so
//
//     position = evaluate(binding) + offset
//
// lands on the joint exactly. The server therefore needs no skeleton, no
// UsdSkel support, and no knowledge that any of this happened - the same
// property that keeps subdivision out of the worker.
//
// Nothing here overwrites a guide the user placed. See `autoReplaceableIds`.
// ==========================================================================

import * as THREE from 'three';
import type { CharacterModel } from '../../io/CharacterModel';
import type { Guide, RiserDocument, TemplateDef, Vec3 } from '../../doc/types';
import { autoReplaceableIds } from '../../doc/types';
import { nearestPointOnMeshes, offsetToTarget } from '../../viewport/nearest';
import { worldToDocument } from '../../viewport/space';
import {
  JOINT_HINTS_BY_TEMPLATE,
  BIPED_JOINT_HINTS,
  matchJointsToGuides,
  type JointMatch
} from './jointNames';

/**
 * A joint further than this from the surface, as a fraction of character
 * height, is not believable as a guide for that character. It usually means
 * the rig and the mesh are in different spaces, or the match was wrong.
 */
const MAX_SURFACE_DISTANCE_FRACTION = 0.25;

export interface SkeletonPlacementOptions {
  /** Replace guides the user placed by hand. Off, and should stay off. */
  overwriteUserPlaced?: boolean;
}

export interface SkeletonPlacementResult {
  guides: Guide[];
  matches: JointMatch[];
  /** Template guides no joint could be found for. */
  unmatched: string[];
  /** Matched but rejected as implausible, with why. */
  rejected: { guideId: string; reason: string }[];
}

export const EMPTY_PLACEMENT: SkeletonPlacementResult = {
  guides: [],
  matches: [],
  unmatched: [],
  rejected: []
};

/**
 * Build guides from a character's skeleton.
 *
 * Pure with respect to the document: it returns guides rather than applying
 * them, so the caller decides how they enter the undo history.
 */
export function placeGuidesFromSkeleton(
  character: CharacterModel,
  documentRoot: THREE.Object3D,
  template: TemplateDef,
  doc: RiserDocument,
  options: SkeletonPlacementOptions = {}
): SkeletonPlacementResult {
  const skeleton = character.skeleton;
  if (!skeleton || skeleton.bones.length === 0) return EMPTY_PLACEMENT;

  const replaceable = options.overwriteUserPlaced
    ? null
    : autoReplaceableIds(doc);
  const placed = new Set(doc.guides.map((g) => g.id));

  const candidateIds = template.guides
    .map((g) => g.id)
    // A guide the user placed is off limits unless explicitly overridden.
    .filter((id) => !placed.has(id) || replaceable === null || replaceable.has(id));

  const hints = JOINT_HINTS_BY_TEMPLATE[template.id] ?? BIPED_JOINT_HINTS;
  const jointNames = skeleton.bones.map((b) => b.name);
  const matches = orderSpineChain(
    matchJointsToGuides(candidateIds, jointNames, hints),
    skeleton
  );

  const height = characterHeight(character);
  const maxDistance = height * MAX_SURFACE_DISTANCE_FRACTION;

  const guides: Guide[] = [];
  const rejected: SkeletonPlacementResult['rejected'] = [];
  const groupById = new Map(template.guides.map((g) => [g.id, g.group]));
  const worldJoint = new THREE.Vector3();

  for (const match of matches) {
    const bone = skeleton.bones[match.jointIndex];
    if (!bone) continue;
    bone.updateWorldMatrix(true, false);
    bone.getWorldPosition(worldJoint);

    const nearest = nearestPointOnMeshes(character.meshes, worldJoint);
    if (!nearest) {
      rejected.push({
        guideId: match.guideId,
        reason: 'no surface could be bound to'
      });
      continue;
    }

    // A joint a quarter of the character's height from any surface is not
    // describing this character. Placing it anyway would look like the app
    // scattering markers into empty space.
    if (nearest.distance > maxDistance) {
      rejected.push({
        guideId: match.guideId,
        reason: `joint "${match.jointName}" is ${nearest.distance.toFixed(2)} from the surface`
      });
      continue;
    }

    const offset = offsetToTarget(nearest, worldJoint);
    const position = worldToDocument(documentRoot, worldJoint.clone());
    const normal = surfaceNormal(nearest.worldPoint, worldJoint);

    guides.push({
      id: match.guideId,
      group: groupById.get(match.guideId) ?? '',
      position,
      normal,
      binding: {
        primPath: nearest.primPath,
        faceIndex: nearest.faceIndex,
        barycentric: nearest.barycentric,
        offset
      },
      source: 'skeleton',
      confidence: match.confidence
    });
  }

  const matchedIds = new Set(guides.map((g) => g.id));
  const unmatched = template.guides
    .filter((g) => !g.optional && !matchedIds.has(g.id))
    .map((g) => g.id);

  return { guides, matches, unmatched, rejected };
}

/**
 * Direction from the joint out to the surface point it bound to.
 *
 * For an interior joint this is the natural "which way is out", and it is what
 * the marker orients to. A joint sitting exactly on the surface has no such
 * direction, so it falls back to up rather than to a zero vector.
 */
function surfaceNormal(surfaceWorld: THREE.Vector3, jointWorld: THREE.Vector3): Vec3 {
  const dir = surfaceWorld.clone().sub(jointWorld);
  if (dir.lengthSq() < 1e-12) return [0, 1, 0];
  dir.normalize();
  return [dir.x, dir.y, dir.z];
}

function characterHeight(character: CharacterModel): number {
  const size = character.bounds.getSize(new THREE.Vector3());
  return Math.max(size.y, 1e-3);
}

/** Depth of a bone in the skeleton, counting parents up to the root. */
function boneDepth(bone: THREE.Object3D): number {
  let depth = 0;
  let current: THREE.Object3D | null = bone.parent;
  while (current) {
    depth++;
    current = current.parent;
  }
  return depth;
}

/**
 * Fix the spine assignment using the hierarchy, which is the only thing that
 * actually knows.
 *
 * Names cannot settle this: Mixamo's `Spine1` is the MID spine while Unreal's
 * `spine_01` is the LOWER one - the same string naming different bones. What
 * IS reliable is order. Whichever spine joints were matched, the one nearest
 * the root is the lower spine and the one furthest is the chest, so the
 * matched joints are re-dealt to the spine guides in template order.
 *
 * Only reorders among guides that were already matched, so it can correct a
 * mis-ranking without inventing a placement.
 */
export function orderSpineChain(
  matches: JointMatch[],
  skeleton: THREE.Skeleton
): JointMatch[] {
  const CHAIN = ['spine01', 'spine02', 'chest'];

  const inChain = matches.filter((m) => CHAIN.includes(m.guideId));
  if (inChain.length < 2) return matches;

  // Guides in template order (lowest first), joints in hierarchy order.
  const guideIds = CHAIN.filter((id) => inChain.some((m) => m.guideId === id));
  const joints = inChain
    .slice()
    .sort(
      (a, b) =>
        boneDepth(skeleton.bones[a.jointIndex] as THREE.Object3D) -
        boneDepth(skeleton.bones[b.jointIndex] as THREE.Object3D)
    );

  const reassigned = new Map<string, JointMatch>();
  guideIds.forEach((guideId, i) => {
    const joint = joints[i];
    if (!joint) return;
    reassigned.set(guideId, { ...joint, guideId });
  });

  return matches.map((m) => reassigned.get(m.guideId) ?? m);
}
