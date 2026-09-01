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
import { buildRefinedSurface, type SubdivMesh } from '@squarebit/subdivs-three';
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

/**
 * That the character's texture stays on the character once it is smoothed.
 *
 * Reading the authored UVs is only half of it. They then have to be REFINED
 * along with the mesh: a refined vertex moves toward the limit surface, and if
 * its UV does not move with it the texture slides, which is what "the UVs are
 * stretching when subd happens on Gary" was.
 *
 * The check is the one the plugin's fvar-consistency commandlet makes, run
 * against Gary's real body cage. Inside a UV island a vertex has exactly one
 * UV, so the UV of a refined vertex is predictable: apply the vertex's own
 * subdivision weights - the stencil row the surface already carries - to the
 * cage's UVs. If the UV channel is refined with the same rules as the
 * positions, the prediction is exact. Bilinear UVs miss it by 2.2e-3 in UV
 * space on this cage, which is about nine texels of a 4K map.
 */
describe('the authored UVs survive subdivision', () => {
  const authored = readAuthoredTopology(garyUsdz());

  /** Worst distance, in UV units, between a refined UV and where the vertex went. */
  function drift(cage: SubdivMesh, mode: 'smooth' | 'linear'): number {
    const V = cage.positions.length / 3;

    // The cage UV of each vertex, where every corner meeting there agrees.
    // Seam vertices carry more than one and are not predictable this way, so
    // anything refined from one is left out of the score.
    const u = new Float32Array(V);
    const v = new Float32Array(V);
    const seen = new Uint8Array(V);
    const seam = new Uint8Array(V);
    for (let c = 0; c < cage.faceVertexIndices.length; c++) {
      const at = cage.faceVertexIndices[c]!;
      const cu = cage.uvs![c * 2]!;
      const cv = cage.uvs![c * 2 + 1]!;
      if (!seen[at]) {
        seen[at] = 1;
        u[at] = cu;
        v[at] = cv;
      } else if (u[at] !== cu || v[at] !== cv) {
        seam[at] = 1;
      }
    }

    const surface = buildRefinedSurface({ ...cage, uvInterpolation: mode }, 1);
    const mesh = surface.mesh;
    const table = surface.table;
    let worst = 0;
    for (let c = 0; c < mesh.faceVertexIndices.length; c++) {
      const at = mesh.faceVertexIndices[c]!;
      let pu = 0;
      let pv = 0;
      let scorable = true;
      for (let o = table.offsets[at]!; o < table.offsets[at + 1]!; o++) {
        const source = table.indices[o]!;
        if (seam[source]) {
          scorable = false;
          break;
        }
        const weight = table.weights[o]!;
        pu += u[source]! * weight;
        pv += v[source]! * weight;
      }
      if (!scorable) continue;
      const err = Math.hypot(mesh.uvs![c * 2]! - pu, mesh.uvs![c * 2 + 1]! - pv);
      if (err > worst) worst = err;
    }
    return worst;
  }

  function bodyCage(): SubdivMesh {
    const body = authored.get('body_geo')!;
    return {
      positions: body.positions,
      faceVertexCounts: body.faceVertexCounts,
      faceVertexIndices: body.faceVertexIndices,
      uvs: body.uvs
    };
  }

  it('leaves the texture exactly where it was painted on the body', () => {
    // Float noise on 350k scored corners, against 2.2e-3 before the UVs were
    // refined rather than split.
    expect(drift(bodyCage(), 'smooth')).toBeLessThan(1e-5);
  });

  it('and would not, if the UVs were merely split per face', () => {
    // The control. Without it the test above cannot tell "the UVs are refined"
    // from "the measurement is looking at nothing".
    expect(drift(bodyCage(), 'linear')).toBeGreaterThan(1e-3);
  });
});
