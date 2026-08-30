// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Colours shared between the 3D overlay and the React chrome. The hex values
// here are the twins of the `guide.*` and `curve.*` entries in
// tailwind.config.js - if you change one, change the other, or the checklist
// and the viewport will disagree about what "placed" looks like.
// ==========================================================================

export const GUIDE_COLORS = {
  unplaced: 0x5a616b,
  placed: 0x4ea3ff,
  /**
   * Auto-placed and not yet confirmed by a person. Deliberately a different
   * hue rather than a dimmer blue: the user needs to see at a glance which
   * markers are the app's guesses and still want checking.
   */
  suggested: 0x9b8cff,
  active: 0xffc447,
  hover: 0xffffff,
  error: 0xff5c5c
} as const;

export const CURVE_COLORS = {
  normal: 0x57e0a0,
  active: 0xffc447,
  point: 0x57e0a0,
  pointActive: 0xffc447
} as const;

export const VIEWPORT_COLORS = {
  background: 0x16181b,
  backgroundLight: 0xe9ebee,
  grid: 0x2b2f36,
  gridLight: 0xc8ccd2,
  gridAxis: 0x3d434c,
  gridAxisLight: 0xa8aeb6
} as const;

export type GuideVisualState = keyof typeof GUIDE_COLORS;
