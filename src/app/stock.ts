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
  }
];

/** Characters that carry a skeleton. Used by tests, and by the UI copy. */
export const RIGGED_STOCK_URLS: readonly string[] = ['/assets/biped-rigged.usda'];
