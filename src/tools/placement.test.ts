import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  PLACEMENT_MODES,
  pointOnCameraPlane,
  resolvePlacement,
  volumeDepth,
  type PlacementMode
} from './placement';
import type { PickResult, SurfacePick } from '../viewport/Picker';
import type { Vec3 } from '../doc/types';

/**
 * A click straight down the -z axis onto a surface at z = 1, whose normal
 * points back at the camera. Chosen so "inward" is simply -z and the
 * arithmetic can be read off by eye.
 */
function surfacePick(offset: Vec3 = [0, 0, 0]): SurfacePick {
  return {
    pick: {} as PickResult,
    offset,
    worldPoint: new THREE.Vector3(0, 0, 1),
    normal: new THREE.Vector3(0, 0, 1),
    localNormal: new THREE.Vector3(0, 0, 1)
  };
}

/** A crossing of the click ray at distance `z` along the axis. */
function crossing(z: number): PickResult {
  return {
    point: new THREE.Vector3(0, 0, z),
    distance: 1 - z
  } as PickResult;
}

/** A limb one unit thick: the ray enters at z = 1 and leaves at z = 0. */
const THROUGH_A_LIMB = [crossing(1), crossing(0)];

const options = (extra: Partial<Parameters<typeof resolvePlacement>[2]> = {}) => ({
  interior: false,
  characterHeight: 2,
  ...extra
});

describe('what a click means', () => {
  it('offers every mode with a label and a reason', () => {
    // These are read straight out of a menu by someone deciding between them,
    // so an unexplained option is a useless one.
    expect(PLACEMENT_MODES.length).toBe(4);
    for (const mode of PLACEMENT_MODES) {
      expect(mode.label.length).toBeGreaterThan(0);
      expect(mode.hint.length).toBeGreaterThan(10);
    }
  });
});

describe('placing on the surface', () => {
  it('keeps the clicked point exactly', () => {
    const result = resolvePlacement('surface', surfacePick(), options());
    expect(result.offset).toEqual([0, 0, 0]);
    expect(result.measured).toBe(true);
  });

  it('stays on the surface even for a guide the template calls interior', () => {
    // The whole point of an explicit mode: it overrides the template.
    const result = resolvePlacement(
      'surface',
      surfacePick(),
      options({ interior: true, through: THROUGH_A_LIMB })
    );
    expect(result.offset).toEqual([0, 0, 0]);
  });

  it('carries the subdivision offset through untouched', () => {
    // On a subdivided character the clicked point is on the limit surface and
    // the binding names a cage triangle; that gap is already in the offset and
    // must survive.
    const result = resolvePlacement('surface', surfacePick([0.1, 0, 0]), options());
    expect(result.offset).toEqual([0.1, 0, 0]);
  });
});

describe('placing at the centre of the volume', () => {
  it('lands halfway through the limb', () => {
    // Enters at z = 1, leaves at z = 0, so the centre is z = 0.5 - which is
    // 0.5 inward from the clicked point along the +z normal.
    const result = resolvePlacement(
      'center',
      surfacePick(),
      options({ through: THROUGH_A_LIMB })
    );
    expect(result.offset[2]).toBeCloseTo(-0.5, 6);
    expect(result.measured).toBe(true);
  });

  it('scales with the limb, not with the character', () => {
    // The reason this replaced a fraction of body height: a thin wrist and a
    // thick thigh on the same character need different depths, and only a
    // measurement gives them.
    const thin = resolvePlacement(
      'center',
      surfacePick(),
      options({ through: [crossing(1), crossing(0.8)] })
    );
    const thick = resolvePlacement(
      'center',
      surfacePick(),
      options({ through: [crossing(1), crossing(0)] })
    );
    expect(Math.abs(thin.offset[2])).toBeCloseTo(0.1, 6);
    expect(Math.abs(thick.offset[2])).toBeCloseTo(0.5, 6);
  });

  it('measures the first thing the ray hits, not everything behind it', () => {
    // A ray aimed at an arm usually carries on into the torso. The centre of
    // "the arm and the torso" is not a place any joint belongs.
    const result = resolvePlacement(
      'center',
      surfacePick(),
      options({ through: [crossing(1), crossing(0.8), crossing(-2), crossing(-3)] })
    );
    expect(Math.abs(result.offset[2])).toBeCloseTo(0.1, 6);
  });

  it('falls back to an estimate when the ray never comes out', () => {
    // An open mesh, or a grazing click at a silhouette. Better to place the
    // joint slightly inside than on the skin - but it is flagged, because it
    // is the one case the app is guessing.
    const result = resolvePlacement('center', surfacePick(), options({ through: [] }));
    expect(result.measured).toBe(false);
    expect(result.offset[2]).toBeLessThan(0);
  });

  it('falls back when only one crossing was found', () => {
    const result = resolvePlacement(
      'center',
      surfacePick(),
      options({ through: [crossing(1)] })
    );
    expect(result.measured).toBe(false);
  });

  it('is undisturbed by a zero-thickness crossing', () => {
    // Two coincident hits - a degenerate sliver - would give a depth of zero,
    // which is the surface, not a centre.
    const result = resolvePlacement(
      'center',
      surfacePick(),
      options({ through: [crossing(1), crossing(1)] })
    );
    expect(result.measured).toBe(false);
  });
});

