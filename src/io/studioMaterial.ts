// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Making sure a loaded character can actually be seen.
//
// Riser is a placement tool, not a look-dev tool, but it still has to render
// what it is handed - and what it is handed is frequently unshaded. A model
// published out of Maya, or an OBJ, or a USD exported without its shading
// graph, arrives with either no material or one whose base colour is black.
// Both render as a silhouette, and placing a marker on a silhouette is
// guesswork.
//
// So: a character whose material says nothing gets Riser's own neutral clay.
// A character that brought real materials keeps every one of them, because
// "Lit" is documented as showing the asset as its own materials describe it,
// and quietly overriding those would make that false.
//
// The test for "says nothing" is deliberately narrow - black or missing base
// colour, with no texture and no vertex colours. A deliberately dark material
// with a texture on it is a choice; a bare black one is the absence of a
// choice, and every DCC writes it when there is nothing to write.
// ==========================================================================

import * as THREE from 'three';

/** Neutral clay: light enough to read shape, desaturated enough to not fight the markers. */
const CLAY_COLOR = 0xb9bcc2;
const CLAY_ROUGHNESS = 0.72;
const CLAY_METALNESS = 0.0;

/**
 * True when a material carries no usable appearance.
 *
 * Black WITH a texture is a real material - the map supplies the colour, and
 * base colour multiplies it. Black WITHOUT one is what an exporter writes when
 * the asset had no shading to export.
 */
export function isUnshaded(material: THREE.Material): boolean {
  const standard = material as THREE.MeshStandardMaterial;

  // Anything carrying an image or per-vertex colour is expressing something.
  if (standard.map || standard.vertexColors) return false;
  if ((standard as THREE.MeshPhysicalMaterial).sheenColorMap) return false;
  if (standard.emissiveMap) return false;

  const color = standard.color;
  if (!color) return true;

  // Pure black, and only pure black.
  //
  // The threshold is deliberately tiny because three stores colour in LINEAR
  // space: a generous-looking 0.02 there is about #282828 in sRGB, which would
  // swallow every deliberately dark material an artist ever authored. What is
  // being detected is not "dark" - it is the exact zero an exporter writes when
  // there was nothing to write.
  return color.r <= 1e-4 && color.g <= 1e-4 && color.b <= 1e-4;
}

/** Riser's neutral surface, for characters that arrived without one. */
export function createStudioMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: CLAY_COLOR,
    roughness: CLAY_ROUGHNESS,
    metalness: CLAY_METALNESS
  });
  material.name = 'RiserStudioClay';
  return material;
}

/**
 * Give every unshaded mesh under `root` a material it can be seen with.
 *
 * Returns how many meshes were changed, so the caller can tell the user that
 * the asset's own look was not what got rendered.
 *
 * One shared material instance for the whole character rather than one each:
 * they are identical, and sharing lets the renderer batch state changes across
 * what is often thirty or forty separate pieces.
 */
export function applyStudioMaterial(root: THREE.Object3D): number {
  let shared: THREE.MeshStandardMaterial | null = null;
  let replaced = 0;

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!materials.every(isUnshaded)) return;

    shared ??= createStudioMaterial();
    // Disposed here rather than left to the GC: these are GPU programs, and a
    // character swap would otherwise leak one set per load.
    for (const material of materials) material.dispose();

    mesh.material = Array.isArray(mesh.material)
      ? (materials.map(() => shared) as THREE.Material[])
      : shared;
    replaced++;
  });

  return replaced;
}
