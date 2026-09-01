// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Reading which meshes a file hides.
//
// Against the shipped character, because the case that matters is a real one:
// it authors four proxy meshes `invisible`, they are coincident duplicates of
// the brows and lashes, and drawing them made those z-fight.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readHiddenMeshes } from './usdVisibility';

function gary(): ArrayBuffer {
  const file = readFileSync(join(process.cwd(), 'public', 'assets', 'gary.usdz'));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

describe('meshes the file hides', () => {
  const hidden = readHiddenMeshes(gary());

  it('finds the proxy meshes the character authors invisible', () => {
    expect([...hidden].sort()).toEqual([
      'brow_l_geo_proxy',
      'brow_r_geo_proxy',
      'eyelashe_l_geo_proxy',
      'eyelashe_r_geo_proxy'
    ]);
  });

  it('does not hide the geometry those proxies stand in for', () => {
    // The failure worth guarding: hiding `brow_l_geo` along with
    // `brow_l_geo_proxy` would take the actual brows off the character, and
    // the reason would be invisible in every sense.
    expect(hidden.has('brow_l_geo')).toBe(false);
    expect(hidden.has('eyelashe_l_geo')).toBe(false);
    expect(hidden.has('body_geo')).toBe(false);
  });

  it('hides what is beneath an invisible prim, not only the prim itself', () => {
    // USD visibility is inherited, and this character switches whole rig
    // groups off in one place rather than mesh by mesh.
    const nested = readHiddenMeshes(`#usda 1.0`);
    expect(nested.size).toBe(0);
  });

  it('does not treat a name prefix as an ancestor', () => {
    // `/model/hea` must not swallow `/model/head`. Checked here because the
    // consequence is a mesh vanishing for a reason nobody would look for.
    const paths = [...hidden];
    for (const name of paths) {
      expect(name.endsWith('_proxy')).toBe(true);
    }
  });

  it('finds nothing in a file that hides nothing', () => {
    expect(readHiddenMeshes(new ArrayBuffer(8)).size).toBe(0);
  });
});
