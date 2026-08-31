// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Measuring a four-legged character.
//
// Riser shipped a quadruped template and a quadruped stock asset, and
// automatic placement refused both: the biped measurement in profile.ts slices
// by HEIGHT, which is the right axis for something that stands upright and the
// wrong one for something that stands on four legs and is longer than it is
// tall. Loading the horse gave an empty checklist.
//
// So this measures along the character's LENGTH instead. The two useful facts
// fall straight out of that:
//
//   * Down near the ground there are exactly two groups of legs. Where they
//     sit along the body's length is where the shoulders and hips are - no
//     proportion assumed, and it works for a dachshund as readily as a horse.
//   * The topline tells you which end is the head. A quadruped's highest point
//     is its skull or its ears, and they are at one end; the tail end slopes
//     away. Nothing else needs to know which way the animal faces.
//
// Nothing here assumes a horse, a dog, or a particular number of vertebrae.
// The proportions used in fromQuadruped.ts are anchored to these measurements,
// exactly as the biped's are.
// ==========================================================================

import type { Vec3 } from '../../doc/types';
import { findMasses } from './profile';

/** Points below this fraction of the height are legs rather than body. */
const LEG_BAND_FRACTION = 0.3;

/**
 * A quadruped is longer than it is tall. Below this ratio the shape is not
 * one, and measuring it as one would place a shoulder inside a torso.
 */
const MIN_LENGTH_TO_HEIGHT = 1.2;

export interface QuadrupedLandmarks {
  groundY: number;
  topY: number;
  height: number;

  /** Index of the long horizontal axis: 0 for x, 2 for z. */
  axis: 0 | 2;
  /** Index of the other horizontal axis, across the body. */
  cross: 0 | 2;

  /** Extent along the long axis. */
  minL: number;
  maxL: number;
  /** Which end the head is at, as a coordinate on the long axis. */
  headEnd: number;
  /** The opposite end. */
  tailEnd: number;

  /** Centre of the front and back leg pairs, along the long axis. */
  frontLegL: number;
  backLegL: number;
  /** Half the distance between left and right legs. */
  legHalfWidth: number;
  /** Middle of the body across its width. */
  centerCross: number;

  /** Topline over the barrel, and above each leg pair. */
  bodyTopY: number;
  withersY: number;
  croupY: number;
  /** Underside of the barrel, between the legs. */
  bellyY: number;

  /** Where the head sits, along the long axis and in height. */
  headL: number;
  headY: number;

  confidence: number;
}

/**
 * Measure a four-legged character, or return null when it is not one.
 *
 * Returning null rather than a low-confidence guess: unlike the biped case
 * there is no useful fallback here. Without two leg groups there is nothing to
 * anchor a quadruped's proportions to at all.
 */
