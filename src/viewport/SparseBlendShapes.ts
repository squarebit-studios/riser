// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Firing a character's blend shapes without building morph targets for them.
//
// Three drives blend shapes through `morphTargetInfluences`, which wants a
// DENSE delta per vertex per target. That is fine for the handful a glTF
// carries and impossible for a face rig: this character has 878 shapes on the
// body alone against 152,928 render vertices, which as morph targets is about
// 1.6GB for one mesh before anything is drawn.
//
// UsdSkel stores them the way they actually are - `offsets` against
// `pointIndices`, only the points that move - and a cheek shape moves about
// 700 of 25,490 points. Kept sparse and applied by hand, the whole set costs a
// few megabytes and firing one costs the points it actually moves.
//
// SO WHY NOT WELD. Three's geometry is unwelded: the body arrives as 152,928
// vertices for the file's 25,490 points, because a renderer splits a vertex at
// every UV and normal seam. The file's indices mean POINTS, so applying them
// needs the map from one to the other. It is built by position, which is exact
// here rather than approximate: the authored points and the loaded geometry
// agree to the bit, having come from the same file.
//
// NAMES ARE SHARED ON PURPOSE. A jaw shape lives on the face, the gums and the
// teeth, and 462 of this character's 932 names are on more than one mesh. One
// name is one control, and it moves all of them, because a smile that left the
// teeth behind would read as a bug in Riser rather than as the asset.
// ==========================================================================

import * as THREE from 'three';
import type { BlendShapeDelta } from '../io/blendShapeData';
import type { AuthoredCage } from '../io/authoredTopology';
import { AUTHORED_CAGE } from './SubdivSurface';
import { BlendShapeGpu } from './BlendShapeGpu';

/**
 * How long a weight must sit still before the CPU pass runs.
 *
 * Long enough that a drag does not trigger one per frame, short enough that
 * letting go feels like it settled rather than like it caught up later.
 */
const SETTLE_MS = 120;

/** No weights at all, for putting one side of the pair back to rest. */
const NO_WEIGHTS: ReadonlyMap<string, number> = new Map();

/** Positions closer together than this are the same point. */
const WELD = 1e-5;

interface MeshShapes {
  mesh: THREE.Mesh;
  /** The geometry's own positions, before any shape is applied. */
  rest: Float32Array;
  /**
   * The file's own points, at rest and as currently posed.
   *
   * Kept alongside the render vertices because subdivision works from these,
   * not from those. The stencil table indexes the CAGE, which since the cage
   * started coming from the file means the file's 25,490 points rather than
   * the renderer's 152,928 vertices. Without moving these, a shape moves the
   * cage and the refined surface stays exactly where it was, which is how it
   * behaved with smoothing on: fire a shape, watch nothing happen.
   */
  restPoints: Float32Array;
  points: Float32Array;
  /**
   * The mesh's own normals, exactly as the file shaded it.
   *
   * Kept because they cannot be recovered. Three's `computeVertexNormals`
   * averages across VERTICES, and a renderer's geometry is unwelded - this
   * character is 152,928 vertices for 25,490 points, split at every UV and
   * normal seam - so no two vertices are ever shared and every normal comes
   * out per face. Calling it once took the character from smooth to 80% faceted
   * and there was no way back.
   */
  restNormals: Float32Array | null;
  /** The authored faces, for computing normals the way the file means them. */
  faceVertexCounts: Uint32Array;
  faceVertexIndices: Uint32Array;
  /** Per point normals at rest, for measuring how far the surface has turned. */
  restPointNormals: Float32Array | null;
  /**
   * Render vertices per authored point, flattened.
   *
   * Held as CSR rather than an array of arrays: one point can own a dozen
   * vertices at a seam, and a character has tens of thousands of points.
   */
  vertexStart: Uint32Array;
  vertexOf: Uint32Array;
  /** The authored point each render vertex was split from. */
  pointOfVertex: Uint32Array;
  byName: Map<string, BlendShapeDelta>;
}

/**
 * Sparse blend shapes for a character, applied straight to its geometry.
 */
export class SparseBlendShapes {
  /**
   * Told when a mesh's control points have moved.
   *
   * Set by whoever owns the subdivision, so a limit surface can be
   * re-evaluated from the moved cage. One sparse matrix product, which is what
   * the stencil table has existed for since before anything deformed a cage.
   */
  onPointsMoved: ((mesh: THREE.Mesh, points: Float32Array) => void) | null = null;

