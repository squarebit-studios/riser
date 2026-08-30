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

  constructor(private readonly camera: THREE.Camera) {
    // Only ever test the scene layer; markers and gizmos do their own hit
    // testing with their own pickers.
    this.raycaster.layers.set(0);
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

  /** Build a `PickResult` from whatever ray the raycaster currently holds. */
  private pickWithCurrentRay(targets: THREE.Object3D[]): PickResult | null {
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const hit of hits) {
      const mesh = hit.object as THREE.Mesh;
      if (!mesh.isMesh || hit.faceIndex === undefined || hit.faceIndex === null) continue;

      // World -> local, because bindings live in the mesh's own space and must
      // survive the character being moved or rescaled afterwards.
      mesh.updateWorldMatrix(true, false);
      const localPoint = hit.point.clone().applyMatrix4(
        new THREE.Matrix4().copy(mesh.matrixWorld).invert()
      );

      const barycentric = barycentricAt(mesh.geometry, hit.faceIndex, localPoint);
      if (!barycentric) continue;

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
    return null;
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
