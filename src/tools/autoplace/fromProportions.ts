// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Placing guides on a character that has no skeleton.
//
// This is the common case. Most uploads are a mesh and nothing else, so there
// is no exact answer to read and the app has to work it out from the shape.
//
// It is a fallback for fromSkeleton.ts, and honest about being one. A rig gives
// the right answer; this gives a plausible one, and the confidence it reports
// says which you are looking at. The point is not to be correct - it is to
// stop the user placing forty markers from scratch when thirty of them were
// predictable, and to leave them adjusting rather than starting.
//
// Two layers, deliberately separate:
//
//   profile.ts   MEASURES the character. Where the legs stop, where the torso
//                narrows, how far the arms reach. No assumptions about
//                proportion at all.
//   this file    turns those measurements into guides, using standard human
//                ratios only where the shape cannot say - the height of a knee
//                between the floor and the crotch, say.
//
// Measure first, assume second. Reversed, you get an app that ignores the
// character it was given.
// ==========================================================================

import * as THREE from 'three';
import type { CharacterModel } from '../../io/CharacterModel';
import type { Guide, RiserDocument, TemplateDef, Vec3 } from '../../doc/types';
import { autoReplaceableIds } from '../../doc/types';
import { nearestPointOnMeshes, offsetToTarget } from '../../viewport/nearest';
import { worldToDocument } from '../../viewport/space';
import { buildProfile, findLandmarks, type BodyLandmarks, type BodyProfile } from './profile';
import { sampleSurfacePoints } from './sampleSurface';

/**
 * Below this, the shape did not look enough like a biped to place anything.
 *
 * The stock quadruped scores 0.5, and placing human guides on a horse is worse
 * than placing none: the user then has to notice and undo thirty markers
 * rather than simply start.
 */
const MIN_CONFIDENCE = 0.7;

export interface ProportionPlacementResult {
  guides: Guide[];
  landmarks: BodyLandmarks | null;
  /** Required template guides this could not place. */
  unmatched: string[];
  /** Why nothing was placed, when nothing was. */
  reason: string | null;
}

const NOTHING: ProportionPlacementResult = {
  guides: [],
  landmarks: null,
  unmatched: [],
  reason: null
};

export interface ProportionOptions {
  overwriteUserPlaced?: boolean;
}

/**
 * A target position for one guide, before it is bound to the surface.
 *
 * `surface` says whether the point belongs ON the skin. A chin does; an elbow
 * centre does not, and forcing it to the surface would put it on the outside
 * of the arm.
 */
interface Target {
  id: string;
  world: THREE.Vector3;
  surface: boolean;
  confidence: number;
}

export function placeGuidesFromProportions(
  character: CharacterModel,
  documentRoot: THREE.Object3D,
  template: TemplateDef,
  doc: RiserDocument,
  options: ProportionOptions = {}
): ProportionPlacementResult {
  if (character.meshes.length === 0) {
    return { ...NOTHING, reason: 'This character has no geometry to measure.' };
  }

  const profile = buildProfile(sampleSurfacePoints(character.meshes));
  const landmarks = findLandmarks(profile);
  if (!landmarks) {
    return { ...NOTHING, reason: 'The character is too small or too sparse to measure.' };
  }

  if (landmarks.confidence < MIN_CONFIDENCE) {
    return {
      ...NOTHING,
      landmarks,
      reason:
        'This does not measure like a two-legged figure, so guides would be ' +
        'guesses in the wrong places. Place them by hand.'
    };
  }

  const replaceable = options.overwriteUserPlaced ? null : autoReplaceableIds(doc);
  const placedAlready = new Set(doc.guides.map((g) => g.id));
  const allowed = (id: string): boolean =>
    !placedAlready.has(id) || replaceable === null || replaceable.has(id);

  const wanted = new Set(template.guides.map((g) => g.id));
  const interiorIds = new Set(
    template.guides.filter((g) => g.interior).map((g) => g.id)
  );
  const groupById = new Map(template.guides.map((g) => [g.id, g.group]));

  const targets = buildTargets(profile, landmarks).filter(
    (t) => wanted.has(t.id) && allowed(t.id)
  );

  const guides: Guide[] = [];
  for (const target of targets) {
    const nearest = nearestPointOnMeshes(character.meshes, target.world);
    if (!nearest) continue;

    // A guide that belongs on the skin is snapped to it; one that belongs
    // inside keeps the offset that puts it there. The template already knows
    // which is which, so this does not need a second list.
    const interior = interiorIds.has(target.id) && !target.surface;
    const anchor = interior ? target.world : nearest.worldPoint;
    const offset = interior ? offsetToTarget(nearest, target.world) : ([0, 0, 0] as Vec3);

    const normal = anchor
      .clone()
      .sub(nearest.worldPoint)
      .normalize();

    guides.push({
      id: target.id,
      group: groupById.get(target.id) ?? '',
      position: worldToDocument(documentRoot, anchor.clone()),
      normal: Number.isFinite(normal.x) && normal.lengthSq() > 0.5
        ? [normal.x, normal.y, normal.z]
        : [0, 0, 1],
      binding: {
        primPath: nearest.primPath,
        faceIndex: nearest.faceIndex,
        barycentric: nearest.barycentric,
        offset
      },
      source: 'proportions',
      confidence: target.confidence * landmarks.confidence
    });
  }

  const placed = new Set(guides.map((g) => g.id));
  const unmatched = template.guides
    .filter((g) => !g.optional && !placed.has(g.id))
    .map((g) => g.id);

  return { guides, landmarks, unmatched, reason: null };
}

