// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Bundled characters.
//
// Having something to click on from the first second matters more than it
// sounds: without a stock asset the app opens on an empty grid, and every tool
// in it is inert until the user finds a file. These also give the automated
// tests a known character with known geometry to assert against.
// ==========================================================================

export interface StockCharacter {
  label: string;
  /** Served from public/, so the path is absolute from the site root. */
  url: string;
  templateId: string;
  credit?: string;
}

export const STOCK_CHARACTERS: readonly StockCharacter[] = [
  {
    label: 'Biped (blockout)',
    url: '/assets/biped-blockout.usda',
    templateId: 'biped'
  },
  {
    label: 'Quadruped (blockout)',
    url: '/assets/quadruped-blockout.usda',
    templateId: 'quadruped'
  },
  {
    // Carries a real UsdSkel skeleton, so the nearest-joint hint in the
    // inspector has something to report and the skinned-mesh load path gets
    // exercised by something other than a unit test.
    label: 'Biped (rigged)',
    url: '/assets/biped-rigged.usda',
    templateId: 'biped'
  },
  {
    // The only bundled asset that MOVES.
    //
    // Same body and same joint names as the rigged USD above, which is the
    // point: it gives the Animation tab something real to play, and it gives
    // the clip matcher a file whose tracks are known to fit one stock
    // character and known not to fit the unrigged blockout.
    label: 'Biped (animated)',
    url: '/assets/biped-walk.gltf',
    templateId: 'biped'
  },
  {
    // A production character, converted from Maya with tools/mb-to-usd.py.
    //
    // Worth bundling because it is the first asset here that was not built to
    // be measured: 33 meshes, an A-pose rather than a T-pose, a 482-joint rig,
    // and clothing layered over skin. The blockouts are clean in ways real
    // work is not, and every one of those differences has already caught a bug
    // that the blockouts could not.
    //
    // USDZ rather than USDC, and not for compression: three only reads
    // textures out of a USD when it is a USDZ. For a plain .usdc the loader's
    // asset table is empty and every texture resolves to null, so the same
    // character arrives untextured. See USDComposer's `_loadTexture`.
    label: 'Gary',
    url: '/assets/gary.usdz',
    templateId: 'biped'
  }
];

/** Characters that carry a skeleton. Used by tests, and by the UI copy. */
export const RIGGED_STOCK_URLS: readonly string[] = [
  '/assets/biped-rigged.usda',
  '/assets/gary.usdz'
];
