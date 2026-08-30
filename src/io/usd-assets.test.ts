import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import { CharacterModel } from './CharacterModel';
import { barycentricAt, evaluateBinding, triangleCount } from '../viewport/Picker';
import { STOCK_CHARACTERS } from '../app/stock';

/**
 * These tests read the ACTUAL generated assets through the ACTUAL loader.
 *
 * The whole USD-in-the-browser approach rests on three's USDLoader reading
 * what tools/make-stock-assets.mjs writes. A mock would prove nothing; a
 * three.js upgrade that changed the parser would sail past it. This is the
 * test that would catch that.
 */

const ASSET_DIR = join(process.cwd(), 'public', 'assets');

function loadAsset(url: string): THREE.Group {
  const filename = url.replace(/^\/assets\//, '');
  const text = readFileSync(join(ASSET_DIR, filename), 'utf8');
  return new USDLoader().parse(text);
}

describe.each(STOCK_CHARACTERS.map((c) => [c.label, c.url] as const))(
  'stock asset %s',
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

    it('stands on the ground and is a plausible size', () => {
      const model = new CharacterModel(loadAsset(url), {
        ref: url,
        format: 'usd',
        metersPerUnit: 1,
        upAxis: 'Y'
      });
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
      const model = new CharacterModel(loadAsset(url), {
        ref: url,
        format: 'usd',
        metersPerUnit: 1,
        upAxis: 'Y'
      });

      const mesh = model.primaryMesh!;
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
      const model = new CharacterModel(loadAsset(url), {
        ref: url,
        format: 'usd',
        metersPerUnit: 1,
        upAxis: 'Y'
      });
      const box = model.bounds;
      expect(Math.abs(box.min.x + box.max.x)).toBeLessThan(0.02);
    });
  }
);

describe('stock asset registry', () => {
  it('points at files that exist', () => {
    for (const character of STOCK_CHARACTERS) {
      expect(() => loadAsset(character.url), character.url).not.toThrow();
    }
  });
});
