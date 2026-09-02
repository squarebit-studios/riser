// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The centre line: that things stay on it, and that staying on it does not
// break the binding underneath them.
//
// The second half is the one that could go wrong quietly. Moving a guide onto
// the plane has to move its OFFSET by the same amount, because the document's
// one invariant is `position = evaluate(binding) + offset` and the Python
// worker re-evaluates it independently. A snap that moved the position alone
// would look perfect in the viewport and resolve somewhere else on the server.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import {
  centreCurveAlong,
  centreGuide,
  curveSymmetry,
  holdToCentreLine,
  isCentreGuide,
  reflectAcrossCentre,
  symmetricTargets
} from './centreLine';
import * as M from './mutations';
import { getTemplate } from '../templates';
import { createDocument } from './types';
import type { CurvePoint, Guide, SurfaceBinding, Vec3 } from './types';

const biped = getTemplate('biped');

function binding(offset: Vec3): SurfaceBinding {
  return {
    primPath: '/Riser/Character/Geom/Body',
    faceIndex: 42,
    barycentric: [0.2, 0.3, 0.5],
    offset
  };
}

function guide(id: string, position: Vec3, offset: Vec3 = [0, 0, 0]): Guide {
  return {
    id,
    group: 'spine',
    position,
    normal: [0, 0, 1],
    binding: binding(offset),
    source: 'user',
    confidence: 1
  };
}

function point(position: Vec3, offset: Vec3 = [0, 0, 0]): CurvePoint {
  return { position, normal: [0, 0, 1], binding: binding(offset) };
}

describe('which things belong on the centre line', () => {
  it('knows the spine, neck and head do', () => {
    for (const id of ['root', 'pelvis', 'spine01', 'chest', 'neck', 'head', 'headTop']) {
      expect(isCentreGuide(biped, id), id).toBe(true);
    }
  });

  it('knows a left or right guide does not', () => {
    for (const id of ['shoulderL', 'elbowR', 'wristL', 'kneeR']) {
      expect(isCentreGuide(biped, id), id).toBe(false);
    }
  });
});

describe('holding a position on the centre line', () => {
  it('keeps evaluate + offset landing where the position says', () => {
    // The surface point the binding evaluates to is position - offset, and
    // that must not change: the triangle and barycentric coordinate are
    // untouched, so the server still evaluates the same point.
    const before: Vec3 = [0.03, 1.2, 0.4];
    const offsetBefore: Vec3 = [0.01, 0, -0.02];
    const evaluated: Vec3 = [
      before[0] - offsetBefore[0],
      before[1] - offsetBefore[1],
      before[2] - offsetBefore[2]
    ];

    const after = holdToCentreLine(before, binding(offsetBefore));
    const offsetAfter = (after.binding as SurfaceBinding).offset;

    expect(after.position[0]).toBe(0);
    const resolved: Vec3 = [
      after.position[0] - offsetAfter[0],
      after.position[1] - offsetAfter[1],
      after.position[2] - offsetAfter[2]
    ];
    expect(resolved[0]).toBeCloseTo(evaluated[0], 12);
    expect(resolved[1]).toBeCloseTo(evaluated[1], 12);
    expect(resolved[2]).toBeCloseTo(evaluated[2], 12);
  });

  it('leaves the triangle it is bound to completely alone', () => {
    const held = holdToCentreLine([0.05, 1, 0], binding([0, 0, 0]));
    expect((held.binding as SurfaceBinding).faceIndex).toBe(42);
    expect((held.binding as SurfaceBinding).barycentric).toEqual([0.2, 0.3, 0.5]);
    expect((held.binding as SurfaceBinding).primPath).toBe(
      '/Riser/Character/Geom/Body'
    );
  });

  it('handles a guide with no binding at all', () => {
    const free = holdToCentreLine([0.4, 1, 0], null);
    expect(free.position).toEqual([0, 1, 0]);
    expect(free.binding).toBeNull();
  });

  it('does nothing to something already centred', () => {
    const already: Vec3 = [0, 1, 2];
    expect(centreGuide(guide('neck', already)).position).toBe(already);
  });
});

