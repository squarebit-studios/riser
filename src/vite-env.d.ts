

/** Injected by vite.config.ts from package.json. See src/app/version.ts. */
declare const __APP_VERSION__: string;

/**
 * three ships a USDC parser but no types for it. USDAParser is typed upstream;
 * the binary one is not, and Riser reads it directly to recover custom
 * attributes the composer has no reason to carry - see io/eyeLook.ts.
 */
declare module 'three/addons/loaders/usd/USDCParser.js' {
  export class USDCParser {
    parseData(buffer: ArrayBuffer): { specsByPath?: Record<string, unknown> };
  }
}

/** The vendored Squarebit Eye web module, copied verbatim as untyped JS. */
declare module '*/vendor/squarebit-eye/eye-material.js' {
  export function makeEyeUniforms(opts?: Record<string, unknown>): Record<string, unknown>;
  export function applyEyeShader(
    material: unknown,
    coreGlsl: string,
    eye: Record<string, unknown>,
    opts?: Record<string, unknown>
  ): void;
  export function updateProjector(
    eye: Record<string, unknown>,
    object3D: unknown,
    opts?: Record<string, unknown>
  ): void;
  export function updateEyeParams(eye: Record<string, unknown>, params: Record<string, unknown>): void;
  export function updateLightDir(eye: Record<string, unknown>, light: unknown): void;
}
