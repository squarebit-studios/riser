import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import { CharacterModel } from './CharacterModel';
import { applyFit } from './normalize';
import { SurfacePicker, bindingFromPick, evaluateBinding } from '../viewport/Picker';
import { worldToDocument } from '../viewport/space';

/**
 * What space does a document position live in?
 *
 * The worker evaluates a binding against the USD mesh's OWN points and gets a
 * position in the referenced asset's coordinate system. For the round trip to
 * hold, the browser has to store positions in that same space.
 *
 * That is not the world. Between the asset and the world sit three transforms
 * the app applies for display only:
 *
 *   metersPerUnit    three's USD composer scales the root by it
 *   up-axis          a Z-up stage is rotated -90 degrees about X
 *   the framing fit  normalize.ts ground-aligns and recentres the character
 *
 * None of those exist on the USD stage the worker opens. So the anchor for
 * document space must be the loaded asset's own root, NOT the viewport's
 * character root - which is what these tests pin down.
 */

function loadBiped(): CharacterModel {
  const text = readFileSync(
    join(process.cwd(), 'public', 'assets', 'biped-blockout.usda'),
    'utf8'
  );
  return new CharacterModel(new USDLoader().parse(text), {
    ref: 'biped-blockout.usda',
    format: 'usd',
    metersPerUnit: 1,
    upAxis: 'Y'
  });
}

/**
 * A character carrying every display transform the real pipeline applies: the
 * composer's units scale and up-axis flip, then normalize.ts's framing fit.
 *
 * The exact values do not matter - only that world space and asset space stop
 * agreeing, which is the condition the stock asset never creates on its own.
 */
function loadTransformedBiped(): { model: CharacterModel; characterRoot: THREE.Group } {
  const model = loadBiped();

  // Stand in for what USDComposer does to a Z-up stage with declared units...
  model.root.scale.setScalar(2.5);
  model.root.rotation.x = -Math.PI / 2;
  // ...and then the framing fit normalize.ts applies on load.
  applyFit(model.root, { scale: 1.3, offset: [0.25, 0.9, -0.4] });

  const characterRoot = new THREE.Group();
  characterRoot.add(model.root);
  characterRoot.updateMatrixWorld(true);
  return { model, characterRoot };
}

/**
 * Aim at the character wherever it actually is. Framing from real bounds keeps
 * the test about coordinate spaces rather than about camera arithmetic.
 */
function pickCentre(model: CharacterModel) {
  const box = model.bounds;
  const centre = box.getCenter(new THREE.Vector3());
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius;

  const camera = new THREE.PerspectiveCamera(35, 16 / 9, radius * 1e-4, radius * 100);
  camera.position.set(centre.x, centre.y, centre.z + radius * 3);
  camera.lookAt(centre);
  camera.updateMatrixWorld(true);

  const picker = new SurfacePicker(camera);
  for (const [x, y] of [
    [640, 360],
    [620, 330],
    [660, 400],
    [640, 300],
    [600, 380]
  ] as [number, number][]) {
    const hit = picker.pick(x, y, 1280, 720, model.meshes);
    if (hit) return hit;
  }
  return null;
}

describe('document space anchor', () => {
  it('agrees with the worker when the asset root is identity', () => {
    // The easy case, and the reason this bug stayed hidden: our stock asset is
    // already metre-scale, Y-up and centred, so every candidate anchor gives
    // the same answer.
    const model = loadBiped();
    const characterRoot = new THREE.Group();
    characterRoot.add(model.root);
    characterRoot.updateMatrixWorld(true);

    const hit = pickCentre(model);
    expect(hit, 'expected a hit on the character').not.toBeNull();

    const world = hit!.pick.object.localToWorld(hit!.pick.localPoint.clone());
    const viaCharacterRoot = worldToDocument(characterRoot, world.clone());
    const viaAssetRoot = worldToDocument(model.root, world.clone());

    expect(viaCharacterRoot[0]).toBeCloseTo(viaAssetRoot[0], 6);
    expect(viaCharacterRoot[1]).toBeCloseTo(viaAssetRoot[1], 6);
    expect(viaCharacterRoot[2]).toBeCloseTo(viaAssetRoot[2], 6);
  });

  it('anchoring at the viewport root diverges once the asset is transformed', () => {
    // The failure this whole test file exists to prevent. With a units scale,
    // an up-axis flip and a framing fit in play, world-space coordinates are
    // nothing like the asset's own - and the worker only knows the asset's.
    const { model, characterRoot } = loadTransformedBiped();

    const hit = pickCentre(model);
    expect(hit, 'expected a hit on the transformed character').not.toBeNull();

    const world = hit!.pick.object.localToWorld(hit!.pick.localPoint.clone());
    const viaCharacterRoot = worldToDocument(characterRoot, world.clone());
    const viaAssetRoot = worldToDocument(model.root, world.clone());

    const drift = Math.hypot(
      viaCharacterRoot[0] - viaAssetRoot[0],
      viaCharacterRoot[1] - viaAssetRoot[1],
      viaCharacterRoot[2] - viaAssetRoot[2]
    );
    expect(drift, 'the two anchors should genuinely disagree here').toBeGreaterThan(0.1);
  });

  it('anchoring at the asset root reproduces the mesh-local evaluation', () => {
    // THE contract. The worker resolves a binding against the USD mesh's own
    // points; with no prim transforms between the mesh and the asset root,
    // that is exactly what anchoring here produces - whatever display
    // transforms sit above.
    const { model } = loadTransformedBiped();

    const hit = pickCentre(model);
    expect(hit).not.toBeNull();

    const binding = bindingFromPick(hit!.pick, hit!.offset);
    const meshLocal = evaluateBinding(
      hit!.pick.object.geometry,
      binding.faceIndex,
      binding.barycentric
    )!;
    meshLocal.x += binding.offset[0];
    meshLocal.y += binding.offset[1];
    meshLocal.z += binding.offset[2];

    const world = hit!.pick.object.localToWorld(
      hit!.pick.localPoint
        .clone()
        .add(new THREE.Vector3(...(binding.offset as [number, number, number])))
    );
    const stored = worldToDocument(model.root, world);

    expect(stored[0]).toBeCloseTo(meshLocal.x, 5);
    expect(stored[1]).toBeCloseTo(meshLocal.y, 5);
    expect(stored[2]).toBeCloseTo(meshLocal.z, 5);
  });
});
