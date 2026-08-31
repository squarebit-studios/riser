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
  const wantsInside =
    mode === 'center' || (mode === 'auto' && options.interior);

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
 * The first two crossings, not the first and last: a ray aimed at an arm will
 * often continue into the torso, and the centre of "the arm and the torso" is
 * not a place any joint belongs.
 */
export function volumeDepth(
  surface: SurfacePick,
  through: readonly PickResult[] | undefined
): number | null {
  if (!through || through.length < 2) return null;

  const entry = through[0]!;
  const exit = through[1]!;
  const span = entry.point.distanceTo(exit.point);
  if (!(span > 0)) return null;

  // Measured from the point the user actually clicked, which on a subdivided
  // character is the limit surface rather than the cage.
  const fromClick = surface.worldPoint.distanceTo(entry.point);
  return span / 2 + fromClick;
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
