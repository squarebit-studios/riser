import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  activeCount,
  findBlendShapes,
  resetAll,
  setWeight,
  weightOf
} from './blendShapes';

/** A mesh carrying named morph targets, the way a loaded character does. */
function meshWithShapes(
  names: string[],
  { named = true }: { named?: boolean } = {}
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  mesh.morphTargetInfluences = names.map(() => 0);
  if (named) {
    mesh.morphTargetDictionary = Object.fromEntries(
      names.map((name, index) => [name, index])
    );
  }
  return mesh;
}

describe('finding a character’s blend shapes', () => {
  it('finds nothing on a character that has none', () => {
    // The panel hides entirely in this case: a permanently empty section
    // teaches the user to ignore that part of the interface.
    expect(findBlendShapes([new THREE.Mesh(new THREE.BoxGeometry())])).toEqual([]);
    expect(findBlendShapes([])).toEqual([]);
  });

  it('lists the names the asset gave them', () => {
    const shapes = findBlendShapes([meshWithShapes(['smile', 'blink'])]);
    expect(shapes.map((s) => s.name)).toEqual(['blink', 'smile']);
  });

  it('sorts them, so the list is stable between loads', () => {
    const shapes = findBlendShapes([meshWithShapes(['zzz', 'aaa', 'mmm'])]);
    expect(shapes.map((s) => s.name)).toEqual(['aaa', 'mmm', 'zzz']);
  });

  it('groups one name across every mesh that carries it', () => {
    // The case that matters on a real character: a smile moves the face, the
    // teeth and the tongue, and all three have to move together or it looks
    // like a bug in Riser rather than a feature of the asset.
    const face = meshWithShapes(['smile', 'blink']);
    const teeth = meshWithShapes(['smile']);
    const shapes = findBlendShapes([face, teeth]);

    const smile = shapes.find((s) => s.name === 'smile')!;
    expect(smile.targets).toHaveLength(2);
    expect(shapes.find((s) => s.name === 'blink')!.targets).toHaveLength(1);
  });

  it('names unnamed shapes rather than hiding them', () => {
    // Legal, and some exporters produce it. A numbered shape is reachable; a
    // dropped one is not.
    const shapes = findBlendShapes([meshWithShapes(['a', 'b'], { named: false })]);
    expect(shapes.map((s) => s.name)).toEqual(['Shape 1', 'Shape 2']);
  });
});

describe('firing a blend shape', () => {
  it('drives every mesh carrying that name', () => {
    const face = meshWithShapes(['smile']);
    const teeth = meshWithShapes(['smile']);
    const [smile] = findBlendShapes([face, teeth]);

    setWeight(smile!, 1);
    expect(face.morphTargetInfluences![0]).toBe(1);
    expect(teeth.morphTargetInfluences![0]).toBe(1);
  });

  it('drives the right index when a mesh has several', () => {
    const face = meshWithShapes(['smile', 'blink', 'frown']);
    const shapes = findBlendShapes([face]);
    setWeight(shapes.find((s) => s.name === 'frown')!, 0.5);

    expect(face.morphTargetInfluences).toEqual([0, 0, 0.5]);
  });

  it('clamps to the range a weight can legally take', () => {
    const face = meshWithShapes(['smile']);
    const [smile] = findBlendShapes([face]);

    setWeight(smile!, 5);
    expect(weightOf(smile!)).toBe(1);
    setWeight(smile!, -3);
    expect(weightOf(smile!)).toBe(0);
  });

  it('reports the weight back', () => {
    const [smile] = findBlendShapes([meshWithShapes(['smile'])]);
    setWeight(smile!, 0.25);
    expect(weightOf(smile!)).toBeCloseTo(0.25, 6);
  });

  it('puts everything back', () => {
    const shapes = findBlendShapes([meshWithShapes(['a', 'b', 'c'])]);
    for (const shape of shapes) setWeight(shape, 1);
    expect(activeCount(shapes)).toBe(3);

    resetAll(shapes);
    expect(activeCount(shapes)).toBe(0);
    for (const shape of shapes) expect(weightOf(shape)).toBe(0);
  });

  it('counts only shapes actually doing something', () => {
    const shapes = findBlendShapes([meshWithShapes(['a', 'b'])]);
    setWeight(shapes[0]!, 0.0001); // below the threshold - not "on"
    expect(activeCount(shapes)).toBe(0);
    setWeight(shapes[0]!, 0.5);
    expect(activeCount(shapes)).toBe(1);
  });

  it('survives a mesh whose influences are shorter than its dictionary', () => {
    // Malformed, but a real thing exporters produce. It must not throw.
    const mesh = meshWithShapes(['a', 'b']);
    mesh.morphTargetInfluences = [0];
    const shapes = findBlendShapes([mesh]);
    expect(() => setWeight(shapes[1]!, 1)).not.toThrow();
  });
});
