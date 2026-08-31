import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  faceVertexIndices,
  barycentricAt,
  evaluateBinding,
  evaluateBindingNormal,
  Picker
} from './Picker';
import type { Vec3 } from '../doc/types';

/**
 * Two triangles forming a unit quad in the XY plane at z = 0.
 *
 *   3 ---- 2
 *   |    / |
 *   |  /   |
 *   0 ---- 1
 *
 * tri 0 = (0, 1, 2), tri 1 = (0, 2, 3)
 */
function quad(indexed = true): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const positions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
  if (indexed) {
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
  } else {
    const p = [
      0, 0, 0, 1, 0, 0, 1, 1, 0, // tri 0
      0, 0, 0, 1, 1, 0, 0, 1, 0 // tri 1
    ];
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  }
  g.computeVertexNormals();
  return g;
}

function expectVec(actual: THREE.Vector3 | null, expected: Vec3, eps = 1e-6): void {
  expect(actual).not.toBeNull();
  expect(actual!.x).toBeCloseTo(expected[0], 5);
  expect(actual!.y).toBeCloseTo(expected[1], 5);
  expect(actual!.z).toBeCloseTo(expected[2], 5);
  void eps;
}

describe('faceVertexIndices', () => {
  it('reads indexed geometry', () => {
    const g = quad(true);
    expect(faceVertexIndices(g, 0)).toEqual([0, 1, 2]);
    expect(faceVertexIndices(g, 1)).toEqual([0, 2, 3]);
  });

  it('reads non-indexed geometry', () => {
    const g = quad(false);
    expect(faceVertexIndices(g, 0)).toEqual([0, 1, 2]);
    expect(faceVertexIndices(g, 1)).toEqual([3, 4, 5]);
  });

  it('returns null past the end', () => {
    expect(faceVertexIndices(quad(true), 2)).toBeNull();
    expect(faceVertexIndices(quad(false), 2)).toBeNull();
  });
});

describe('barycentricAt', () => {
  it('gives (1,0,0) at the first vertex', () => {
    const b = barycentricAt(quad(), 0, new THREE.Vector3(0, 0, 0));
    expect(b).not.toBeNull();
    expect(b![0]).toBeCloseTo(1, 5);
    expect(b![1]).toBeCloseTo(0, 5);
    expect(b![2]).toBeCloseTo(0, 5);
  });

  it('gives (0,1,0) at the second vertex', () => {
    const b = barycentricAt(quad(), 0, new THREE.Vector3(1, 0, 0));
    expect(b![1]).toBeCloseTo(1, 5);
  });

  it('gives (0,0,1) at the third vertex', () => {
    const b = barycentricAt(quad(), 0, new THREE.Vector3(1, 1, 0));
    expect(b![2]).toBeCloseTo(1, 5);
  });

  it('sums to one at the centroid', () => {
    const b = barycentricAt(quad(), 0, new THREE.Vector3(2 / 3, 1 / 3, 0));
    const sum = b![0] + b![1] + b![2];
    expect(sum).toBeCloseTo(1, 5);
    expect(b![0]).toBeCloseTo(1 / 3, 4);
    expect(b![1]).toBeCloseTo(1 / 3, 4);
    expect(b![2]).toBeCloseTo(1 / 3, 4);
  });

  it('returns null for a degenerate triangle', () => {
    const g = new THREE.BufferGeometry();
    // Three collinear points - no area, no usable binding.
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 2, 0, 0], 3)
    );
    expect(barycentricAt(g, 0, new THREE.Vector3(0.5, 0, 0))).toBeNull();
  });
});

describe('evaluateBinding', () => {
  it('is the exact inverse of barycentricAt', () => {
    const g = quad();
    // A scatter of points inside triangle 0, including the edges.
    const samples: Vec3[] = [
      [0.5, 0.25, 0],
      [0.9, 0.1, 0],
      [0.25, 0.2, 0],
      [1, 0.5, 0],
      [0.5, 0, 0],
      [0.5, 0.5, 0]
    ];
    for (const s of samples) {
      const p = new THREE.Vector3(...s);
      const bary = barycentricAt(g, 0, p);
      expect(bary, `barycentric for ${s}`).not.toBeNull();
      const back = evaluateBinding(g, 0, bary!);
      expectVec(back, s);
    }
  });

  it('round-trips on the second triangle too', () => {
    const g = quad();
    const p = new THREE.Vector3(0.3, 0.7, 0);
    const bary = barycentricAt(g, 1, p);
    expectVec(evaluateBinding(g, 1, bary!), [0.3, 0.7, 0]);
  });

  it('round-trips on non-indexed geometry', () => {
    const g = quad(false);
    const p = new THREE.Vector3(0.6, 0.2, 0);
    const bary = barycentricAt(g, 0, p);
    expectVec(evaluateBinding(g, 0, bary!), [0.6, 0.2, 0]);
  });

  it('survives a large coordinate scale', () => {
    // Characters arrive in centimetres as often as metres; the math must not
    // lose the point when the mesh is two orders of magnitude bigger.
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 175, 0, 0, 175, 175, 0], 3)
    );
    const p = new THREE.Vector3(100, 40, 0);
    const bary = barycentricAt(g, 0, p);
    const back = evaluateBinding(g, 0, bary!);
    expect(back!.distanceTo(p)).toBeLessThan(1e-3);
  });
});

