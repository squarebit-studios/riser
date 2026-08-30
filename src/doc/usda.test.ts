import { describe, it, expect } from 'vitest';
import { writeUsda, fmt, primName, PATHS } from './usda-writer';
import { readUsda, isRiserLayer, UsdaReadError } from './usda-reader';
import {
  createDocument,
  type Curve,
  type Guide,
  type RiserDocument,
  type Vec3
} from './types';

// -------------------------------------------------------------------------
// Fixtures
// -------------------------------------------------------------------------

function guide(id: string, group: string, pos: Vec3, bound = true): Guide {
  return {
    id,
    group,
    position: pos,
    normal: [0, 1, 0],
    binding: bound
      ? {
          primPath: '/Riser/Character/Geom/Body',
          faceIndex: 12043,
          barycentric: [0.2134567, 0.3412345, 0.4453088],
          offset: [0, 0, 0]
        }
      : null,
    source: 'user',
    confidence: 1
  };
}

function curve(id: string, count: number, bound = true): Curve {
  return {
    id,
    group: 'face',
    closed: false,
    width: 0.004,
    points: Array.from({ length: count }, (_, i) => ({
      position: [i * 0.01, 1.6 + i * 0.002, 0.08] as Vec3,
      normal: [0, 0, 1] as Vec3,
      binding: bound
        ? {
            primPath: '/Riser/Character/Geom/Head',
            faceIndex: 500 + i,
            barycentric: [0.1, 0.2, 0.7] as Vec3,
            offset: [0, 0, 0] as Vec3
          }
        : null
    }))
  };
}

function sampleDoc(): RiserDocument {
  const doc = createDocument('biped', './character.usdc', {
    name: 'Test Character',
    metersPerUnit: 0.01
  });
  doc.guides = [
    guide('pelvis', 'spine', [0, 0.95, 0]),
    guide('chest', 'spine', [0, 1.35, 0.02]),
    guide('wristL', 'armL', [0.62, 1.1, 0]),
    guide('freeGuide', 'spine', [0, 2, 0], false)
  ];
  doc.curves = [curve('browL', 5), curve('jawline', 12), curve('freeCurve', 3, false)];
  return doc;
}

function expectVec3Close(actual: Vec3, expected: Vec3, digits = 5): void {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
  expect(actual[2]).toBeCloseTo(expected[2], digits);
}

