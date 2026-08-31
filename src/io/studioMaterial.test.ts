import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyStudioMaterial, createStudioMaterial, isUnshaded } from './studioMaterial';

function meshWith(material: THREE.Material | THREE.Material[]): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
}

describe('recognising a material that says nothing', () => {
  it('treats a bare black material as unshaded', () => {
    // What every exporter writes when the asset had no shading to export -
    // and what Gary arrived with, rendering as a black silhouette.
    expect(isUnshaded(new THREE.MeshStandardMaterial({ color: 0x000000 }))).toBe(true);
    expect(isUnshaded(new THREE.MeshPhysicalMaterial({ color: 0x000000 }))).toBe(true);
  });

  it('leaves a deliberately dark material alone when it carries a texture', () => {
    // Base colour multiplies the map, so black plus a texture is a real
    // material. Replacing it would be overriding the artist.
    const material = new THREE.MeshStandardMaterial({ color: 0x000000 });
    material.map = new THREE.Texture();
    expect(isUnshaded(material)).toBe(false);
  });

  it('leaves a material with vertex colours alone', () => {
    const material = new THREE.MeshStandardMaterial({
      color: 0x000000,
      vertexColors: true
    });
    expect(isUnshaded(material)).toBe(false);
  });

  it('leaves any material with a real colour alone', () => {
    expect(isUnshaded(new THREE.MeshStandardMaterial({ color: 0x804020 }))).toBe(false);
    // Dark, but not black - someone chose this.
    expect(isUnshaded(new THREE.MeshStandardMaterial({ color: 0x0a0a0a }))).toBe(false);
  });
});

describe('giving an unshaded character something to be seen with', () => {
  it('replaces black materials and reports how many', () => {
    const root = new THREE.Group();
    root.add(meshWith(new THREE.MeshStandardMaterial({ color: 0x000000 })));
    root.add(meshWith(new THREE.MeshStandardMaterial({ color: 0x000000 })));

    expect(applyStudioMaterial(root)).toBe(2);
    for (const child of root.children) {
      const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
      expect(material.name).toBe('RiserStudioClay');
      expect(material.color.getHex()).not.toBe(0x000000);
    }
  });

  it('shares one material across the whole character', () => {
    // A production character is thirty or forty pieces. One material instance
    // rather than forty identical ones lets the renderer batch them.
    const root = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      root.add(meshWith(new THREE.MeshStandardMaterial({ color: 0x000000 })));
    }
    applyStudioMaterial(root);

    const materials = new Set(root.children.map((c) => (c as THREE.Mesh).material));
    expect(materials.size).toBe(1);
  });

  it('does not touch a character that brought real materials', () => {
    // "Lit" is documented as showing the asset as its own materials describe
    // it. Silently overriding them would make that claim false.
    const root = new THREE.Group();
    const original = new THREE.MeshStandardMaterial({ color: 0x3366cc });
    root.add(meshWith(original));

    expect(applyStudioMaterial(root)).toBe(0);
    expect((root.children[0] as THREE.Mesh).material).toBe(original);
  });

  it('leaves a mixed character alone per mesh', () => {
    const root = new THREE.Group();
    const real = new THREE.MeshStandardMaterial({ color: 0x3366cc });
    root.add(meshWith(real));
    root.add(meshWith(new THREE.MeshStandardMaterial({ color: 0x000000 })));

    expect(applyStudioMaterial(root)).toBe(1);
    expect((root.children[0] as THREE.Mesh).material).toBe(real);
    expect(((root.children[1] as THREE.Mesh).material as THREE.Material).name).toBe(
      'RiserStudioClay'
    );
  });

  it('only replaces a multi-material mesh when every slot is unshaded', () => {
    const root = new THREE.Group();
    root.add(
      meshWith([
        new THREE.MeshStandardMaterial({ color: 0x000000 }),
        new THREE.MeshStandardMaterial({ color: 0x3366cc })
      ])
    );
    expect(applyStudioMaterial(root)).toBe(0);
  });

  it('produces a material that is actually visible', () => {
    const material = createStudioMaterial();
    const { r, g, b } = material.color;
    expect(Math.max(r, g, b)).toBeGreaterThan(0.5);
    // Neutral: nothing that would compete with the marker colours drawn on it.
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.1);
  });
});