  /**
   * Told once after the surface has finished moving.
   *
   * Anything DERIVED from the geometry has to be rebuilt, and the wireframe is
   * the visible one: its lines are their own geometry, built from the surface
   * at the moment it was drawn, so a shape moved the character and left its
   * wireframe hanging in the pose the character used to be in.
   */
  onSettled: (() => void) | null = null;

  private readonly meshes: MeshShapes[] = [];
  /**
   * The vertex-shader path, when this character and this renderer allow it.
   *
   * It makes a weight change cost one small upload instead of recomputing
   * every moved vertex. It cannot do everything the CPU pass does, so it does
   * not replace it: see the note on `settle`.
   */
  /**
   * Whether shading should follow a shape, at the cost of computing it.
   *
   * Off by default because the faithful answer is free and the computed one is
   * not. See `shadeAfterMoving` for what each costs.
   */
  recomputeNormals = false;

  private gpu: BlendShapeGpu | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set while the GPU is showing a pose the CPU has not caught up with. */
  private gpuAhead = false;
  private readonly weights = new Map<string, number>();
  /** Vertices moved by the last application, to put back before the next. */
  private dirty = new Map<MeshShapes, Set<number>>();
  /** Authored points moved by the last application. */
  private dirtyPoints = new Map<MeshShapes, Set<number>>();

  /**
   * Build the appliers for whichever meshes carry shapes.
   *
   * A mesh whose authored points do not line up with its geometry is skipped
   * rather than guessed at: a shape applied through a wrong map does not fail,
   * it moves the wrong part of the face.
   */
  setCharacter(
    meshes: readonly THREE.Mesh[],
    shapes: ReadonlyMap<string, readonly BlendShapeDelta[]>,
    renderer?: THREE.WebGLRenderer | null
  ): void {
    this.dispose();
    if (shapes.size === 0) return;

    for (const mesh of meshes) {
      const leaf = ((mesh.userData.primPath as string) ?? '').split('/').pop();
      const mine = leaf ? shapes.get(leaf) : undefined;
      if (!mine || mine.length === 0) continue;

      const cage = mesh.userData[AUTHORED_CAGE] as AuthoredCage | undefined;
      const position = mesh.geometry.getAttribute('position');
      if (!cage || !position) continue;
      const normalAttribute = mesh.geometry.getAttribute('normal');

      const map = mapPointsToVertices(cage.positions, position);
      if (!map) continue;

      const byName = new Map<string, BlendShapeDelta>();
      const points = cage.positions.length / 3;
      for (const shape of mine) {
        // An index past the end of the mesh means this shape was built against
        // different geometry, which is the one way two files drift apart.
        let worst = -1;
        for (const index of shape.pointIndices) {
          if (index > worst) worst = index;
        }
        if (worst >= points) continue;
        byName.set(shape.name, shape);
      }
      if (byName.size === 0) continue;

      this.meshes.push({
        mesh,
        rest: new Float32Array(position.array as ArrayLike<number>),
        restPoints: new Float32Array(cage.positions),
        points: new Float32Array(cage.positions),
        restNormals: normalAttribute
          ? new Float32Array(normalAttribute.array as ArrayLike<number>)
          : null,
        faceVertexCounts: cage.faceVertexCounts,
        faceVertexIndices: cage.faceVertexIndices,
        restPointNormals: null,
        vertexStart: map.start,
        vertexOf: map.vertices,
        pointOfVertex: map.pointOfVertex,
        byName
      });
    }

    this.attachGpu(renderer ?? null);
  }

  /**
   * Put the shapes on the GPU, if everything about this case allows it.
   *
   * Any mesh that cannot be accelerated simply is not, and stays on the CPU
   * path. A partial answer is fine here because the two produce the same pose;
   * they differ in what else they keep up to date.
   */
  private attachGpu(renderer: THREE.WebGLRenderer | null): void {
    if (!BlendShapeGpu.supported(renderer)) return;

    const gpu = new BlendShapeGpu();
    gpu.setShapeOrder(this.names());

    let attached = 0;
    for (const entry of this.meshes) {
      const points = entry.restPoints.length / 3;
      if (gpu.attach(entry.mesh, entry.pointOfVertex, points, entry.byName)) {
        attached++;
      }
    }

    if (attached === 0) {
      gpu.dispose();
      return;
    }
    this.gpu = gpu;
  }

