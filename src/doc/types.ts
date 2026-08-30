// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The Riser document model.
//
// This module is deliberately free of any three.js import. The document is
// plain data that serializes to a USD layer and is re-read by OpenUSD on the
// server, so nothing in here may depend on the renderer.
// ==========================================================================

export type Vec3 = readonly [number, number, number];

/** Current schema version written into the USD layer as `riser:docVersion`. */
export const DOC_VERSION = '1.0.0';

/**
 * Where a guide or curve point sits ON THE CHARACTER, as opposed to where it
 * sits in space.
 *
 * This is the load-bearing idea of the whole format. A bare position is only
 * meaningful for the exact mesh it was picked on: retopologise the character,
 * swap it for a higher-resolution variant, or change its scale and the position
 * is silently wrong. A binding survives all three, because the server recovers
 * the point by evaluating the barycentric coordinate against whatever geometry
 * the reference resolves to.
 *
 * `faceIndex` indexes the TRIANGLE, matching three.js `Intersection.faceIndex`
 * on the indexed BufferGeometry we load. The worker triangulates the USD mesh
 * the same way before evaluating (see worker/riser_worker/binding.py).
 */
export interface SurfaceBinding {
  /** USD prim path of the bound mesh, e.g. `/Riser/Character/Geom/Body`. */
  primPath: string;
  /** Triangle index within that mesh. */
  faceIndex: number;
  /** Barycentric coordinate inside the triangle; components sum to 1. */
  barycentric: Vec3;
  /**
   * Displacement from the evaluated surface point, in character-local units.
   * Zero for on-surface guides. Non-zero for guides that belong INSIDE the
   * volume - hip, shoulder and elbow centres are not surface features, so the
   * user lifts them off the skin along the normal and we record by how much.
   */
  offset: Vec3;
}

/**
 * Where a guide's position came from.
 *
 * This is not bookkeeping. Auto-placement runs repeatedly - on load, on a
 * template change, when the user asks again - and it must never overwrite a
 * position someone placed by hand. Without provenance the only safe options
 * are to never re-run it or to always clobber, and both are wrong.
 *
 * It also tells the server what to trust: a guide the app guessed deserves
 * different treatment from one a person confirmed.
 *
 *   user         placed or adjusted by hand. Never overwritten.
 *   skeleton     taken from the asset's own rig. Exact, when there is one.
 *   proportions  fitted from the mesh's shape and standard proportions.
 *   landmarks    predicted by a vision model.
 */
export type GuideSource = 'user' | 'skeleton' | 'proportions' | 'landmarks';

/** A single named guide marker from the active template. */
export interface Guide {
  /** Template guide id, e.g. `wristL`. Unique within a document. */
  id: string;
  /** Template group, e.g. `armL`. Used for checklist grouping only. */
  group: string;
  /** Resolved position in character-local space. Derived from `binding`. */
  position: Vec3;
  /** Surface normal at the pick, used to orient the marker. */
  normal: Vec3;
  /**
   * Null when the guide was placed free in space rather than on the mesh -
   * legal, but the server can only take `position` at face value in that case.
   */
  binding: SurfaceBinding | null;
  /** How this position was arrived at. Defaults to `user`. */
  source: GuideSource;
  /**
   * How much the source trusts it, 0..1. Always 1 for `user` - a person
   * putting a marker somewhere is the definition of certain.
   */
  confidence: number;
}

/** One control vertex of a curve. */
export interface CurvePoint {
  position: Vec3;
  normal: Vec3;
  binding: SurfaceBinding | null;
}

/** A named curve laid along the character's surface. */
export interface Curve {
  id: string;
  group: string;
  points: CurvePoint[];
  closed: boolean;
  /** Curve width in character-local units; written as USD `widths`. */
  width: number;
}

