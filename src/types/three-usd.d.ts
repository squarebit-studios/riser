// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// @types/three ships declarations for USDLoader but not for the parsers that
// sit under it, so this describes the slice of USDAParser we use.
//
// The shape mirrors three/examples/jsm/loaders/usd/USDAParser.js. If a three
// upgrade changes it, the round-trip tests in src/doc/usda.test.ts are what
// will tell us - they parse real generated output rather than a mock.
// ==========================================================================

declare module 'three/addons/loaders/usd/USDAParser.js' {
  /**
   * Matches the SpecType enum in USDAParser/USDCParser/USDComposer:
   * Attribute = 1, Prim = 6, Relationship = 8. Declared as a union rather
   * than a const enum because ambient const enums are unusable under
   * isolatedModules.
   */
  export type UsdSpecType = 1 | 6 | 8;

  export interface UsdSpecFields {
    /** Prim specs. */
    typeName?: string;
    primChildren?: string[];
    /** Raw `@asset@` strings, exactly as written in the layer. */
    references?: string[];
    payload?: string;
    xformOpOrder?: string[];
    variantSelection?: Record<string, string>;
    /** Attribute specs: the parsed value. */
    default?: unknown;
    timeSamples?: { times: number[]; values: unknown[] };
    connectionPaths?: string[];
    /** Relationship specs. */
    targetPaths?: string[];
    /** Stage metadata, present on the '/' spec only. */
    upAxis?: string;
    defaultPrim?: string;
    metersPerUnit?: number;
  }

  export interface UsdSpec {
    specType: number;
    fields: UsdSpecFields;
  }

  export interface UsdParseResult {
    specsByPath: Record<string, UsdSpec>;
  }

  export class USDAParser {
    parseText(text: string): Record<string, unknown>;
    parseData(text: string): UsdParseResult;
  }
}
