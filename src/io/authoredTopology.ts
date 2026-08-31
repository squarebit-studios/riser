// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The polygons the artist actually modelled, read from the file.
//
// USD stores a mesh as n-gons: `faceVertexCounts` and `faceVertexIndices` say,
// exactly, that Gary's body is 25,488 quads. Three's USD loader triangulates
// on the way in and throws that away, so by the time Riser has a
// BufferGeometry the quads are gone and only 50,976 triangles remain.
//
// That matters because subdivision is defined on the CAGE. Catmull-Clark puts
// an extraordinary vertex at the centre of every non-quad face, so subdividing
// a triangulated copy of a quad mesh gives a different surface from the one
// the artist saw in Maya, and a wireframe full of diagonals nobody drew.
//
// The previous answer was `recoverQuads`, which pairs triangles back up by
// looking at them. It is a good heuristic and it is not the file: on Gary's
// body it recovered 28,246 faces where the file says 25,488, so roughly 11% of
// the mesh stayed triangles. Those are the slivers that showed up across his
// cheek. Every mesh in the character was affected except the belt and the two
// eyeballs.
//
// So this reads the topology from the source, the way the Unreal plugin does.
// The heuristic stays as the fallback for files that arrive without it, which
// is every glTF, FBX and OBJ, and any USD Riser cannot line up confidently.
//
// LINING UP IS CHECKED, NOT ASSUMED. The authored data describes the same
// surface as the loaded geometry, but nothing enforces that, and getting it
// wrong is not a subtle error: material slots that do not match their faces
// made Gary's body and clothing disappear entirely once before. So every mesh
// is verified against the geometry three built - triangle counts overall, and
// per material subset - and anything that does not reconcile falls back rather
// than being drawn wrong.
// ==========================================================================

import { parseSpecs, type CrateSpec } from './eyeLook';

/** A cage exactly as the file authored it. */
export interface AuthoredCage {
  /** xyz per point, in the file's own units. */
  positions: Float32Array;
  faceVertexCounts: Uint32Array;
  /** Flattened corners, `sum(faceVertexCounts)` of them. */
  faceVertexIndices: Uint32Array;
  /** Face-varying UVs, 2 per corner, when the file carries them. */
  uvs?: Float32Array;
  /** Material slot per face, when the mesh is split into subsets. */
  faceMaterialIndices?: Uint32Array;
  /** Triangles this cage implies, for reconciling against the loaded mesh. */
  triangles: number;
  /** Triangles per material slot, in slot order. */
  trianglesPerSlot: number[];
}

/**
 * Read every mesh's authored topology, keyed by leaf prim name.
 *
 * Keyed on the leaf rather than the full path for the same reason the eye
 * looks are: the path a character has inside Riser is not the path it had in
 * the file, because the asset is referenced under `/Riser/Character`. A leaf
 * that appears more than once is dropped rather than guessed at.
 */
export function readAuthoredTopology(
  source: ArrayBuffer | string
): Map<string, AuthoredCage> {
  const specs = parseSpecs(source);
  const out = new Map<string, AuthoredCage>();
  if (!specs) return out;

  const ambiguous = new Set<string>();
  const paths = meshPaths(specs);

  for (const path of paths) {
    const leaf = path.slice(path.lastIndexOf('/') + 1);
    if (out.has(leaf)) {
      // Two meshes with the same name, and no way to tell which is which.
      ambiguous.add(leaf);
      continue;
    }
    const cage = cageAt(specs, path);
    if (cage) out.set(leaf, cage);
  }
  for (const leaf of ambiguous) out.delete(leaf);
  return out;
}

/** Prim paths that carry a face topology. */
function meshPaths(specs: Record<string, CrateSpec>): string[] {
  const paths: string[] = [];
  for (const key of Object.keys(specs)) {
    if (!key.endsWith('.faceVertexCounts')) continue;
    paths.push(key.slice(0, -'.faceVertexCounts'.length));
  }
  return paths;
}

