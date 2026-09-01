// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Applying blend shapes that never become morph targets.
//
// The properties worth pinning are the ones that fail quietly. A shape applied
// through a wrong point-to-vertex map does not throw, it moves the wrong part
// of the face. A shape that does not subtract cleanly leaves the character
// slightly wrong after every drag, in a way nobody attributes to the slider
// they let go of ten minutes ago.
// ==========================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SparseBlendShapes } from './SparseBlendShapes';
import { AUTHORED_CAGE } from './SubdivSurface';
import type { BlendShapeDelta } from '../io/blendShapeData';

/**
 * A mesh with UNWELDED vertices, which is what a renderer really builds.
 *
 * Three points, but the middle one is split in two the way a UV seam splits
 * it, so a shape moving point 1 has to move both copies. A test on a welded
 * mesh would pass with the mapping missing entirely.
 */
function splitMesh(): THREE.Mesh {
  const points = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    // point 0, point 1, point 1 again, point 2
    new THREE.BufferAttribute(
      new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 0]),
      3
    )
  );
  const mesh = new THREE.Mesh(geometry);
  mesh.userData.primPath = '/Character/face';
  mesh.userData[AUTHORED_CAGE] = {
    positions: points,
    faceVertexCounts: new Uint32Array([3]),
    faceVertexIndices: new Uint32Array([0, 1, 2]),
    triangles: 1,
    trianglesPerSlot: [1]
  };
  return mesh;
}

function shape(name: string, indices: number[], offsets: number[]): BlendShapeDelta {
  return {
    name,
    pointIndices: new Uint32Array(indices),
    offsets: new Float32Array(offsets)
  };
}

function positions(mesh: THREE.Mesh): number[] {
  return [...(mesh.geometry.getAttribute('position').array as Float32Array)];
}

describe('sparse blend shapes', () => {
  let mesh: THREE.Mesh;
  let shapes: SparseBlendShapes;

  beforeEach(() => {
    mesh = splitMesh();
    shapes = new SparseBlendShapes();
    shapes.setCharacter(
      [mesh],
      new Map([['face', [shape('jaw_open', [1], [0, -1, 0])]]])
    );
  });

  it('finds the shapes on a mesh', () => {
    expect(shapes.names()).toEqual(['jaw_open']);
  });

  it('moves EVERY render vertex split from the moved point', () => {
    // The one that matters. Point 1 is two vertices, and moving only the first
    // tears the mesh open along the seam.
    shapes.setWeight('jaw_open', 1);
    expect(positions(mesh)).toEqual([0, 0, 0, 1, -1, 0, 1, -1, 0, 2, 0, 0]);
  });

  it('leaves points the shape does not name alone', () => {
    shapes.setWeight('jaw_open', 1);
    const after = positions(mesh);
    expect(after.slice(0, 3)).toEqual([0, 0, 0]);
    expect(after.slice(9, 12)).toEqual([2, 0, 0]);
  });

  it('scales with the weight', () => {
    shapes.setWeight('jaw_open', 0.5);
    expect(positions(mesh)[4]).toBeCloseTo(-0.5, 6);
  });

  it('returns EXACTLY to rest, however many times it is fired', () => {
    // Recomputed from rest rather than nudged. Adding and subtracting a delta
    // accumulates the error of every drag, and a face that is slightly wrong
    // after a while is not traced back to the slider that did it.
    const rest = positions(mesh);
    for (const w of [1, 0.3, 0.9, 0.1, 1, 0.5]) shapes.setWeight('jaw_open', w);
    shapes.setWeight('jaw_open', 0);
    expect(positions(mesh)).toEqual(rest);
  });

  it('adds two shapes that touch the same point', () => {
    const two = new SparseBlendShapes();
    two.setCharacter(
      [splitMesh()],
      new Map([
        [
          'face',
          [shape('a', [1], [0, -1, 0]), shape('b', [1], [0, 0, 2])]
        ]
      ])
    );
    two.setWeight('a', 1);
    two.setWeight('b', 0.5);
    expect(two.weightOf('a')).toBe(1);
    expect(two.weightOf('b')).toBe(0.5);
  });

  it('drives every mesh carrying the name', () => {
    // 462 of the real character's 932 names are on more than one mesh: a jaw
    // shape has to move the gums and the teeth with the face.
    const face = splitMesh();
    const gums = splitMesh();
    gums.userData.primPath = '/Character/gums';

    const both = new SparseBlendShapes();
    both.setCharacter(
      [face, gums],
      new Map([
        ['face', [shape('jaw_open', [1], [0, -1, 0])]],
        ['gums', [shape('jaw_open', [1], [0, -1, 0])]]
      ])
    );

    expect(both.meshCountFor('jaw_open')).toBe(2);
    both.setWeight('jaw_open', 1);
    expect(positions(face)[4]).toBeCloseTo(-1, 6);
    expect(positions(gums)[4]).toBeCloseTo(-1, 6);
  });

  it('refuses a shape built against different geometry', () => {
    // The way two files drift apart. An index past the end of the mesh means
    // this shape describes something else, and applying it would move a face
    // by numbers meant for another one.
    const wrong = new SparseBlendShapes();
    wrong.setCharacter(
      [splitMesh()],
      new Map([['face', [shape('impossible', [99], [0, -1, 0])]]])
    );
    expect(wrong.names()).toEqual([]);
  });

  it('does nothing for a mesh with no authored points to map through', () => {
    const bare = new THREE.Mesh(new THREE.BufferGeometry());
    bare.userData.primPath = '/Character/face';
    bare.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3)
    );
    const none = new SparseBlendShapes();
    none.setCharacter(
      [bare],
      new Map([['face', [shape('jaw_open', [0], [0, -1, 0])]]])
    );
    expect(none.names()).toEqual([]);
  });

  it('puts the character back when it is disposed', () => {
    const rest = positions(mesh);
    shapes.setWeight('jaw_open', 1);
    shapes.dispose();
    expect(positions(mesh)).toEqual(rest);
  });
});

