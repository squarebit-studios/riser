// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Squarebit Subdivs in the viewport: the user places markers on a smooth
// limit surface, while bindings stay on the control cage.
//
// This is the same Catmull-Clark core the Unreal plugin runs and the store's
// Eye and Subdivs pages use (@squarebit/subdivs-three), but it earns its place
// here for a reason specific to this app rather than for looks.
//
// THE PROBLEM. A binding names a triangle of the USD mesh. If we subdivided
// and bound to the refined result, the Python worker would have to reproduce
// Catmull-Clark exactly to resolve it - a heavyweight dependency on the server
// and a fresh way for the two sides to disagree. But a faceted blockout is a
// poor thing to place an eye corner on.
//
// THE RESOLUTION.
//   1. The USD mesh stays the binding target. It is the control cage, and the
//      document format does not change at all.
//   2. The viewport displays the limit surface, refined once into a stencil
//      table so re-evaluation is one sparse matrix product.
//   3. A click raycasts BOTH. The limit surface gives the point the user
//      actually means; the cage gives the triangle to bind to. The vector
//      between them goes into the binding's existing `offset` field.
//
// Because `position = evaluate(binding) + offset` already holds on both sides,
// the server recovers the exact clicked point with no subdivision, no schema
// change, and no Subdivs dependency in the worker.
//
// The cage and the limit surface are separated by LAYERS, not by `visible`.
// three's raycaster is gated only by layers (Raycaster.js `intersect`), so a
// cage on a layer the camera does not render is invisible and still perfectly
// pickable - which is exactly the property this design needs.
// ==========================================================================

import * as THREE from 'three';
import {
  applyStencils,
  buildRefinedSurface,
  buildRenderMesh,
  computeVertexNormals,
  fromBufferGeometry,
  meshCounts,
  recoverQuads,
  updateRenderMesh,
  type RefinedSurface,
  type RenderMesh,
  type SubdivMesh
} from '@squarebit/subdivs-three';
import { LAYER_CAGE, LAYER_SCENE } from './Viewport';

/** Level 0 means "no subdivision" - the cage is shown and bound to directly. */
export const MIN_SUBDIV_LEVEL = 0;
/**
 * Each level roughly quadruples the face count. Three is already ~64x the
 * cage; beyond that the gain is invisible and the refine cost is not.
 */
export const MAX_SUBDIV_LEVEL = 3;
export const DEFAULT_SUBDIV_LEVEL = 2;

/** Above this many cage faces, refining in the main thread stalls visibly. */
const MAX_CAGE_FACES_FOR_LEVEL = [Infinity, 200_000, 50_000, 12_000];

export interface SubdivStats {
  level: number;
  cageFaces: number;
  limitFaces: number;
  /** True when the requested level was reduced to keep the app responsive. */
  clamped: boolean;
}

/**
 * One character mesh, paired with its subdivided display surface.
 *
 * The limit mesh is a CHILD of the cage, so the two share a transform by
 * construction - no matrix copying to keep in sync, and cage-local space is
 * limit-local space, which is what makes the offset arithmetic trivial.
 */
export class SubdivSurface {
  readonly cage: THREE.Mesh;
  /** Null at level 0, where the cage is what gets displayed. */
  private limit: THREE.Mesh | null = null;

  private cageSubdiv: SubdivMesh | null = null;
  private refined: RefinedSurface | null = null;
  private render: RenderMesh | null = null;
  private normals: Float32Array | null = null;
  private level = 0;
  private clamped = false;
  private failed = false;

  constructor(cage: THREE.Mesh) {
    this.cage = cage;
    this.applyLayers();
  }

  get stats(): SubdivStats {
    return {
      level: this.level,
      cageFaces: this.cageSubdiv ? meshCounts(this.cageSubdiv).faces : 0,
      limitFaces: this.refined ? meshCounts(this.refined.mesh).faces : 0,
      clamped: this.clamped
    };
  }

  /** The mesh the camera renders and the user clicks. */
  get displayed(): THREE.Mesh {
    return this.limit ?? this.cage;
  }

  get isSubdivided(): boolean {
    return this.limit !== null;
  }

  /**
   * Set the subdivision level, rebuilding the surface if it changed.
   *
   * A level too heavy for the cage is reduced rather than refused: a character
   * that is already dense does not need subdividing to look smooth, and
   * freezing the tab to prove a point helps nobody. `stats.clamped` reports it
   * so the UI can say so.
   */
  setLevel(level: number): void {
    const requested = clampLevel(level);
    const effective = this.effectiveLevel(requested);
    if (effective === this.level && !this.failed) return;

    this.teardownLimit();
    this.level = effective;
    this.clamped = effective !== requested;

    if (effective > 0) this.build(effective);
    this.applyLayers();
  }

  private effectiveLevel(requested: number): number {
    if (requested === 0) return 0;
    const faces = this.cageFaceCount();
    let level = requested;
    while (level > 0 && faces > (MAX_CAGE_FACES_FOR_LEVEL[level] ?? Infinity)) {
      level--;
    }
    return level;
  }

  private cageFaceCount(): number {
    const index = this.cage.geometry.getIndex();
    const position = this.cage.geometry.getAttribute('position');
    if (index) return Math.floor(index.count / 3);
    return position ? Math.floor(position.count / 3) : 0;
  }