/** Structural comparison with float tolerance. */
function expectDocsEqual(actual: RiserDocument, expected: RiserDocument): void {
  expect(actual.docVersion).toBe(expected.docVersion);
  expect(actual.templateId).toBe(expected.templateId);
  expect(actual.name).toBe(expected.name);
  expect(actual.characterRef).toBe(expected.characterRef);
  expect(actual.upAxis).toBe(expected.upAxis);
  expect(actual.metersPerUnit).toBeCloseTo(expected.metersPerUnit, 9);

  expect(actual.guides.map((g) => g.id)).toEqual(expected.guides.map((g) => g.id));
  for (const want of expected.guides) {
    const got = actual.guides.find((g) => g.id === want.id);
    expect(got, `guide ${want.id} missing`).toBeDefined();
    expect(got!.group).toBe(want.group);
    expectVec3Close(got!.position, want.position);
    expectVec3Close(got!.normal, want.normal);
    if (want.binding === null) {
      expect(got!.binding, `guide ${want.id} should be unbound`).toBeNull();
    } else {
      expect(got!.binding, `guide ${want.id} should be bound`).not.toBeNull();
      expect(got!.binding!.primPath).toBe(want.binding.primPath);
      expect(got!.binding!.faceIndex).toBe(want.binding.faceIndex);
      expectVec3Close(got!.binding!.barycentric, want.binding.barycentric, 6);
      expectVec3Close(got!.binding!.offset, want.binding.offset, 6);
    }
  }

  expect(actual.curves.map((c) => c.id)).toEqual(expected.curves.map((c) => c.id));
  for (const want of expected.curves) {
    const got = actual.curves.find((c) => c.id === want.id);
    expect(got, `curve ${want.id} missing`).toBeDefined();
    expect(got!.group).toBe(want.group);
    expect(got!.closed).toBe(want.closed);
    expect(got!.width).toBeCloseTo(want.width, 6);
    expect(got!.points.length, `curve ${want.id} point count`).toBe(want.points.length);
    want.points.forEach((wp, i) => {
      const gp = got!.points[i]!;
      expectVec3Close(gp.position, wp.position);
      expectVec3Close(gp.normal, wp.normal);
      if (wp.binding === null) {
        expect(gp.binding, `curve ${want.id} point ${i} should be unbound`).toBeNull();
      } else {
        expect(gp.binding, `curve ${want.id} point ${i} should be bound`).not.toBeNull();
        expect(gp.binding!.primPath).toBe(wp.binding.primPath);
        expect(gp.binding!.faceIndex).toBe(wp.binding.faceIndex);
        expectVec3Close(gp.binding!.barycentric, wp.binding.barycentric, 6);
      }
    });
  }
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe('fmt', () => {
  it('keeps integers integral', () => {
    expect(fmt(0)).toBe('0');
    expect(fmt(5)).toBe('5');
    expect(fmt(-12)).toBe('-12');
  });

  it('trims trailing zeros but stays a float', () => {
    expect(fmt(0.5)).toBe('0.5');
    expect(fmt(1.25)).toBe('1.25');
  });

  it('never emits exponent notation', () => {
    expect(fmt(0.0000001)).not.toMatch(/e/i);
    expect(fmt(123456789.5)).not.toMatch(/e/i);
  });

  it('survives non-finite input', () => {
    expect(fmt(NaN)).toBe('0');
    expect(fmt(Infinity)).toBe('0');
  });
});

describe('primName', () => {
  it('passes valid identifiers through', () => {
    expect(primName('wristL')).toBe('wristL');
    expect(primName('spine_01')).toBe('spine_01');
  });

  it('replaces characters USD will not accept', () => {
    expect(primName('brow.left')).toBe('brow_left');
    expect(primName('curve 1')).toBe('curve_1');
  });

  it('does not start a name with a digit', () => {
    expect(primName('01hip')).toBe('_01hip');
  });
});

describe('writeUsda', () => {
  it('emits a parseable header and the expected prim skeleton', () => {
    const text = writeUsda(sampleDoc());
    expect(text.startsWith('#usda 1.0\n')).toBe(true);
    expect(text).toContain('defaultPrim = "Riser"');
    expect(text).toContain('def Xform "Riser"');
    expect(text).toContain('prepend references = @./character.usdc@');
    expect(text).toContain('def Scope "Guides"');
    expect(text).toContain('def Scope "Curves"');
    expect(text).toContain('def BasisCurves "browL"');
  });

  it('never writes the custom qualifier', () => {
    // three's USDAParser ATTR_MATCH_REGEX only tolerates `uniform`; a `custom`
    // prefix would make every attribute on that line unreadable.
    expect(writeUsda(sampleDoc())).not.toMatch(/^\s*custom\s/m);
  });

  it('places each metadata block opener on its own line', () => {
    // The parser keys metadata blocks off a line ENDING in '(' - anything else
    // silently drops the reference.
    const text = writeUsda(sampleDoc());
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      // Only `def` lines open a metadata block. Value lines contain parens too
      // (every float3 does), which is not what this invariant is about.
      if (!trimmed.startsWith('def ')) continue;
      if (!trimmed.includes('(')) continue;
      expect(trimmed.endsWith('('), `bad metadata line: ${line}`).toBe(true);
    }
  });

  it('is deterministic', () => {
    const doc = sampleDoc();
    expect(writeUsda(doc)).toBe(writeUsda(doc));
  });
});

