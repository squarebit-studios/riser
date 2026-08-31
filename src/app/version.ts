// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The running version, baked in at build time from package.json.
//
// One import for anything that shows a version. package.json is the source of
// truth and vite.config.ts substitutes it; nothing here keeps its own copy,
// which is how the old version.json managed to sit two releases behind
// package.json without anyone noticing.
// ==========================================================================

declare const __APP_VERSION__: string;

/** Semantic version of this build, e.g. "0.6.0". */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
