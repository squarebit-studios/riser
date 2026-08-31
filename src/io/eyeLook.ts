// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Reading Squarebit Eye look settings out of a USD file.
//
// WHY THIS EXISTS. A Squarebit Eye is a refracted iris projection: the visible
// iris is not painted on the surface, it is seen THROUGH a cornea with an
// index of refraction. `UsdPreviewSurface` has no way to express that, so a
// character exported with real eyes arrives in any USD viewer as a pair of
// white spheres - which is exactly what Riser was showing.
//
// The look itself is not lost. tools/mb-to-usd.py writes the full shipping
// interop set as `squarebitEye:*` attributes on each eye prim, 56 of them, and
// this reads them back. Riser then hands them to the Squarebit Eye web
// material, which is the same shader the store's Eye widget runs.
//
// WHY IT PARSES THE FILE AGAIN. three's USD composer builds meshes and
// materials; it has no reason to carry custom attributes onto the objects it
// produces, and it does not. The attributes are in the crate, so this reads
// them with three's own parser - the same approach `doc/usda-reader.ts` takes
// for Riser's own `riser:` attributes, and for the same reason: writing a
// second USD parser to read files we wrote ourselves would be a way to
// disagree with the loader rather than a way to be independent of it.
//
// STRUCTURE OF THE CRATE, which is not obvious. A prim spec lists its
// attribute NAMES in `fields.properties`; each attribute is then its own spec
// at `<primPath>.<attributeName>`, carrying `typeName` and `default`. Reading
// the prim alone finds the names and none of the values.
// ==========================================================================

import { USDAParser } from 'three/addons/loaders/usd/USDAParser.js';
import { USDCParser } from 'three/addons/loaders/usd/USDCParser.js';

/** The namespace the Eye interop format writes under. See SquarebitEye SPEC. */
const PREFIX = 'squarebitEye:';

/** Identifies the interop version, so a future format change is detectable. */
export const EYE_SPEC_ATTRIBUTE = `${PREFIX}spec`;

export interface EyeLook {
  /** Prim path of the eye mesh this look belongs to. */
  primPath: string;
  /**
   * Look settings, keyed WITHOUT the namespace - `ior`, `corneaRadius` - which
   * is how the web module's params are named.
   */
  params: Record<string, number | string | number[]>;
}

interface CrateSpec {
  specType?: unknown;
  fields?: Record<string, unknown>;
}

/**
 * Every eye look in a USD file.
 *
 * Returns an empty array for a file with no eyes, which is the common case and
 * is not an error - most characters do not carry a Squarebit Eye.
 */
export function readEyeLooks(source: ArrayBuffer | string): EyeLook[] {
  const table = parseSpecs(source);
  if (!table) return [];

  // Attributes live at `<prim>.<name>`, so the prims carrying a look are the
  // ones with at least one such attribute beneath them.
  const byPrim = new Map<string, Record<string, number | string | number[]>>();

  for (const path of Object.keys(table)) {
    const dot = path.lastIndexOf('.');
    if (dot === -1) continue;

    const name = path.slice(dot + 1);
    if (!name.startsWith(PREFIX)) continue;

    const value = valueOf(table[path]);
    if (value === undefined) continue;

    const primPath = path.slice(0, dot);
    let params = byPrim.get(primPath);
    if (!params) {
      params = {};
      byPrim.set(primPath, params);
    }
    params[name.slice(PREFIX.length)] = value;
  }

  return [...byPrim.entries()]
    .map(([primPath, params]) => ({ primPath, params }))
    .sort((a, b) => a.primPath.localeCompare(b.primPath));
}

/**
 * The look for a prim path, or null when it carries none.
 *
 * Matched on the LEAF NAME, not the whole path. The look's path is the one
 * authored in the file (`/gary/trs_master/.../eye_l_geo`), while the mesh
 * carries the path Riser assigns on load (`/Riser/Character/...`). Comparing
 * whole paths therefore never matches, which is exactly how this first
 * shipped: the looks were read correctly and applied to nothing.
 *
 * A leaf name is unique enough here in practice - a character does not carry
 * two prims called `eye_l_geo` - and it survives the reparenting that
 * referencing an asset into a layer performs.
 */
