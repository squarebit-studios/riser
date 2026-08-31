// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Surface picking, and the barycentric round trip that makes bindings work.
//
// The two directions matter equally:
//
//   pick()             screen point -> triangle + barycentric coordinate
//   evaluateBinding()  triangle + barycentric coordinate -> position
//
// The second is what runs on reload, on a character swap, and (in Python) on
// the server. If these two ever disagree, every marker the user placed moves,
// so the pair is covered by unit tests rather than trusted by eye.
// ==========================================================================

import * as THREE from 'three';
import type { SurfaceBinding, Vec3 } from '../doc/types';
import { LAYER_CAGE, LAYER_SCENE } from './Viewport';

export interface PickResult {
  /** The mesh that was hit. */
  object: THREE.Mesh;
  /** USD prim path of that mesh, from `userData.primPath`. */
  primPath: string;
  /** Hit position in world space. */
  point: THREE.Vector3;
  /** Hit position in the mesh's local space - what bindings are expressed in. */
  localPoint: THREE.Vector3;
  /** Interpolated, world-space, normalized surface normal. */
  normal: THREE.Vector3;
  faceIndex: number;
  barycentric: Vec3;
  distance: number;
}

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _bary = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _normalMatrix = new THREE.Matrix3();

/**
 * Number of triangles in a geometry, indexed or not.
 *
 * three's USD composer expands `faceVertexIndices` into flat vertex arrays, so
 * meshes loaded from USD arrive NON-indexed. Since our assets are all
 * triangles, the triangle ordinal is still the USD face ordinal either way -
 * which is what keeps a binding written in the browser meaningful to the
 * Python worker.
 */
export function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  if (index) return Math.floor(index.count / 3);
  const position = geometry.getAttribute('position');
  return position ? Math.floor(position.count / 3) : 0;
}

/**
 * Vertex indices of triangle `faceIndex`, honouring indexed and non-indexed
 * geometry. three.js reports `faceIndex` as the triangle ordinal in both cases.
 */
export function faceVertexIndices(
  geometry: THREE.BufferGeometry,
  faceIndex: number
): [number, number, number] | null {
  const index = geometry.getIndex();
  const base = faceIndex * 3;
  if (index) {
    if (base + 2 >= index.count) return null;
    return [index.getX(base), index.getX(base + 1), index.getX(base + 2)];
  }
  const position = geometry.getAttribute('position');
  if (!position || base + 2 >= position.count) return null;
  return [base, base + 1, base + 2];
}

/** Read triangle `faceIndex` into three vectors, in the geometry's local space. */
export function readTriangle(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3
): boolean {
  const idx = faceVertexIndices(geometry, faceIndex);
  if (!idx) return false;
  const position = geometry.getAttribute('position');
  if (!position) return false;
  a.fromBufferAttribute(position as THREE.BufferAttribute, idx[0]);
  b.fromBufferAttribute(position as THREE.BufferAttribute, idx[1]);
  c.fromBufferAttribute(position as THREE.BufferAttribute, idx[2]);
  return true;
}

/**
 * Barycentric coordinate of `localPoint` inside triangle `faceIndex`.
 * Returns null for a degenerate triangle, which is the only case where a pick
 * cannot produce a usable binding.
 */
export function barycentricAt(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  localPoint: THREE.Vector3
): Vec3 | null {
  if (!readTriangle(geometry, faceIndex, _v0, _v1, _v2)) return null;
  const result = THREE.Triangle.getBarycoord(localPoint, _v0, _v1, _v2, _bary);
  if (result === null) return null;
  return [_bary.x, _bary.y, _bary.z];
}

/**
 * The inverse of `barycentricAt`: recover a local-space position from a
 * binding. The server does the same arithmetic against the USD mesh, so this
 * is the definition of where a guide "is".
 */
