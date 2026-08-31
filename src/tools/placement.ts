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
    /** Character height, for the fallback depth. */
    characterHeight: number;
  }
): PlacementResult {
  const wantsInside = needsVolume(mode, options.interior);

  // Free and surface both keep the point the user clicked. They differ in what
  // happens NEXT - a free marker drags off the surface - not in where the
  // first click lands, which is what makes free mode unsurprising to try.
  if (!wantsInside) {
    return { offset: surface.offset, measured: true };
  }

  const depth = volumeDepth(surface, options.through);
  if (depth !== null) {
    return { offset: pushIn(surface, depth), measured: true };
  }
  return {
    offset: pushIn(surface, options.characterHeight * FALLBACK_DEPTH_FRACTION),
    measured: false
  };
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
  through: readonly PickResult[] | undefined
): number | null {
  if (!through || through.length < 2) return null;

  const entry = through[0]!;
  const exit = farSideOf(through);
  if (!exit) return null;

  const span = entry.point.distanceTo(exit.point);
  if (!(span > 0)) return null;

  // Measured from the point the user actually clicked, which on a subdivided
  // character is the limit surface rather than the cage.
  const fromClick = surface.worldPoint.distanceTo(entry.point);
  return span / 2 + fromClick;
}

/**
 * Where the solid the user clicked ends.
 *
 * Returns null when the crossings never close - an open mesh like a hair card,
 * or an asset with inconsistent winding, where the count is not to be trusted.
 * Guessing a far side from unreliable normals would put a joint somewhere
 * arbitrary; saying so and falling back to an estimate is honest.
 */
function farSideOf(through: readonly PickResult[]): PickResult | null {
  const direction = rayDirection(through);
  if (!direction) return null;

  let depth = 0;
  for (const hit of through) {
    depth += hit.normal.dot(direction) < 0 ? 1 : -1;
    // Back out of every layer we went into: this is the far side.
    if (depth <= 0) return hit;
  }
  return null;
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
