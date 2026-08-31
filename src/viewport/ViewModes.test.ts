import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ViewModeController, VIEW_MODES, DEFAULT_VIEW_MODE } from './ViewModes';

const WIRE_NAME = 'RiserWireframe';

function mesh(name = 'Body'): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x808080 })
  );
  m.name = name;
  return m;
}

function wireOf(m: THREE.Mesh): THREE.Object3D | undefined {
  return m.getObjectByName(WIRE_NAME);
}

describe('view modes', () => {
  it('offers the four modes', () => {
    expect(VIEW_MODES.map((v) => v.id)).toEqual([
      'lit',
      'flat',
      'wireframe',
      'litWireframe'
    ]);
    expect(DEFAULT_VIEW_MODE).toBe('lit');
  });

  it('leaves the asset material alone in lit mode', () => {
    const body = mesh();
    const original = body.material;
    const controller = new ViewModeController(() => [body]);

    controller.setMode('lit');
    expect(body.material).toBe(original);
    expect(wireOf(body)).toBeUndefined();
    controller.dispose();
  });

  it('shades flat with a CLONE, never by mutating the original', () => {
    // flatShading is a property of the material, so setting it in place would
    // change how the asset looks in every other mode too.
    const body = mesh();
    const original = body.material as THREE.MeshStandardMaterial;
    const controller = new ViewModeController(() => [body]);

    controller.setMode('flat');
    expect(body.material).not.toBe(original);
    expect((body.material as THREE.MeshStandardMaterial).flatShading).toBe(true);
    expect(original.flatShading).toBe(false);
    controller.dispose();
  });

  it('draws edges over the surface in lit wireframe', () => {
    const body = mesh();
    const original = body.material;
    const controller = new ViewModeController(() => [body]);

    controller.setMode('litWireframe');
    expect(body.material).toBe(original);
    expect(wireOf(body)).toBeDefined();
    controller.dispose();
  });

  it('keeps the mesh itself visible in wireframe, so the edges still render', () => {
    // The trap: three skips the CHILDREN of an invisible object, and the
    // wireframe is a child. Hiding the mesh would take the edges with it and
    // leave an empty viewport, so the surface is suppressed with an invisible
    // material instead.
    const body = mesh();
    const controller = new ViewModeController(() => [body]);

    controller.setMode('wireframe');
    expect(body.visible, 'hiding the mesh would hide its wireframe too').toBe(true);
    expect((body.material as THREE.Material).visible).toBe(false);
    expect(wireOf(body)).toBeDefined();
    controller.dispose();
  });

  it('removes the edges again when returning to lit', () => {
    const body = mesh();
    const controller = new ViewModeController(() => [body]);

    controller.setMode('litWireframe');
    expect(wireOf(body)).toBeDefined();
    controller.setMode('lit');
    expect(wireOf(body)).toBeUndefined();
    controller.dispose();
  });

  it('never lets the wireframe be picked', () => {
    // The guide tools raycast the character. An edge overlay in that list
    // would let a marker bind to a line instead of a triangle.
    const body = mesh();
    const controller = new ViewModeController(() => [body]);
    controller.setMode('wireframe');

    const raycaster = new THREE.Raycaster();
    raycaster.set(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
    const hits = raycaster.intersectObject(wireOf(body)!, false);
    expect(hits).toHaveLength(0);
    controller.dispose();
  });

  it('puts everything back on dispose', () => {
    const body = mesh();
    const original = body.material;
    const controller = new ViewModeController(() => [body]);

    controller.setMode('wireframe');
    controller.dispose();

    expect(body.material).toBe(original);
    expect(body.visible).toBe(true);
    expect(wireOf(body)).toBeUndefined();
  });
});

describe('following what is actually displayed', () => {
  it('applies to whatever the getter returns now, not what it returned before', () => {
    // Subdivision swaps the displayed mesh: the cage at level 0, a limit
    // surface above it. A mode set before the swap has to reach the new mesh.
    const cage = mesh('cage');
    const limit = mesh('limit');
    let displayed: THREE.Mesh[] = [cage];

    const controller = new ViewModeController(() => displayed);
    controller.setMode('litWireframe');
    expect(wireOf(cage)).toBeDefined();

    displayed = [limit];
    controller.refresh();

    expect(wireOf(limit), 'the new displayed mesh got no wireframe').toBeDefined();
    controller.dispose();
  });

  it('restores a mesh that stops being displayed', () => {
    // Otherwise a rebuilt limit surface strands a flat clone on a mesh nobody
    // can see, and switching back to level 0 shows the wrong shading.
    const cage = mesh('cage');
    const limit = mesh('limit');
    const originalCageMaterial = cage.material;
    let displayed: THREE.Mesh[] = [cage];

    const controller = new ViewModeController(() => displayed);
    controller.setMode('flat');
    expect(cage.material).not.toBe(originalCageMaterial);

    displayed = [limit];
    controller.refresh();

    expect(cage.material).toBe(originalCageMaterial);
    expect(wireOf(cage)).toBeUndefined();
    controller.dispose();
  });

  it('handles having no character at all', () => {
    const controller = new ViewModeController(() => []);
    expect(() => controller.setMode('wireframe')).not.toThrow();
    expect(() => controller.dispose()).not.toThrow();
  });

  it('handles a mesh with an array of materials', () => {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [
      new THREE.MeshStandardMaterial(),
      new THREE.MeshStandardMaterial()
    ]);
    const controller = new ViewModeController(() => [body]);

    controller.setMode('flat');
    const flat = body.material as THREE.MeshStandardMaterial[];
    expect(Array.isArray(flat)).toBe(true);
    expect(flat.every((m) => m.flatShading)).toBe(true);
    controller.dispose();
  });
});

