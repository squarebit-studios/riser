import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { resampleCurve, DEFAULT_SAMPLES_PER_SEGMENT } from './geometry';
import {
  controlVertexSampleIndices,
  interpolateNormals,
  projectSamplesToSurface
} from './project';
import type { Vec3 } from '../../doc/types';

const CVS: Vec3[] = [
  [0, 0, 0],
  [1, 1, 0],
  [2, 0, 0],
  [3, 1, 0],
  [4, 0, 0]
];

describe('controlVertexSampleIndices', () => {
  it('names indices that really are the control vertices', () => {
    // The pinning logic in projectSamplesToSurface depends on this alignment
    // between resampleCurve's output and the control vertices. Asserting it
    // against actual output means a change to the resampler cannot quietly
    // break projection.
    const sps = DEFAULT_SAMPLES_PER_SEGMENT;
    const samples = resampleCurve(CVS, false, sps);
    const indices = [...controlVertexSampleIndices(CVS.length, sps, false)].sort(
      (a, b) => a - b
    );

    expect(indices.length).toBe(CVS.length);
    indices.forEach((sampleIndex, k) => {
      const sample = samples[sampleIndex];
      const cv = CVS[k]!;
      expect(sample, `no sample at index ${sampleIndex}`).toBeDefined();
      expect(sample![0]).toBeCloseTo(cv[0], 6);
      expect(sample![1]).toBeCloseTo(cv[1], 6);
      expect(sample![2]).toBeCloseTo(cv[2], 6);
    });
  });

  it('covers the wrap-around segment when closed', () => {
    const indices = controlVertexSampleIndices(4, 8, true);
    expect(indices.size).toBe(5); // four vertices plus the closing repeat
    expect(indices.has(32)).toBe(true);
  });

  it('is empty for a curve too short to have a segment', () => {
    expect(controlVertexSampleIndices(1, 8, false).size).toBe(0);
    expect(controlVertexSampleIndices(0, 8, false).size).toBe(0);
  });
});

describe('interpolateNormals', () => {
  it('reproduces the control normals at the ends', () => {
    const normals: Vec3[] = [
      [0, 0, 1],
      [0, 1, 0]
    ];
    const out = interpolateNormals(normals, 11, false);
    expect(out).toHaveLength(11);
    expect(out[0]![2]).toBeCloseTo(1, 6);
    expect(out[10]![1]).toBeCloseTo(1, 6);
  });

  it('produces unit-length normals throughout', () => {
    const normals: Vec3[] = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ];
    for (const n of interpolateNormals(normals, 25, false)) {
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 6);
    }
  });

  it('falls back to up when given nothing', () => {
    expect(interpolateNormals([], 3, false)).toEqual([
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 0]
    ]);
  });

  it('handles a single control normal', () => {
    const out = interpolateNormals([[0, 0, 1]], 5, false);
    expect(out).toHaveLength(5);
    expect(out.every((n) => n[2] === 1)).toBe(true);
  });
});

describe('projectSamplesToSurface', () => {
  /** A 4x4 plane at y = 0, facing up. */
  function ground(): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(4, 4);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    return mesh;
  }

  it('pulls floating samples down onto the surface', () => {
    const samples: Vec3[] = [
      [0, 0.5, 0],
      [0.5, 0.4, 0],
      [1, 0.5, 0]
    ];
    const normals: Vec3[] = samples.map(() => [0, 1, 0]);
    const out = projectSamplesToSurface(
      samples,
      normals,
      [ground()],
      new THREE.Raycaster(),
      { searchDistance: 1 }
    );
    for (const p of out) expect(p[1]).toBeCloseTo(0, 5);
  });

  it('leaves pinned samples exactly where they were', () => {
    const samples: Vec3[] = [
      [0, 0.5, 0],
      [0.5, 0.5, 0],
      [1, 0.5, 0]
    ];
    const normals: Vec3[] = samples.map(() => [0, 1, 0]);
    const out = projectSamplesToSurface(
      samples,
      normals,
      [ground()],
      new THREE.Raycaster(),
      { searchDistance: 1, pinned: new Set([0, 2]) }
    );
    expect(out[0]).toEqual([0, 0.5, 0]);
    expect(out[2]).toEqual([1, 0.5, 0]);
    expect(out[1]![1]).toBeCloseTo(0, 5);
  });

  it('keeps samples that find no surface', () => {
    // Well outside the 4x4 plane - the curve stays continuous rather than
    // collapsing a point to the origin.
    const samples: Vec3[] = [[50, 0.5, 50]];
    const out = projectSamplesToSurface(
      samples,
      [[0, 1, 0]],
      [ground()],
      new THREE.Raycaster(),
      { searchDistance: 1 }
    );
    expect(out[0]).toEqual([50, 0.5, 50]);
  });

  it('does not reach past the search distance', () => {
    const samples: Vec3[] = [[0, 5, 0]];
    const out = projectSamplesToSurface(
      samples,
      [[0, 1, 0]],
      [ground()],
      new THREE.Raycaster(),
      { searchDistance: 0.1 }
    );
    expect(out[0]![1]).toBe(5);
  });

  it('is a no-op with no meshes or no samples', () => {
    const rc = new THREE.Raycaster();
    expect(projectSamplesToSurface([], [], [ground()], rc, { searchDistance: 1 })).toEqual(
      []
    );
    const samples: Vec3[] = [[0, 1, 0]];
    expect(
      projectSamplesToSurface(samples, [[0, 1, 0]], [], rc, { searchDistance: 1 })
    ).toEqual(samples);
  });

  it('ignores a degenerate normal rather than dividing by zero', () => {
    const samples: Vec3[] = [[0, 0.5, 0]];
    const out = projectSamplesToSurface(
      samples,
      [[0, 0, 0]],
      [ground()],
      new THREE.Raycaster(),
      { searchDistance: 1 }
    );
    expect(out[0]).toEqual([0, 0.5, 0]);
  });
});
