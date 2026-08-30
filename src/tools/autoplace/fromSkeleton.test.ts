import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import { CharacterModel } from '../../io/CharacterModel';
import { placeGuidesFromSkeleton, orderSpineChain } from './fromSkeleton';
import { getTemplate } from '../../templates';
import { createDocument, type Guide, type RiserDocument } from '../../doc/types';
import * as M from '../../doc/mutations';
import { resolveBindingWorld } from '../../viewport/Picker';
import { documentToWorld } from '../../viewport/space';
import type { JointMatch } from './jointNames';

function loadRigged(): { model: CharacterModel; root: THREE.Group } {
  const text = readFileSync(
    join(process.cwd(), 'public', 'assets', 'biped-rigged.usda'),
    'utf8'
  );
  const model = new CharacterModel(new USDLoader().parse(text), {
    ref: '/assets/biped-rigged.usda',
    format: 'usd',
    metersPerUnit: 1,
    upAxis: 'Y'
  });
  const root = new THREE.Group();
  root.add(model.root);
  root.updateMatrixWorld(true);
  return { model, root };
}

function loadUnrigged(): { model: CharacterModel; root: THREE.Group } {
  const text = readFileSync(
    join(process.cwd(), 'public', 'assets', 'biped-blockout.usda'),
    'utf8'
  );
  const model = new CharacterModel(new USDLoader().parse(text), {
    ref: '/assets/biped-blockout.usda',
    format: 'usd',
    metersPerUnit: 1,
    upAxis: 'Y'
  });
  const root = new THREE.Group();
  root.add(model.root);
  root.updateMatrixWorld(true);
  return { model, root };
}

const biped = () => getTemplate('biped');
const emptyDoc = (): RiserDocument =>
  createDocument('biped', '/assets/biped-rigged.usda', { metersPerUnit: 1 });

function place(doc = emptyDoc()) {
  const { model, root } = loadRigged();
  const result = placeGuidesFromSkeleton(model, model.root, biped(), doc);
  return { model, root, result };
}