describe('letting the template decide', () => {
  it('puts an interior guide inside the volume', () => {
    const result = resolvePlacement(
      'auto',
      surfacePick(),
      options({ interior: true, through: THROUGH_A_LIMB })
    );
    expect(result.offset[2]).toBeCloseTo(-0.5, 6);
  });

  it('leaves everything else on the skin', () => {
    const result = resolvePlacement(
      'auto',
      surfacePick(),
      options({ interior: false, through: THROUGH_A_LIMB })
    );
    expect(result.offset).toEqual([0, 0, 0]);
  });
});

describe('free placement', () => {
  it('lands where the click landed, so trying it is not a surprise', () => {
    // Free mode differs from surface in what happens on the DRAG, not on the
    // first click. A mode that teleported the marker on selection would be
    // one nobody dared try.
    const result = resolvePlacement(
      'free',
      surfacePick(),
      options({ interior: true, through: THROUGH_A_LIMB })
    );
    expect(result.offset).toEqual([0, 0, 0]);
  });
});

describe('measuring thickness directly', () => {
  it('reports half the span plus the distance from the click', () => {
    expect(volumeDepth(surfacePick(), THROUGH_A_LIMB)).toBeCloseTo(0.5, 6);
  });

  it('accounts for the click being on the limit surface, inside the cage', () => {
    // With subdivision on, the point the user clicked is not the point the
    // ray first crossed. The depth has to be measured from what they clicked.
    const pick = surfacePick();
    pick.worldPoint.set(0, 0, 0.9);
    expect(volumeDepth(pick, THROUGH_A_LIMB)).toBeCloseTo(0.6, 6);
  });

  it('returns null when there is nothing to measure', () => {
    expect(volumeDepth(surfacePick(), undefined)).toBeNull();
    expect(volumeDepth(surfacePick(), [])).toBeNull();
  });
});

describe('finding a depth for a free click', () => {
  it('puts the point on a camera-facing plane through the reference', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

    const through = new THREE.Vector3(0, 0, 1);
    const point = pointOnCameraPlane(raycaster, camera, through);

    expect(point).not.toBeNull();
    // Dead centre of the screen, so it lands on the reference point itself.
    expect(point!.distanceTo(through)).toBeLessThan(1e-6);
  });

  it('keeps off-centre clicks at the reference depth', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0.5, 0.5), camera);

    const point = pointOnCameraPlane(raycaster, camera, new THREE.Vector3(0, 0, 1));
    expect(point).not.toBeNull();
    expect(point!.z).toBeCloseTo(1, 5);
    // And genuinely off to the side, or the plane maths did nothing.
    expect(Math.abs(point!.x)).toBeGreaterThan(0.1);
  });
});

describe('every mode produces a usable offset', () => {
  const modes: PlacementMode[] = ['auto', 'surface', 'center', 'free'];

  it('never returns a non-finite number', () => {
    // Whatever the mode, the result goes straight into a binding the Python
    // worker resolves. A NaN here is a corrupt document.
    for (const mode of modes) {
      for (const through of [undefined, [], THROUGH_A_LIMB]) {
        const result = resolvePlacement(
          mode,
          surfacePick([0.01, -0.02, 0.03]),
          options({ interior: true, through })
        );
        for (const value of result.offset) {
          expect(Number.isFinite(value), `${mode} produced ${value}`).toBe(true);
        }
      }
    }
  });
});
