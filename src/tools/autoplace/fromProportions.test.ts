import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import { CharacterModel } from '../../io/CharacterModel';
import { placeGuidesFromProportions } from './fromProportions';
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

const biped = () => getTemplate('biped');
const emptyDoc = (): RiserDocument =>
  createDocument('biped', 'biped-blockout.usda', { metersPerUnit: 1 });

function place(doc = emptyDoc(), asset = 'biped-blockout.usda') {
  const model = load(asset);
  const result = placeGuidesFromProportions(model, model.root, biped(), doc);
  return { model, result };
}

/** Height fraction of a guide, for asserting anatomy in a scale-free way. */
function heightFraction(model: CharacterModel, guide: Guide): number {
  const bounds = model.bounds;
  const size = bounds.getSize(new THREE.Vector3());
  return (guide.position[1] - bounds.min.y) / size.y;
}

describe('placing guides by proportion', () => {
  const { model, result } = place();
  const byId = new Map(result.guides.map((g) => [g.id, g]));

  it('places every required guide', () => {
    expect(result.reason).toBeNull();
    expect(result.unmatched, `unmatched: ${result.unmatched.join(', ')}`).toEqual([]);
    expect(result.guides.length).toBeGreaterThanOrEqual(32);
  });

  it('marks them as measured, not as the user', () => {
    for (const guide of result.guides) {
      expect(guide.source).toBe('proportions');
      expect(guide.confidence).toBeGreaterThan(0);
      expect(guide.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('is less confident about the face than about the skeleton', () => {
    // A cross section says almost nothing about a face. Reporting that as
    // equally certain to a measured shoulder would be a lie the UI repeats.
    expect(byId.get('noseTip')!.confidence).toBeLessThan(
      byId.get('shoulderL')!.confidence
    );
    expect(byId.get('mouthCornerL')!.confidence).toBeLessThan(
      byId.get('headTop')!.confidence
    );
  });

  /**
   * The property every tier shares: the binding, resolved the way the Python
   * worker resolves it, has to land on the stored position.
   */
  it('resolves every binding back to the position it stored', () => {
    for (const guide of result.guides) {
      const mesh = model.meshForPrimPath(guide.binding!.primPath);
      expect(mesh, `${guide.id} names an unknown prim`).toBeDefined();

      const resolved = resolveBindingWorld(mesh!, guide.binding!)!;
      const stored = documentToWorld(model.root, guide.position);
      expect(resolved.distanceTo(stored), `${guide.id} drifted`).toBeLessThan(1e-5);
    }
  });

  it('stacks the spine up the body in order', () => {
    const y = (id: string) => byId.get(id)!.position[1];
    expect(y('root')).toBeLessThan(y('pelvis'));
    expect(y('pelvis')).toBeLessThan(y('spine01'));
    expect(y('spine01')).toBeLessThan(y('spine02'));
    expect(y('spine02')).toBeLessThan(y('chest'));
    expect(y('chest')).toBeLessThan(y('neck'));
    expect(y('neck')).toBeLessThan(y('head'));
    expect(y('head')).toBeLessThan(y('headTop'));
  });

  it('puts the leg joints in the right order down the leg', () => {
    const y = (id: string) => byId.get(id)!.position[1];
    expect(y('hipL')).toBeGreaterThan(y('kneeL'));
    expect(y('kneeL')).toBeGreaterThan(y('ankleL'));
    expect(y('ankleL')).toBeGreaterThan(y('toeBaseL') - 1e-6);
  });

  it('puts the arm joints in order out along the arm', () => {
    const x = (id: string) => Math.abs(byId.get(id)!.position[0]);
    expect(x('clavicleL')).toBeLessThan(x('shoulderL'));
    expect(x('shoulderL')).toBeLessThan(x('elbowL'));
    expect(x('elbowL')).toBeLessThan(x('wristL'));
  });

  it('lands the big landmarks in human proportion', () => {
    // Scale free, so these hold for a child or a giant as much as this figure.
    expect(heightFraction(model, byId.get('pelvis')!)).toBeGreaterThan(0.4);
    expect(heightFraction(model, byId.get('pelvis')!)).toBeLessThan(0.58);

    expect(heightFraction(model, byId.get('shoulderL')!)).toBeGreaterThan(0.72);
    expect(heightFraction(model, byId.get('shoulderL')!)).toBeLessThan(0.9);

    expect(heightFraction(model, byId.get('kneeL')!)).toBeGreaterThan(0.15);
    expect(heightFraction(model, byId.get('kneeL')!)).toBeLessThan(0.35);

    expect(heightFraction(model, byId.get('headTop')!)).toBeGreaterThan(0.95);
  });

  it('places the limbs where this character actually has them', () => {
    // Measured, not assumed: the generator puts the legs at x = +/-0.1 and the
    // hands at x = +/-0.45. Guides that ignored the mesh would not match.
    expect(Math.abs(byId.get('hipL')!.position[0])).toBeGreaterThan(0.05);
    expect(Math.abs(byId.get('hipL')!.position[0])).toBeLessThan(0.16);

    expect(Math.abs(byId.get('wristL')!.position[0])).toBeGreaterThan(0.34);
    expect(Math.abs(byId.get('wristL')!.position[0])).toBeLessThan(0.56);
  });

  it('is symmetric left to right', () => {
    for (const id of ['hip', 'knee', 'ankle', 'shoulder', 'elbow', 'wrist', 'eye']) {
      const left = byId.get(id + 'L');
      const right = byId.get(id + 'R');
      expect(left, `${id}L missing`).toBeDefined();
      expect(right, `${id}R missing`).toBeDefined();
      expect(left!.position[0]).toBeCloseTo(-right!.position[0], 5);
      expect(left!.position[1]).toBeCloseTo(right!.position[1], 5);
    }
  });

  it('keeps the centre chain on the centre line', () => {
    for (const id of ['root', 'pelvis', 'chest', 'neck', 'headTop', 'noseTip']) {
      expect(Math.abs(byId.get(id)!.position[0]), id).toBeLessThan(0.02);
    }
  });

  it('puts interior joints inside the body and surface features on it', () => {
    // An elbow centre is in the middle of the arm, so it carries an offset off
    // the surface. The top of the head is a surface feature and does not.
    const elbowOffset = Math.hypot(...byId.get('elbowL')!.binding!.offset);
    const headTopOffset = Math.hypot(...byId.get('headTop')!.binding!.offset);
    expect(elbowOffset).toBeGreaterThan(1e-4);
    expect(headTopOffset).toBeLessThan(1e-6);
  });
});

describe('refusing to guess', () => {
  it('places nothing on a quadruped, and says why', () => {
    const model = load('quadruped-blockout.usda');
    const result = placeGuidesFromProportions(
      model,
      model.root,
      biped(),
      createDocument('biped', 'q', { metersPerUnit: 1 })
    );
    // Placing human guides on a horse is worse than placing none: the user
    // then has to notice and undo thirty markers rather than simply start.
    expect(result.guides).toEqual([]);
    expect(result.reason).toBeTruthy();
    expect(result.landmarks).not.toBeNull();
  });

  it('places nothing when there is no geometry', () => {
    const model = load('biped-blockout.usda');
    const empty = new CharacterModel(new THREE.Group(), {
      ref: 'empty',
      format: 'usd',
      metersPerUnit: 1,
      upAxis: 'Y'
    });
    const result = placeGuidesFromProportions(
      empty,
      empty.root,
      biped(),
      emptyDoc()
    );
    expect(result.guides).toEqual([]);
    expect(result.reason).toMatch(/no geometry/i);
    void model;
  });
});

describe('not overwriting the user', () => {
  const handPlaced: Guide = {
    id: 'chest',
    group: 'spine',
    position: [9, 9, 9],
    normal: [0, 1, 0],
    binding: null,
    source: 'user',
    confidence: 1
  };

  it('leaves a hand-placed guide alone', () => {
    const { result } = place(M.placeGuide(emptyDoc(), handPlaced));
    expect(result.guides.some((g) => g.id === 'chest')).toBe(false);
  });

  it('replaces one it measured itself on an earlier run', () => {
    const previous: Guide = { ...handPlaced, source: 'proportions', confidence: 0.5 };
    const { result } = place(M.placeGuide(emptyDoc(), previous));
    expect(result.guides.some((g) => g.id === 'chest')).toBe(true);
  });

  it('replaces one taken from a skeleton, since measuring is the fallback', () => {
    // Both are the app's own work, so a later pass may revise either.
    const previous: Guide = { ...handPlaced, source: 'skeleton', confidence: 0.9 };
    const { result } = place(M.placeGuide(emptyDoc(), previous));
    expect(result.guides.some((g) => g.id === 'chest')).toBe(true);
  });
});