export function evaluateBinding(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  barycentric: Vec3,
  target = new THREE.Vector3()
): THREE.Vector3 | null {
  if (!readTriangle(geometry, faceIndex, _v0, _v1, _v2)) return null;
  const [u, v, w] = barycentric;
  target.set(0, 0, 0);
  target.addScaledVector(_v0, u);
  target.addScaledVector(_v1, v);
  target.addScaledVector(_v2, w);
  return target;
}

/** Interpolated local-space normal at a binding, falling back to the face normal. */
export function evaluateBindingNormal(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  barycentric: Vec3,
  target = new THREE.Vector3()
): THREE.Vector3 | null {
  const idx = faceVertexIndices(geometry, faceIndex);
  if (!idx) return null;
  const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;

  if (normalAttr) {
    const [u, v, w] = barycentric;
    target.set(0, 0, 0);
    _tmp.fromBufferAttribute(normalAttr, idx[0]);
    target.addScaledVector(_tmp, u);
    _tmp.fromBufferAttribute(normalAttr, idx[1]);
    target.addScaledVector(_tmp, v);
    _tmp.fromBufferAttribute(normalAttr, idx[2]);
    target.addScaledVector(_tmp, w);
    if (target.lengthSq() > 1e-12) return target.normalize();
  }

  if (!readTriangle(geometry, faceIndex, _v0, _v1, _v2)) return null;
  return THREE.Triangle.getNormal(_v0, _v1, _v2, target);
}

/**
 * Resolve a stored binding to a world-space position on `mesh`, including the
 * off-surface offset. This is the function that re-places every marker after a
 * document is reloaded.
 */
export function resolveBindingWorld(
  mesh: THREE.Mesh,
  binding: SurfaceBinding,
  target = new THREE.Vector3()
): THREE.Vector3 | null {
  const local = evaluateBinding(mesh.geometry, binding.faceIndex, binding.barycentric);
  if (!local) return null;
  local.x += binding.offset[0];
  local.y += binding.offset[1];
  local.z += binding.offset[2];
  mesh.updateWorldMatrix(true, false);
  return target.copy(local).applyMatrix4(mesh.matrixWorld);
}

/**
 * Raycasts the character. Deliberately takes an explicit target list rather
 * than walking the scene, so overlays can never be picked by accident.
 */
export class Picker {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  constructor(
    private readonly camera: THREE.Camera,
    layer: number = LAYER_SCENE
  ) {
    // Only ever test one layer; markers and gizmos do their own hit testing
    // with their own pickers, and subdivision cages live on LAYER_CAGE.
    this.raycaster.layers.set(layer);
  }

  /**
   * @param x   Pointer x in CSS pixels, relative to the canvas.
   * @param y   Pointer y in CSS pixels, relative to the canvas.
   */
  pick(
    x: number,
    y: number,
    width: number,
    height: number,
    targets: THREE.Object3D[]
  ): PickResult | null {
    this.ndc.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.pickWithCurrentRay(targets);
  }

  /**
   * Pick along an explicit ray rather than through the camera. This is how a
   * mirrored placement finds its own surface point: reflecting a position
   * across the symmetry plane gives a point in space, and only a raycast turns
   * that back into a triangle the binding can name.
   */
  pickRay(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    targets: THREE.Object3D[],
    far = Infinity
  ): PickResult | null {
    this.raycaster.set(origin, direction.clone().normalize());
    this.raycaster.far = far;
    const result = this.pickWithCurrentRay(targets);
    this.raycaster.far = Infinity;
    return result;
  }

