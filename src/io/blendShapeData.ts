// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Blend shapes, read from the USD the character came in.
//
// Three's USD composer reads skinning and does not read blend shapes at all -
// not one mention of them in its 4,594 lines - so a character can arrive with
// a face rig's worth of shapes and no sign of them in the viewport. This reads
// them out of the crate directly, the same way the eye look and the authored
// topology are read.
//
// SPARSE ON BOTH SIDES, ON PURPOSE. Maya stores a target as deltas beside the
// components they apply to, and UsdSkel stores exactly the same thing as
// `offsets` beside `pointIndices`. Keeping that shape all the way through is
// what makes this affordable: the body carries 878 targets against 152,928
// render vertices, which as three morph targets would want a dense delta per
// vertex per target and come to roughly 1.6GB for one mesh. Sparse it is a few
// megabytes, and applying a shape costs only the points it actually moves.
//
// NAMES ARE SHARED, AND THAT IS THE POINT. The same shape lives on several
// meshes: 462 of this character's 932 names appear on more than one, because a
// jaw shape has to move the gums and the teeth along with the face. They are
// read as one name so one control can drive all of them.
// ==========================================================================

import { parseSpecs, type CrateSpec } from './eyeLook';

/** One shape's effect on one mesh. */
export interface BlendShapeDelta {
  /** The shape's name, shared with every other mesh that carries it. */
  name: string;
  /** Which of the mesh's authored points move. */
  pointIndices: Uint32Array;
  /** xyz per moved point, in the file's own units. */
  offsets: Float32Array;
}

/**
 * Every mesh's blend shapes, keyed by leaf prim name.
 *
 * Keyed on the leaf for the same reason the eye looks and the topology are:
 * the path a character has inside Riser is not the path it had in its file.
 */
export function readBlendShapes(
  source: ArrayBuffer | string
): Map<string, BlendShapeDelta[]> {
  const specs = parseSpecs(source);
  const out = new Map<string, BlendShapeDelta[]>();
  if (!specs) return out;

  for (const [key, spec] of Object.entries(specs)) {
    if (!key.endsWith('.skel:blendShapes')) continue;

    const meshPath = key.slice(0, -'.skel:blendShapes'.length);
    const leaf = meshPath.slice(meshPath.lastIndexOf('/') + 1);
    const names = strings(spec);
    if (!names || names.length === 0) continue;

    const targets = targetPaths(specs[`${meshPath}.skel:blendShapeTargets`]);
    const shapes: BlendShapeDelta[] = [];

    for (let i = 0; i < names.length; i++) {
      // The target list says where each shape lives. Without one they are
      // assumed to be children named after themselves, which is the UsdSkel
      // convention and what this exporter writes.
      const path = targets?.[i] ?? `${meshPath}/${names[i]}`;
      const shape = shapeAt(specs, path, names[i]!);
      if (shape) shapes.push(shape);
    }

    if (shapes.length > 0) out.set(leaf, shapes);
  }
  return out;
}

/** Every distinct shape name across a character, in the order first seen. */
export function shapeNames(
  shapes: ReadonlyMap<string, readonly BlendShapeDelta[]>
): string[] {
  const seen = new Set<string>();
  for (const list of shapes.values()) {
    for (const shape of list) seen.add(shape.name);
  }
  return [...seen];
}

function shapeAt(
  specs: Record<string, CrateSpec>,
  path: string,
  name: string
): BlendShapeDelta | null {
  const offsets = numbers(specs[`${path}.offsets`]);
  if (!offsets || offsets.length === 0 || offsets.length % 3 !== 0) return null;
  const moved = offsets.length / 3;

  const indices = numbers(specs[`${path}.pointIndices`]);
  if (indices) {
    // The two halves have to describe the same points, or the shape would be
    // applied to the wrong part of the face.
    if (indices.length !== moved) return null;
    return {
      name,
      pointIndices: new Uint32Array(indices),
      offsets: new Float32Array(offsets)
    };
  }

  // No indices means the shape is dense: one offset per point, in order.
  const dense = new Uint32Array(moved);
  for (let i = 0; i < moved; i++) dense[i] = i;
  return { name, pointIndices: dense, offsets: new Float32Array(offsets) };
}

function targetPaths(spec: CrateSpec | undefined): string[] | null {
  const fields = (spec?.fields ?? {}) as Record<string, unknown>;
  const targets = fields.targetPaths;
  if (!Array.isArray(targets)) return null;
  return targets.map((t) => String(t));
}

function strings(spec: CrateSpec | undefined): string[] | null {
  const value = spec?.fields?.default;
  if (!Array.isArray(value)) return null;
  return value.map((v) => String(v));
}

function numbers(spec: CrateSpec | undefined): number[] | null {
  const value = spec?.fields?.default;
  if (Array.isArray(value)) {
    // A Vec3f array arrives as triples rather than as a flat run.
    if (value.length > 0 && Array.isArray(value[0])) {
      const flat: number[] = [];
      for (const entry of value as unknown as number[][]) {
        flat.push(entry[0]!, entry[1]!, entry[2]!);
      }
      return flat;
    }
    return value.every((v) => typeof v === 'number') ? (value as number[]) : null;
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<number>);
  }
  return null;
}
