// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The centre line, and the things that must never leave it.
//
// Characters are modelled symmetric about local x = 0. A spine guide, a neck,
// a head: these are not "nearly centred" features that happen to sit close to
// that plane, they are ON it, and a millimetre either way is always a mistake.
// It is a mistake that is nearly invisible in the viewport and very visible
// downstream, where a rig built from a spine that drifts sideways leans.
//
// Nothing about a click can be that accurate, so this is not something to ask
// of the person placing markers. The template already knows which guides are
// centred - they are the ones with no mirrored counterpart, and that is true
// of every guide in every template we ship - so the document can simply hold
// them there.
//
// HOW A GUIDE IS MOVED WITHOUT BREAKING ITS BINDING. The invariant the whole
// format rests on is `position = evaluate(binding) + offset`, and the Python
// worker re-evaluates it independently. Snapping x to zero therefore cannot
// touch the binding's triangle or barycentric coordinate, which are what
// `evaluate` reads. It moves the OFFSET by exactly as much as it moves the
// position, so the two sides of that equation change together and the worker
// resolves the same point the viewport draws.
// ==========================================================================

import type { Curve, CurvePoint, Guide, SurfaceBinding, TemplateDef, Vec3 } from './types';

/**
 * Whether this guide belongs on the centre line.
 *
 * Having no mirrored counterpart is what makes a guide central, and it is not
 * a heuristic: a guide is either one of a left/right pair or it is on the
 * plane between them. Checked against the template rather than the position,
 * so a guide that has drifted is still recognised as one that should not have.
 */
export function isCentreGuide(template: TemplateDef, id: string): boolean {
  const def = template.guides.find((g) => g.id === id);
  return def ? !def.mirror : false;
}

/** Whether this curve spans or follows the centre line rather than a side. */
export function isCentreCurve(template: TemplateDef, id: string): boolean {
  const def = template.curves.find((c) => c.id === id);
  return def ? !def.mirror : false;
}

/**
 * Move a position onto the centre plane, carrying its binding with it.
 *
 * The binding's triangle is left exactly as it was. Only the offset moves,
 * and by exactly the distance the position moved, so `evaluate + offset` still
 * lands where the position now says it does.
 */
export function holdToCentreLine(
  position: Vec3,
  binding: SurfaceBinding | null
): { position: Vec3; binding: SurfaceBinding | null } {
  const x = position[0];
  if (x === 0) return { position, binding };

  const centred: Vec3 = [0, position[1], position[2]];
  if (!binding) return { position: centred, binding };

  return {
    position: centred,
    binding: {
      ...binding,
      offset: [binding.offset[0] - x, binding.offset[1], binding.offset[2]] as Vec3
    }
  };
}

/** A guide held on the centre line, or the same guide when it already is. */
export function centreGuide(guide: Guide): Guide {
  if (guide.position[0] === 0) return guide;
  const held = holdToCentreLine(guide.position, guide.binding);
  return { ...guide, position: held.position, binding: held.binding };
}

/**
 * What kind of symmetry a centre curve has, judged by where its points are.
 *
 * A template says a curve is central; it does not say which of the two shapes
 * that means, and the two want opposite things:
 *
 *   `along`     Every point is on the centre line, like a spine or a belly
 *               curve seen from the front. Mirroring means holding all of them
 *               there.
 *   `spanning`  The curve crosses the centre line, like a lip or a jawline,
 *               with points either side and usually one in the middle.
 *               Mirroring means making the two sides match.
 *
 * Told apart by how far the points actually spread sideways, because that is
 * the thing that differs. The threshold is relative to the curve's own extent
 * rather than to the character, so it reads the same on a face curve and a
 * body one.
 */
export type CurveSymmetry = 'side' | 'along' | 'spanning';

export function curveSymmetry(
  template: TemplateDef,
  curve: Pick<Curve, 'id' | 'points'>
): CurveSymmetry {
  if (!isCentreCurve(template, curve.id)) return 'side';

  const points = curve.points;
  if (points.length === 0) return 'along';

  let widest = 0;
  let extent = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    widest = Math.max(widest, Math.abs(p.position[0]));
    minY = Math.min(minY, p.position[1]);
    maxY = Math.max(maxY, p.position[1]);
    minZ = Math.min(minZ, p.position[2]);
    maxZ = Math.max(maxZ, p.position[2]);
  }
  extent = Math.max(maxY - minY, maxZ - minZ);

  // A curve that never leaves a narrow band around the plane was drawn along
  // it. One whose points reach a fifth of its own length to either side was
  // drawn across it.
  if (extent <= 0) return widest < 1e-6 ? 'along' : 'spanning';
  return widest / extent < 0.2 ? 'along' : 'spanning';
}

/** Every point held on the centre line, for a curve drawn along it. */
export function centreCurveAlong(points: readonly CurvePoint[]): CurvePoint[] {
  return points.map((p) => {
    const held = holdToCentreLine(p.position, p.binding);
    return { ...p, position: held.position, binding: held.binding };
  });
}

/**
 * The reflection of a point across the centre plane, as a position only.
 *
 * The binding is deliberately NOT reflected. A binding names a triangle, and
 * the triangle on the far side is a different triangle: on a mesh that is not
 * perfectly mirror symmetric, and none are once they are triangulated, there
 * may be no matching face at all. Re-binding needs a raycast, which belongs
 * with the picker rather than here, so this returns the target and lets the
 * caller resolve it.
 */
export function reflectAcrossCentre(position: Vec3): Vec3 {
  return [-position[0], position[1], position[2]];
}

/**
 * Where each point of a curve drawn ACROSS the centre line should sit.
 *
 * The first half is treated as the drawn side and the second half is rebuilt
 * as its reflection, which is what makes the result predictable: the same
 * curve mirrored twice is the same curve. With an odd number of points the
 * middle one is the one on the plane, and it goes exactly on it.
 *
 * Returns one target per point, in the curve's own order, so a caller can
 * re-bind each one and know which point it belongs to.
 */
export function symmetricTargets(points: readonly CurvePoint[]): Vec3[] {
  const n = points.length;
  const targets: Vec3[] = new Array(n);
  const middle = (n - 1) / 2;

  for (let i = 0; i < n; i++) {
    const point = points[i] as CurvePoint;
    if (n % 2 === 1 && i === middle) {
      // The one on the plane. Nothing to pair it with, so it is simply held.
      targets[i] = [0, point.position[1], point.position[2]];
      continue;
    }
    if (i < middle) {
      targets[i] = point.position;
      continue;
    }
    const source = points[n - 1 - i] as CurvePoint;
    targets[i] = reflectAcrossCentre(source.position);
  }
  return targets;
}