describe('round trip', () => {
  it('doc -> usda -> doc is identity', () => {
    const doc = sampleDoc();
    expectDocsEqual(readUsda(writeUsda(doc)), doc);
  });

  it('is stable across a second pass', () => {
    // Catches drift: any value that degrades a little on each save would show
    // up here even if a single pass looked clean.
    const doc = sampleDoc();
    const once = writeUsda(doc);
    const twice = writeUsda(readUsda(once));
    expect(twice).toBe(once);
  });

  it('handles an empty document', () => {
    const doc = createDocument('biped', './character.usdc', { name: 'Empty' });
    const back = readUsda(writeUsda(doc));
    expect(back.guides).toEqual([]);
    expect(back.curves).toEqual([]);
    expect(back.characterRef).toBe('./character.usdc');
  });

  it('preserves a long curve that wraps across lines', () => {
    // The writer wraps point arrays; the parser has to reassemble them. A
    // 60-point curve is well past the wrap threshold.
    const doc = createDocument('biped', './c.usdc');
    doc.curves = [curve('long', 60)];
    const back = readUsda(writeUsda(doc));
    expect(back.curves[0]!.points.length).toBe(60);
    expectVec3Close(back.curves[0]!.points[59]!.position, [0.59, 1.718, 0.08]);
    expect(back.curves[0]!.points[59]!.binding!.faceIndex).toBe(559);
  });

  it('keeps unbound guides distinguishable from bound ones', () => {
    const back = readUsda(writeUsda(sampleDoc()));
    expect(back.guides.find((g) => g.id === 'freeGuide')!.binding).toBeNull();
    expect(back.guides.find((g) => g.id === 'pelvis')!.binding).not.toBeNull();
  });

  it('preserves a closed curve', () => {
    const doc = createDocument('biped', './c.usdc');
    const c = curve('lipOuter', 8);
    c.closed = true;
    doc.curves = [c];
    expect(readUsda(writeUsda(doc)).curves[0]!.closed).toBe(true);
  });

  it('preserves an off-surface offset', () => {
    const doc = createDocument('biped', './c.usdc');
    const g = guide('hipL', 'legL', [0.1, 0.9, 0]);
    g.binding!.offset = [0.012, -0.004, 0.031];
    doc.guides = [g];
    const back = readUsda(writeUsda(doc));
    expectVec3Close(back.guides[0]!.binding!.offset, [0.012, -0.004, 0.031], 6);
  });

  it('preserves ids that are not valid prim names', () => {
    // The prim name gets sanitised; the id must survive intact because that is
    // what the template checklist and the server match on.
    const doc = createDocument('biped', './c.usdc');
    doc.guides = [guide('brow.left', 'face', [0, 1.7, 0.1])];
    expect(readUsda(writeUsda(doc)).guides[0]!.id).toBe('brow.left');
  });

  it('preserves a name containing quotes', () => {
    const doc = createDocument('biped', './c.usdc', { name: 'Bob "the" Rig' });
    expect(readUsda(writeUsda(doc)).name).toBe('Bob "the" Rig');
  });

  it('preserves centimetre-scale stage metadata', () => {
    const doc = createDocument('quadruped', './horse.usdc', { metersPerUnit: 0.01 });
    const back = readUsda(writeUsda(doc));
    expect(back.metersPerUnit).toBeCloseTo(0.01, 9);
    expect(back.templateId).toBe('quadruped');
  });

  it('preserves a Z-up stage', () => {
    const doc = createDocument('biped', './c.usdc', { upAxis: 'Z' });
    expect(readUsda(writeUsda(doc)).upAxis).toBe('Z');
  });
});

describe('readUsda error handling', () => {
  it('rejects a layer with no Riser prim', () => {
    const notOurs = '#usda 1.0\n(\n    defaultPrim = "World"\n)\n\ndef Xform "World"\n{\n}\n';
    expect(() => readUsda(notOurs)).toThrow(UsdaReadError);
  });

  it('rejects empty input', () => {
    expect(() => readUsda('')).toThrow(UsdaReadError);
  });
});

describe('isRiserLayer', () => {
  it('recognises our own output', () => {
    expect(isRiserLayer(writeUsda(sampleDoc()))).toBe(true);
  });

  it('rejects unrelated USD', () => {
    expect(isRiserLayer('#usda 1.0\ndef Mesh "Cube" {}')).toBe(false);
  });
});

describe('PATHS', () => {
  it('matches the prim structure the writer emits', () => {
    const text = writeUsda(sampleDoc());
    expect(PATHS.root).toBe('/Riser');
    expect(text).toContain('def Xform "Riser"');
    expect(PATHS.guides).toBe('/Riser/Guides');
    expect(PATHS.curves).toBe('/Riser/Curves');
    expect(PATHS.character).toBe('/Riser/Character');
  });
});