describe('shading', () => {
  it('never derives normals with three, which would facet an unwelded mesh', () => {
    // The bug this exists for. A renderer's geometry is unwelded: this
    // character is 152,928 vertices for 25,490 points, split at every UV and
    // normal seam. `computeVertexNormals` averages across VERTICES, so with
    // none shared it yields one normal per triangle. Firing a single shape
    // took the character from smooth to 80% faceted, permanently, and made its
    // triangulation visible at level 0.
    const mesh = splitMesh();
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    mesh.geometry.setAttribute(
      'normal',
      new THREE.BufferAttribute(normals.slice(), 3)
    );

    const shapes = new SparseBlendShapes();
    shapes.setCharacter(
      [mesh],
      new Map([['face', [shape('jaw_open', [1], [0, -1, 0])]]])
    );

    shapes.setWeight('jaw_open', 1);
    shapes.setWeight('jaw_open', 0);

    // Back to exactly what the file shaded it with, not to something derived.
    const after = mesh.geometry.getAttribute('normal').array as Float32Array;
    expect([...after]).toEqual([...normals]);
  });

  it('keeps the two halves of a split point shaded the same', () => {
    // What smooth means here: a point split into several render vertices has
    // to get ONE normal written to all of them, or the seam shows as a crease
    // that nobody authored.
    const mesh = splitMesh();
    mesh.geometry.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array(12), 3)
    );
    const shapes = new SparseBlendShapes();
    shapes.setCharacter(
      [mesh],
      new Map([['jaw', [shape('jaw', [1], [0, -1, 0])]]])
    );
    shapes.setWeight('jaw', 1);

    const n = mesh.geometry.getAttribute('normal').array as Float32Array;
    // Vertices 1 and 2 are the same authored point.
    expect(n[3]).toBeCloseTo(n[6]!, 10);
    expect(n[4]).toBeCloseTo(n[7]!, 10);
    expect(n[5]).toBeCloseTo(n[8]!, 10);
  });
});