describe('evaluateBindingNormal', () => {
  it('returns the face normal of a flat quad', () => {
    const g = quad();
    const n = evaluateBindingNormal(g, 0, [1 / 3, 1 / 3, 1 / 3]);
    expectVec(n, [0, 0, 1]);
  });

  it('falls back to the geometric normal with no normal attribute', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)
    );
    const n = evaluateBindingNormal(g, 0, [1 / 3, 1 / 3, 1 / 3]);
    expectVec(n, [0, 0, 1]);
  });
});

describe('measuring through a volume', () => {
  /** A unit box with an ordinary front-facing material, as characters have. */
  function boxMesh(): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial()
    );
    mesh.updateMatrixWorld(true);
    return mesh;
  }

  function cameraLookingDownZ(): THREE.PerspectiveCamera {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    return camera;
  }

  it('finds the far side of a front-facing mesh', () => {
    // THE bug this guards. three honours material.side when raycasting, and a
    // character is front-facing because that is what you want to RENDER. A
    // plain ray therefore reports the entry face and nothing else, the
    // thickness silently measures as nothing, and every centre placement
    // quietly falls back to a guess - on every character, every time.
    const mesh = boxMesh();
    expect((mesh.material as THREE.Material).side).toBe(THREE.FrontSide);

    // Deliberately off dead centre: a ray through the exact middle of a quad
    // face rides the diagonal shared by its two triangles and is reported as
    // two hits on the SAME face, which has nothing to do with thickness.
    const picker = new Picker(cameraLookingDownZ());
    const hits = picker.pickThrough(55, 45, 100, 100, [mesh]);

    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0]!.point.z).toBeCloseTo(0.5, 5);
    expect(hits[1]!.point.z).toBeCloseTo(-0.5, 5);
  });

  it('puts the materials back exactly as it found them', () => {
    // It forces double-sided to see the exit face. Leaving them that way would
    // change how the character renders as a side effect of a click.
    const mesh = boxMesh();
    const material = mesh.material as THREE.Material;
    material.side = THREE.FrontSide;

    new Picker(cameraLookingDownZ()).pickThrough(55, 45, 100, 100, [mesh]);
    expect(material.side).toBe(THREE.FrontSide);
  });

  it('restores a material that was already double-sided', () => {
    const mesh = boxMesh();
    const material = mesh.material as THREE.Material;
    material.side = THREE.DoubleSide;

    new Picker(cameraLookingDownZ()).pickThrough(55, 45, 100, 100, [mesh]);
    expect(material.side).toBe(THREE.DoubleSide);
  });

  it('handles one material shared across many meshes', () => {
    // A character with no shading of its own gets a single clay material
    // across all thirty-odd of its pieces.
    const shared = new THREE.MeshStandardMaterial();
    const group = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared);
      mesh.position.z = -i * 3;
      group.add(mesh);
    }
    group.updateMatrixWorld(true);

    const hits = new Picker(cameraLookingDownZ()).pickThrough(55, 45, 100, 100, [group]);
    expect(hits.length).toBeGreaterThanOrEqual(6);
    expect(shared.side).toBe(THREE.FrontSide);
  });

  it('returns hits in distance order', () => {
    const mesh = boxMesh();
    const hits = new Picker(cameraLookingDownZ()).pickThrough(55, 45, 100, 100, [mesh]);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i]!.distance).toBeGreaterThanOrEqual(hits[i - 1]!.distance);
    }
  });

  it('returns nothing when the ray misses', () => {
    const mesh = boxMesh();
    mesh.position.set(50, 0, 0);
    mesh.updateMatrixWorld(true);
    const hits = new Picker(cameraLookingDownZ()).pickThrough(55, 45, 100, 100, [mesh]);
    expect(hits).toEqual([]);
  });
});