/** The complete authored document. Serializes 1:1 to a USD layer. */
export interface RiserDocument {
  docVersion: string;
  /** Id of the template this document was authored against, e.g. `biped`. */
  templateId: string;
  /**
   * Asset reference written into the layer as `prepend references = @...@`.
   * Relative when the asset sits beside the layer, absolute URI otherwise.
   */
  characterRef: string;
  /** Display name for the document. */
  name: string;
  upAxis: 'Y' | 'Z';
  metersPerUnit: number;
  guides: Guide[];
  curves: Curve[];
}

// -------------------------------------------------------------------------
// Templates
// -------------------------------------------------------------------------

/** One entry in a template's guide checklist. */
export interface GuideDef {
  id: string;
  group: string;
  label: string;
  /** Shown in the UI while this guide is the active one. */
  hint?: string;
  optional?: boolean;
  /**
   * Id of the mirrored counterpart. When symmetry is on, placing one places
   * the other across the character's symmetry plane.
   */
  mirror?: string;
  /** True for guides that belong inside the volume rather than on the skin. */
  interior?: boolean;
}

/** One entry in a template's curve checklist. */
export interface CurveDef {
  id: string;
  group: string;
  label: string;
  hint?: string;
  optional?: boolean;
  closed?: boolean;
  mirror?: string;
  /** Suggested control vertex count; the user is not held to it. */
  suggestedPoints?: number;
}

/** A named rig layout: what the user is asked to place, and in what order. */
export interface TemplateDef {
  id: string;
  label: string;
  description: string;
  /** Group ids in checklist order, with their display labels. */
  groups: { id: string; label: string }[];
  guides: GuideDef[];
  curves: CurveDef[];
}

// -------------------------------------------------------------------------
// Construction and lookup
// -------------------------------------------------------------------------

export const ZERO3: Vec3 = [0, 0, 0];

export function createDocument(
  templateId: string,
  characterRef: string,
  options: Partial<Pick<RiserDocument, 'name' | 'upAxis' | 'metersPerUnit'>> = {}
): RiserDocument {
  return {
    docVersion: DOC_VERSION,
    templateId,
    characterRef,
    name: options.name ?? 'Untitled',
    upAxis: options.upAxis ?? 'Y',
    metersPerUnit: options.metersPerUnit ?? 0.01,
    guides: [],
    curves: []
  };
}

/** True for a guide the user placed or adjusted, which must not be overwritten. */
export function isUserPlaced(guide: Guide): boolean {
  return guide.source === 'user';
}

/**
 * Guides that automatic placement is allowed to replace.
 *
 * Everything except the ones a person put there. Re-running a fit should
 * improve its own previous guesses and leave hand work alone.
 */
export function autoReplaceableIds(doc: RiserDocument): Set<string> {
  return new Set(doc.guides.filter((g) => !isUserPlaced(g)).map((g) => g.id));
}

export function findGuide(doc: RiserDocument, id: string): Guide | undefined {
  return doc.guides.find((g) => g.id === id);
}

export function findCurve(doc: RiserDocument, id: string): Curve | undefined {
  return doc.curves.find((c) => c.id === id);
}

/**
 * Template ids the user has not placed yet, in template order. Drives both the
 * checklist progress and "advance to the next guide" after a placement.
 */
export function unplacedGuideIds(
  doc: RiserDocument,
  template: TemplateDef,
  includeOptional = true
): string[] {
  const placed = new Set(doc.guides.map((g) => g.id));
  return template.guides
    .filter((d) => (includeOptional || !d.optional) && !placed.has(d.id))
    .map((d) => d.id);
}

/** Fraction of required guides placed, in [0, 1]. */
export function guideProgress(doc: RiserDocument, template: TemplateDef): number {
  const required = template.guides.filter((d) => !d.optional);
  if (required.length === 0) return 1;
  const placed = new Set(doc.guides.map((g) => g.id));
  const done = required.filter((d) => placed.has(d.id)).length;
  return done / required.length;
}