describe('hiding the character', () => {
  it('stops drawing the surface without hiding the object', () => {
    // Hidden through the MATERIAL, not `visible`. three skips the children of
    // an invisible object, and hiding the mesh would take anything parented to
    // it with it - which is the bug the wireframe mode already had to avoid.
    const body = mesh();
    const modes = new ViewModeController(() => [body]);
    modes.setSurfaceVisible(false);

    expect(body.visible).toBe(true);
    expect((body.material as THREE.Material).visible).toBe(false);
  });

  it('keeps the mesh pickable while hidden', () => {
    // Someone who hides the character to see their markers clearly still
    // expects to be able to click it and place one.
    const body = mesh();
    const modes = new ViewModeController(() => [body]);
    modes.setSurfaceVisible(false);

    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(0, 0, 5),
      new THREE.Vector3(0, 0, -1)
    );
    const hits: THREE.Intersection[] = [];
    body.raycast(raycaster, hits);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('takes the wireframe with it', () => {
    // A wireframe is a way of DRAWING the geometry, so "do not draw the
    // geometry" has to mean it too - otherwise turning the character off in
    // wireframe mode appears to do nothing at all.
    const body = mesh();
    const modes = new ViewModeController(() => [body]);
    modes.setMode('wireframe');
    expect(wireOf(body)).toBeDefined();

    modes.setSurfaceVisible(false);
    expect(wireOf(body)).toBeUndefined();
  });

  it('puts the surface back, in whatever mode is current', () => {
    const body = mesh();
    const original = body.material;
    const modes = new ViewModeController(() => [body]);

    modes.setSurfaceVisible(false);
    modes.setSurfaceVisible(true);
    expect(body.material).toBe(original);

    modes.setMode('litWireframe');
    modes.setSurfaceVisible(false);
    modes.setSurfaceVisible(true);
    expect(body.material).toBe(original);
    expect(wireOf(body)).toBeDefined();
  });

  it('reports its own state', () => {
    const modes = new ViewModeController(() => [mesh()]);
    expect(modes.isSurfaceVisible).toBe(true);
    modes.setSurfaceVisible(false);
    expect(modes.isSurfaceVisible).toBe(false);
  });
});
