// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// What a click means: on the skin, inside the volume, or wherever you put it.
//
// Riser used to have exactly one answer - snap to the surface - with a fixed
// nudge inwards for guides the template happened to mark `interior`. That is
// wrong for the case it matters most in. A joint is not on the skin. An elbow
// centre is somewhere in the middle of the forearm, and how far in depends on
// how thick that particular character's forearm is, which a fraction of body
// height cannot know.
//
// THE MODES
//
//   auto      The template decides. Guides it marks `interior` - hips, elbows,
//             knees - go to the centre of the volume; everything else goes on
//             the skin. The default, because the template already carries this
//             knowledge and most people should never have to think about it.
//   surface   Always on the skin, whatever the template says.
//   centre    Always the centre of the volume under the cursor.
//   free      Wherever you put it. No snapping, and dragging moves in the
//             plane of the screen rather than sliding along the mesh.
//
// HOW CENTRE IS MEASURED, and why this is not a guess: the ray that hits the
// front of a forearm carries on and leaves through the back. The midpoint of
// those two crossings is the centre of the volume at that point. It assumes
// nothing about anatomy, thickness or scale, and it is right on a dachshund's
// leg and a giant's arm for the same reason.
//
// WHAT DOES NOT CHANGE: every mode still produces a binding, and
// `position = evaluate(binding) + offset` still holds. That invariant is what
// the Python worker resolves against and what lets a marker survive a retopo,
// so a mode that broke it would not be a placement option - it would be a
// second, incompatible document format. A free-placed marker binds to the
// nearest surface point and carries the rest as offset, exactly as an interior
// one does.
// ==========================================================================

import * as THREE from 'three';
import type { Vec3 } from '../doc/types';
import type { PickResult, SurfacePick } from '../viewport/Picker';

export type PlacementMode = 'auto' | 'surface' | 'center' | 'free';

export const DEFAULT_PLACEMENT_MODE: PlacementMode = 'auto';

export const PLACEMENT_MODES: readonly {
  id: PlacementMode;
  label: string;
  hint: string;
}[] = [
  {
    id: 'auto',
    label: 'Auto',
    hint: 'The template decides: joints go inside the body, everything else on the surface'
  },
  { id: 'surface', label: 'On surface', hint: 'Always place on the skin' },
  {
    id: 'center',
    label: 'Centre of volume',
    hint: 'Place in the middle of the limb or body under the cursor'
  },
  {
    id: 'free',
    label: 'Free',
    hint: 'Place anywhere, and drag without sticking to the surface'
  }
];

/**
 * How far to fall back inside the surface when the volume cannot be measured.
 *
 * Only reached when the ray leaves the character without coming back - an open
 * mesh, or a grazing click at a silhouette. A fraction of the character's
 * height, which is a poor substitute for measuring but better than placing a
 * joint on the skin.
 */
const FALLBACK_DEPTH_FRACTION = 0.012;

/**
 * Below this fraction of the character's height, a closed span is a shell
 * rather than a body part.
 *
 * Gary's spacesuit is 0.9mm thick and closes a perfectly valid solid the
 * instant the ray meets it, so "the first closed solid" put joints inside his
 * clothing. Set to separate a garment from the thinnest thing anyone would
 * actually place a joint in: on a 1.8m character this is 7mm, where a shirt is
 * about one and a finger about fifteen.
 */
const MIN_SOLID_FRACTION = 0.004;

/**
 * Whether this placement needs the volume measured.
 *
 * Worth asking before raycasting: the through-pick has to force materials
 * double-sided, and a curve drag fires it every frame. Surface and free modes
 * never look at the result, so they should not pay for it.
 */
export function needsVolume(mode: PlacementMode, interior: boolean): boolean {
  return mode === 'center' || (mode === 'auto' && interior);
}

export interface PlacementResult {
  /** Cage-local offset from the bound triangle to the final position. */
  offset: Vec3;
  /** Whether the volume was actually measured, or fell back to a fraction. */
  measured: boolean;
}

/**
 * Resolve where a guide goes, as an offset from the cage triangle it binds to.
 *
 * `through` is every surface the click ray crossed, near to far. Passing it in
 * rather than raycasting here keeps this function pure, which is what makes
 * the arithmetic testable without a renderer.
 */
