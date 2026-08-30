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
  }
];
