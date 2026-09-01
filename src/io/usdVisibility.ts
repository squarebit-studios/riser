// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Meshes the file says should not be drawn.
//
// USD has a `visibility` attribute and this character uses it: the four proxy
// meshes behind the brows and lashes are authored `invisible`, because they
// are coincident duplicates of the real geometry kept for a different purpose.
// Three's USD composer does not read it, so Riser drew both copies of each and
// they z-fought, which is the flicker across the brows.
//
// INHERITED, NOT PER PRIM. `invisible` on a prim hides everything beneath it,
// and this character uses that too: whole rig groups are switched off in one
// place rather than mesh by mesh. So a mesh is hidden when it is invisible
// ITSELF or when anything above it is, which means this has to walk ancestors
// rather than read one attribute.
//
// A SUGGESTION, NOT A LAW. What is read here becomes the initial state of the
// Scene tab's visibility toggles, so a person can still turn any of it back on
// and see what the file was hiding. Riser is a tool for looking at characters,
// and "the file said not to" is a good default rather than a reason to make
// something unreachable.
// ==========================================================================

import { parseSpecs, type CrateSpec } from './eyeLook';

/**
 * Leaf names of every mesh the file hides, itself or through an ancestor.
 *
 * Leaf names because that is the identity Riser can match: a character loaded
 * into a document does not keep the prim path it had in its own file.
 */
export function readHiddenMeshes(source: ArrayBuffer | string): Set<string> {
  const specs = parseSpecs(source);
  const hidden = new Set<string>();
  if (!specs) return hidden;

  const invisible = invisiblePaths(specs);
  if (invisible.length === 0) return hidden;

  for (const path of meshPaths(specs)) {
    if (isUnder(path, invisible)) {
      hidden.add(path.slice(path.lastIndexOf('/') + 1));
    }
  }
  return hidden;
}

/** Prim paths whose `visibility` is authored `invisible`. */
function invisiblePaths(specs: Record<string, CrateSpec>): string[] {
  const paths: string[] = [];
  for (const [key, spec] of Object.entries(specs)) {
    if (!key.endsWith('.visibility')) continue;
    if (spec?.fields?.default !== 'invisible') continue;
    paths.push(key.slice(0, -'.visibility'.length));
  }
  return paths;
}

function meshPaths(specs: Record<string, CrateSpec>): string[] {
  const paths: string[] = [];
  for (const key of Object.keys(specs)) {
    if (key.endsWith('.faceVertexCounts')) {
      paths.push(key.slice(0, -'.faceVertexCounts'.length));
    }
  }
  return paths;
}

/**
 * Whether a prim is one of these, or beneath one of them.
 *
 * The trailing slash matters: without it `/model/head` would count as being
 * under `/model/hea`, and a mesh would disappear because another prim's name
 * happened to be a prefix of its parent's.
 */
function isUnder(path: string, ancestors: readonly string[]): boolean {
  return ancestors.some(
    (ancestor) => path === ancestor || path.startsWith(`${ancestor}/`)
  );
}
