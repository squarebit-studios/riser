// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Placing guides on a four-legged character.
//
// The counterpart to fromProportions.ts, and it shares that file's discipline:
// quadruped.ts MEASURES, this file interprets. Every position here is anchored
// to something the mesh actually said - where the leg pairs sit along the body,
// how far apart they are, where the topline runs, where the belly is - so a
// dachshund and a horse both come out sensibly without either being assumed.
//
// The proportions that remain are the joints a cross section cannot see. A hock
// has no signature in the silhouette, so its height comes from the measured
// distance between the belly and the ground, which is the leg's real length on
// this animal rather than a number taken from a textbook horse.
//
// Anatomy worth stating, because the template's names are not casual: on a
// quadruped the front "knee" is a CARPUS, anatomically a wrist, and the joint
// that bends backwards on the hind leg is a HOCK, anatomically an ankle. The
// true knee is the stifle, high up and tucked against the body. Placing these
// as though they were a person's knees is the classic way to get a quadruped
// rig wrong.
// ==========================================================================

import * as THREE from 'three';
import type { CharacterModel } from '../../io/CharacterModel';
import type { Guide, RiserDocument, TemplateDef, Vec3 } from '../../doc/types';
import { sampleSurfacePoints } from './sampleSurface';
import {
  alongAxis,
  findQuadrupedLandmarks,
  type QuadrupedLandmarks
} from './quadruped';
import { allowedGuideIds, bindTargets, type Target } from './fromProportions';

/** Below this the shape did not measure like a four-legged animal. */
const MIN_CONFIDENCE = 0.6;

export interface QuadrupedPlacementResult {
  guides: Guide[];
  landmarks: QuadrupedLandmarks | null;
  unmatched: string[];
  reason: string | null;
}

const NOTHING: QuadrupedPlacementResult = {
  guides: [],
  landmarks: null,
  unmatched: [],
  reason: null
};

/**
 * Positions along a leg, as fractions of the measured belly-to-ground drop.
 *
 * Anchored to the animal's own leg length rather than to its height, so a
 * short-legged breed gets short-legged joints.
 */
const LEG = {
  /** Where the leg meets the body. */
  attach: 1.0,
  /** Elbow on the front leg, and stifle on the back. */
  upper: 0.62,
  /** Carpus in front, hock behind - the joint that is visibly a knee. */
  middle: 0.34,
  fetlock: 0.12,
  foot: 0.0
} as const;

export function placeGuidesFromQuadruped(
  character: CharacterModel,
  documentRoot: THREE.Object3D,
  template: TemplateDef,
  doc: RiserDocument,
  options: { overwriteUserPlaced?: boolean } = {}
): QuadrupedPlacementResult {
  if (character.meshes.length === 0) {
    return { ...NOTHING, reason: 'This character has no geometry to measure.' };
  }

  const landmarks = findQuadrupedLandmarks(sampleSurfacePoints(character.meshes));
  if (!landmarks) {
    return {
      ...NOTHING,
      reason:
        'This does not measure like a four-legged animal - Riser could not find ' +
        'two pairs of legs. Place the guides by hand.'
    };
  }
  if (landmarks.confidence < MIN_CONFIDENCE) {
    return {
      ...NOTHING,
      landmarks,
      reason:
        'The shape is only loosely four-legged, so guides would be guesses in ' +
        'the wrong places. Place them by hand.'
    };
  }

  const allowed = allowedGuideIds(template, doc, options.overwriteUserPlaced ?? false);
  const targets = buildTargets(landmarks).filter((t) => allowed.has(t.id));
  const guides = bindTargets(
    character,
    documentRoot,
    template,
    targets,
    landmarks.confidence
  );

  const placed = new Set(guides.map((g) => g.id));
  const unmatched = template.guides
    .filter((g) => !g.optional && !placed.has(g.id))
    .map((g) => g.id);

  return { guides, landmarks, unmatched, reason: null };
}