  /**
   * Every surface the ray crosses, near to far.
   *
   * The entry and exit points of a limb are what make a joint CENTRE
   * measurable rather than guessed: click an elbow, the ray enters the front
   * of the forearm and leaves the back, and the midpoint of those two is the
   * centre of the volume at that point. Nothing about it assumes a thickness,
   * a species, or a scale.
   *
   * Returns hits in distance order, so [0] is what the user sees and [1] is
   * the far side of the same piece of geometry.
   *
   * TESTED DOUBLE-SIDED, which is the whole reason this cannot be an ordinary
   * raycast. three's `Mesh.raycast` honours `material.side`, and characters
   * arrive with front-facing materials because that is what you want to RENDER
   * - so a plain ray reports only the entry face and the exit is culled. The
   * measurement then quietly finds nothing to measure, every time, on every
   * character. Materials are restored before this returns.
   */
  pickThrough(
    x: number,
    y: number,
    width: number,
    height: number,
    targets: THREE.Object3D[],
    // Generous, because layers add up: a clothed character can put a suit, a
    // collar and skin in front of the body before the ray is halfway through.
    limit = 64
  ): PickResult[] {
    this.ndc.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);

    const results: PickResult[] = [];
    withDoubleSided(targets, () => {
      for (const hit of this.raycaster.intersectObjects(targets, true)) {
        const result = this.resultFromHit(hit);
        if (result) results.push(result);
        if (results.length >= limit) break;
      }
    });
    return results;
  }

  /** `pickThrough`, along an explicit ray rather than through the camera. */
  pickThroughRay(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    targets: THREE.Object3D[],
    far = Infinity,
    limit = 64
  ): PickResult[] {
    this.raycaster.set(origin, direction.clone().normalize());
    this.raycaster.far = far;

    const results: PickResult[] = [];
    withDoubleSided(targets, () => {
      for (const hit of this.raycaster.intersectObjects(targets, true)) {
        const result = this.resultFromHit(hit);
        if (result) results.push(result);
        if (results.length >= limit) break;
      }
    });
    this.raycaster.far = Infinity;
    return results;
  }

  /** Build a `PickResult` from whatever ray the raycaster currently holds. */
  private pickWithCurrentRay(targets: THREE.Object3D[]): PickResult | null {
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const hit of hits) {
      const result = this.resultFromHit(hit);
      if (result) return result;
    }
    return null;
  }

  /**
   * One intersection, expressed in the terms a binding needs.
   *
   * Returns null for a hit that cannot be bound - no face index, or a
   * degenerate triangle with no barycentric coordinate. Callers skip those and
   * carry on to the next hit rather than failing the whole pick.
   */
  private resultFromHit(hit: THREE.Intersection): PickResult | null {
    const mesh = hit.object as THREE.Mesh;
    if (!mesh.isMesh || hit.faceIndex === undefined || hit.faceIndex === null) {
      return null;
    }

    // World -> local, because bindings live in the mesh's own space and must
    // survive the character being moved or rescaled afterwards.
    mesh.updateWorldMatrix(true, false);
    const localPoint = hit.point
      .clone()
      .applyMatrix4(new THREE.Matrix4().copy(mesh.matrixWorld).invert());

    const barycentric = barycentricAt(mesh.geometry, hit.faceIndex, localPoint);
    if (!barycentric) return null;

    const localNormal = evaluateBindingNormal(
      mesh.geometry,
      hit.faceIndex,
      barycentric
    );
    const normal = localNormal
      ? localNormal
          .clone()
          .applyMatrix3(_normalMatrix.getNormalMatrix(mesh.matrixWorld))
          .normalize()
      : new THREE.Vector3(0, 1, 0);

    return {
      object: mesh,
      primPath: (mesh.userData.primPath as string) ?? '',
      point: hit.point.clone(),
      localPoint,
      normal,
      faceIndex: hit.faceIndex,
      barycentric,
      distance: hit.distance
    };
  }
}

/**
 * Run `body` with every material under `targets` temporarily double-sided.
 *
 * Synchronous and restored in a `finally`, so nothing renders in between and
 * an exception cannot leave the character inside out.
 *
 * Keyed by material rather than by mesh because materials are shared - a
 * character with no shading of its own gets ONE clay material across all
 * thirty-odd of its pieces, and restoring per mesh would write the same
 * material back thirty times while recording it thirty times.
 */