export function resolvePlacement(
  mode: PlacementMode,
  surface: SurfacePick,
  options: {
    /** The template marks this guide as belonging inside the volume. */
    interior: boolean;
    /** Every crossing of the click ray, in distance order. */
    through?: readonly PickResult[];
    /** Character height, in WORLD units, for the fallback depth. */
    characterHeight: number;
    /**
     * An explicit world point to place at, instead of measuring.
     *
     * Used by mirroring. A reflected placement must be the SAME placement,
     * reflected - not an independent measurement of the other limb. The two
     * rays differ in direction, so they cut different chords through the arm
     * and produced depths several centimetres apart: a symmetry feature that
     * was not symmetric.
     */
    worldTarget?: THREE.Vector3 | null;
    /**
     * Cage-local units per world unit, from the bound mesh's world matrix.
     *
     * Not optional decoration. Depths here are measured by raycasting, which
     * happens in WORLD space, while the offset they turn into is CAGE-LOCAL -
     * and the two are only the same when the character is authored in metres.
     * Gary is authored in centimetres, so his meshes sit at world scale 0.01
     * and every measured depth was applied a hundred times too small: a 26 cm
     * joint placement came out at 0.26 cm, which is the surface. The biped
     * blockout is authored in metres, so the bug was invisible on it and on
     * every test that used it.
     */
    localPerWorld?: number;
  }
): PlacementResult {
  const wantsInside = needsVolume(mode, options.interior);

  // Free and surface both keep the point the user clicked. They differ in what
  // happens NEXT - a free marker drags off the surface - not in where the
  // first click lands, which is what makes free mode unsurprising to try.
  if (!wantsInside) {
    return { offset: surface.offset, measured: true };
  }

  // The centre is a POINT, not a distance, so it is used as one: the offset
  // is the vector to the midpoint of the two crossings, expressed in the cage
  // space the binding lives in.
  //
  // The first version measured the span along the ray and then pushed that far
  // along the surface NORMAL, which is only the same thing when the two are
  // parallel. On a curved belly, or any click that is not head-on, the push
  // overshot the far side and left the marker OUTSIDE the character - a joint
  // placed in mid-air behind the body. Going straight to the midpoint has no
  // such failure mode, and needs no unit conversion either, because the
  // conversion falls out of the matrix that takes the world point into cage
  // space.
  const centre =
    options.worldTarget ??
    volumeCentre(options.through, options.characterHeight * MIN_SOLID_FRACTION);
  if (centre) {
    return { offset: offsetToWorldPoint(surface, centre), measured: true };
  }

  // Only the fallback still works in distances, and only it needs the world
  // to cage-local conversion made explicit.
  const toLocal = options.localPerWorld ?? 1;
  return {
    offset: pushIn(
      surface,
      options.characterHeight * FALLBACK_DEPTH_FRACTION * toLocal
    ),
    measured: false
  };
}

/** The centre for this character, with the thin-shell threshold applied. */
export function volumeCentreFor(
  through: readonly PickResult[] | undefined,
  characterHeight: number
): THREE.Vector3 | null {
  return volumeCentre(through, characterHeight * MIN_SOLID_FRACTION);
}

/**
 * The midpoint of the solid the ray passed through, in world space.
 *
 * Null when the crossings do not describe a solid - see `farSideOf`.
 */
export function volumeCentre(
  through: readonly PickResult[] | undefined,
  minThickness = 0
): THREE.Vector3 | null {
  const span = solidSpan(through, minThickness);
  if (!span) return null;
  return span.entry.point.clone().add(span.exit.point).multiplyScalar(0.5);
}

/**
 * The span of the solid worth measuring, skipping shells too thin to be one.
 *
 * Every closed span is considered in order, and the first one thicker than
 * `minThickness` wins. If nothing clears the bar - a character genuinely made
 * of thin pieces - the thickest span is used rather than refusing, because
 * some answer from real geometry beats a fraction of body height.
 */
function solidSpan(
  through: readonly PickResult[] | undefined,
  minThickness: number
): { entry: PickResult; exit: PickResult } | null {
  if (!through || through.length < 2) return null;

  const direction = rayDirection(through);
  if (!direction) return null;

  let best: { entry: PickResult; exit: PickResult; thickness: number } | null = null;
  let depth = 0;
  let entry: PickResult | null = null;

  for (const hit of through) {
    const entering = hit.normal.dot(direction) < 0;
    if (entering) {
      if (depth === 0) entry = hit;
      depth++;
      continue;
    }

    depth--;
    // A solid closes when the count comes back to zero. A count that goes
    // negative means the ray began inside geometry, where there is no entry
    // point to measure from.
    if (depth > 0 || !entry) continue;
    if (depth < 0) return null;

    const thickness = entry.point.distanceTo(hit.point);
    if (thickness > minThickness) return { entry, exit: hit };
    if (!best || thickness > best.thickness) {
      best = { entry, exit: hit, thickness };
    }
    entry = null;
  }

  return best && best.thickness > 0 ? { entry: best.entry, exit: best.exit } : null;
}