describe('placing guides from a skeleton', () => {
  it('places the guides the rig can supply', () => {
    const { result } = place();
    const ids = result.guides.map((g) => g.id);

    expect(ids.length).toBeGreaterThanOrEqual(15);
    for (const expected of [
      'pelvis',
      'chest',
      'head',
      'shoulderL',
      'elbowR',
      'wristL',
      'hipL',
      'kneeR',
      'ankleL'
    ]) {
      expect(ids, `missing ${expected}`).toContain(expected);
    }
  });

  it('marks them as coming from the skeleton, not the user', () => {
    const { result } = place();
    for (const guide of result.guides) {
      expect(guide.source).toBe('skeleton');
      expect(guide.confidence).toBeGreaterThan(0);
      expect(guide.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('binds every guide to a real surface triangle', () => {
    // A joint is inside the character, so this is the whole trick: it still has
    // to name a triangle, or the server cannot resolve it.
    const { model, result } = place();
    for (const guide of result.guides) {
      expect(guide.binding, `${guide.id} is unbound`).not.toBeNull();
      const mesh = model.meshForPrimPath(guide.binding!.primPath);
      expect(mesh, `${guide.id} names an unknown prim`).toBeDefined();
      expect(guide.binding!.faceIndex).toBeGreaterThanOrEqual(0);
    }
  });

  /**
   * THE property. The binding plus its offset has to resolve back to the joint
   * position exactly, because that resolution is what the Python worker does -
   * and the worker knows nothing about skeletons.
   */
  it('resolves each binding back to the joint it came from', () => {
    const { model, result } = place();
    const skeleton = model.skeleton!;
    const jointWorld = new THREE.Vector3();

    for (const guide of result.guides) {
      const match = result.matches.find((m) => m.guideId === guide.id)!;
      const bone = skeleton.bones[match.jointIndex]!;
      bone.updateWorldMatrix(true, false);
      bone.getWorldPosition(jointWorld);

      const mesh = model.meshForPrimPath(guide.binding!.primPath)!;
      const resolved = resolveBindingWorld(mesh, guide.binding!);

      expect(resolved, `${guide.id} did not resolve`).not.toBeNull();
      expect(
        resolved!.distanceTo(jointWorld),
        `${guide.id} resolved ${resolved!.distanceTo(jointWorld)} from its joint`
      ).toBeLessThan(1e-5);
    }
  });

  it('stores a position that agrees with the resolved binding', () => {
    const { model, result } = place();
    for (const guide of result.guides) {
      const world = documentToWorld(model.root, guide.position);
      const mesh = model.meshForPrimPath(guide.binding!.primPath)!;
      const resolved = resolveBindingWorld(mesh, guide.binding!)!;
      expect(resolved.distanceTo(world), guide.id).toBeLessThan(1e-5);
    }
  });

  it('puts interior joints inside the character, not on its skin', () => {
    // An elbow guide taken from a rig should sit in the middle of the arm. A
    // non-zero offset is what proves it is not just stuck to the surface.
    const { result } = place();
    const elbow = result.guides.find((g) => g.id === 'elbowL');
    expect(elbow).toBeDefined();
    const offsetLength = Math.hypot(...elbow!.binding!.offset);
    expect(offsetLength).toBeGreaterThan(1e-4);
  });

  it('places left and right guides symmetrically', () => {
    const { result } = place();
    const left = result.guides.find((g) => g.id === 'elbowL')!;
    const right = result.guides.find((g) => g.id === 'elbowR')!;
    expect(Math.sign(left.position[0])).toBe(-Math.sign(right.position[0]));
    expect(left.position[1]).toBeCloseTo(right.position[1], 4);
  });

  it('reports the required guides the rig could not supply', () => {
    const { result } = place();
    // The rig has no clavicles or toes, so those must be reported rather than
    // silently dropped - the checklist still needs them placed by hand.
    expect(result.unmatched).toContain('clavicleL');
    expect(result.unmatched.length).toBeGreaterThan(0);
    for (const id of result.unmatched) {
      expect(result.guides.some((g) => g.id === id)).toBe(false);
    }
  });
});

describe('not overwriting the user', () => {
  it('leaves a hand-placed guide alone', () => {
    const handPlaced: Guide = {
      id: 'chest',
      group: 'spine',
      position: [9, 9, 9],
      normal: [0, 1, 0],
      binding: null,
      source: 'user',
      confidence: 1
    };
    const doc = M.placeGuide(emptyDoc(), handPlaced);

    const { result } = place(doc);
    expect(result.guides.some((g) => g.id === 'chest')).toBe(false);
  });

  it('does replace one it placed itself on an earlier run', () => {
    // Re-running should improve its own guesses, not fight them.
    const previous: Guide = {
      id: 'chest',
      group: 'spine',
      position: [9, 9, 9],
      normal: [0, 1, 0],
      binding: null,
      source: 'skeleton',
      confidence: 0.5
    };
    const doc = M.placeGuide(emptyDoc(), previous);

    const { result } = place(doc);
    expect(result.guides.some((g) => g.id === 'chest')).toBe(true);
  });

  it('overwrites user placements only when explicitly told to', () => {
    const { model } = loadRigged();
    const handPlaced: Guide = {
      id: 'chest',
      group: 'spine',
      position: [9, 9, 9],
      normal: [0, 1, 0],
      binding: null,
      source: 'user',
      confidence: 1
    };
    const doc = M.placeGuide(emptyDoc(), handPlaced);

    const result = placeGuidesFromSkeleton(model, model.root, biped(), doc, {
      overwriteUserPlaced: true
    });
    expect(result.guides.some((g) => g.id === 'chest')).toBe(true);
  });
});

describe('characters with no skeleton', () => {
  it('returns nothing rather than guessing', () => {
    const { model } = loadUnrigged();
    expect(model.skeleton).toBeNull();
    const result = placeGuidesFromSkeleton(model, model.root, biped(), emptyDoc());
    expect(result.guides).toEqual([]);
    expect(result.matches).toEqual([]);
  });
});

describe('orderSpineChain', () => {
  /** A three-bone chain: root -> a -> b -> c, at increasing depth. */
  function chainSkeleton(): THREE.Skeleton {
    const root = new THREE.Bone();
    root.name = 'Root';
    const a = new THREE.Bone();
    a.name = 'SpineA';
    const b = new THREE.Bone();
    b.name = 'SpineB';
    const c = new THREE.Bone();
    c.name = 'SpineC';
    root.add(a);
    a.add(b);
    b.add(c);
    root.updateMatrixWorld(true);
    return new THREE.Skeleton([root, a, b, c]);
  }

  const match = (guideId: string, jointIndex: number): JointMatch => ({
    guideId,
    jointIndex,
    jointName: `joint${jointIndex}`,
    confidence: 1
  });

  it('re-deals spine joints in hierarchy order', () => {
    // Deliberately assigned backwards: the deepest joint given to the lowest
    // guide. Ordering by depth has to correct it.
    const skeleton = chainSkeleton();
    const input = [match('spine01', 3), match('spine02', 2), match('chest', 1)];

    const out = orderSpineChain(input, skeleton);
    const byGuide = new Map(out.map((m) => [m.guideId, m.jointIndex]));

    expect(byGuide.get('spine01')).toBe(1);
    expect(byGuide.get('spine02')).toBe(2);
    expect(byGuide.get('chest')).toBe(3);
  });

  it('leaves a correctly ordered chain untouched', () => {
    const skeleton = chainSkeleton();
    const input = [match('spine01', 1), match('spine02', 2), match('chest', 3)];
    const out = orderSpineChain(input, skeleton);
    expect(out.map((m) => m.jointIndex)).toEqual([1, 2, 3]);
  });

  it('does nothing with fewer than two spine guides', () => {
    const skeleton = chainSkeleton();
    const input = [match('spine01', 3)];
    expect(orderSpineChain(input, skeleton)).toEqual(input);
  });

  it('never invents a placement for an unmatched spine guide', () => {
    // Only two spine guides matched; the third must stay unmatched rather than
    // being handed a joint that belongs to one of the others.
    const skeleton = chainSkeleton();
    const input = [match('spine01', 3), match('chest', 1)];
    const out = orderSpineChain(input, skeleton);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((m) => m.jointIndex)).size).toBe(2);
  });

  it('leaves non-spine matches alone', () => {
    const skeleton = chainSkeleton();
    const input = [match('spine01', 3), match('chest', 1), match('wristL', 2)];
    const out = orderSpineChain(input, skeleton);
    expect(out.find((m) => m.guideId === 'wristL')!.jointIndex).toBe(2);
  });
});
