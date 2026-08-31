// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// That Riser reads the polygons the artist modelled, rather than guessing.
//
// Against the shipped gary.usdz, because the numbers are the point. The
// heuristic this replaced was not broken in a way a synthetic fixture would
// show: it recovered 28,246 faces on a body the file says is 25,488 quads, and
// the ~11% it could not pair up stayed triangles, took an extraordinary vertex
// through the middle at every subdivision, and showed as slivers across the
// character's cheek.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readAuthoredTopology } from './authoredTopology';

function garyUsdz(): ArrayBuffer {
  const file = readFileSync(join(process.cwd(), 'public', 'assets', 'gary.usdz'));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

describe('the topology the file authored', () => {
  const authored = readAuthoredTopology(garyUsdz());

  it('finds every mesh in the character', () => {
    // 33 pieces, which is what the Scene tab counts.
    expect(authored.size).toBeGreaterThanOrEqual(33);
  });

  it('reads the body as the quads it was modelled as', () => {
    const body = authored.get('body_geo');
    expect(body).toBeDefined();
    expect(body!.faceVertexCounts).toHaveLength(25488);

    // Every face a quad. This is the number the heuristic could not reach.
    const quads = [...body!.faceVertexCounts].filter((n) => n === 4).length;
    expect(quads).toBe(25488);
  });

  it('agrees with itself about how many corners there are', () => {
    for (const [leaf, cage] of authored) {
      const corners = [...cage.faceVertexCounts].reduce((a, b) => a + b, 0);
      expect(cage.faceVertexIndices.length, `${leaf} corner count`).toBe(corners);
    }
  });

  it('never indexes a point that is not there', () => {
    for (const [leaf, cage] of authored) {
      const points = cage.positions.length / 3;
      let worst = -1;
      for (const index of cage.faceVertexIndices) {
        if (index > worst) worst = index;
      }
      expect(worst, `${leaf} out of range index`).toBeLessThan(points);
    }
  });

  it('carries a UV per corner where the file has them', () => {
    const body = authored.get('body_geo')!;
    expect(body.uvs).toBeDefined();
    expect(body.uvs!.length).toBe(body.faceVertexIndices.length * 2);
  });

  it('splits the body across its three material subsets, losing no face', () => {
    // The check that matters most. Material slots that do not line up with
    // their faces is not a subtle error: it made the body and the clothing
    // disappear outright once already.
    const body = authored.get('body_geo')!;
    expect(body.faceMaterialIndices).toBeDefined();
    expect(body.faceMaterialIndices!.length).toBe(25488);
    expect(body.trianglesPerSlot).toHaveLength(3);

    // Two triangles per quad, and every face accounted for exactly once.
    const total = body.trianglesPerSlot.reduce((a, b) => a + b, 0);
    expect(total).toBe(body.triangles);
    expect(body.triangles).toBe(25488 * 2);
  });

  it('reports the triangles the loaded geometry will have', () => {
    // How the cage is reconciled against what three built from the same file.
    // An n-gon cage and a triangulated mesh have no shared vertex numbering,
    // so triangles are the common currency.
    for (const [leaf, cage] of authored) {
      const implied = [...cage.faceVertexCounts].reduce((a, n) => a + (n - 2), 0);
      expect(cage.triangles, `${leaf} triangle count`).toBe(implied);
    }
  });

  it('returns nothing for a file that carries no topology', () => {
    expect(readAuthoredTopology(new ArrayBuffer(8)).size).toBe(0);
    expect(readAuthoredTopology('#usda 1.0\n').size).toBe(0);
  });
});