  /** Every shape name on the character, in the order first seen. */
  names(): string[] {
    const seen = new Set<string>();
    for (const entry of this.meshes) {
      for (const name of entry.byName.keys()) seen.add(name);
    }
    return [...seen];
  }

  /** How many meshes a given name drives. */
  meshCountFor(name: string): number {
    return this.meshes.filter((m) => m.byName.has(name)).length;
  }

  get shapeCount(): number {
    return this.names().length;
  }

  weightOf(name: string): number {
    return this.weights.get(name) ?? 0;
  }

  activeNames(): string[] {
    return [...this.weights.entries()]
      .filter(([, w]) => w > 0.001)
      .map(([name]) => name);
  }

  /**
   * Drive a shape on every mesh that carries it.
   *
   * `live` says a value is still moving, which is what a drag looks like. The
   * GPU shows it at once and the CPU pass follows once it stops, so scrubbing
   * costs an upload rather than a re-evaluation of every moved vertex, and the
   * pose it settles into is the fully correct one.
   */
  setWeight(name: string, weight: number, live = false): void {
    const clamped = Math.min(1, Math.max(0, weight));
    if (clamped <= 0.0001) this.weights.delete(name);
    else this.weights.set(name, clamped);

    if (this.gpu) {
      // EXACTLY ONE SIDE DISPLACES AT A TIME.
      //
      // The shader adds its offsets to whatever the position attribute already
      // holds. If the CPU pass has posed those vertices and the shader still
      // has a weight, the shape is applied twice, and it looks like a shape
      // that is simply too strong rather than like two things doing one job.
      //
      // So handing over means putting the other side back first: the CPU
      // returns to rest before the shader takes the pose.
      if (!this.gpuAhead) this.applyAll(NO_WEIGHTS);
      this.gpu.setWeights(this.weights);
      this.gpuAhead = true;
      if (live) {
        this.scheduleSettle();
        return;
      }
    }
    this.settleNow();
  }

  /** True when the vertex shader is doing the work. */
  get onGpu(): boolean {
    return this.gpu !== null;
  }

  /**
   * True while the GPU is showing a pose the CPU has not caught up with.
   *
   * Which means the positions, the normals and any smoothed surface are one
   * settle behind what is on screen. Worth being able to ask, because anything
   * reading geometry - a raycast, an export, a measurement - wants the settled
   * answer rather than the one the shader is drawing.
   */
  get settlePending(): boolean {
    return this.gpuAhead;
  }

