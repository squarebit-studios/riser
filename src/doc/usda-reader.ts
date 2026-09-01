// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// USDA text -> RiserDocument.
//
// Built on three's USDAParser rather than a parser of our own. Writing a
// second USDA parser to read layers we wrote ourselves would be duplicated
// work with a new class of bug (a writer and reader that agree with each other
// but not with USD). Reusing the loader's parser means the text we produce is
// exercised by the same code path that reads third-party USD.
//
// The parser's value conventions, which this module exists to undo:
//   * `float3[]` and `point3f[]` come back FLATTENED - [(1,2,3),(4,5,6)]
//     parses to [1,2,3,4,5,6], so tuple arrays must be regrouped by three.
//   * `bool` has no special case and arrives as the string "true"/"false".
//   * Relationships live at `<primPath>.<relName>` with a `targetPaths` array.
//   * Asset paths keep their surrounding @ signs.
// ==========================================================================

import { USDAParser } from 'three/addons/loaders/usd/USDAParser.js';
import type { UsdSpec } from 'three/addons/loaders/usd/USDAParser.js';
import {
  DOC_VERSION,
  type Curve,
  type GuideSource,
  type CurvePoint,
  type Guide,
  type RiserDocument,
  type SurfaceBinding,
  type Vec3
} from './types';
import { PATHS } from './usda-writer';

const SPEC_PRIM = 6;

export class UsdaReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsdaReadError';
  }
}

type Specs = Record<string, UsdSpec>;

// -------------------------------------------------------------------------
// Spec accessors
// -------------------------------------------------------------------------

function attrValue(specs: Specs, primPath: string, name: string): unknown {
  return specs[`${primPath}.${name}`]?.fields?.default;
}

function relTarget(specs: Specs, primPath: string, name: string): string | null {
  const targets = specs[`${primPath}.${name}`]?.fields?.targetPaths;
  return targets && targets.length > 0 ? (targets[0] as string) : null;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number.parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return fallback;
}

function asVec3(value: unknown, fallback: Vec3 = [0, 0, 0]): Vec3 {
  if (Array.isArray(value) && value.length >= 3) {
    return [asNumber(value[0]), asNumber(value[1]), asNumber(value[2])];
  }
  return fallback;
}

const GUIDE_SOURCES: readonly GuideSource[] = [
  'user',
  'skeleton',
  'proportions',
  'landmarks'
];

function asGuideSource(value: unknown): GuideSource {
  const name = asString(value, 'user');
  return (GUIDE_SOURCES as readonly string[]).includes(name)
    ? (name as GuideSource)
    : 'user';
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => asNumber(v));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => asString(v));
}

/** Regroup a flattened `[x,y,z,x,y,z,...]` back into tuples. */
function groupVec3(flat: number[]): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    out.push([flat[i] as number, flat[i + 1] as number, flat[i + 2] as number]);
  }
  return out;
}

/** Child prim paths of `primPath`, in the order the layer declared them. */
function childPrimPaths(specs: Specs, primPath: string): string[] {
  const children = specs[primPath]?.fields?.primChildren;
  if (children && children.length > 0) {
    return children.map((name) => `${primPath}/${name}`);
  }
  // Fall back to scanning, in case a layer was hand-edited and lost its
  // primChildren bookkeeping.
  const prefix = `${primPath}/`;
  return Object.keys(specs).filter(
    (p) =>
      p.startsWith(prefix) &&
      !p.slice(prefix.length).includes('/') &&
      !p.includes('.') &&
      specs[p]?.specType === SPEC_PRIM
  );
}

// -------------------------------------------------------------------------
// Reader
// -------------------------------------------------------------------------

