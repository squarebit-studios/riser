// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Does a curve actually get drawn?
//
// Reported: while placing points nothing appears but the dots, and the line
// only shows up after a reload. The difference between those two moments is
// which curve is ACTIVE, so that is what this pins down: the layer must draw
// the line in both states, from the second point onwards.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CurveLayer } from './CurveLayer';
import type { Vec3 } from '../../doc/types';

function layer(): { layer: CurveLayer; parent: THREE.Object3D } {
  const parent = new THREE.Object3D();
  const made = new CurveLayer(parent);
  made.setResolution(1920, 1080);
  return { layer: made, parent };
}

/** Every line the layer has put in the scene, whether visible or not. */
function lines(parent: THREE.Object3D): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  parent.traverse((child) => {
    if (child.name.startsWith('Curve:')) found.push(child);
  });
  return found;
}

const P: Vec3[] = [
  [0, 0, 0],
  [1, 0.5, 0],
  [2, 0, 0]
];

describe('drawing a curve into the scene', () => {
  it('draws the line for a curve being placed, not only a finished one', () => {
    const { layer: curves, parent } = layer();

    // Exactly the shape the app sends while somebody is placing points: the
    // curve is active, and no projection has been computed for it.
    curves.setCurves([
      { id: 'browL', points: P.slice(0, 2), polyline: undefined, closed: false, active: true }
    ]);

    const drawn = lines(parent);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.visible).toBe(true);
  });

  it('draws it the same once it is no longer the active curve', () => {
    const { layer: curves, parent } = layer();
    curves.setCurves([
      { id: 'browL', points: P, polyline: undefined, closed: false, active: true }
    ]);
    curves.setCurves([
      { id: 'browL', points: P, polyline: undefined, closed: false, active: false }
    ]);
    expect(lines(parent)[0]?.visible).toBe(true);
  });

  it('shows nothing but the point until there are two of them', () => {
    const { layer: curves, parent } = layer();
    curves.setCurves([
      { id: 'browL', points: P.slice(0, 1), polyline: undefined, closed: false, active: true }
    ]);
    expect(lines(parent)[0]?.visible).toBe(false);
  });

  it('keeps drawing as points keep arriving', () => {
    const { layer: curves, parent } = layer();
    for (let n = 2; n <= P.length; n++) {
      curves.setCurves([
        {
          id: 'browL',
          points: P.slice(0, n),
          polyline: undefined,
          closed: false,
          active: true
        }
      ]);
      expect(lines(parent)[0]?.visible, `with ${n} points`).toBe(true);
    }
  });
});