export function findQuadrupedLandmarks(
  points: readonly Vec3[]
): QuadrupedLandmarks | null {
  if (points.length < 200) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
    if (p[2] < minZ) minZ = p[2];
    if (p[2] > maxZ) maxZ = p[2];
  }

  const height = maxY - minY;
  if (!(height > 0)) return null;

  // The long horizontal axis. A quadruped is built along it; a biped is not
  // built along either, which is what the ratio check below catches.
  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;
  const axis: 0 | 2 = spanZ >= spanX ? 2 : 0;
  const cross: 0 | 2 = axis === 2 ? 0 : 2;

  const minL = axis === 2 ? minZ : minX;
  const maxL = axis === 2 ? maxZ : maxX;
  const length = maxL - minL;
  if (length / height < MIN_LENGTH_TO_HEIGHT) return null;

  const minC = cross === 2 ? minZ : minX;
  const maxC = cross === 2 ? maxZ : maxX;

  // --- legs ------------------------------------------------------------
  const legBandTop = minY + height * LEG_BAND_FRACTION;
  const legPoints = points.filter((p) => p[1] <= legBandTop);
  const legGroups = findMasses(
    legPoints.map((p) => p[axis]),
    minL,
    length
  );
  // Exactly two: a front pair and a back pair. One means the legs are not
  // separated at this height, which is not a quadruped stance; more means
  // something is being measured that is not a leg.
  if (legGroups.length !== 2) return null;

  const groupA = (legGroups[0]!.min + legGroups[0]!.max) / 2;
  const groupB = (legGroups[1]!.min + legGroups[1]!.max) / 2;

  // --- which end is the head -------------------------------------------
  // The highest point of a quadruped is its skull or its ears, and they are at
  // one end. The tail end slopes away. That is enough to orient the animal.
  let highest = points[0] as Vec3;
  for (const p of points) if (p[1] > highest[1]) highest = p;
  const headL = highest[axis];
  const headY = highest[1];

  const headEnd = Math.abs(headL - minL) < Math.abs(headL - maxL) ? minL : maxL;
  const tailEnd = headEnd === minL ? maxL : minL;

  // The leg group nearer the head end is the front pair.
  const frontIsA = Math.abs(groupA - headEnd) < Math.abs(groupB - headEnd);
  const frontLegL = frontIsA ? groupA : groupB;
  const backLegL = frontIsA ? groupB : groupA;

  // --- lateral separation ----------------------------------------------
  const frontLegPoints = legPoints.filter(
    (p) => Math.abs(p[axis] - frontLegL) < length * 0.12
  );
  const lateral = findMasses(
    frontLegPoints.map((p) => p[cross]),
    minC,
    maxC - minC
  );
  const legHalfWidth =
    lateral.length === 2
      ? Math.abs(
          (lateral[1]!.min + lateral[1]!.max) / 2 -
            (lateral[0]!.min + lateral[0]!.max) / 2
        ) / 2
      : (maxC - minC) / 4;

  // --- body -------------------------------------------------------------
  // Strictly BETWEEN the leg pairs, and inset from both.
  //
  // Spanning leg centre to leg centre still includes the near halves of both
  // pairs, so the lowest point in that span is a hoof and the "belly" comes
  // out at ground level. Insetting a fifth of the gap clears the legs and
  // still leaves most of the barrel.
  const gap = Math.abs(frontLegL - backLegL);
  const inset = gap * 0.2;
  const lo = Math.min(frontLegL, backLegL) + inset;
  const hi = Math.max(frontLegL, backLegL) - inset;
  const barrel = points.filter((p) => p[axis] >= lo && p[axis] <= hi);

  const bodyTopY = barrel.length > 0 ? Math.max(...barrel.map((p) => p[1])) : maxY;
  const bellyY = barrel.length > 0 ? Math.min(...barrel.map((p) => p[1])) : minY;

  const withersY = toplineNear(points, axis, frontLegL, length * 0.08, bodyTopY);
  const croupY = toplineNear(points, axis, backLegL, length * 0.08, bodyTopY);

  // --- confidence --------------------------------------------------------
  let confidence = 1;
  if (lateral.length !== 2) confidence *= 0.7;
  // The legs should sit well apart along the body, not bunched at one end.
  const legSeparation = Math.abs(frontLegL - backLegL) / length;
  if (legSeparation < 0.25) confidence *= 0.5;
  // The belly has to be above the ground, or what was measured is not a body
  // standing on legs.
  if (!(bellyY > minY + height * 0.15)) confidence *= 0.6;

  return {
    groundY: minY,
    topY: maxY,
    height,
    axis,
    cross,
    minL,
    maxL,
    headEnd,
    tailEnd,
    frontLegL,
    backLegL,
    legHalfWidth,
    centerCross: (minC + maxC) / 2,
    bodyTopY,
    withersY,
    croupY,
    bellyY,
    headL,
    headY,
    confidence
  };
}

/** Highest point within `reach` of a position along the long axis. */
function toplineNear(
  points: readonly Vec3[],
  axis: 0 | 2,
  at: number,
  reach: number,
  fallback: number
): number {
  let top = -Infinity;
  for (const p of points) {
    if (Math.abs(p[axis] - at) > reach) continue;
    if (p[1] > top) top = p[1];
  }
  return top === -Infinity ? fallback : top;
}

/** Build a world-space position from a long-axis, height and cross-axis triple. */
export function alongAxis(
  landmarks: QuadrupedLandmarks,
  l: number,
  y: number,
  crossOffset = 0
): Vec3 {
  const c = landmarks.centerCross + crossOffset;
  return landmarks.axis === 2 ? [c, y, l] : [l, y, c];
}

/** Fraction from the tail end (0) to the head end (1). */
export function towardHead(landmarks: QuadrupedLandmarks, t: number): number {
  return landmarks.tailEnd + (landmarks.headEnd - landmarks.tailEnd) * t;
}