export function withDoubleSided(targets: THREE.Object3D[], body: () => void): void {
  const saved = new Map<THREE.Material, THREE.Side>();

  for (const target of targets) {
    target.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (saved.has(material)) continue;
        saved.set(material, material.side);
        material.side = THREE.DoubleSide;
      }
    });
  }

  try {
    body();
  } finally {
    for (const [material, side] of saved) material.side = side;
  }
}

const _ndc = new THREE.Vector2();

/**
 * Point an existing raycaster through a screen position. Tools that hit-test
 * overlays keep their own raycaster (on the overlay layer) and re-aim it with
 * this, rather than allocating one per pointermove.
 */
export function aimAtScreen(
  raycaster: THREE.Raycaster,
  camera: THREE.Camera,
  x: number,
  y: number,
  width: number,
  height: number
): THREE.Raycaster {
  _ndc.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
  raycaster.setFromCamera(_ndc, camera);
  return raycaster;
}

/** Build a `SurfaceBinding` from a pick, with an optional off-surface lift. */
export function bindingFromPick(pick: PickResult, offset: Vec3 = [0, 0, 0]): SurfaceBinding {
  return {
    primPath: pick.primPath,
    faceIndex: pick.faceIndex,
    barycentric: pick.barycentric,
    offset
  };
}

// -------------------------------------------------------------------------
// Two-surface picking (subdivision)
// -------------------------------------------------------------------------

/**
 * A pick that separates WHERE THE USER CLICKED from WHAT TO BIND TO.
 *
 * With subdivision on, those are different surfaces: the user clicks the
 * smooth limit surface, but a binding can only name a triangle of the control
 * cage - which is the USD mesh, and the only thing the server can evaluate.
 * The gap between the two is carried in `offset`, which the binding format
 * already has, so nothing downstream needs to know subdivision happened.
 *
 * With subdivision off the two surfaces are the same mesh and `offset` is zero.
 */
export interface SurfacePick {
  /** The cage triangle to bind to. */
  pick: PickResult;
  /** Cage-local vector from the cage point to the clicked point. */
  offset: Vec3;
  /** World-space point the user actually clicked. */
  worldPoint: THREE.Vector3;
  /** World-space normal of the surface the user clicked. */
  normal: THREE.Vector3;
  /**
   * That same normal in CAGE-LOCAL space. Offsets live in cage-local space, so
   * anything that displaces a guide along the normal - the interior-joint push
   * - has to use this one rather than the world normal.
   */
  localNormal: THREE.Vector3;
}

/**
 * How far to search back along the normal when the cage ray misses.
 * A fraction of the mesh's bounding sphere - the cage encloses the limit
 * surface, so this only has to cross the gap between them.
 */
const CAGE_FALLBACK_REACH = 0.25;

/**
 * Picks the displayed surface and the control cage together.
 *
 * Both raycasts use the same screen ray, separated only by layer: the
 * displayed surface is on LAYER_SCENE, the cage on LAYER_CAGE. At subdivision
 * level 0 the cage sits on both layers, so the two picks find the same mesh
 * and the offset falls out as zero without a special case.
 */
export class SurfacePicker {
  private readonly displayed: Picker;
  private readonly cage: Picker;

  constructor(camera: THREE.Camera) {
    this.displayed = new Picker(camera, LAYER_SCENE);
    this.cage = new Picker(camera, LAYER_CAGE);
  }