export function eyeLookFor(looks: readonly EyeLook[], primPath: string): EyeLook | null {
  if (!primPath) return null;
  const exact = looks.find((look) => look.primPath === primPath);
  if (exact) return exact;

  const leaf = leafOf(primPath);
  return looks.find((look) => leafOf(look.primPath) === leaf) ?? null;
}

function leafOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

/**
 * Whether a look is complete enough to drive the shader.
 *
 * The spec marker is the honest test: a file carrying a handful of stray
 * `squarebitEye:` attributes without it is not a look, and building a material
 * from it would produce something confidently wrong.
 */
export function isUsableLook(look: EyeLook): boolean {
  return typeof look.params.spec === 'string' && Object.keys(look.params).length > 8;
}

// -------------------------------------------------------------------------

/**
 * The crate bytes inside a USDZ.
 *
 * A USDZ is an uncompressed zip holding a `.usdc` and its textures, so the
 * bytes handed to a crate parser have to be the INNER file. Passing the
 * archive itself parses to nothing, silently - which is exactly how this first
 * shipped: the unit test unzipped by hand and passed, while the running app
 * fed the parser a zip and found no eyes at all.
 *
 * Read by scanning local file headers rather than with a zip library, because
 * USDZ mandates stored (uncompressed) entries: the payload is already there,
 * and inflating is not needed.
 */
function crateInsideUsdz(source: ArrayBuffer): ArrayBuffer | null {
  const bytes = new Uint8Array(source);
  const view = new DataView(source);
  // "PK"
  if (bytes.length < 30 || view.getUint32(0, true) !== 0x04034b50) return null;

  for (let at = 0; at + 30 < bytes.length; at++) {
    if (view.getUint32(at, true) !== 0x04034b50) continue;

    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(
      bytes.subarray(at + 30, at + 30 + nameLength)
    );
    if (!/\.usdc?$/i.test(name)) continue;

    const size = view.getUint32(at + 22, true);
    const start = at + 30 + nameLength + extraLength;
    if (size === 0 || start + size > bytes.length) continue;
    return source.slice(start, start + size);
  }
  return null;
}

function parseSpecs(source: ArrayBuffer | string): Record<string, CrateSpec> | null {
  try {
    if (typeof source === 'string') {
      const parser = new USDAParser() as unknown as {
        parseText: (text: string) => { specsByPath?: Record<string, CrateSpec> };
      };
      const parsed = parser.parseText(source);
      return parsed?.specsByPath ?? (parsed as Record<string, CrateSpec>) ?? null;
    }

    const parser = new USDCParser() as unknown as {
      parseData: (buffer: ArrayBuffer) => { specsByPath?: Record<string, CrateSpec> };
    };
    const parsed = parser.parseData(crateInsideUsdz(source) ?? source);
    return parsed?.specsByPath ?? (parsed as Record<string, CrateSpec>) ?? null;
  } catch {
    // A file this cannot parse is one three could not have loaded either, so
    // the character is already failing more visibly elsewhere. Eyes are not
    // worth a second error about it.
    return null;
  }
}

/**
 * The authored value of an attribute spec.
 *
 * `default` is where a non-animated attribute's value lives in the crate.
 * Anything else - a time-sampled attribute, a connection - is skipped rather
 * than guessed at, because a look built from half-understood values would be
 * worse than no look at all.
 */
function valueOf(spec: CrateSpec | undefined): number | string | number[] | undefined {
  const value = spec?.fields?.default;
  if (typeof value === 'number' || typeof value === 'string') return value;

  if (Array.isArray(value) && value.every((v) => typeof v === 'number')) {
    return value as number[];
  }
  // Typed arrays are how the crate stores vectors and matrices.
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<number>);
  }
  return undefined;
}
