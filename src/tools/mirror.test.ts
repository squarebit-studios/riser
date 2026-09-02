// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Mirroring puts a point at its reflection. Exactly there, and nowhere else.
//
// Reported busted: mirroring the left lids gave right lids whose points were
// not the reflection, some of them landing on the nose. The counts matched, so
// points were being made and made in the wrong places.
//
// The cause was the question being asked. Mirroring fired a ray along the
// reflected normal and kept whatever it hit, which asks "what surface is in
// this direction" and answers with the eyelashes in front of the lid, the nose
// beside it, or nothing, depending on where the reflected normal pointed. A
// mirror has no direction to get wrong: it reflects.
//
// So the test is an equality, not a tolerance. The binding is still required
// to be real, because it is what the exporter writes, but finding it must not
// be able to move the point.
//
// The scene is the part of a face that made this fail: two eyeballs either
// side of the centre line with a nose between them for a stray ray to find.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bindAtPosition } from './rebind';
import { reflectAcrossCentre } from '../doc/centreLine';
import type { Vec3 } from '../doc/types';

const EYE_X = 0.35;
const EYE_R = 0.15;

function face(): { root: THREE.Object3D; meshes: THREE.Mesh[] } {
  const root = new THREE.Object3D();
  const meshes: THREE.Mesh[] = [];

  const put = (mesh: THREE.Mesh, path: string, x: number, z: number): void => {
    mesh.position.set(x, 0, z);
    // The binder refuses anything with no prim path, because a binding names
    // a prim and inventing one would write a path the exporter cannot honour.
    mesh.userData.primPath = path;
    mesh.name = path;
    root.add(mesh);
    meshes.push(mesh);
  };

  const material = new THREE.MeshBasicMaterial();
  put(new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 48, 48), material),
      '/Character/eyeL', -EYE_X, 0);
  put(new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 48, 48), material),
      '/Character/eyeR', EYE_X, 0);
  // Proud of both eyes and on the centre line: what a badly aimed ray found.
  put(new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 24), material),
      '/Character/nose', 0, 0.22);

  root.updateMatrixWorld(true);
  return { root, meshes };
}

/** A point on the LEFT eye's surface, as a traced lid point would be. */
function onLeftEye(phi: number): Vec3 {
  const theta = 1.35;
  const n = new THREE.Vector3(
    Math.sin(theta) * Math.cos(phi),
    Math.cos(theta),
    Math.sin(theta) * Math.sin(phi)
  ).normalize();
  return [-EYE_X + n.x * EYE_R, n.y * EYE_R, n.z * EYE_R];
}

describe('mirroring a curve point', () => {
  const { root, meshes } = face();

  it('puts the point exactly at its reflection', () => {
    const target = reflectAcrossCentre(onLeftEye(1.2));
    const bound = bindAtPosition(target, root, meshes);

    expect(bound).not.toBeNull();
    const at = (bound as NonNullable<typeof bound>).position;
    // Exactly, not nearly. Binding is allowed to describe the point; it is not
    // allowed to move it.
    expect(at[0]).toBeCloseTo(target[0], 12);
    expect(at[1]).toBeCloseTo(target[1], 12);
    expect(at[2]).toBeCloseTo(target[2], 12);
  });

  it('does it for a whole traced lid, not one lucky point', () => {
    // The report was that SOME points went astray. One point proving nothing
    // is how a bug like that ships.
    for (let i = 0; i < 12; i++) {
      const target = reflectAcrossCentre(onLeftEye(0.6 + (i / 11) * 1.6));
      const bound = bindAtPosition(target, root, meshes);
      expect(bound, `point ${i} could not be bound`).not.toBeNull();
      const at = (bound as NonNullable<typeof bound>).position;
      expect(Math.hypot(at[0] - target[0], at[1] - target[1], at[2] - target[2])).
        toBeLessThan(1e-9);
    }
  });

  it('binds to the far eye, not to the nose between them', () => {
    // The inner corner, nearest the nose, which is where the old ray went
    // wrong. The binding has to name the eye it is actually on.
    const target = reflectAcrossCentre(onLeftEye(2.0));
    const bound = bindAtPosition(target, root, meshes);
    expect(bound?.binding.primPath).toBe('/Character/eyeR');
  });

  it('binds on the surface, so the offset is nothing', () => {
    // A mirrored point on a symmetric character lands on the far surface, so
    // there is no displacement to record. A non-zero offset here would mean
    // the point had been bound to something it is not lying on.
    const bound = bindAtPosition(reflectAcrossCentre(onLeftEye(1.0)), root, meshes);
    const offset = bound?.binding.offset as Vec3;
    expect(Math.hypot(offset[0], offset[1], offset[2])).toBeLessThan(1e-3);
  });

  it('reflecting twice is the original point', () => {
    const original = onLeftEye(1.1);
    expect(reflectAcrossCentre(reflectAcrossCentre(original))).toEqual(original);
  });
});
