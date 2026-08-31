import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { EyeMaterials } from './EyeMaterials';
import type { EyeLook } from '../io/eyeLook';

function eyeMesh(primPath: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  mesh.userData.primPath = primPath;
  return mesh;
}

/** A look with enough of the shipping set to be usable. */
function look(primPath: string): EyeLook {
  const params: Record<string, number | string | number[]> = {
    spec: 'Eye_L_Projection',
    ior: 1.376,
    corneaRadius: 0.65,
    corneaApexZ: 1.05,
    corneaBulge: 0,
    irisWidth: 0.8,
    irisHeight: 0.8,
    irisPlaneZ: 0.75,
    limbusDarkening: 0.5,
    refractionMode: 'MESH_NORMAL',
    projectorMatrix: [
      0.0457, 0, 0, 0, 0, 0.0457, 0, 0, 0, 0, 0.0457, 0, 0, 1.6, 0.1, 1
    ]
  };
  return { primPath, params };
}

describe('shading a character’s eyes', () => {
  it('shades only the meshes that carry a look', () => {
    // A character is thirty-odd meshes and two of them are eyes. Shading
    // anything else would put a refracted cornea on a boot.
    const eyes = new EyeMaterials();
    const meshes = [eyeMesh('/c/eye_l_geo'), eyeMesh('/c/eye_r_geo'), eyeMesh('/c/body_geo')];
    const shaded = eyes.apply(meshes, [look('/c/eye_l_geo'), look('/c/eye_r_geo')], '/assets/gary.usdz');

    expect(shaded).toBe(2);
    expect(eyes.count).toBe(2);
    expect(meshes[2]!.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect((meshes[2]!.material as THREE.Material).name).not.toContain('SquarebitEye');
  });

  it('names the material so it is identifiable in a debugger', () => {
    const eyes = new EyeMaterials();
    const mesh = eyeMesh('/c/eye_l_geo');
    eyes.apply([mesh], [look('/c/eye_l_geo')], '/assets/gary.usdz');
    expect((mesh.material as THREE.Material).name).toContain('SquarebitEye');
  });

  it('does nothing when the character has no looks', () => {
    // The common case - most characters are not carrying a Squarebit Eye.
    const eyes = new EyeMaterials();
    const mesh = eyeMesh('/c/eye_l_geo');
    const before = mesh.material;
    expect(eyes.apply([mesh], [], '/assets/x.usdz')).toBe(0);
    expect(mesh.material).toBe(before);
  });

  it('refuses a look too sparse to build a shader from', () => {
    const eyes = new EyeMaterials();
    const mesh = eyeMesh('/c/eye_l_geo');
    const sparse: EyeLook = { primPath: '/c/eye_l_geo', params: { ior: 1.3 } };
    expect(eyes.apply([mesh], [sparse], '/assets/x.usdz')).toBe(0);
  });

  it('does not shade the same eye twice', () => {
    // Called again after a subdivision rebuild, it must not stack materials.
    const eyes = new EyeMaterials();
    const mesh = eyeMesh('/c/eye_l_geo');
    const looks = [look('/c/eye_l_geo')];
    expect(eyes.apply([mesh], looks, '/assets/x.usdz')).toBe(1);
    expect(eyes.apply([mesh], looks, '/assets/x.usdz')).toBe(0);
    expect(eyes.count).toBe(1);
  });

  it('keeps the character loadable when a look cannot be shaded', () => {
    // Soft failure is the rule: a broken eye leaves the white stand-in and
    // never costs the character.
    const eyes = new EyeMaterials();
    const mesh = eyeMesh('/c/eye_l_geo');
    const broken = look('/c/eye_l_geo');
    broken.params.projectorMatrix = 'not a matrix';
    expect(() => eyes.apply([mesh], [broken], '/assets/x.usdz')).not.toThrow();
  });

  it('releases what it built', () => {
    const eyes = new EyeMaterials();
    eyes.apply([eyeMesh('/c/eye_l_geo')], [look('/c/eye_l_geo')], '/assets/x.usdz');
    eyes.dispose();
    expect(eyes.count).toBe(0);
  });
});
