import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import { CharacterModel } from '../../io/CharacterModel';
import { sampleSurfacePoints } from './sampleSurface';
import { findQuadrupedLandmarks } from './quadruped';
import { placeGuidesFromQuadruped } from './fromQuadruped';
import { getTemplate } from '../../templates';
import { createDocument, type Guide, type RiserDocument } from '../../doc/types';
import * as M from '../../doc/mutations';
import { resolveBindingWorld } from '../../viewport/Picker';
import { documentToWorld } from '../../viewport/space';

function load(name: string): CharacterModel {
  const text = readFileSync(join(process.cwd(), 'public', 'assets', name), 'utf8');
  return new CharacterModel(new USDLoader().parse(text), {
    ref: name,
    format: 'usd',
    metersPerUnit: 1,
    upAxis: 'Y'
  });
}

const quadTemplate = () => getTemplate('quadruped');
const emptyDoc = (): RiserDocument =>
  createDocument('quadruped', 'quadruped-blockout.usda', { metersPerUnit: 1 });

/**
 * The stock quadruped's construction, from tools/make-stock-assets.mjs. These
 * are what the measurement is checked against - a value it agrees with by
 * accident is not a measurement.
 */
const BUILT = {
  frontLegZ: 0.32,
  backLegZ: -0.39,
  legHalfWidth: 0.11,
  barrelBottomY: 0.5,
  barrelTopY: 0.82,
  noseZ: 0.9,
  tailTipZ: -0.79
};

describe('measuring a four-legged character', () => {
  const model = load('quadruped-blockout.usda');
  const lm = findQuadrupedLandmarks(sampleSurfacePoints(model.meshes))!;

  it('measures it at all', () => {
    expect(lm).not.toBeNull();
    expect(lm.confidence).toBeGreaterThan(0.9);
  });

  it('works out that the long axis is the body, not the height', () => {
    // The whole reason the biped path fails here: it slices by height, which is
    // the shortest axis on an animal that stands on four legs.
    expect(lm.axis).toBe(2);
    expect(lm.maxL - lm.minL).toBeGreaterThan(lm.height);
  });

  it('finds both leg pairs where they were built', () => {
    expect(lm.frontLegL).toBeGreaterThan(BUILT.frontLegZ - 0.1);
    expect(lm.frontLegL).toBeLessThan(BUILT.frontLegZ + 0.1);
    expect(lm.backLegL).toBeGreaterThan(BUILT.backLegZ - 0.1);
    expect(lm.backLegL).toBeLessThan(BUILT.backLegZ + 0.1);
  });

  it('works out which end the head is', () => {
    // From the topline: the skull and ears are the highest thing on the animal,
    // and the tail end slopes away. Nothing else has to know which way it faces.
    expect(lm.headEnd).toBeGreaterThan(lm.tailEnd);
    expect(lm.headL).toBeGreaterThan(0);
  });

  it('measures the leg separation rather than assuming it', () => {
    expect(lm.legHalfWidth).toBeCloseTo(BUILT.legHalfWidth, 1);
  });

  it('finds the belly between the legs, not the floor', () => {
    // Spanning leg centre to leg centre includes the near halves of both pairs,
    // so the lowest point in that span is a hoof and the belly comes out at
    // ground level. It has to be inset past the legs.
    expect(lm.bellyY).toBeCloseTo(BUILT.barrelBottomY, 1);
    expect(lm.bellyY).toBeGreaterThan(lm.groundY + lm.height * 0.2);
  });

  it('finds the topline over the barrel', () => {
    expect(lm.bodyTopY).toBeCloseTo(BUILT.barrelTopY, 1);
  });

  it('refuses a biped', () => {
    // Not a judgement call: a biped is taller than it is long, and has no two
    // separated groups of legs along its length.
    const biped = load('biped-blockout.usda');
    expect(findQuadrupedLandmarks(sampleSurfacePoints(biped.meshes))).toBeNull();
  });

  it('refuses too few points to mean anything', () => {
    expect(findQuadrupedLandmarks([])).toBeNull();
    expect(findQuadrupedLandmarks([[0, 0, 0]])).toBeNull();
  });
});

