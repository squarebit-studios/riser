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
  toQuadWireframeGeometry,
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
/**
 * Start unsubdivided.
 *
 * The character appears exactly as the file describes it, immediately, and
 * smoothing becomes something the user asks for rather than something the app
 * did to their asset before they ever saw it. It is also the honest default:
 * level 0 is the surface the bindings are actually written against.
 */
export const DEFAULT_SUBDIV_LEVEL = 0;

/** Above this many cage faces, refining in the main thread stalls visibly. */
const MAX_CAGE_FACES_FOR_LEVEL = [Infinity, 200_000, 50_000, 12_000];

/** One refined level, kept so returning to it is free. */
interface BuiltLevel {
  mesh: THREE.Mesh;
  refined: RefinedSurface;
  render: RenderMesh;
  normals: Float32Array;
}

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

  /**
   * Every level built so far, kept so that returning to one is free.
   *
   * Refining is the expensive step - on a 137k-face character it is most of a
   * second - and a slider is a control people sweep back and forth. Paying
   * that once per level instead of once per movement is the difference
   * between a slider that responds and one that stutters.
   *
   * Bounded by MAX_SUBDIV_LEVEL, which is 3, and dropped entirely when the
   * character changes.
   */
  private readonly builtLevels = new Map<number, BuiltLevel>();
  /** The level currently attached to the cage. Null at level 0. */
  private active: BuiltLevel | null = null;

  /**
   * The welded, quad-recovered cage.
   *
   * Level-independent, so it is computed once and shared by every level rather
   * than rebuilt on each refinement.
   */
  private cageSubdiv: SubdivMesh | null = null;
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
      limitFaces: this.active ? meshCounts(this.active.refined.mesh).faces : 0,
      clamped: this.clamped
    };
  }

  /** The mesh the camera renders and the user clicks. */
  get displayed(): THREE.Mesh {
    return this.active?.mesh ?? this.cage;
  }

  get isSubdivided(): boolean {
    return this.active !== null;
  }

  /**
   * Set the subdivision level, rebuilding the surface if it changed.
   *
   * A level too heavy for the cage is reduced rather than refused: a character
   * that is already dense does not need subdividing to look smooth, and
   * freezing the tab to prove a point helps nobody. `stats.clamped` reports it
   * so the UI can say so.
   */
  /**
   * Set the level, optionally against a budget the whole character shares.
   *
   * `totalCageFaces` is the face count of every mesh on the character, not
   * just this one. It matters because a character is rarely one mesh: a
   * production asset arrives as thirty or forty pieces - body, hair, teeth,
   * eyes, clothing - each small enough to pass this test on its own while the
   * character as a whole is far too heavy to subdivide.
   */
  setLevel(level: number, totalCageFaces?: number): void {
    const requested = clampLevel(level);
    const effective = this.effectiveLevel(requested, totalCageFaces);
    // Recorded before the early return. Asking for level 3 on a mesh already
    // pinned at 1 rebuilds nothing, but it is still a request that was
    // reduced, and the UI has to be able to say so - otherwise the slider
    // moves, the surface does not, and nothing explains why.
    this.clamped = effective !== requested;
    if (effective === this.level && !this.failed) return;

    this.detach();
    this.level = effective;

    if (effective > 0) {
      const cached = this.builtLevels.get(effective);
      if (cached) this.attach(cached);
      else this.build(effective);
    }
    this.applyLayers();
  }

  /**
   * Edge geometry for the displayed surface, following its QUADS.
   *
   * A `THREE.WireframeGeometry` draws the triangles a renderer actually has,
   * which after subdivision means every quad crossed by the diagonal that
   * triangulated it. On a Catmull-Clark surface that doubles the line count
   * and hides the thing a wireframe is being looked at for: the edge flow.
   *
   * Null at level 0, where there is no refined mesh and the ordinary triangle
   * wireframe is the honest picture of what is being rendered.
   */
  quadWireframe(): THREE.BufferGeometry | null {
    const active = this.active;
    if (!active) return null;
    try {
      return toQuadWireframeGeometry(active.refined.mesh);
    } catch {
      // Falling back to the caller's triangle wireframe beats no wireframe.
      return null;
    }
  }

  /** True when this level is built already, so switching to it is free. */
  hasCached(level: number): boolean {
    return level === 0 || this.builtLevels.has(clampLevel(level));
  }

  private effectiveLevel(requested: number, totalCageFaces?: number): number {
    if (requested === 0) return 0;
    // The budget is spent by the character, so the character's total is what
    // has to fit - falling back to this mesh alone only when no total is given.
    const faces = totalCageFaces ?? this.cageFaceCount();
    let level = requested;
    while (level > 0 && faces > (MAX_CAGE_FACES_FOR_LEVEL[level] ?? Infinity)) {
      level--;
    }
    return level;
  }

  /**
   * Faces in this mesh's own cage geometry.
   *
   * Read from the geometry rather than from `stats`, which reports the
   * recovered-quad cage and is therefore zero until a surface has been built -
   * exactly when the budget needs to be computed.
   */
  faceCount(): number {
    return this.cageFaceCount();
  }

  private cageFaceCount(): number {
    const index = this.cage.geometry.getIndex();
    const position = this.cage.geometry.getAttribute('position');
    if (index) return Math.floor(index.count / 3);
    return position ? Math.floor(position.count / 3) : 0;
  }

  private build(level: number): void {
    try {
      if (!this.cageSubdiv) {
        // Renderer geometry splits vertices at UV and normal seams, which the
        // subdivision rules would read as infinitely sharp creases.
        // fromBufferGeometry welds them back together first.
        const extracted = fromBufferGeometry(this.cage.geometry);

        // USD and glTF both arrive triangulated, and subdividing raw triangles
        // puts an extraordinary vertex in the middle of every one - visible as
        // shading artifacts on what was authored as a quad grid. Recovering
        // the quads first is what makes the result match the DCC's own
        // preview.
        // Carry the cage's material groups onto its faces BEFORE recovering
        // quads.
        //
        // Without this a multi-material mesh subdivides into a geometry with
        // no groups, and three renders NOTHING when a material array has no
        // groups to index it - so Gary's body and spacesuit vanished the
        // moment smoothing was turned on while every single-material
        // accessory stayed put. The kernel already carries these slots
        // through refinement and turns them back into groups; they simply
        // were never populated.
        assignMaterialSlots(extracted.mesh, this.cage.geometry);
        this.cageSubdiv = recoverQuads(extracted.mesh);
      }

      const refined = buildRefinedSurface(this.cageSubdiv, level);
      const normals = computeVertexNormals(refined.mesh);
      const render = buildRenderMesh(refined.mesh);
      updateRenderMesh(render, refined.mesh, normals);

      const mesh = new THREE.Mesh(render.geometry, this.cage.material);
      mesh.name = `${this.cage.name || 'Mesh'}:limit${level}`;
      // A child of the cage, so the transform is shared by construction.
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();

      const built: BuiltLevel = { mesh, refined, render, normals };
      this.builtLevels.set(level, built);
      this.attach(built);
      this.failed = false;
    } catch (err) {
      // A cage the kernel cannot handle must not take the app down with it -
      // the character is still perfectly usable unsubdivided.
      console.warn(
        `Subdivision failed for ${this.cage.name || 'a mesh'}; showing the cage.`,
        err
      );
      this.detach();
      this.level = 0;
      this.failed = true;
    }
  }

  /** Put a built level on screen. */
  private attach(built: BuiltLevel): void {
    // Taken from the cage each time rather than kept, because the material can
    // have changed since this level was built - a view mode swap, say.
    built.mesh.material = this.cage.material;
    this.cage.add(built.mesh);
    this.active = built;
  }

  /** Take the current level off screen, keeping it in the cache. */
  private detach(): void {
    if (!this.active) return;
    this.cage.remove(this.active.mesh);
    this.active = null;
  }

  /**
   * Re-evaluate the limit surface from moved control points.
   *
   * Not used yet - nothing deforms the cage today - but this is the whole
   * reason the stencil table exists, and it is one sparse matrix product
   * rather than a re-refine.
   */
  refresh(): void {
    const active = this.active;
    if (!active) return;
    const positions = this.cage.geometry.getAttribute('position');
    if (!positions) return;

    applyStencils(
      active.refined.table,
      positions.array as Float32Array,
      active.refined.mesh.positions
    );
    computeVertexNormals(active.refined.mesh, active.normals);
    updateRenderMesh(active.render, active.refined.mesh, active.normals);

    // Every other cached level is now stale against the moved cage. Dropping
    // them is cheaper than re-stencilling surfaces nobody is looking at, and
    // far safer than keeping one that would come back wrong.
    for (const [level, built] of this.builtLevels) {
      if (built === active) continue;
      built.mesh.geometry.dispose();
      this.builtLevels.delete(level);
    }
  }

  /**
   * Cage on the pick-only layer, limit on the rendered layer.
   *
   * At level 0 the cage sits on BOTH, so the "displayed" and "cage" raycasts
   * find the same mesh and the offset comes out zero with no special case.
   */
  private applyLayers(): void {
    if (this.active) {
      this.cage.layers.set(LAYER_CAGE);
      this.active.mesh.layers.set(LAYER_SCENE);
    } else {
      this.cage.layers.set(LAYER_SCENE);
      this.cage.layers.enable(LAYER_CAGE);
    }
  }

  private teardownLimit(): void {
    this.detach();
    for (const built of this.builtLevels.values()) built.mesh.geometry.dispose();
    this.builtLevels.clear();
    this.cageSubdiv = null;
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
    // One budget for the whole character. Deciding per mesh let a 34-piece
    // character through at level 2 - every piece passed on its own, and the
    // sum was 137k faces becoming 2.2M, which locks the tab.
    const total = this.totalCageFaces();
    for (const surface of this.surfaces) surface.setLevel(this.level, total);
  }

  /** Faces across every cage on the character. */
  totalCageFaces(): number {
    let total = 0;
    for (const surface of this.surfaces) total += surface.faceCount();
    return total;
  }

  get currentLevel(): number {
    return this.level;
  }

  /** True when any surface had to reduce the requested level. */
  get clamped(): boolean {
    return this.surfaces.some((s) => s.stats.clamped);
  }

  /**
   * The level actually on screen, which is not always the one asked for.
   *
   * `currentLevel` reports the request. This reports the result, and the two
   * differ exactly when the character was too heavy - which is the moment the
   * user has to be told something, so the difference has to be legible.
   */
  get effectiveLevel(): number {
    let level = 0;
    for (const surface of this.surfaces) level = Math.max(level, surface.stats.level);
    return level;
  }

  /** True when every surface already has this level built. */
  hasCached(level: number): boolean {
    return this.surfaces.every((s) => s.hasCached(level));
  }

  /**
   * Quad edges for a displayed mesh, or null when it is not subdivided.
   *
   * Looked up by the mesh the caller is holding, because view modes work from
   * what is on screen and have no idea which surface produced it.
   */
  quadWireframe(displayed: THREE.Mesh): THREE.BufferGeometry | null {
    const surface = this.surfaces.find((s) => s.displayed === displayed);
    return surface?.quadWireframe() ?? null;
  }

  /** The control cages, which are what bindings are written against. */
  get cages(): THREE.Mesh[] {
    return this.surfaces.map((s) => s.cage);
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

/**
 * Copy a geometry's material groups onto the extracted cage, per face.
 *
 * `fromBufferGeometry` produces one face per source triangle, in order, so
 * face `i` is triangle `i`. A group's `start` and `count` are in INDEX space,
 * which is three times the triangle range.
 *
 * Faces outside every group keep slot 0 rather than being dropped: a geometry
 * whose groups do not cover it is malformed, and rendering it with the first
 * material beats rendering nothing.
 */
function assignMaterialSlots(
  mesh: SubdivMesh,
  geometry: THREE.BufferGeometry
): void {
  const groups = geometry.groups;
  if (!groups || groups.length < 2) return;

  const faceCount = mesh.faceVertexCounts.length;
  const slots = new Uint32Array(faceCount);

  for (const group of groups) {
    const first = Math.floor(group.start / 3);
    const last = Math.min(faceCount, Math.floor((group.start + group.count) / 3));
    const slot = group.materialIndex ?? 0;
    for (let face = first; face < last; face++) slots[face] = slot;
  }

  mesh.faceMaterialIndices = slots;
}