  private build(level: number): void {
    try {
      // Renderer geometry splits vertices at UV and normal seams, which the
      // subdivision rules would read as infinitely sharp creases. fromBuffer-
      // Geometry welds them back together first.
      const extracted = fromBufferGeometry(this.cage.geometry);

      // USD and glTF both arrive triangulated, and subdividing raw triangles
      // puts an extraordinary vertex in the middle of every one - visible as
      // shading artifacts on what was authored as a quad grid. Recovering the
      // quads first is what makes the result look like the DCC's own preview.
      this.cageSubdiv = recoverQuads(extracted.mesh);

      this.refined = buildRefinedSurface(this.cageSubdiv, level);
      this.normals = computeVertexNormals(this.refined.mesh);
      this.render = buildRenderMesh(this.refined.mesh);
      updateRenderMesh(this.render, this.refined.mesh, this.normals);

      const limit = new THREE.Mesh(this.render.geometry, this.cage.material);
      limit.name = `${this.cage.name || 'Mesh'}:limit`;
      // A child of the cage, so the transform is shared by construction.
      limit.matrixAutoUpdate = false;
      limit.updateMatrix();
      this.cage.add(limit);
      this.limit = limit;
      this.failed = false;
    } catch (err) {
      // A cage the kernel cannot handle must not take the app down with it -
      // the character is still perfectly usable unsubdivided.
      console.warn(
        `Subdivision failed for ${this.cage.name || 'a mesh'}; showing the cage.`,
        err
      );
      this.teardownLimit();
      this.level = 0;
      this.failed = true;
    }
  }

  /**
   * Re-evaluate the limit surface from moved control points.
   *
   * Not used yet - nothing deforms the cage today - but this is the whole
   * reason the stencil table exists, and it is one sparse matrix product
   * rather than a re-refine.
   */
  refresh(): void {
    if (!this.refined || !this.render || !this.normals) return;
    const positions = this.cage.geometry.getAttribute('position');
    if (!positions) return;

    applyStencils(
      this.refined.table,
      positions.array as Float32Array,
      this.refined.mesh.positions
    );
    computeVertexNormals(this.refined.mesh, this.normals);
    updateRenderMesh(this.render, this.refined.mesh, this.normals);
  }

  /**
   * Cage on the pick-only layer, limit on the rendered layer.
   *
   * At level 0 the cage sits on BOTH, so the "displayed" and "cage" raycasts
   * find the same mesh and the offset comes out zero with no special case.
   */
  private applyLayers(): void {
    if (this.limit) {
      this.cage.layers.set(LAYER_CAGE);
      this.limit.layers.set(LAYER_SCENE);
    } else {
      this.cage.layers.set(LAYER_SCENE);
      this.cage.layers.enable(LAYER_CAGE);
    }
  }

  private teardownLimit(): void {
    if (this.limit) {
      this.cage.remove(this.limit);
      this.limit.geometry.dispose();
      this.limit = null;
    }
    this.cageSubdiv = null;
    this.refined = null;
    this.render = null;
    this.normals = null;
  }

  dispose(): void {
    this.teardownLimit();
    // Leave the cage on the default layer so a later consumer is not surprised
    // by a mesh that renders nowhere.
    this.cage.layers.set(LAYER_SCENE);
  }
}

export function clampLevel(level: number): number {
  // Garbage falls to the MINIMUM, not the maximum: a NaN arriving from a
  // malformed stored preference should not silently trigger the most
  // expensive refinement the app can do.
  if (!Number.isFinite(level)) return MIN_SUBDIV_LEVEL;
  return Math.max(MIN_SUBDIV_LEVEL, Math.min(MAX_SUBDIV_LEVEL, Math.round(level)));
}

/**
 * Manages a subdivision surface per character mesh.
 *
 * Kept separate from CharacterModel because subdivision is a viewport concern:
 * the document, the worker and the USD layer know nothing about it.
 */
export class SubdivSet {
  private readonly surfaces: SubdivSurface[] = [];
  private level = 0;

  constructor(meshes: readonly THREE.Mesh[]) {
    for (const mesh of meshes) this.surfaces.push(new SubdivSurface(mesh));
  }

  setLevel(level: number): void {
    this.level = clampLevel(level);
    for (const surface of this.surfaces) surface.setLevel(this.level);
  }

  get currentLevel(): number {
    return this.level;
  }

  /** True when any surface had to reduce the requested level. */
  get clamped(): boolean {
    return this.surfaces.some((s) => s.stats.clamped);
  }

  get isSubdivided(): boolean {
    return this.surfaces.some((s) => s.isSubdivided);
  }

  /**
   * The meshes the camera is currently drawing.
   *
   * The cage at level 0, the limit surface above it. View modes and anything
   * else that shades what the user sees has to follow this rather than the
   * character's mesh list, which is always the cages.
   */
  displayedMeshes(): THREE.Mesh[] {
    return this.surfaces.map((s) => s.displayed);
  }

  get totals(): { cageFaces: number; limitFaces: number } {
    return this.surfaces.reduce(
      (acc, s) => {
        const stats = s.stats;
        acc.cageFaces += stats.cageFaces;
        acc.limitFaces += stats.limitFaces;
        return acc;
      },
      { cageFaces: 0, limitFaces: 0 }
    );
  }

  dispose(): void {
    for (const surface of this.surfaces) surface.dispose();
    this.surfaces.length = 0;
  }
}