function buildTargets(lm: QuadrupedLandmarks): Target[] {
  const targets: Target[] = [];

  const add = (
    id: string,
    position: Vec3,
    surface: boolean,
    confidence: number
  ): void => {
    targets.push({
      id,
      world: new THREE.Vector3(position[0], position[1], position[2]),
      surface,
      confidence
    });
  };

  const at = (l: number, y: number, crossOffset = 0): Vec3 =>
    alongAxis(lm, l, y, crossOffset);

  const legDrop = Math.max(lm.bellyY - lm.groundY, lm.height * 0.05);
  const legY = (t: number) => lm.groundY + legDrop * t;
  // Positive is toward the head, so a single expression serves both ends.
  const forward = lm.headEnd > lm.tailEnd ? 1 : -1;
  const bodyLength = Math.abs(lm.frontLegL - lm.backLegL);

  // --- spine, from tail to head -----------------------------------------
  // Heights sit just under the topline, which is where a spine actually runs.
  const spineY = (top: number) => top - lm.height * 0.06;

  add('root', at((lm.frontLegL + lm.backLegL) / 2, lm.groundY), false, 0.9);
  add('pelvis', at(lm.backLegL, spineY(lm.croupY)), false, 0.85);
  add(
    'spineLower',
    at(lm.backLegL + forward * bodyLength * 0.3, spineY(lm.bodyTopY)),
    false,
    0.8
  );
  add(
    'spineMid',
    at((lm.frontLegL + lm.backLegL) / 2, spineY(lm.bodyTopY)),
    false,
    0.8
  );
  add('chest', at(lm.frontLegL, spineY(lm.withersY)), false, 0.85);

  // The neck runs from the withers up and forward to the head.
  const neckBaseL = lm.frontLegL + forward * bodyLength * 0.18;
  add('neckBase', at(neckBaseL, spineY(lm.withersY)), false, 0.75);
  add(
    'neckMid',
    at(
      neckBaseL + (lm.headL - neckBaseL) * 0.5,
      spineY(lm.withersY) + (lm.headY - lm.withersY) * 0.5
    ),
    false,
    0.7
  );
  add('head', at(lm.headL, lm.headY - lm.height * 0.09), false, 0.75);

  // --- tail ---------------------------------------------------------------
  // Interpolated between base and tip rather than measured from the whole
  // body's extent, which put the middle of the tail closer to the animal than
  // its own base and ran the tail backwards.
  const tailBaseL = lm.backLegL - forward * bodyLength * 0.18;
  const tailTipL = lm.tailEnd;
  const tailTipY = lm.croupY - lm.height * 0.05;

  add('tailBase', at(tailBaseL, lm.croupY), false, 0.6);
  add(
    'tailMid',
    at(tailBaseL + (tailTipL - tailBaseL) * 0.5, (lm.croupY + tailTipY) / 2),
    false,
    0.5
  );
  add('tailTip', at(tailTipL, tailTipY), true, 0.45);

  // --- legs ---------------------------------------------------------------
  for (const [suffix, side] of [
    ['L', 1],
    ['R', -1]
  ] as const) {
    const across = side * lm.legHalfWidth;

    // Front. The scapula rides high on the ribcage, above the shoulder joint.
    add('scapula' + suffix, at(lm.frontLegL, spineY(lm.withersY), across * 0.7), false, 0.65);
    add('shoulderF' + suffix, at(lm.frontLegL, legY(LEG.attach), across), false, 0.75);
    add('elbowF' + suffix, at(lm.frontLegL, legY(LEG.upper), across), false, 0.7);
    add('carpus' + suffix, at(lm.frontLegL, legY(LEG.middle), across), false, 0.7);
    add('fetlockF' + suffix, at(lm.frontLegL, legY(LEG.fetlock), across), false, 0.7);
    add('hoofF' + suffix, at(lm.frontLegL, legY(LEG.foot), across), true, 0.8);

    // Back. The stifle is the true knee and sits high, tucked to the body.
    add('hip' + suffix, at(lm.backLegL, spineY(lm.croupY), across * 0.7), false, 0.75);
    add('stifle' + suffix, at(lm.backLegL, legY(LEG.upper), across), false, 0.7);
    add('hock' + suffix, at(lm.backLegL, legY(LEG.middle), across), false, 0.7);
    add('fetlockB' + suffix, at(lm.backLegL, legY(LEG.fetlock), across), false, 0.7);
    add('hoofB' + suffix, at(lm.backLegL, legY(LEG.foot), across), true, 0.8);
  }

  // --- head --------------------------------------------------------------
  // The weakest tier, as on the biped: a silhouette says little about a face.
  const headHalf = lm.legHalfWidth;
  const muzzleL = lm.headL + forward * (lm.headEnd - lm.headL) * 0.55;

  add('jaw', at(lm.headL, lm.headY - lm.height * 0.13), false, 0.5);
  add('muzzle', at(muzzleL, lm.headY - lm.height * 0.13), true, 0.5);
  add('noseTip', at(lm.headEnd, lm.headY - lm.height * 0.13), true, 0.55);
  add('eyeL', at(lm.headL, lm.headY - lm.height * 0.06, headHalf * 0.55), false, 0.45);
  add('eyeR', at(lm.headL, lm.headY - lm.height * 0.06, -headHalf * 0.55), false, 0.45);
  add('earL', at(lm.headL, lm.headY, headHalf * 0.45), true, 0.4);
  add('earR', at(lm.headL, lm.headY, -headHalf * 0.45), true, 0.4);

  return targets;
}