  pick(
    x: number,
    y: number,
    width: number,
    height: number,
    targets: THREE.Object3D[]
  ): SurfacePick | null {
    const visible = this.displayed.pick(x, y, width, height, targets);
    if (!visible) return null;

    let cage = this.cage.pick(x, y, width, height, targets);

    if (!cage) {
      // Near a silhouette the screen ray can graze the limit surface and miss
      // the cage. The cage encloses the limit surface, so shooting back along
      // the normal from the clicked point finds it.
      const radius = boundingRadius(visible.object);
      const reach = Math.max(radius * CAGE_FALLBACK_REACH, 1e-4);
      const origin = visible.point.clone().addScaledVector(visible.normal, reach);
      cage = this.cage.pickRay(
        origin,
        visible.normal.clone().negate(),
        targets,
        reach * 2
      );
    }

    return finishSurfacePick(cage, visible);
  }

  /**
   * Every DISPLAYED surface the ray crosses, near to far.
   *
   * The displayed surface rather than the cage, because this measures the
   * volume the user can see: on a subdivided character the cage sits outside
   * the limit surface, so measuring across it would report a limb thicker than
   * the one on screen.
   */
  pickThrough(
    x: number,
    y: number,
    width: number,
    height: number,
    targets: THREE.Object3D[]
  ): PickResult[] {
    return this.displayed.pickThrough(x, y, width, height, targets);
  }

  /**
   * Every displayed surface an explicit ray crosses. The mirrored counterpart
   * of `pickThrough`, for placements that come from a reflected ray rather
   * than a screen position.
   */
  pickThroughRay(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    targets: THREE.Object3D[],
    far = Infinity
  ): PickResult[] {
    return this.displayed.pickThroughRay(origin, direction, targets, far);
  }

  /**
   * The same two-surface pick along an explicit ray. Used by mirroring, which
   * has a reflected ray rather than a screen position.
   */
  pickAlongRay(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    targets: THREE.Object3D[],
    far = Infinity
  ): SurfacePick | null {
    const visible = this.displayed.pickRay(origin, direction, targets, far);
    if (!visible) return null;

    let cage = this.cage.pickRay(origin, direction, targets, far);
    if (!cage) {
      const radius = boundingRadius(visible.object);
      const reach = Math.max(radius * CAGE_FALLBACK_REACH, 1e-4);
      cage = this.cage.pickRay(
        visible.point.clone().addScaledVector(visible.normal, reach),
        visible.normal.clone().negate(),
        targets,
        reach * 2
      );
    }
    return finishSurfacePick(cage, visible);
  }
}

/**
 * Resolve the cage pick, falling back to the displayed surface itself.
 *
 * When no subdivision surface has been built, nothing is on LAYER_CAGE and the
 * cage raycast finds nothing - but the mesh the user clicked IS the cage in
 * that case, so binding to it is exactly right. Returning null here instead
 * would make picking silently depend on a SubdivSet having been created, which
 * is coupling no caller should have to know about.
 *
 * The fallback is gated on a prim path, so it can never bind to a generated
 * limit mesh: those are created by SubdivSurface and never carry one.
 */
function finishSurfacePick(
  cage: PickResult | null,
  visible: PickResult
): SurfacePick | null {
  if (cage) return buildSurfacePick(cage, visible);
  if (!visible.primPath) return null;
  return buildSurfacePick(visible, visible);
}

function buildSurfacePick(cage: PickResult, visible: PickResult): SurfacePick {
  cage.object.updateWorldMatrix(true, false);
  const toLocal = new THREE.Matrix4().copy(cage.object.matrixWorld).invert();
  const localNormal = visible.normal
    .clone()
    .applyMatrix3(new THREE.Matrix3().setFromMatrix4(cage.object.matrixWorld).invert())
    .normalize();

  const localClicked = visible.point.clone().applyMatrix4(toLocal);

  return {
    pick: cage,
    offset: [
      localClicked.x - cage.localPoint.x,
      localClicked.y - cage.localPoint.y,
      localClicked.z - cage.localPoint.z
    ],
    worldPoint: visible.point.clone(),
    normal: visible.normal.clone(),
    localNormal
  };
}

function boundingRadius(mesh: THREE.Mesh): number {
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  return mesh.geometry.boundingSphere?.radius ?? 1;
}
