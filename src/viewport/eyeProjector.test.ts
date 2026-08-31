// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// That the eye's projector lands where the exporter said it does.
//
// The iris is projected FROM the projector rather than read off the mesh's
// UVs, so this transform is the difference between an eye that looks the right
// way and one that does not. It is worth a test of its own because every way
// of getting it wrong is quiet:
//
//   - `updateProjector` takes its frame from the object it is handed and has
//     no `matrix` option at all. Riser passed the eye MESH and a `matrix` in
//     the options, so the projector came from the eyeball's own transform and
//     the authored matrix was ignored. Nothing failed; the eyes simply looked
//     wrong to anyone who knew what to look for.
//   - The exporter writes metres. Three's USD composer puts `metersPerUnit` on
//     the root as a scale, so the root's children are in the file's own units.
//     Handing it metres scaled them twice and put the projector 1.7 metres
//     from the eye, beside the origin.
//
// Both are arithmetic, so both are checkable here against the real shipped
// asset, with no renderer.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readEyeLooks } from '../io/eyeLook';
import { projectorLocalMatrix } from './EyeMaterials';

function garyUsdz(): ArrayBuffer {
  const file = readFileSync(join(process.cwd(), 'public', 'assets', 'gary.usdz'));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

/** Gary is authored in centimetres. */
const GARY_METERS_PER_UNIT = 0.01;

describe('the eye projector transform', () => {
  it('is recorded in the file at all', () => {
    // If the exporter stops writing this, the eyes keep rendering and quietly
    // go back to projecting from the mesh. That is worth failing over.
    for (const look of readEyeLooks(garyUsdz())) {
      const authored = look.params.projectorMatrix;
      expect(Array.isArray(authored), `${look.primPath} has no projector`).toBe(true);
      expect(authored as number[]).toHaveLength(16);
      expect((authored as number[]).every((v) => Number.isFinite(v))).toBe(true);
    }
  });

  it('is authored in metres, at head height', () => {
    // The exporter converts to metres on the way out. A character is about
    // 1.9m tall, so an eye sits well above 1m: if this ever reads ~170 the
    // conversion was dropped, and if it reads ~0.017 it was applied twice.
    for (const look of readEyeLooks(garyUsdz())) {
      const authored = look.params.projectorMatrix as number[];
      const height = authored[13]!;
      expect(height).toBeGreaterThan(1);
      expect(height).toBeLessThan(2.5);
    }
  });

  it('converts into the units the root expects', () => {
    for (const look of readEyeLooks(garyUsdz())) {
      const authored = look.params.projectorMatrix as number[];
      const local = projectorLocalMatrix(authored, GARY_METERS_PER_UNIT);

      // The root scales its children by metersPerUnit, so putting that back
      // has to return the metres the exporter wrote.
      const backToMetres = new THREE.Vector3()
        .setFromMatrixPosition(local)
        .multiplyScalar(GARY_METERS_PER_UNIT);

      expect(backToMetres.x).toBeCloseTo(authored[12]!, 6);
      expect(backToMetres.y).toBeCloseTo(authored[13]!, 6);
      expect(backToMetres.z).toBeCloseTo(authored[14]!, 6);
    }
  });

  it('scales the basis with the translation, because the basis is the radius', () => {
    // The projector's axis lengths carry the eye radius, so a conversion that
    // moved the origin without rescaling the frame would place a correctly
    // positioned projector with a hundredfold radius.
    const look = readEyeLooks(garyUsdz())[0]!;
    const authored = look.params.projectorMatrix as number[];

    const authoredScale = new THREE.Vector3().setFromMatrixScale(
      new THREE.Matrix4().fromArray(authored)
    );
    const localScale = new THREE.Vector3().setFromMatrixScale(
      projectorLocalMatrix(authored, GARY_METERS_PER_UNIT)
    );

    expect(localScale.x).toBeCloseTo(authoredScale.x / GARY_METERS_PER_UNIT, 4);
    expect(localScale.y).toBeCloseTo(authoredScale.y / GARY_METERS_PER_UNIT, 4);
    expect(localScale.z).toBeCloseTo(authoredScale.z / GARY_METERS_PER_UNIT, 4);
  });

  it('leaves a metre-authored file alone', () => {
    const authored = new THREE.Matrix4()
      .makeTranslation(1, 2, 3)
      .toArray();

    for (const unit of [1, null, undefined, 0]) {
      const local = projectorLocalMatrix(authored, unit);
      const t = new THREE.Vector3().setFromMatrixPosition(local);
      expect([t.x, t.y, t.z], `metersPerUnit ${unit} should be a no-op`).toEqual([
        1, 2, 3
      ]);
    }
  });

  it('reads the flat array without transposing it', () => {
    // USD is row-vector with the translation in the last row; three is
    // column-vector with it in slots 12 to 14. Those coincide, so reading the
    // array straight is correct and a transpose would move the translation
    // into the basis.
    const authored = readEyeLooks(garyUsdz())[0]!.params.projectorMatrix as number[];
    const straight = new THREE.Vector3().setFromMatrixPosition(
      new THREE.Matrix4().fromArray(authored)
    );
    const transposed = new THREE.Vector3().setFromMatrixPosition(
      new THREE.Matrix4().fromArray(authored).transpose()
    );

    expect(straight.length()).toBeGreaterThan(1);
    // The transpose puts zeros where the position should be, which is how a
    // wrong reading shows up rather than as an error.
    expect(transposed.length()).toBeLessThan(straight.length());
  });
});
