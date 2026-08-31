import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  PLACEMENT_MODES,
  pointOnCameraPlane,
  resolvePlacement,
  volumeCentre,
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
  // A real mesh at identity, so cage-local space and world space coincide and
  // the arithmetic below can still be read off by eye. The placement code
  // transforms through this object's world matrix, which is the mechanism that
  // makes a centimetre-authored character work without any scaling by hand.
  const object = new THREE.Mesh(new THREE.BufferGeometry());
  object.updateMatrixWorld(true);

  return {
    pick: {
      object,
      localPoint: new THREE.Vector3(0, 0, 1)
    } as PickResult,
    offset,
    worldPoint: new THREE.Vector3(0, 0, 1),
    normal: new THREE.Vector3(0, 0, 1),
    localNormal: new THREE.Vector3(0, 0, 1)
  };
}

/**
 * A crossing of the click ray at `z`, facing into or out of the solid.
 *
 * The ray travels along -z, so a face going IN has a normal pointing +z.
 * Orientation is what lets nested layers - clothing over skin - be told apart
 * from the two sides of one solid.
 */
function crossing(z: number, going: 'in' | 'out' = 'in'): PickResult {
  return {
    point: new THREE.Vector3(0, 0, z),
    normal: new THREE.Vector3(0, 0, going === 'in' ? 1 : -1),
    distance: 1 - z
  } as PickResult;
}