  private scheduleSettle(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.settleNow();
    }, SETTLE_MS);
  }

  /**
   * Bring the CPU side up to the pose the GPU is already showing.
   *
   * Needed for two things the vertex shader cannot do. NORMALS: displacing a
   * position in a shader does not relight it, so a strong shape moves the
   * silhouette and leaves the shading behind. SUBDIVISION: a smoothed surface
   * is evaluated from the cage by a stencil product on the CPU, which a vertex
   * shader has no way to feed.
   */
  private settleNow(): void {
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    // The shader stops contributing BEFORE the CPU takes the pose, for the
    // same reason and in the same order.
    this.gpu?.setWeights(NO_WEIGHTS);
    this.applyAll(this.weights);
    this.gpuAhead = false;
  }

  /** Re-apply the current pose, for when the shading rule changes. */
  reshade(): void {
    this.applyAll(this.weights);
  }

  reset(): void {
    this.weights.clear();
    this.settleNow();
  }

  dispose(): void {
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    this.gpu?.dispose();
    this.gpu = null;
    this.gpuAhead = false;
    this.restoreAll();
    this.meshes.length = 0;
    this.weights.clear();
    this.dirty = new Map();
    this.dirtyPoints = new Map();
  }

  // -----------------------------------------------------------------------

  /**
   * Rebuild every affected vertex from rest plus the active shapes.
   *
   * Recomputed rather than nudged, because weights move both ways and a
   * running total accumulates the error of every drag. Only the points some
   * shape touches are visited, which is what keeps this cheap: an expression
   * moves a few hundred points of twenty five thousand.
   */
  private applyAll(weights: ReadonlyMap<string, number> = this.weights): void {
    for (const entry of this.meshes) {
      const active = [...weights.entries()].filter(([name]) =>
        entry.byName.has(name)
      );

      const previous = this.dirty.get(entry);
      const touched = new Set<number>();
      const position = entry.mesh.geometry.getAttribute('position');
      const array = position.array as Float32Array;

      // Back to rest first, so a shape that was just switched off leaves
      // nothing behind.
      if (previous) {
        for (const vertex of previous) {
          array[vertex * 3] = entry.rest[vertex * 3]!;
          array[vertex * 3 + 1] = entry.rest[vertex * 3 + 1]!;
          array[vertex * 3 + 2] = entry.rest[vertex * 3 + 2]!;
        }
      }
      if (!previous && active.length === 0) continue;

      // The authored points, reset the same way and for the same reason.
      const movedPoints = this.dirtyPoints.get(entry);
      if (movedPoints) {
        for (const point of movedPoints) {
          entry.points[point * 3] = entry.restPoints[point * 3]!;
          entry.points[point * 3 + 1] = entry.restPoints[point * 3 + 1]!;
          entry.points[point * 3 + 2] = entry.restPoints[point * 3 + 2]!;
        }
      }
      const touchedPoints = new Set<number>();

      for (const [name, weight] of active) {
        const shape = entry.byName.get(name)!;
        for (let i = 0; i < shape.pointIndices.length; i++) {
          const point = shape.pointIndices[i]!;
          const dx = shape.offsets[i * 3]! * weight;
          const dy = shape.offsets[i * 3 + 1]! * weight;
          const dz = shape.offsets[i * 3 + 2]! * weight;

          if (!touchedPoints.has(point)) {
            entry.points[point * 3] = entry.restPoints[point * 3]!;
            entry.points[point * 3 + 1] = entry.restPoints[point * 3 + 1]!;
            entry.points[point * 3 + 2] = entry.restPoints[point * 3 + 2]!;
            touchedPoints.add(point);
          }
          entry.points[point * 3] = (entry.points[point * 3] ?? 0) + dx;
          entry.points[point * 3 + 1] = (entry.points[point * 3 + 1] ?? 0) + dy;
          entry.points[point * 3 + 2] = (entry.points[point * 3 + 2] ?? 0) + dz;

          const from = entry.vertexStart[point]!;
          const to = entry.vertexStart[point + 1]!;
          for (let v = from; v < to; v++) {
            const vertex = entry.vertexOf[v]!;
            if (!touched.has(vertex)) {
              // First shape to reach this vertex this pass starts from rest.
              array[vertex * 3] = entry.rest[vertex * 3]!;
              array[vertex * 3 + 1] = entry.rest[vertex * 3 + 1]!;
              array[vertex * 3 + 2] = entry.rest[vertex * 3 + 2]!;
              touched.add(vertex);
            }
            array[vertex * 3] = (array[vertex * 3] ?? 0) + dx;
            array[vertex * 3 + 1] = (array[vertex * 3 + 1] ?? 0) + dy;
            array[vertex * 3 + 2] = (array[vertex * 3 + 2] ?? 0) + dz;
          }
        }
      }

      this.dirty.set(entry, touched);
      this.dirtyPoints.set(entry, touchedPoints);
      position.needsUpdate = true;
      this.shadeAfterMoving(entry, active.length > 0);
      entry.mesh.geometry.computeBoundingSphere();

      // And the surface built from those points, if one is on screen.
      this.onPointsMoved?.(entry.mesh, entry.points);
    }

    // Once, after every mesh has moved, rather than per mesh: whatever is
    // rebuilt from the geometry should see the finished pose.
    this.onSettled?.();
  }

  /**
   * Keep the shading the file shipped with.
   *
   * Deliberately NOT recomputed. Three ways of deriving normals were tried on
   * this character and each was worse than leaving them alone:
   *
   * `computeVertexNormals` averages across VERTICES, and a renderer's geometry
   * shares none of them, so it produced one normal per triangle and turned the
   * character 80% faceted with its triangulation showing through.
   *
   * Accumulating per POINT over the authored faces fixes the faceting and
   * introduces a subtler loss: a file gives split vertices DIFFERENT normals
   * wherever it wants a hard edge, and averaging to one normal per point
   * smooths every one of those away. Measured on this character at a weight
   * small enough that the surface had not moved, 1% of its normals still
   * turned more than ten degrees, and sixteen turned more than ninety. Those
   * are its creases being erased.
   *
   * And Newell's sign follows winding order, which a file is under no
   * obligation to match: computed normals sat 178 degrees from the authored
   * ones here, lighting the mesh inside out.
   *
   * So the normals stay as authored. The cost is honest and small: on a strong
   * shape the lighting does not follow the new silhouette, so a bulge is lit
   * as though it had not bulged. The alternative is a surface that is lit
   * wrongly in ways an artist would recognise instantly as not their model,
   * and this panel exists for checking that markers still sit right on a face
   * that moves, not for judging its lighting.
   */
  private shadeAfterMoving(entry: MeshShapes, deformed: boolean): void {
    const normals = entry.mesh.geometry.getAttribute('normal');
    if (!normals || !entry.restNormals) return;
    const out = normals.array as Float32Array;

    if (!deformed || !this.recomputeNormals) {
      out.set(entry.restNormals);
      normals.needsUpdate = true;
      return;
    }

    // ROTATED, NOT REBUILT.
    //
    // The surface's own normal at a point turns by some amount when a shape
    // moves it. Applying that same turn to each authored normal at that point
    // is what Unreal does, and it is the only approach here that survives
    // contact with a real character:
    //
    //   Rebuilding smooth normals per point erases every hard edge, because a
    //   file gives split vertices DIFFERENT normals precisely where it wants a
    //   crease. Rotating moves each of those independently, so the crease
    //   turns with the surface instead of being averaged away.
    //
    //   The winding problem disappears too. Newell's sign follows the face
    //   order, which a file need not match, and getting it wrong lit this
    //   character inside out. Here the sign appears in the rest normal and the
    //   deformed one alike, so it cancels.
    const rest = entry.restPointNormals ?? pointNormals(entry, entry.restPoints);
    entry.restPointNormals = rest;
    const now = pointNormals(entry, entry.points);

    const points = rest.length / 3;
    for (let point = 0; point < points; point++) {
      const ax = rest[point * 3] ?? 0;
      const ay = rest[point * 3 + 1] ?? 0;
      const az = rest[point * 3 + 2] ?? 0;
      const bx = now[point * 3] ?? 0;
      const by = now[point * 3 + 1] ?? 0;
      const bz = now[point * 3 + 2] ?? 0;

      const from = entry.vertexStart[point] ?? 0;
      const to = entry.vertexStart[point + 1] ?? from;
      const dot = ax * bx + ay * by + az * bz;

      // Barely turned, or degenerate: leave the authored normals alone rather
      // than pushing them through a rotation that is mostly rounding error.
      if (dot > 0.999999 || !Number.isFinite(dot)) {
        for (let v = from; v < to; v++) {
          const at = (entry.vertexOf[v] ?? 0) * 3;
          out[at] = entry.restNormals[at] ?? 0;
          out[at + 1] = entry.restNormals[at + 1] ?? 0;
          out[at + 2] = entry.restNormals[at + 2] ?? 0;
        }
        continue;
      }

      // Rodrigues, about the axis between the two.
      let kx = ay * bz - az * by;
      let ky = az * bx - ax * bz;
      let kz = ax * by - ay * bx;
      const klen = Math.hypot(kx, ky, kz);
      if (klen < 1e-9) continue;
      kx /= klen;
      ky /= klen;
      kz /= klen;
      const angle = Math.acos(Math.min(1, Math.max(-1, dot)));
      const c = Math.cos(angle);
      const sn = Math.sin(angle);

      for (let v = from; v < to; v++) {
        const at = (entry.vertexOf[v] ?? 0) * 3;
        const nx = entry.restNormals[at] ?? 0;
        const ny = entry.restNormals[at + 1] ?? 0;
        const nz = entry.restNormals[at + 2] ?? 0;
        const kd = kx * nx + ky * ny + kz * nz;
        out[at] = nx * c + (ky * nz - kz * ny) * sn + kx * kd * (1 - c);
        out[at + 1] = ny * c + (kz * nx - kx * nz) * sn + ky * kd * (1 - c);
        out[at + 2] = nz * c + (kx * ny - ky * nx) * sn + kz * kd * (1 - c);
      }
    }
    normals.needsUpdate = true;
  }

  private restoreAll(): void {
    for (const entry of this.meshes) {
      const position = entry.mesh.geometry.getAttribute('position');
      if (!position) continue;
      (position.array as Float32Array).set(entry.rest);
      position.needsUpdate = true;
      this.shadeAfterMoving(entry, false);
      entry.points.set(entry.restPoints);
      this.onPointsMoved?.(entry.mesh, entry.points);
    }
  }
}