// -------------------------------------------------------------------------
// Turning landmarks into target positions
// -------------------------------------------------------------------------

/**
 * Ratios used only where the measured shape cannot answer.
 *
 * A knee has no signature in a cross section - the leg is a smooth taper - so
 * its height comes from the one thing that IS measured, the distance from the
 * floor to the crotch. Every constant here is anchored to a measurement rather
 * than to the character's total height, so a long-legged or squat build still
 * gets its knee in the right place.
 */
const RATIO = {
  /** Knee, as a fraction of the floor-to-crotch distance. */
  kneeUpLeg: 0.52,
  /** Ankle, likewise. */
  ankleUpLeg: 0.09,
  /** Elbow along the shoulder-to-hand line. */
  elbowAlongArm: 0.48,
  /** Wrist along the same line. */
  wristAlongArm: 0.88,
  /** Clavicle, as a fraction of the shoulder half width. */
  clavicleAcross: 0.4
} as const;

function buildTargets(profile: BodyProfile, lm: BodyLandmarks): Target[] {
  const cx = profile.centerX;
  const targets: Target[] = [];

  const at = (y: number) => bandAt(profile, y);
  const midZ = (y: number): number => {
    const band = at(y);
    return band && band.count > 0 ? (band.minZ + band.maxZ) / 2 : lm.centerZ;
  };
  const frontZ = (y: number): number => {
    const band = at(y);
    return band && band.count > 0 ? band.maxZ : lm.centerZ;
  };

  const add = (
    id: string,
    x: number,
    y: number,
    z: number,
    surface: boolean,
    confidence: number
  ): void => {
    targets.push({ id, world: new THREE.Vector3(x, y, z), surface, confidence });
  };

  const height = lm.height;
  const legLength = lm.crotchY - lm.groundY;
  const headSpan = lm.topY - lm.neckY;

  // --- centre chain ------------------------------------------------------
  // Heights here sit BETWEEN measured landmarks, so they inherit their
  // confidence rather than being independent guesses.
  add('root', cx, lm.groundY, midZ(lm.groundY + height * 0.02), false, 0.95);
  add('pelvis', cx, lm.crotchY + height * 0.04, midZ(lm.crotchY), false, 0.9);
  add(
    'spine01',
    cx,
    lm.crotchY + (lm.waistY - lm.crotchY) * 0.55,
    midZ(lm.waistY),
    false,
    0.8
  );
  add('spine02', cx, lm.waistY, midZ(lm.waistY), false, 0.85);
  add(
    'chest',
    cx,
    lm.waistY + (lm.shoulderY - lm.waistY) * 0.62,
    midZ(lm.shoulderY),
    false,
    0.85
  );
  add('neck', cx, lm.neckY, midZ(lm.neckY), false, 0.85);
  add('head', cx, lm.neckY + headSpan * 0.42, midZ(lm.neckY + headSpan * 0.42), false, 0.8);
  add('headTop', cx, lm.topY, midZ(lm.topY - height * 0.01), true, 0.95);

  // --- legs --------------------------------------------------------------
  for (const [suffix, side] of [
    ['L', 1],
    ['R', -1]
  ] as const) {
    const legX = cx + side * lm.hipHalfWidth;

    add('hip' + suffix, legX, lm.crotchY + height * 0.02, midZ(lm.crotchY), false, 0.85);
    const kneeY = lm.groundY + legLength * RATIO.kneeUpLeg;
    add('knee' + suffix, legX, kneeY, midZ(kneeY), false, 0.75);
    const ankleY = lm.groundY + legLength * RATIO.ankleUpLeg;
    add('ankle' + suffix, legX, ankleY, midZ(ankleY), false, 0.8);
    // The ball of the foot is forward of the ankle, and the foot is the one
    // place the mesh's depth genuinely tells us where it is.
    add(
      'toeBase' + suffix,
      legX,
      lm.groundY + height * 0.015,
      frontZ(lm.groundY + height * 0.02) * 0.75,
      true,
      0.65
    );
  }

  // --- arms --------------------------------------------------------------
  // Along the measured shoulder-to-hand line rather than horizontally: in any
  // rest pose the hands are well below the shoulders, and interpolating across
  // the shoulder line would leave the elbow in mid air beside the ribs.
  for (const [suffix, side] of [
    ['L', 1],
    ['R', -1]
  ] as const) {
    const shoulderX = cx + side * lm.shoulderHalfWidth;
    const shoulderYY = lm.shoulderY - height * 0.015;
    const handX = cx + side * lm.armReachX;
    const handY = lm.armTipY;

    add(
      'clavicle' + suffix,
      cx + side * lm.shoulderHalfWidth * RATIO.clavicleAcross,
      lm.shoulderY,
      midZ(lm.shoulderY),
      false,
      0.7
    );
    add('shoulder' + suffix, shoulderX, shoulderYY, midZ(shoulderYY), false, 0.8);

    const elbowX = shoulderX + (handX - shoulderX) * RATIO.elbowAlongArm;
    const elbowY = shoulderYY + (handY - shoulderYY) * RATIO.elbowAlongArm;
    add('elbow' + suffix, elbowX, elbowY, midZ(elbowY), false, 0.7);

    const wristX = shoulderX + (handX - shoulderX) * RATIO.wristAlongArm;
    const wristY = shoulderYY + (handY - shoulderYY) * RATIO.wristAlongArm;
    add('wrist' + suffix, wristX, wristY, midZ(wristY), false, 0.7);
  }

  // --- face --------------------------------------------------------------
  // The weakest tier by some distance. A cross section says almost nothing
  // about a face, so these are proportions of the measured head span and
  // nothing more. Their confidence says so.
  const headWidth = headHalfWidth(profile, lm);
  const faceY = (t: number) => lm.neckY + headSpan * t;

  add('jaw', cx, faceY(0.34), midZ(faceY(0.34)), false, 0.5);
  add('chin', cx, faceY(0.2), frontZ(faceY(0.2)), true, 0.55);
  add('noseTip', cx, faceY(0.5), frontZ(faceY(0.5)), true, 0.5);
  add('mouthCenter', cx, faceY(0.32), frontZ(faceY(0.32)), true, 0.5);
  add('mouthCornerL', cx + headWidth * 0.3, faceY(0.32), frontZ(faceY(0.32)) * 0.9, true, 0.45);
  add('mouthCornerR', cx - headWidth * 0.3, faceY(0.32), frontZ(faceY(0.32)) * 0.9, true, 0.45);
  add('eyeL', cx + headWidth * 0.42, faceY(0.62), frontZ(faceY(0.62)) * 0.7, false, 0.5);
  add('eyeR', cx - headWidth * 0.42, faceY(0.62), frontZ(faceY(0.62)) * 0.7, false, 0.5);

  return targets;
}

/** The band containing `y`, or undefined when the profile is empty. */
function bandAt(profile: BodyProfile, y: number) {
  if (profile.slabs.length === 0) return undefined;
  let best = profile.slabs[0];
  let bestDistance = Infinity;
  for (const slab of profile.slabs) {
    const distance = Math.abs(slab.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = slab;
    }
  }
  return best;
}

/** Half the width of the head, measured across the middle of the head span. */
function headHalfWidth(profile: BodyProfile, lm: BodyLandmarks): number {
  const band = bandAt(profile, lm.neckY + (lm.topY - lm.neckY) * 0.55);
  const width = band && band.centralWidth > 0 ? band.centralWidth : lm.height * 0.12;
  return width / 2;
}
