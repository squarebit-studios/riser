// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Reading UsdSkel blend shapes.
//
// Against a real 2KB crate rather than USDA text, for a reason worth knowing:
// three's USDA parser does not produce the path-keyed spec table its CRATE
// parser does. It returns a nested object keyed by raw declarations, so this
// reader, the eye look reader and the topology reader all read USDC and USDZ
// only. A USDA fixture would have tested a code path that does not exist.
//
// The fixture is generated rather than hand-written, by
// `scratchpad/mkfix.py` using OpenUSD, so what is under test is a crate USD
// itself produced. The character that carries the real thing is 21MB and does
// not belong in the repository.
//
// The cases are the ones that go wrong: a shape whose offsets and indices
// disagree, a dense shape with no indices, a target naming a prim nobody
// authored, and one name on two meshes, which is the whole point.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readBlendShapes, shapeNames } from './blendShapeData';

function fixture(): ArrayBuffer {
  const file = readFileSync(
    join(process.cwd(), 'src', 'io', 'fixtures', 'blend-shapes.usdc')
  );
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

describe('reading blend shapes from USD', () => {
  const shapes = readBlendShapes(fixture());

  it('finds the meshes that really carry shapes', () => {
    // `ghosted` declares a target that was never authored and `broken`
    // declares one whose halves disagree, so neither should appear.
    expect([...shapes.keys()].sort()).toEqual(['dense', 'face', 'gums']);
  });

  it('reads the sparse pair as authored', () => {
    const jaw = shapes.get('face')!.find((s) => s.name === 'jaw_open')!;
    expect([...jaw.pointIndices]).toEqual([4, 7]);
    expect([...jaw.offsets]).toEqual([0, -1, 0, 0, -2, 0]);
  });

  it('keeps one offset per moved point, not one per point', () => {
    // The reason any of this is affordable. Kept dense, the real character's
    // body would want a delta for all 25,490 points on each of its 878 shapes,
    // which is about 1.6GB for one mesh.
    for (const list of shapes.values()) {
      for (const shape of list) {
        expect(shape.offsets.length).toBe(shape.pointIndices.length * 3);
      }
    }
  });

  it('reports a name shared across meshes once, and on both meshes', () => {
    // What lets one control drive several meshes: 462 of the real character's
    // 932 names are on more than one, because a jaw shape has to move the gums
    // along with the face.
    expect(shapeNames(shapes).sort()).toEqual(['all', 'cheek_puff_l', 'jaw_open']);
    expect(shapes.get('face')!.some((s) => s.name === 'jaw_open')).toBe(true);
    expect(shapes.get('gums')!.some((s) => s.name === 'jaw_open')).toBe(true);
  });

  it('refuses a shape whose offsets and indices disagree', () => {
    // Two offsets against one index cannot both be right, and applying it
    // anyway would move the wrong part of the face.
    expect(shapes.has('broken')).toBe(false);
  });

  it('drops a target naming a prim that is not there', () => {
    // Exactly what mayaUSDExport produced on this character: names and
    // relationships with no shapes behind them, 878 of 878 dangling. A control
    // that appears and does nothing is worse than one that never appears.
    expect(shapes.has('ghosted')).toBe(false);
  });

  it('accepts a dense shape, which authors one offset per point in order', () => {
    const shape = shapes.get('dense')![0]!;
    expect([...shape.pointIndices]).toEqual([0, 1, 2]);
    expect(shape.offsets.length).toBe(9);
  });

  it('finds nothing in a file that carries none', () => {
    expect(readBlendShapes(new ArrayBuffer(8)).size).toBe(0);
  });
});