/**
 * One normal per authored point, from the faces around it.
 *
 * Newell's method, which is right for an n-gon and for a face that is not
 * quite planar. The sign follows winding order and is not corrected here on
 * purpose: this is only ever used to compare a rest normal with a deformed
 * one, and a sign present in both cancels.
 */
function pointNormals(entry: MeshShapes, points: Float32Array): Float32Array {
  const counts = entry.faceVertexCounts;
  const indices = entry.faceVertexIndices;
  const out = new Float32Array(points.length);

  let corner = 0;
  for (let f = 0; f < counts.length; f++) {
    const n = counts[f] ?? 0;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < n; i++) {
      const a = (indices[corner + i] ?? 0) * 3;
      const b = (indices[corner + ((i + 1) % n)] ?? 0) * 3;
      const ax = points[a] ?? 0;
      const ay = points[a + 1] ?? 0;
      const az = points[a + 2] ?? 0;
      const bx = points[b] ?? 0;
      const by = points[b + 1] ?? 0;
      const bz = points[b + 2] ?? 0;
      nx += (ay - by) * (az + bz);
      ny += (az - bz) * (ax + bx);
      nz += (ax - bx) * (ay + by);
    }
    for (let i = 0; i < n; i++) {
      const at = (indices[corner + i] ?? 0) * 3;
      out[at] = (out[at] ?? 0) + nx;
      out[at + 1] = (out[at + 1] ?? 0) + ny;
      out[at + 2] = (out[at + 2] ?? 0) + nz;
    }
    corner += n;
  }

  for (let i = 0; i < out.length; i += 3) {
    const length = Math.hypot(out[i] ?? 0, out[i + 1] ?? 0, out[i + 2] ?? 0);
    if (length > 1e-12) {
      out[i] = (out[i] ?? 0) / length;
      out[i + 1] = (out[i + 1] ?? 0) / length;
      out[i + 2] = (out[i + 2] ?? 0) / length;
    }
  }
  return out;
}

