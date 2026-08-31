import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import { CharacterModel } from './CharacterModel';
import { barycentricAt, evaluateBinding, triangleCount } from '../viewport/Picker';
import { RIGGED_STOCK_URLS, STOCK_CHARACTERS } from '../app/stock';

/**
 * These tests read the ACTUAL generated assets through the ACTUAL loader.
 *
 * The whole USD-in-the-browser approach rests on three's USDLoader reading
 * what tools/make-stock-assets.mjs writes. A mock would prove nothing; a
 * three.js upgrade that changed the parser would sail past it. This is the
 * test that would catch that.
 */

const ASSET_DIR = join(process.cwd(), 'public', 'assets');

/**
 * Read a bundled asset the way the browser does.
 *
 * The binary/text split is not a detail. `.usdc` read as UTF-8 still parses -
 * USDLoader hands back an empty Group rather than throwing - so getting this
 * wrong does not produce an error, it produces a character with no meshes and
 * a pile of confusing downstream failures. That is exactly what happened when
 * the first binary asset was added to this list.
 */
function loadAsset(url: string): THREE.Group {
  const filename = url.replace(/^\/assets\//, '');
  const path = join(ASSET_DIR, filename);
  const binary = /\.(usdc|usdz)$/i.test(filename);

  if (binary) {
    const buffer = readFileSync(path);
    return new USDLoader().parse(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    );
  }
  return new USDLoader().parse(readFileSync(path, 'utf8'));
}

function modelFor(url: string): CharacterModel {
  return new CharacterModel(loadAsset(url), {
    ref: url,
    format: 'usd',
    metersPerUnit: 1,
    upAxis: 'Y'
  });
}

/**
 * The assets tools/make-stock-assets.mjs writes.
 *
 * Separated from the rest because these tests assert on their exact
 * construction - two meshes, named Body and Head - which is a fact about the
 * generator, not a requirement Riser places on characters. A real production
 * asset arrives as thirty-odd pieces and is no less valid for it.
 */
const GENERATED = STOCK_CHARACTERS.filter((c) => c.url.endsWith('.usda'));

/**
 * Assets these Node tests can load.
 *
 * Text USD only, for two separate reasons.
 *
 * USDZ is excluded, and not because it is untested. three reads textures out
 * of a USDZ by constructing an `Image`, which is a DOM API that does not exist
 * here - the load throws before it can report anything about the geometry. The
 * end-to-end suite covers those assets in a real browser, which is the only
 * place the texture path can be exercised honestly anyway.
 *
 * The animated glTF is excluded because `loadAsset` is a USD reader: handing
 * it to USDLoader produces an empty group rather than an error, so including
 * it here would fail with "no meshes" and say nothing about the file. It has
 * its own coverage in viewport/animation.test.ts.
 */
const NODE_READABLE = STOCK_CHARACTERS.filter((c) => /\.(usd|usda|usdc)$/.test(c.url));

describe.each(GENERATED.map((c) => [c.label, c.url] as const))(
  'generated stock asset %s',
  (_label, url) => {
    it('parses through three USDLoader', () => {
      const group = loadAsset(url);
      expect(group).toBeInstanceOf(THREE.Group);
    });

    it('yields the Body and Head meshes at their prim paths', () => {
      const model = new CharacterModel(loadAsset(url), {
        ref: url,
        format: 'usd',
        metersPerUnit: 1,
        upAxis: 'Y'
      });

      expect(model.meshes.length).toBe(2);
      const paths = model.primPaths;
      expect(paths.some((p) => p.endsWith('/Body')), paths.join()).toBe(true);
      expect(paths.some((p) => p.endsWith('/Head')), paths.join()).toBe(true);
    });

    it('has real triangles with positions', () => {
      const model = new CharacterModel(loadAsset(url), {
        ref: url,
        format: 'usd',
        metersPerUnit: 1,
        upAxis: 'Y'
      });

      for (const mesh of model.meshes) {
        const position = mesh.geometry.getAttribute('position');
        expect(position, `${mesh.name} has no positions`).toBeDefined();
        expect(position.count).toBeGreaterThan(100);
        // three's USD composer expands faces into flat vertex arrays, so these
        // arrive non-indexed. Either way the vertex count must divide by three.
        expect(position.count % 3, `${mesh.name} vertex count is not triangular`).toBe(0);
        expect(triangleCount(mesh.geometry)).toBeGreaterThan(30);
      }
    });

  }
);

describe.each(NODE_READABLE.map((c) => [c.label, c.url] as const))(
  'stock asset %s',
  (_label, url) => {
    it('parses into something with geometry', () => {
      const model = modelFor(url);
      expect(model.meshes.length).toBeGreaterThan(0);
    });

    it('stands on the ground and is a plausible size', () => {
      const model = modelFor(url);
      const box = model.bounds;
      const size = box.getSize(new THREE.Vector3());

      // Metres, and something a person or an animal could be.
      expect(size.y).toBeGreaterThan(0.5);
      expect(size.y).toBeLessThan(2.5);
      expect(box.min.y).toBeGreaterThan(-0.05);
      expect(box.min.y).toBeLessThan(0.05);
    });

    it('supports a binding round trip on its real geometry', () => {
      // The end-to-end property: a point picked on this character can be
      // expressed as a binding and recovered from it.
      const model = modelFor(url);

      // The biggest mesh, not the first. On a production character the first
      // piece in the file is as likely to be an eyelash as a torso.
      let mesh = model.meshes[0]!;
      for (const candidate of model.meshes) {
        if (triangleCount(candidate.geometry) > triangleCount(mesh.geometry)) {
          mesh = candidate;
        }
      }
      const tris = triangleCount(mesh.geometry);
      expect(tris).toBeGreaterThan(100);

      // Sample across the mesh rather than testing one lucky triangle.
      for (const faceIndex of [
        0,
        Math.floor(tris * 0.25),
        Math.floor(tris * 0.5),
        Math.floor(tris * 0.75),
        tris - 1
      ]) {
        const centroid = evaluateBinding(mesh.geometry, faceIndex, [
          1 / 3,
          1 / 3,
          1 / 3
        ]);
        expect(centroid, `face ${faceIndex} has no centroid`).not.toBeNull();

        const bary = barycentricAt(mesh.geometry, faceIndex, centroid!);
        expect(bary, `face ${faceIndex} is degenerate`).not.toBeNull();
        expect(bary![0] + bary![1] + bary![2]).toBeCloseTo(1, 5);

        const back = evaluateBinding(mesh.geometry, faceIndex, bary!);
        expect(back!.distanceTo(centroid!)).toBeLessThan(1e-5);
      }
    });

    it('is symmetric about x = 0, so mirroring has something to hit', () => {
      const model = modelFor(url);
      const box = model.bounds;
      // Relative to the character's width: a 2mm absolute tolerance is strict
      // on a blockout and arbitrary on a two-metre production asset.
      const width = box.max.x - box.min.x;
      expect(Math.abs(box.min.x + box.max.x)).toBeLessThan(width * 0.02);
    });
  }
);

describe('stock asset registry', () => {
  it('points at files that exist', () => {
    // Every entry, USDZ included - this one only checks the file is there and
    // parses, which does not need the texture path that Node cannot follow.
    for (const character of STOCK_CHARACTERS) {
      const filename = character.url.replace(/^\/assets\//, '');
      expect(
        existsSync(join(ASSET_DIR, filename)),
        `${character.label} -> ${filename}`
      ).toBe(true);
    }
  });
});

/**
 * The rigged stock character exists so the UsdSkel path is exercised by
 * something real. Without it, `CharacterModel.skeleton` and the inspector's
 * nearest-joint hint are code no test ever reaches - and UsdSkel is precisely
 * the part of three's USD support most likely to change under us.
 */
// Same reason as NODE_READABLE: a USDZ's textures need a DOM to load, and the
// browser suite covers those. Its rig is verified there instead.
describe.each(
  RIGGED_STOCK_URLS.filter((url) => !url.endsWith('.usdz')).map(
    (url) => [url] as const
  )
)(
  'rigged stock asset %s',
  (url) => {
    function model(): CharacterModel {
      return new CharacterModel(loadAsset(url), {
        ref: url,
        format: 'usd',
        metersPerUnit: 1,
        upAxis: 'Y'
      });
    }

    it('loads with a skeleton', () => {
      const skeleton = model().skeleton;
      expect(skeleton, 'no skeleton was built from the UsdSkel data').not.toBeNull();
      expect(skeleton!.bones.length).toBe(18);
    });

    it('names the joints the rig declares', () => {
      const names = model().jointNames;
      // Conventional names, matching Mixamo/Unreal/Rigify rather than Riser's
      // own guide vocabulary - see tools/make-stock-assets.mjs.
      for (const expected of [
        'Root',
        'Hips',
        'Chest',
        'Head',
        'LowerArmL',
        'CalfR'
      ]) {
        expect(names, `missing joint ${expected}`).toContain(expected);
      }
    });

    it('builds skinned meshes with skin attributes', () => {
      for (const mesh of model().meshes) {
        const skinned = mesh as THREE.SkinnedMesh;
        expect(skinned.isSkinnedMesh, `${mesh.name} is not skinned`).toBe(true);
        expect(mesh.geometry.getAttribute('skinIndex')).toBeDefined();
        expect(mesh.geometry.getAttribute('skinWeight')).toBeDefined();
      }
    });

    it('has normalized skin weights', () => {
      // Weights that do not sum to one shrink the mesh when it is posed, which
      // reads as a loader bug rather than an asset one.
      const mesh = model().primaryMesh!;
      const weights = mesh.geometry.getAttribute('skinWeight');
      for (let i = 0; i < Math.min(weights.count, 200); i++) {
        const sum =
          weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
        expect(sum, `vertex ${i} weights sum to ${sum}`).toBeCloseTo(1, 4);
      }
    });

    it('answers the nearest-joint question the inspector asks', () => {
      const m = model();
      m.root.updateMatrixWorld(true);

      // Near the left elbow, in the rig's own coordinates.
      const nearElbow = m.nearestJoint(new THREE.Vector3(0.31, 1.2, 0));
      expect(nearElbow).not.toBeNull();
      expect(nearElbow!.name).toBe('LowerArmL');

      // And near the head.
      const nearHead = m.nearestJoint(new THREE.Vector3(0, 1.7, 0));
      expect(nearHead).not.toBeNull();
      expect(['Head', 'Neck']).toContain(nearHead!.name);
    });

    it('keeps bindings working on a skinned mesh', () => {
      // Skinning changes how three builds the geometry; the binding round trip
      // has to survive that, since a rigged upload is the normal case.
      const m = model();
      const mesh = m.primaryMesh!;
      const tris = triangleCount(mesh.geometry);

      for (const faceIndex of [0, Math.floor(tris / 2), tris - 1]) {
        const centroid = evaluateBinding(mesh.geometry, faceIndex, [1 / 3, 1 / 3, 1 / 3]);
        expect(centroid, `face ${faceIndex}`).not.toBeNull();
        const bary = barycentricAt(mesh.geometry, faceIndex, centroid!);
        expect(bary, `face ${faceIndex} is degenerate`).not.toBeNull();
        const back = evaluateBinding(mesh.geometry, faceIndex, bary!);
        expect(back!.distanceTo(centroid!)).toBeLessThan(1e-5);
      }
    });
  }
);
