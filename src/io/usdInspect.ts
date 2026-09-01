// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Reading a character's USD as USD, rather than as whatever three made of it.
//
// Riser normally shows the result: meshes, a skeleton, materials. That is the
// right thing almost always and it is useless for one recurring question,
// which is "is the thing I am looking for actually in this file". Answering it
// has meant writing a throwaway script every time, and the answers have been
// worth having:
//
//   - the eye look was in the file all along, 56 attributes per eye, and
//     nothing was reading it
//   - the quads were in the file, and were being guessed at from triangles
//   - the blend shapes were NOT in the file, which is a different problem
//     entirely from the panel being broken
//
// Every one of those was a minute of looking and hours of not looking. So this
// puts the crate on screen: prims, their types, their attributes, and the
// values, read from the same parse the eye looks and the topology already use.
//
// A READER, NOT AN EDITOR. Riser authors a layer that REFERENCES the character
// and never modifies it, and a panel that implied otherwise would be promising
// something the format deliberately does not do.
//
// VALUES ARE SUMMARISED, NOT HELD. Gary's crate has a quarter of a million
// joint weights in one attribute. Keeping every array so a panel can show a
// number would cost more memory than the character does, so arrays are
// described by type and length with a short prefix of their contents, which is
// what anybody actually reads.
// ==========================================================================

import { parseSpecs, type CrateSpec } from './eyeLook';

/** How many leading values of an array to keep for display. */
const PREVIEW = 8;

export interface UsdAttribute {
  name: string;
  /** The authored type, when the crate records one. */
  typeName: string | null;
  /** A short description of the value: a scalar, or a type and a length. */
  summary: string;
  /** First few entries of an array value, already formatted. */
  preview: string | null;
  interpolation: string | null;
}

export interface UsdPrim {
  path: string;
  name: string;
  /** Depth below the pseudo-root, for indenting without re-parsing paths. */
  depth: number;
  typeName: string | null;
  attributes: UsdAttribute[];
  /** True when any descendant exists, so the row can be expandable. */
  hasChildren: boolean;
}

/**
 * Every prim in a character file, in the order the crate lists them.
 *
 * Attribute specs live beside their prim as `<primPath>.<attributeName>`, so
 * this splits the spec table on that last dot and gathers the pieces.
 */
export function inspectUsd(source: ArrayBuffer | string): UsdPrim[] {
  const specs = parseSpecs(source);
  if (!specs) return [];

  const prims = new Map<string, UsdPrim>();
  const parents = new Set<string>();

  const primFor = (path: string): UsdPrim => {
    const existing = prims.get(path);
    if (existing) return existing;
    const created: UsdPrim = {
      path,
      name: path.slice(path.lastIndexOf('/') + 1) || '/',
      depth: Math.max(0, path.split('/').length - 2),
      typeName: null,
      attributes: [],
      hasChildren: false
    };
    prims.set(path, created);
    return created;
  };

  for (const [key, spec] of Object.entries(specs)) {
    const lastSlash = key.lastIndexOf('/');
    const dot = key.indexOf('.', lastSlash + 1);

    if (dot === -1) {
      // The prim itself.
      const prim = primFor(key);
      const type = spec?.fields?.typeName;
      if (typeof type === 'string') prim.typeName = type;
      if (lastSlash > 0) parents.add(key.slice(0, lastSlash));
      continue;
    }

    const primPath = key.slice(0, dot);
    const prim = primFor(primPath);
    prim.attributes.push(describe(key.slice(dot + 1), spec));
    if (primPath.lastIndexOf('/') > 0) {
      parents.add(primPath.slice(0, primPath.lastIndexOf('/')));
    }
  }

  for (const path of parents) {
    const prim = prims.get(path);
    if (prim) prim.hasChildren = true;
  }

  return [...prims.values()];
}

/** Prims whose path or any attribute name matches a query. */
export function searchPrims(prims: readonly UsdPrim[], query: string): UsdPrim[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...prims];
  return prims.filter(
    (prim) =>
      prim.path.toLowerCase().includes(needle) ||
      (prim.typeName?.toLowerCase().includes(needle) ?? false) ||
      prim.attributes.some((a) => a.name.toLowerCase().includes(needle))
  );
}

function describe(name: string, spec: CrateSpec | undefined): UsdAttribute {
  const fields = spec?.fields ?? {};
  const value = (fields as Record<string, unknown>).default;
  const typeName =
    typeof (fields as Record<string, unknown>).typeName === 'string'
      ? ((fields as Record<string, unknown>).typeName as string)
      : null;
  const interpolation =
    typeof (fields as Record<string, unknown>).interpolation === 'string'
      ? ((fields as Record<string, unknown>).interpolation as string)
      : null;

  return { name, typeName, interpolation, ...valueOf(value) };
}

function valueOf(value: unknown): { summary: string; preview: string | null } {
  if (value === undefined) return { summary: 'no authored value', preview: null };
  if (value === null) return { summary: 'null', preview: null };

  if (typeof value === 'string') return { summary: `"${value}"`, preview: null };
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { summary: String(value), preview: null };
  }

  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const array = value as unknown as { length: number; constructor: { name: string } };
    return {
      summary: `${array.constructor.name}[${array.length}]`,
      preview: prefix(Array.from(value as unknown as ArrayLike<number>))
    };
  }

  if (Array.isArray(value)) {
    return { summary: `array[${value.length}]`, preview: prefix(value) };
  }

  return { summary: typeof value, preview: null };
}

function prefix(values: unknown[]): string | null {
  if (values.length === 0) return null;
  const head = values.slice(0, PREVIEW).map((v) => {
    if (typeof v !== 'number') return String(v);
    // Long decimals are noise at a glance; the exact value is rarely the
    // question this panel is asked.
    return Number.isInteger(v) ? String(v) : v.toFixed(4);
  });
  return head.join(', ') + (values.length > PREVIEW ? ', ...' : '');
}