/** A limb one unit thick: the ray enters at z = 1 and leaves at z = 0. */
const THROUGH_A_LIMB = [crossing(1, 'in'), crossing(0, 'out')];

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
      options({ through: [crossing(1, 'in'), crossing(0.8, 'out')] })
    );
    const thick = resolvePlacement(
      'center',
      surfacePick(),
      options({ through: [crossing(1, 'in'), crossing(0, 'out')] })
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
      options({
        through: [
          crossing(1, 'in'),
          crossing(0.8, 'out'),
          crossing(-2, 'in'),
          crossing(-3, 'out')
        ]
      })
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
      options({ through: [crossing(1, 'in')] })
    );
    expect(result.measured).toBe(false);
  });

  it('is undisturbed by a zero-thickness crossing', () => {
    // Two coincident hits - a degenerate sliver - would give a depth of zero,
    // which is the surface, not a centre.
    const result = resolvePlacement(
      'center',
      surfacePick(),
      options({ through: [crossing(1, 'in'), crossing(1, 'out')] })
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

describe('a character wearing clothes', () => {
  /**
   * Gary's hip, as actually measured: the ray enters his spacesuit, enters his
   * skin a millimetre later, then leaves both on the far side.
   */
  const LAYERED_HIP = [
    crossing(0.343, 'in'), // spacesuit, front
    crossing(0.342, 'in'), // body, front
    crossing(-0.166, 'out'), // body, back
    crossing(-0.166, 'out') // spacesuit, back
  ];

  it('measures the whole hip, not the gap between suit and skin', () => {
    // The bug this exists for. Taking the first two crossings measured the
    // 1mm between a spacesuit and the body inside it, so a centre placement
    // landed back on the surface - on every clothed character, while looking
    // perfect on a bare blockout.
    const pick = surfacePick();
    pick.worldPoint.set(0, 0, 0.343);
    expect(volumeDepth(pick, LAYERED_HIP)).toBeCloseTo(0.2545, 3);
  });

  it('still stops at the arm rather than running on into the torso', () => {
    // The property the naive version had by accident, and which the layered
    // fix must not lose: the arm's own exit closes the count first.
    const pick = surfacePick();
    pick.worldPoint.set(0, 0, 1);
    const armThenTorso = [
      crossing(1, 'in'),
      crossing(0.8, 'out'),
      crossing(-2, 'in'),
      crossing(-3, 'out')
    ];
    expect(volumeDepth(pick, armThenTorso)).toBeCloseTo(0.1, 6);
  });

  it('handles three layers over the body', () => {
    // Briefs over skin over a suit, which is what Gary's thigh really is.
    const pick = surfacePick();
    pick.worldPoint.set(0, 0, 0.172);
    const thigh = [
      crossing(0.172, 'in'),
      crossing(0.167, 'in'),
      crossing(0.167, 'in'),
      crossing(-0.097, 'out'),
      crossing(-0.099, 'out'),
      crossing(-0.107, 'out')
    ];
    expect(volumeDepth(pick, thigh)).toBeCloseTo(0.1395, 3);
  });

  it('refuses to guess when the crossings never close', () => {
    // An open mesh - a hair card, an eyelash - or inconsistent winding. The
    // count cannot be trusted, so the caller falls back to an estimate and
    // tells the user rather than inventing a far side.
    const pick = surfacePick();
    expect(
      volumeDepth(pick, [crossing(1, 'in'), crossing(0.5, 'in'), crossing(0, 'in')])
    ).toBeNull();
  });

  it('declines to measure when the ray starts inside the geometry', () => {
    // A first crossing that is back-facing means the camera is already inside
    // the solid, so there is no entry point to measure from. Inventing one
    // would put the joint somewhere arbitrary; falling back to an estimate and
    // saying so is the honest answer.
    const pick = surfacePick();
    pick.worldPoint.set(0, 0, 1);
    expect(volumeDepth(pick, [crossing(1, 'out'), crossing(0, 'in')])).toBeNull();
  });
});

describe('a garment in front of the body', () => {
  /**
   * Gary at chest height: a spacesuit shell less than a millimetre thick
   * closes a perfectly valid solid before the ray ever reaches him.
   */
  const SHELL_THEN_BODY = [
    crossing(0.2327, 'in'),
    crossing(0.2318, 'out'), // the shell closes here, 0.9mm thick
    crossing(0.2146, 'in'),
    crossing(0.2146, 'in'),
    crossing(-0.2659, 'out'),
    crossing(-0.2662, 'out')
  ];

  it('skips a shell too thin to be a body part', () => {
    // Taking the first CLOSED solid is not enough either: it put joints inside
    // a spacesuit. Anything thinner than a few millimetres on a person-sized
    // character is clothing.
    const centre = volumeCentre(SHELL_THEN_BODY, 0.007);
    expect(centre).not.toBeNull();
    // Midpoint of the body, not of the 0.9mm shell at z = 0.232.
    expect(centre!.z).toBeCloseTo((0.2146 + -0.2659) / 2, 3);
  });

  it('takes the shell when that is genuinely all there is', () => {
    // A character made of thin pieces should still get an answer from real
    // geometry rather than a fraction of its own height.
    const centre = volumeCentre([crossing(1, 'in'), crossing(0.999, 'out')], 0.007);
    expect(centre).not.toBeNull();
    expect(centre!.z).toBeCloseTo(0.9995, 4);
  });

  it('measures nothing thin when no threshold is given', () => {
    const centre = volumeCentre(SHELL_THEN_BODY);
    expect(centre!.z).toBeCloseTo(0.23225, 4);
  });
});

describe('a character authored in centimetres', () => {
  it('places at the same point whatever the units', () => {
    // Gary is authored in centimetres, so his meshes sit at world scale 0.01.
    // Depths measured by raycasting are in WORLD units while the offset they
    // become is cage-local, and applying one as the other put a 26cm joint
    // placement 0.26cm inside - the surface. Going to the midpoint through the
    // object's own inverse world matrix makes the conversion automatic.
    const scaled = surfacePick();
    scaled.pick.object.scale.setScalar(0.01);
    scaled.pick.object.updateMatrixWorld(true);
    // The cage point in LOCAL space is 100x the world point.
    scaled.pick.localPoint.set(0, 0, 100);
    scaled.worldPoint.set(0, 0, 1);

    const result = resolvePlacement(
      'center',
      scaled,
      options({ through: THROUGH_A_LIMB })
    );

    // World centre is z = 0.5, which is z = 50 in local units, so the offset
    // from the cage point at 100 is -50 - not the -0.5 an unconverted world
    // distance would have given.
    expect(result.offset[2]).toBeCloseTo(-50, 4);
    expect(result.measured).toBe(true);
  });
});
