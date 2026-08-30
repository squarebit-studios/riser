import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import { CharacterModel } from '../io/CharacterModel';
import { barycentricAt, evaluateBinding, triangleCount } from '../viewport/Picker';
import { writeUsda, PATHS } from './usda-writer';
import { readUsda } from './usda-reader';
import { createDocument, type Curve, type Guide, type RiserDocument, type Vec3 } from './types';

/**
 * Generates the cross-language contract fixture.
 *
 * worker/tests/test_document.py opens the file this writes using OpenUSD. That
 * pairing is the only thing that proves the browser and the server agree about
 * the format - the TypeScript round-trip test in usda.test.ts only proves our
 * writer and our reader agree with each other, which they could do while both
 * being wrong about USD.
 *
 * The fixture is built from REAL picks on the REAL stock asset, so the face
 * indices and barycentric weights in it are ones the app could actually
 * produce, and the worker can evaluate them against the referenced geometry.
 */

const ASSET = 'biped-blockout.usda';
const FIXTURE_PATH = join(
  process.cwd(),
  'worker',
  'tests',
  'fixtures',
  'sample-layer.usda'
);
/** Where the asset sits relative to the fixture, so OpenUSD can resolve it. */
const CHARACTER_REF = '../../../public/assets/' + ASSET;

function loadStockCharacter(): CharacterModel {
  const text = readFileSync(join(process.cwd(), 'public', 'assets', ASSET), 'utf8');
  return new CharacterModel(new USDLoader().parse(text), {
    ref: CHARACTER_REF,
    format: 'usd',
    metersPerUnit: 1,
    upAxis: 'Y'
  });
}

/**
 * A binding at the centroid of a chosen triangle. Deterministic, and a
 * centroid is guaranteed to be inside the face - no edge cases from a random
 * point that lands just outside.
 */
function bindingAt(mesh: THREE.Mesh, faceIndex: number) {
  const primPath = mesh.userData.primPath as string;
  const centroid = evaluateBinding(mesh.geometry, faceIndex, [1 / 3, 1 / 3, 1 / 3]);
  if (!centroid) throw new Error(`face ${faceIndex} of ${primPath} is degenerate`);
  const barycentric = barycentricAt(mesh.geometry, faceIndex, centroid);
  if (!barycentric) throw new Error(`face ${faceIndex} of ${primPath} has no barycoord`);
  return {
    binding: { primPath, faceIndex, barycentric, offset: [0, 0, 0] as Vec3 },
    position: [centroid.x, centroid.y, centroid.z] as Vec3
  };
}