export function readUsda(text: string): RiserDocument {
  let specs: Specs;
  try {
    specs = new USDAParser().parseData(text).specsByPath as Specs;
  } catch (err) {
    throw new UsdaReadError(
      `Could not parse USDA: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!specs[PATHS.root]) {
    throw new UsdaReadError(
      `Not a Riser layer: no ${PATHS.root} prim. Found: ${Object.keys(specs)
        .filter((p) => !p.includes('.'))
        .slice(0, 8)
        .join(', ')}`
    );
  }

  const stage = specs['/']?.fields ?? {};

  const doc: RiserDocument = {
    docVersion: asString(attrValue(specs, PATHS.root, 'riser:docVersion'), DOC_VERSION),
    templateId: asString(attrValue(specs, PATHS.root, 'riser:template'), 'biped'),
    name: asString(attrValue(specs, PATHS.root, 'riser:name'), 'Untitled'),
    characterRef: readCharacterRef(specs),
    upAxis: stage.upAxis === 'Z' ? 'Z' : 'Y',
    metersPerUnit: asNumber(stage.metersPerUnit, 0.01),
    guides: readGuides(specs),
    curves: readCurves(specs)
  };

  return doc;
}

function readCharacterRef(specs: Specs): string {
  const refs = specs[PATHS.character]?.fields?.references;
  const raw = refs && refs.length > 0 ? String(refs[0]) : '';
  // The parser hands back the literal `@path@` form for references.
  return raw.replace(/^@/, '').replace(/@$/, '').trim();
}

function readGuides(specs: Specs): Guide[] {
  const guides: Guide[] = [];
  for (const path of childPrimPaths(specs, PATHS.guides)) {
    const id = asString(attrValue(specs, path, 'riser:guide:id'));
    if (!id) continue; // Not one of ours; leave it alone rather than guess.
    guides.push({
      id,
      group: asString(attrValue(specs, path, 'riser:guide:group')),
      position: asVec3(attrValue(specs, path, 'xformOp:translate')),
      normal: asVec3(attrValue(specs, path, 'riser:guide:normal'), [0, 1, 0]),
      binding: readBinding(specs, path, 'riser:guide'),
      // A layer written before provenance existed has no source attribute.
      // Reading those as `user` is the safe default: it means a later
      // auto-placement pass leaves them alone rather than overwriting work
      // whose origin we cannot establish.
      source: asGuideSource(attrValue(specs, path, 'riser:guide:source')),
      confidence: asNumber(attrValue(specs, path, 'riser:guide:confidence'), 1)
    });
  }
  return guides;
}

function readBinding(specs: Specs, path: string, ns: string): SurfaceBinding | null {
  const bound = asString(attrValue(specs, path, `${ns}:bound`), 'none');
  if (bound !== 'surface') return null;

  const primPath = relTarget(specs, path, `${ns}:bindPrim`);
  const faceIndex = asNumber(attrValue(specs, path, `${ns}:faceIndex`), -1);
  if (primPath === null || faceIndex < 0) return null;

  return {
    primPath,
    faceIndex: Math.round(faceIndex),
    barycentric: asVec3(attrValue(specs, path, `${ns}:barycentric`)),
    offset: asVec3(attrValue(specs, path, `${ns}:offset`))
  };
}

function readCurves(specs: Specs): Curve[] {
  const curves: Curve[] = [];

  for (const path of childPrimPaths(specs, PATHS.curves)) {
    const id = asString(attrValue(specs, path, 'riser:curve:id'));
    if (!id) continue;

    // An open curve repeats its first and last point, because a cubic USD
    // curve spends those as tangents rather than positions. Those two are the
    // format's, not the user's, and everything else here is indexed per
    // authored vertex.
    const duplicated = asBool(
      attrValue(specs, path, 'riser:curve:endsDuplicated')
    );
    const rawPositions = groupVec3(
      asNumberArray(attrValue(specs, path, 'points'))
    );
    const positions =
      duplicated && rawPositions.length > 2
        ? rawPositions.slice(1, -1)
        : rawPositions;
    const normals = groupVec3(
      asNumberArray(attrValue(specs, path, 'riser:curve:normals'))
    );
    const bindPrims = asStringArray(attrValue(specs, path, 'riser:curve:bindPrims'));
    const faceIndices = asNumberArray(
      attrValue(specs, path, 'riser:curve:faceIndices')
    );
    const barycentrics = groupVec3(
      asNumberArray(attrValue(specs, path, 'riser:curve:barycentrics'))
    );
    const offsets = groupVec3(asNumberArray(attrValue(specs, path, 'riser:curve:offsets')));

    const points: CurvePoint[] = positions.map((position, i) => {
      const primPath = bindPrims[i] ?? '';
      const faceIndex = faceIndices[i] ?? -1;
      const bound = primPath !== '' && faceIndex >= 0;
      return {
        position,
        normal: normals[i] ?? [0, 1, 0],
        binding: bound
          ? {
              primPath,
              faceIndex: Math.round(faceIndex),
              barycentric: barycentrics[i] ?? [0, 0, 0],
              offset: offsets[i] ?? [0, 0, 0]
            }
          : null
      };
    });

    const widths = asNumberArray(attrValue(specs, path, 'widths'));

    curves.push({
      id,
      group: asString(attrValue(specs, path, 'riser:curve:group')),
      points,
      closed: asBool(attrValue(specs, path, 'riser:curve:closed')),
      width: widths[0] ?? 0.01
    });
  }

  return curves;
}

/** True if `text` looks like a layer this app wrote. Cheap enough to run on paste. */
export function isRiserLayer(text: string): boolean {
  return text.includes('riser:docVersion') || text.includes(`def Xform "Riser"`);
}