/**
 * A cage-local offset that lands on `target`.
 *
 * `position = evaluate(binding) + offset`, and `evaluate` returns the cage
 * triangle's own point in cage-local space - which is exactly
 * `surface.pick.localPoint`. So the offset is the target, brought into that
 * same space, minus it. Any scaling between world and cage is carried by the
 * inverse world matrix rather than being applied by hand.
 */
function offsetToWorldPoint(surface: SurfacePick, target: THREE.Vector3): Vec3 {
  const object = surface.pick.object;
  object.updateWorldMatrix(true, false);

  const local = target
    .clone()
    .applyMatrix4(new THREE.Matrix4().copy(object.matrixWorld).invert());
  local.sub(surface.pick.localPoint);
  return [local.x, local.y, local.z];
}

/**
 * How many of an object's local units fit in one world unit.
 *
 * Reads the scale straight off the world matrix rather than trusting
 * `metersPerUnit`, because the fit applied on load - unit scaling, an up-axis
 * flip, framing - all end up in that matrix and all of them matter here.
 */
export function localUnitsPerWorldUnit(object: THREE.Object3D): number {
  object.updateWorldMatrix(true, false);
  const scale = new THREE.Vector3().setFromMatrixScale(object.matrixWorld);
  // The average of the three axes: a non-uniform scale has no single answer,
  // and a character with one is already beyond what a scalar depth can serve.
  const average = (scale.x + scale.y + scale.z) / 3;
  return average > 1e-9 ? 1 / average : 1;
}

/**
 * Half the distance through the volume under the cursor, or null.
 *
 * NOT simply the first two crossings. That works on a single watertight mesh
 * and fails on every real character, because a real character is layered: a
 * ray at Gary's hip enters his spacesuit and then his skin a millimetre later,
 * so "the first two crossings" measured the gap between his clothes and his
 * body and put the marker back on the surface.
 *
 * So the crossings are counted the way solid geometry counts them. A face
 * whose normal opposes the ray is going IN and a face whose normal follows it
 * is coming OUT; walking the list and tracking how deep we are, the solid ends
 * where the count returns to zero. Layers nest, and nesting resolves:
 *
 *   enter suit   depth 1
 *   enter body   depth 2
 *   exit  body   depth 1
 *   exit  suit   depth 0   <- the far side of the hip
 *
 * It also keeps the property the naive version had by accident: a ray aimed at
 * an arm closes on the arm and never reaches the torso behind it, because the
 * arm's own exit brings the count back to zero first.
 */
export function volumeDepth(
  surface: SurfacePick,
  through: readonly PickResult[] | undefined,
  minThickness = 0
): number | null {
  const span = solidSpan(through, minThickness);
  if (!span) return null;

  const thickness = span.entry.point.distanceTo(span.exit.point);
  if (!(thickness > 0)) return null;

  // Measured from the point the user actually clicked, which on a subdivided
  // character is the limit surface rather than the cage.
  const fromClick = surface.worldPoint.distanceTo(span.entry.point);
  return thickness / 2 + fromClick;
}

/**
 * The ray's direction, recovered from the crossings themselves.
 *
 * Every crossing lies on the ray, so the vector between the first and last is
 * the direction - which saves threading the camera through a function whose
 * whole value is being pure arithmetic.
 */
function rayDirection(through: readonly PickResult[]): THREE.Vector3 | null {
  const first = through[0]!;
  for (let i = through.length - 1; i > 0; i--) {
    const direction = through[i]!.point.clone().sub(first.point);
    if (direction.lengthSq() > 1e-18) return direction.normalize();
  }
  return null;
}

/** An offset that displaces the clicked point inward along the surface normal. */
function pushIn(surface: SurfacePick, depth: number): Vec3 {
  const n = surface.localNormal;
  return [
    surface.offset[0] - n.x * depth,
    surface.offset[1] - n.y * depth,
    surface.offset[2] - n.z * depth
  ];
}

/**
 * A point on the plane through `through` facing the camera.
 *
 * Free placement needs a depth, and a 2D pointer does not supply one. Using
 * the depth of whatever is under the cursor means the first click lands
 * exactly where it looks like it should; only afterwards does the marker come
 * loose from the surface. Clicking empty space falls back to the character's
 * own centre, which is the only depth in the scene that means anything.
 */
export function pointOnCameraPlane(
  raycaster: THREE.Raycaster,
  camera: THREE.Camera,
  through: THREE.Vector3
): THREE.Vector3 | null {
  const normal = new THREE.Vector3();
  camera.getWorldDirection(normal);

  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, through);
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
}