/**
 * Which render vertices belong to each authored point.
 *
 * Matched on position, which is exact rather than approximate here: three
 * builds its geometry from the same points this reads, so a render vertex sits
 * exactly on the point it was split from. Returns null when they do not line
 * up, which means the two are describing different geometry and no shape
 * should be applied through the result.
 */
function mapPointsToVertices(
  points: Float32Array,
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute
): {
  start: Uint32Array;
  vertices: Uint32Array;
  pointOfVertex: Uint32Array;
} | null {
  const pointCount = points.length / 3;
  const vertexCount = position.count;
  if (pointCount === 0 || vertexCount === 0) return null;

  const key = (x: number, y: number, z: number): string =>
    `${Math.round(x / WELD)},${Math.round(y / WELD)},${Math.round(z / WELD)}`;

  const byPosition = new Map<string, number>();
  for (let p = 0; p < pointCount; p++) {
    const x = points[p * 3] ?? 0;
    const y = points[p * 3 + 1] ?? 0;
    const z = points[p * 3 + 2] ?? 0;
    byPosition.set(key(x, y, z), p);
  }

  const owner = new Int32Array(vertexCount).fill(-1);
  const counts = new Uint32Array(pointCount + 1);
  let matched = 0;

  for (let v = 0; v < vertexCount; v++) {
    const point = byPosition.get(
      key(position.getX(v), position.getY(v), position.getZ(v))
    );
    if (point === undefined) continue;
    owner[v] = point;
    counts[point + 1] = (counts[point + 1] ?? 0) + 1;
    matched++;
  }

  // A few unmatched vertices would mean a shape with holes in it. Most of them
  // matching is not good enough for something that moves a face.
  if (matched < vertexCount * 0.999) return null;

  for (let p = 0; p < pointCount; p++) {
    counts[p + 1] = (counts[p + 1] ?? 0) + (counts[p] ?? 0);
  }
  const start = counts;
  const vertices = new Uint32Array(matched);
  const cursor = new Uint32Array(pointCount);

  for (let v = 0; v < vertexCount; v++) {
    const point = owner[v]!;
    if (point < 0) continue;
    vertices[(start[point] ?? 0) + (cursor[point] ?? 0)] = v;
    cursor[point] = (cursor[point] ?? 0) + 1;
  }

  const pointOfVertex = new Uint32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) pointOfVertex[v] = Math.max(0, owner[v] ?? 0);

  return { start, vertices, pointOfVertex };
}