function cageAt(
  specs: Record<string, CrateSpec>,
  path: string
): AuthoredCage | null {
  const counts = numbers(specs[`${path}.faceVertexCounts`]);
  const indices = numbers(specs[`${path}.faceVertexIndices`]);
  const points = numbers(specs[`${path}.points`]);
  if (!counts || !indices || !points) return null;
  if (counts.length === 0 || indices.length === 0 || points.length < 9) return null;

  // The corners have to add up. A file that disagrees with itself is not one
  // to build a surface from.
  let corners = 0;
  let triangles = 0;
  for (let i = 0; i < counts.length; i++) {
    const n = counts[i]!;
    if (n < 3) return null;
    corners += n;
    triangles += n - 2;
  }
  if (corners !== indices.length) return null;

  const pointCount = Math.floor(points.length / 3);
  for (let i = 0; i < indices.length; i++) {
    const index = indices[i]!;
    if (index < 0 || index >= pointCount) return null;
  }

  const cage: AuthoredCage = {
    positions: new Float32Array(points),
    faceVertexCounts: new Uint32Array(counts),
    faceVertexIndices: new Uint32Array(indices),
    triangles,
    trianglesPerSlot: [triangles]
  };

  const uvs = faceVaryingUvs(specs, path, corners);
  if (uvs) cage.uvs = uvs;

  const subsets = materialSubsets(specs, path, counts);
  if (subsets) {
    cage.faceMaterialIndices = subsets.slots;
    cage.trianglesPerSlot = subsets.trianglesPerSlot;
  }
  return cage;
}

/**
 * UVs per corner.
 *
 * `primvars:st` is usually face-varying and indexed, which is the same layout
 * the subdivision kernel wants, so this is mostly a gather. A vertex-
 * interpolated st is read per corner through the face indices instead. Any
 * other interpolation is left alone rather than guessed at: a wrong UV is a
 * visibly wrong texture, and the fallback path already produces a correct one.
 */
function faceVaryingUvs(
  specs: Record<string, CrateSpec>,
  path: string,
  corners: number
): Float32Array | undefined {
  const st = numbers(specs[`${path}.primvars:st`]);
  if (!st) return undefined;

  const stIndices = numbers(specs[`${path}.primvars:st:indices`]);
  const interpolation = specs[`${path}.primvars:st`]?.fields?.interpolation;

  const out = new Float32Array(corners * 2);
  if (stIndices) {
    if (stIndices.length !== corners) return undefined;
    const pairs = Math.floor(st.length / 2);
    for (let c = 0; c < corners; c++) {
      const at = stIndices[c]!;
      if (at < 0 || at >= pairs) return undefined;
      out[c * 2] = st[at * 2]!;
      out[c * 2 + 1] = st[at * 2 + 1]!;
    }
    return out;
  }

  if (interpolation === 'faceVarying' && st.length === corners * 2) {
    return new Float32Array(st);
  }
  return undefined;
}

/**
 * Material slot per face, from the mesh's `GeomSubset` children.
 *
 * The order matters and is not arbitrary: three builds its material array and
 * its geometry groups by walking the same subsets in the same order, which is
 * what makes slot `i` here mean material `i` there. The caller checks that
 * claim against the loaded geometry before anything is drawn with it.
 */
function materialSubsets(
  specs: Record<string, CrateSpec>,
  path: string,
  counts: number[]
): { slots: Uint32Array; trianglesPerSlot: number[] } | null {
  const prefix = `${path}/`;
  const subsets: { name: string; faces: number[] }[] = [];

  for (const key of Object.keys(specs)) {
    if (!key.startsWith(prefix) || !key.endsWith('.indices')) continue;
    const name = key.slice(prefix.length, -'.indices'.length);
    // Only the material family. A subset family for anything else does not
    // describe how the mesh is split for rendering.
    const family = specs[`${prefix}${name}.familyName`]?.fields?.default;
    if (family !== undefined && family !== 'materialBind') continue;
    const faces = numbers(specs[key]);
    if (faces) subsets.push({ name, faces });
  }
  if (subsets.length < 2) return null;

  const slots = new Uint32Array(counts.length);
  const trianglesPerSlot: number[] = [];
  const claimed = new Uint8Array(counts.length);

  for (let slot = 0; slot < subsets.length; slot++) {
    let triangles = 0;
    for (const face of subsets[slot]!.faces) {
      if (face < 0 || face >= counts.length) return null;
      // A face in two subsets means this is not the simple split it looks
      // like, and the mapping cannot be trusted.
      if (claimed[face]) return null;
      claimed[face] = 1;
      slots[face] = slot;
      triangles += counts[face]! - 2;
    }
    trianglesPerSlot.push(triangles);
  }

  // Every face has to belong somewhere, or the unclaimed ones silently take
  // slot 0 and render with the wrong material.
  for (let i = 0; i < claimed.length; i++) if (!claimed[i]) return null;

  return { slots, trianglesPerSlot };
}

function numbers(spec: CrateSpec | undefined): number[] | null {
  const value = spec?.fields?.default;
  if (Array.isArray(value) && value.every((v) => typeof v === 'number')) {
    return value as number[];
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<number>);
  }
  return null;
}