function buildFixtureDocument(model: CharacterModel): RiserDocument {
  const doc = createDocument('biped', CHARACTER_REF, {
    name: 'Contract fixture',
    metersPerUnit: 1,
    upAxis: 'Y'
  });

  const body = model.meshForPrimPath(`${PATHS.character}/Geom/Body`);
  const head = model.meshForPrimPath(`${PATHS.character}/Geom/Head`);
  if (!body || !head) {
    throw new Error(`fixture needs Body and Head; got ${model.primPaths.join(', ')}`);
  }

  const bodyTris = triangleCount(body.geometry);
  const headTris = triangleCount(head.geometry);

  const guides: Guide[] = [
    ['pelvis', 'spine', body, Math.floor(bodyTris * 0.1)],
    ['chest', 'spine', body, Math.floor(bodyTris * 0.2)],
    ['wristL', 'armL', body, Math.floor(bodyTris * 0.45)],
    ['kneeR', 'legR', body, Math.floor(bodyTris * 0.8)],
    ['chin', 'face', head, Math.floor(headTris * 0.5)]
  ].map(([id, group, mesh, faceIndex]) => {
    const { binding, position } = bindingAt(mesh as THREE.Mesh, faceIndex as number);
    return {
      id: id as string,
      group: group as string,
      position,
      normal: [0, 0, 1] as Vec3,
      binding
    };
  });

  // One guide with an off-surface offset - the interior-joint case.
  //
  // The stored position must INCLUDE the offset, because that is what
  // MarkerTool.guideFromPick does and what the worker's resolve_binding
  // reproduces: position = evaluate(binding) + offset. Storing the bare
  // surface point here would make the fixture disagree with the app, and the
  // Python contract test would (correctly) report the two as 2cm apart.
  const elbowOffset: Vec3 = [-0.02, 0, 0.01];
  const elbow = bindingAt(body, Math.floor(bodyTris * 0.35));
  guides.push({
    id: 'elbowL',
    group: 'armL',
    position: [
      elbow.position[0] + elbowOffset[0],
      elbow.position[1] + elbowOffset[1],
      elbow.position[2] + elbowOffset[2]
    ],
    normal: [1, 0, 0],
    binding: { ...elbow.binding, offset: elbowOffset }
  });

  // And one placed free in space, with no binding at all.
  guides.push({
    id: 'root',
    group: 'spine',
    position: [0, 0, 0],
    normal: [0, 1, 0],
    binding: null
  });

  const jawline: Curve = {
    id: 'jawline',
    group: 'face',
    closed: false,
    width: 0.004,
    points: [0.2, 0.35, 0.5, 0.65, 0.8].map((t) => {
      const { binding, position } = bindingAt(head, Math.floor(headTris * t));
      return { position, normal: [0, 0, 1] as Vec3, binding };
    })
  };

  const lipOuter: Curve = {
    id: 'lipOuter',
    group: 'face',
    closed: true,
    width: 0.003,
    points: [0.1, 0.15, 0.2, 0.25].map((t) => {
      const { binding, position } = bindingAt(head, Math.floor(headTris * t));
      return { position, normal: [0, 0, 1] as Vec3, binding };
    })
  };

  doc.guides = guides;
  doc.curves = [jawline, lipOuter];
  return doc;
}

describe('worker contract fixture', () => {
  const model = loadStockCharacter();
  const doc = buildFixtureDocument(model);
  const usda = writeUsda(doc, { banner: true });

  it('binds to layer paths, not asset-local paths', () => {
    // The bug this guards: three's loader reports `/Character/Geom/Body`, but
    // once the layer references the asset onto /Riser/Character, OpenUSD sees
    // `/Riser/Character/Geom/Body`. Writing the former produces bindings that
    // work in the browser and resolve to nothing on the server.
    for (const guide of doc.guides) {
      if (!guide.binding) continue;
      expect(guide.binding.primPath, guide.id).toMatch(/^\/Riser\/Character\//);
    }
    // primPaths maps MESHES, so the intermediate Geom scope is not in it.
    expect(model.primPaths.sort()).toEqual([
      '/Riser/Character/Geom/Body',
      '/Riser/Character/Geom/Head'
    ]);
  });

  it('round-trips through our own reader', () => {
    const back = readUsda(usda);
    expect(back.guides.map((g) => g.id)).toEqual(doc.guides.map((g) => g.id));
    expect(back.curves.map((c) => c.id)).toEqual(doc.curves.map((c) => c.id));
    expect(back.characterRef).toBe(CHARACTER_REF);
  });

  it('writes the fixture the Python worker reads', () => {
    mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
    writeFileSync(FIXTURE_PATH, usda, 'utf8');

    const written = readFileSync(FIXTURE_PATH, 'utf8');
    expect(written).toContain('def Xform "Riser"');
    expect(written).toContain(`prepend references = @${CHARACTER_REF}@`);
    expect(written).toContain('riser:guide:bindPrim = </Riser/Character/Geom/Body>');
    expect(written).toContain('def BasisCurves "jawline"');
    // The worker asserts against these exact counts.
    expect(doc.guides).toHaveLength(7);
    expect(doc.curves).toHaveLength(2);
  });
});