describe('placing quadruped guides', () => {
  const model = load('quadruped-blockout.usda');
  const result = placeGuidesFromQuadruped(
    model,
    model.root,
    quadTemplate(),
    emptyDoc()
  );
  const byId = new Map(result.guides.map((g) => [g.id, g]));

  it('places every required guide', () => {
    // The gap this closes: Riser shipped this template and this character, and
    // automatic placement refused it, so loading the horse gave an empty
    // checklist.
    expect(result.reason).toBeNull();
    expect(result.unmatched, `unmatched: ${result.unmatched.join(', ')}`).toEqual([]);
    expect(result.guides.length).toBeGreaterThanOrEqual(35);
  });

  it('resolves every binding back to the position it stored', () => {
    for (const guide of result.guides) {
      const mesh = model.meshForPrimPath(guide.binding!.primPath);
      expect(mesh, `${guide.id} names an unknown prim`).toBeDefined();
      const resolved = resolveBindingWorld(mesh!, guide.binding!)!;
      const stored = documentToWorld(model.root, guide.position);
      expect(resolved.distanceTo(stored), `${guide.id} drifted`).toBeLessThan(1e-5);
    }
  });

  it('puts the legs under the body where they were built', () => {
    expect(byId.get('hoofFL')!.position[2]).toBeCloseTo(BUILT.frontLegZ, 1);
    expect(byId.get('hoofBL')!.position[2]).toBeCloseTo(BUILT.backLegZ, 1);
    expect(Math.abs(byId.get('hoofFL')!.position[0])).toBeCloseTo(
      BUILT.legHalfWidth,
      1
    );
  });

  it('stacks each leg from the body down to the ground', () => {
    const y = (id: string) => byId.get(id)!.position[1];
    // Front: shoulder, elbow, carpus, fetlock, hoof.
    expect(y('shoulderFL')).toBeGreaterThan(y('elbowFL'));
    expect(y('elbowFL')).toBeGreaterThan(y('carpusL'));
    expect(y('carpusL')).toBeGreaterThan(y('fetlockFL'));
    expect(y('fetlockFL')).toBeGreaterThan(y('hoofFL'));

    // Back: hip, stifle, hock, fetlock, hoof.
    expect(y('hipL')).toBeGreaterThan(y('stifleL'));
    expect(y('stifleL')).toBeGreaterThan(y('hockL'));
    expect(y('hockL')).toBeGreaterThan(y('fetlockBL'));
    expect(y('fetlockBL')).toBeGreaterThan(y('hoofBL'));
  });

  it('stands the feet on the ground', () => {
    const bounds = model.bounds;
    for (const id of ['hoofFL', 'hoofFR', 'hoofBL', 'hoofBR']) {
      expect(byId.get(id)!.position[1], id).toBeLessThan(bounds.min.y + 0.06);
    }
  });

  it('runs the spine from the hips forward to the head', () => {
    const z = (id: string) => byId.get(id)!.position[2];
    expect(z('pelvis')).toBeLessThan(z('spineMid'));
    expect(z('spineMid')).toBeLessThan(z('chest'));
    expect(z('chest')).toBeLessThan(z('neckBase'));
    expect(z('neckBase')).toBeLessThan(z('head'));
    expect(z('head')).toBeLessThan(z('noseTip'));
  });

  it('runs the tail away from the body, not back into it', () => {
    // It used to be measured from the whole body's extent, which put the middle
    // of the tail nearer the animal than its own base.
    const z = (id: string) => byId.get(id)!.position[2];
    expect(z('tailBase')).toBeGreaterThan(z('tailMid'));
    expect(z('tailMid')).toBeGreaterThan(z('tailTip'));
    expect(z('tailTip')).toBeCloseTo(BUILT.tailTipZ, 1);
  });

  it('is symmetric left to right', () => {
    // Within a triangle's width, not exactly. The target positions ARE exact
    // mirrors, but each one is then snapped to its nearest surface triangle,
    // and a triangulated mesh is not itself mirror-symmetric - the diagonal of
    // a quad has to fall one way or the other. On this asset that is worth
    // about 0.03mm, which is the mesh's resolution rather than an error.
    const tolerance = 0.001;
    for (const id of ['hoofF', 'carpus', 'hoofB', 'hock', 'scapula']) {
      const left = byId.get(id + 'L');
      const right = byId.get(id + 'R');
      expect(left, `${id}L missing`).toBeDefined();
      expect(Math.abs(left!.position[0] + right!.position[0]), id).toBeLessThan(
        tolerance
      );
      expect(Math.abs(left!.position[1] - right!.position[1]), id).toBeLessThan(
        tolerance
      );
      // Both sides really are out at the leg, not collapsed onto the midline.
      expect(Math.abs(left!.position[0])).toBeGreaterThan(0.02);
    }
  });

  it('keeps the spine and head on the centre line', () => {
    for (const id of ['root', 'pelvis', 'spineMid', 'chest', 'head', 'noseTip']) {
      expect(Math.abs(byId.get(id)!.position[0]), id).toBeLessThan(0.02);
    }
  });

  it('marks everything as measured, and the face as least certain', () => {
    for (const guide of result.guides) expect(guide.source).toBe('proportions');
    expect(byId.get('eyeL')!.confidence).toBeLessThan(
      byId.get('hoofFL')!.confidence
    );
  });
});

describe('quadruped placement refuses what it cannot measure', () => {
  it('places nothing on a biped, and says why', () => {
    const biped = load('biped-blockout.usda');
    const result = placeGuidesFromQuadruped(
      biped,
      biped.root,
      quadTemplate(),
      createDocument('quadruped', 'b', { metersPerUnit: 1 })
    );
    expect(result.guides).toEqual([]);
    expect(result.reason).toMatch(/four-legged/i);
  });

  it('places nothing when there is no geometry', () => {
    const empty = new CharacterModel(new THREE.Group(), {
      ref: 'empty',
      format: 'usd',
      metersPerUnit: 1,
      upAxis: 'Y'
    });
    const result = placeGuidesFromQuadruped(
      empty,
      empty.root,
      quadTemplate(),
      emptyDoc()
    );
    expect(result.guides).toEqual([]);
    expect(result.reason).toMatch(/no geometry/i);
  });
});

describe('quadruped placement leaves the user alone', () => {
  it('does not overwrite a hand-placed guide', () => {
    const handPlaced: Guide = {
      id: 'chest',
      group: 'spine',
      position: [9, 9, 9],
      normal: [0, 1, 0],
      binding: null,
      source: 'user',
      confidence: 1
    };
    const model = load('quadruped-blockout.usda');
    const result = placeGuidesFromQuadruped(
      model,
      model.root,
      quadTemplate(),
      M.placeGuide(emptyDoc(), handPlaced)
    );
    expect(result.guides.some((g) => g.id === 'chest')).toBe(false);
  });
});
