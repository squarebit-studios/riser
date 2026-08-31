import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SceneSelection } from './SceneSelection';

function piece(name: string, opts: { skinned?: boolean; mats?: number } = {}): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material =
    (opts.mats ?? 1) > 1
      ? Array.from({ length: opts.mats! }, () => new THREE.MeshStandardMaterial())
      : new THREE.MeshStandardMaterial();
  const mesh = opts.skinned
    ? new THREE.SkinnedMesh(geometry, material as THREE.Material)
    : new THREE.Mesh(geometry, material);
  mesh.userData.primPath = `/Riser/Character/Geom/${name}`;
  return mesh;
}

describe('listing what a character is made of', () => {
  it('reports a row per piece, named by its leaf', () => {
    const scene = new SceneSelection();
    scene.setCharacter([piece('body_geo'), piece('spacesuit_geo')]);
    expect(scene.items().map((i) => i.name)).toEqual(['body_geo', 'spacesuit_geo']);
  });

  it('says which pieces are skinned and which carry subsets', () => {
    // Both matter when choosing what to bind to: a multi-material piece is one
    // mesh that renders as several, which is not obvious from the viewport.
    const scene = new SceneSelection();
    scene.setCharacter([piece('body_geo', { skinned: true, mats: 3 })]);
    const [item] = scene.items();
    expect(item!.skinned).toBe(true);
    expect(item!.materials).toBe(3);
    expect(item!.triangles).toBeGreaterThan(0);
  });

  it('starts with nothing selected and nothing hidden', () => {
    const scene = new SceneSelection();
    scene.setCharacter([piece('body_geo')]);
    expect(scene.selectedPath).toBeNull();
    expect(scene.hiddenCount).toBe(0);
  });
});

describe('selecting a piece', () => {
  it('highlights without touching the shared material', () => {
    // Materials ARE shared: an unshaded character gets one clay material
    // across every piece, so tinting in place would light up the whole
    // character rather than the one piece selected.
    const shared = new THREE.MeshStandardMaterial();
    const a = new THREE.Mesh(new THREE.BoxGeometry(), shared);
    const b = new THREE.Mesh(new THREE.BoxGeometry(), shared);
    a.userData.primPath = '/c/a';
    b.userData.primPath = '/c/b';

    const scene = new SceneSelection();
    scene.setCharacter([a, b]);
    scene.select('/c/a');

    expect(a.material).not.toBe(shared);
    expect(b.material).toBe(shared);
    expect((shared as THREE.MeshStandardMaterial).emissiveIntensity).toBe(1);
  });

  it('puts the original material back on deselect', () => {
    const mesh = piece('body_geo');
    const original = mesh.material;
    const scene = new SceneSelection();
    scene.setCharacter([mesh]);

    scene.select('/Riser/Character/Geom/body_geo');
    expect(mesh.material).not.toBe(original);

    scene.select(null);
    expect(mesh.material).toBe(original);
    expect(scene.selectedPath).toBeNull();
  });

  it('moves the highlight rather than stacking it', () => {
    const a = piece('a');
    const b = piece('b');
    const originalA = a.material;
    const scene = new SceneSelection();
    scene.setCharacter([a, b]);

    scene.select('/Riser/Character/Geom/a');
    scene.select('/Riser/Character/Geom/b');

    expect(a.material).toBe(originalA);
    expect(b.material).not.toBe(originalA);
  });

  it('ignores a path the character does not have', () => {
    const scene = new SceneSelection();
    scene.setCharacter([piece('body_geo')]);
    scene.select('/not/here');
    expect(scene.selectedPath).toBeNull();
  });
});

describe('hiding a piece', () => {
  it('takes it out of the scene entirely, raycast included', () => {
    // Unlike the Show menu's Character toggle, which hides through a material
    // so the mesh stays clickable. Hiding here exists so a click can reach the
    // piece UNDERNEATH, which means this one has to leave the raycast.
    const mesh = piece('spacesuit_geo');
    const scene = new SceneSelection();
    scene.setCharacter([mesh]);

    scene.setVisible('/Riser/Character/Geom/spacesuit_geo', false);
    expect(mesh.visible).toBe(false);
    expect(scene.hiddenCount).toBe(1);
    expect(scene.items()[0]!.visible).toBe(false);
  });

  it('brings it back', () => {
    const mesh = piece('spacesuit_geo');
    const scene = new SceneSelection();
    scene.setCharacter([mesh]);
    scene.setVisible('/Riser/Character/Geom/spacesuit_geo', false);
    scene.setVisible('/Riser/Character/Geom/spacesuit_geo', true);
    expect(mesh.visible).toBe(true);
    expect(scene.hiddenCount).toBe(0);
  });

  it('shows everything at once', () => {
    const meshes = [piece('a'), piece('b'), piece('c')];
    const scene = new SceneSelection();
    scene.setCharacter(meshes);
    for (const m of meshes) scene.setVisible(m.userData.primPath as string, false);
    expect(scene.hiddenCount).toBe(3);

    scene.showAll();
    expect(scene.hiddenCount).toBe(0);
    for (const m of meshes) expect(m.visible).toBe(true);
  });

  it('does not carry hiding across a character change', () => {
    // A new character arriving with pieces missing, for a reason nothing on
    // screen explains, is a bug report waiting to happen.
    const first = piece('spacesuit_geo');
    const scene = new SceneSelection();
    scene.setCharacter([first]);
    scene.setVisible('/Riser/Character/Geom/spacesuit_geo', false);

    scene.setCharacter([piece('other_geo')]);
    expect(scene.hiddenCount).toBe(0);
    expect(first.visible).toBe(true);
  });

  it('clears the highlight when the character changes', () => {
    const mesh = piece('body_geo');
    const original = mesh.material;
    const scene = new SceneSelection();
    scene.setCharacter([mesh]);
    scene.select('/Riser/Character/Geom/body_geo');

    scene.setCharacter([piece('new_geo')]);
    expect(mesh.material).toBe(original);
    expect(scene.selectedPath).toBeNull();
  });
});