describe('the document holds centre guides there by itself', () => {
  const doc = createDocument('biped', '');

  it('on placement', () => {
    const placed = M.placeGuide(doc, guide('neck', [0.02, 1.5, 0]));
    expect(placed.guides[0]?.position[0]).toBe(0);
  });

  it('on a drag, which is the way one actually drifts', () => {
    const placed = M.placeGuide(doc, guide('spine01', [0, 1, 0]));
    const dragged = M.moveGuide(
      placed,
      'spine01',
      [0.07, 1.1, 0.2],
      [0, 0, 1],
      binding([0, 0, 0])
    );
    expect(dragged.guides[0]?.position[0]).toBe(0);
    expect(dragged.guides[0]?.position[1]).toBe(1.1);
  });

  it('and leaves a side guide exactly where it was put', () => {
    const placed = M.placeGuide(
      doc,
      { ...guide('shoulderL', [0.3, 1.4, 0]), group: 'armL' }
    );
    expect(placed.guides[0]?.position[0]).toBe(0.3);
  });
});

describe('telling one kind of centre curve from the other', () => {
  it('calls a spine curve one that runs along the line', () => {
    const spine = [
      point([0, 0.2, 0]),
      point([0.001, 0.6, 0.01]),
      point([0, 1.0, 0]),
      point([-0.001, 1.4, 0.01])
    ];
    expect(curveSymmetry(biped, { id: 'spineCurve', points: spine })).toBe('along');
  });

  it('calls a lip one that spans it', () => {
    const lip = [
      point([-0.05, 1.6, 0.1]),
      point([0, 1.62, 0.11]),
      point([0.05, 1.6, 0.1])
    ];
    expect(curveSymmetry(biped, { id: 'lipUpper', points: lip })).toBe('spanning');
  });

  it('calls a brow a side curve, whatever its points look like', () => {
    expect(
      curveSymmetry(biped, { id: 'browL', points: [point([0.05, 1.7, 0.1])] })
    ).toBe('side');
  });
});

describe('making a curve symmetric', () => {
  it('puts every point of an along curve on the plane, bindings intact', () => {
    const held = centreCurveAlong([point([0.02, 1, 0]), point([-0.03, 1.4, 0])]);
    expect(held.map((p) => p.position[0])).toEqual([0, 0]);
    expect(held[0]?.binding?.faceIndex).toBe(42);
  });

  it('mirrors the drawn half onto the other and centres the middle', () => {
    const lip = [
      point([-0.05, 1.6, 0.1]),
      point([-0.02, 1.63, 0.12]),
      point([0.004, 1.62, 0.11]), // the middle one, placed slightly off
      point([0.03, 1.61, 0.09]), // these two were placed carelessly
      point([0.06, 1.58, 0.08])
    ];
    const targets = symmetricTargets(lip);

    // The first half is the source and is untouched.
    expect(targets[0]).toEqual([-0.05, 1.6, 0.1]);
    expect(targets[1]).toEqual([-0.02, 1.63, 0.12]);
    // The middle goes exactly onto the plane, keeping its height and depth.
    expect(targets[2]).toEqual([0, 1.62, 0.11]);
    // And the far half becomes the reflection of the near one, in order.
    expect(targets[3]).toEqual([0.02, 1.63, 0.12]);
    expect(targets[4]).toEqual([0.05, 1.6, 0.1]);
  });

  it('mirroring twice is the same as mirroring once', () => {
    const lip = [
      point([-0.05, 1.6, 0.1]),
      point([0.01, 1.62, 0.11]),
      point([0.06, 1.58, 0.08])
    ];
    const once = symmetricTargets(lip);
    const twice = symmetricTargets(once.map((t) => point(t)));
    expect(twice).toEqual(once);
  });

  it('handles an even number of points, with no middle to centre', () => {
    const targets = symmetricTargets([
      point([-0.04, 1, 0]),
      point([-0.01, 1.1, 0]),
      point([0.02, 1.1, 0]),
      point([0.05, 1, 0])
    ]);
    expect(targets[0]).toEqual([-0.04, 1, 0]);
    expect(targets[1]).toEqual([-0.01, 1.1, 0]);
    expect(targets[2]).toEqual([0.01, 1.1, 0]);
    expect(targets[3]).toEqual([0.04, 1, 0]);
  });

  it('reflects a position and nothing else', () => {
    expect(reflectAcrossCentre([0.3, 1.2, -0.4])).toEqual([-0.3, 1.2, -0.4]);
  });
});
