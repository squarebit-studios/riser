// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Drawing the character's own skeleton, as bones.
//
// Riser already READS a rig - automatic placement puts a guide at every joint
// it can name - but until recently there was no way to SEE one. That made the
// most exact thing the app does the least inspectable: when a guide landed
// somewhere surprising, you could not tell whether the rig was odd or the name
// matching was.
//
// IT USED TO BE DOTS, and dots were the wrong shape for it. A sphere at every
// joint is exactly what a marker is, in a scene whose entire subject is
// markers, so the one overlay that is NOT something you placed looked like the
// things you did. It also said less: a dot has no direction, so a chain of
// them cannot show which way a joint faces or where one bone ends and the next
// begins, which at a spine or a finger is the only question worth asking.
//
// So they are drawn the way every rig in every DCC is drawn: an octahedron per
// bone, running from its head to its tail, widest a tenth of the way along.
// Somebody who has opened Blender or Unreal already knows how to read it, and
// it cannot be mistaken for a marker.
//
// The faces are shaded by hand rather than by a light. This overlay has to be
// legible whatever the scene lighting is doing, including none, so the colour
// is baked per face: a flat unlit solid would be a silhouette with no form.
// ==========================================================================

import * as THREE from 'three';

/** Bone colour. Warm, to read as different from markers and curves. */
const BONE_COLOR = 0xffb454;
/** How wide a bone is at its widest, as a fraction of its own length. */
const BONE_WIDTH = 0.1;
/** Where along the bone that widest ring sits. */
const BONE_SHOULDER = 0.12;
/**
 * Widest a bone may be, as a fraction of the whole rig.
 *
 * Without it a single long bone - a root that reaches the floor, a prop bone
 * off to one side - becomes a slab that hides the rig it belongs to.
 */
const BONE_WIDTH_CAP = 0.02;

const UP = new THREE.Vector3(0, 1, 0);

/**
 * A skeleton overlay for one character.
 *
 * One instanced octahedron per bone that has a parent, which is the same set
 * of segments `THREE.SkeletonHelper` would draw: a bone's tail is its child's
 * head, and three does not store a tail of its own.
 */
export class SkeletonView {
  readonly object = new THREE.Group();

  private mesh: THREE.InstancedMesh | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.MeshBasicMaterial | null = null;
  /** Head and tail of each drawn bone, as the pair that positions it. */
  private segments: { head: THREE.Bone; tail: THREE.Bone }[] = [];
  private widthCap = Infinity;

  constructor() {
    this.object.name = 'RiserSkeleton';
    // Never pickable. The marker tools raycast whatever is in the scene, and a
    // bone in that list would let a guide bind to the rig instead of the mesh.
    this.object.raycast = () => {};
    this.object.visible = false;
  }

  /** True when there is a rig to show. Drives whether the toggle is offered. */
  get hasSkeleton(): boolean {
    return this.mesh !== null;
  }

  setCharacter(root: THREE.Object3D | null): void {
    this.clear();
    if (!root) return;

    const bones = collectBones(root);
    this.segments = [];
    for (const bone of bones) {
      const parent = bone.parent;
      if (parent && (parent as THREE.Bone).isBone) {
        this.segments.push({ head: parent as THREE.Bone, tail: bone });
      }
    }
    if (this.segments.length === 0) return;

    // Sized against the rig's own extent, so a character authored in
    // centimetres does not get bones the size of the room.
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    for (const bone of bones) {
      bone.updateWorldMatrix(true, false);
      box.expandByPoint(point.setFromMatrixPosition(bone.matrixWorld));
    }
    this.widthCap = Math.max(box.getSize(new THREE.Vector3()).length(), 1e-6) *
      BONE_WIDTH_CAP;

    this.geometry = octahedron();
    this.material = new THREE.MeshBasicMaterial({
      color: BONE_COLOR,
      // The per-face shading, which is what gives an unlit solid its form.
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      toneMapped: false,
      depthWrite: false
    });
    this.mesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      this.segments.length
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.raycast = () => {};
    this.object.add(this.mesh);

    this.setXray(true);
    this.update();
  }

  setVisible(visible: boolean): void {
    this.object.visible = visible && this.mesh !== null;
  }

  /**
   * Whether the skeleton is drawn through the character.
   *
   * A skeleton is inside the body, so depth testing hides it exactly where it
   * matters, which is why this was pinned on. It is a choice rather than a law
   * though: seeing which bones are actually behind the surface is the whole
   * point of turning it off, and it now follows the same switch as the markers
   * and curves instead of ignoring it.
   */
  setXray(xray: boolean): void {
    if (!this.material) return;
    this.material.depthTest = !xray;
    this.material.needsUpdate = true;
  }

  /**
   * Follow the bones.
   *
   * Every frame rather than on demand, because a rig can be driven by
   * anything: the point is that it is never stale.
   */
  update(): void {
    const mesh = this.mesh;
    if (!mesh || !this.object.visible) return;

    const head = new THREE.Vector3();
    const tail = new THREE.Vector3();
    const direction = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const matrix = new THREE.Matrix4();

    for (let i = 0; i < this.segments.length; i++) {
      const segment = this.segments[i] as { head: THREE.Bone; tail: THREE.Bone };
      segment.head.updateWorldMatrix(true, false);
      segment.tail.updateWorldMatrix(true, false);
      head.setFromMatrixPosition(segment.head.matrixWorld);
      tail.setFromMatrixPosition(segment.tail.matrixWorld);

      direction.subVectors(tail, head);
      const length = direction.length();
      if (length < 1e-9) {
        // Two joints in the same place. Drawing a zero length bone gives a
        // degenerate matrix, so it is collapsed out of sight instead.
        matrix.makeScale(0, 0, 0);
        mesh.setMatrixAt(i, matrix);
        continue;
      }

      rotation.setFromUnitVectors(UP, direction.normalize());
      const width = Math.min(length * BONE_WIDTH, this.widthCap);
      // Length along the bone, capped width across it: a long bone stays long
      // without becoming a slab.
      scale.set(width / BONE_WIDTH, length, width / BONE_WIDTH);
      matrix.compose(head, rotation, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.clear();
  }

  // -----------------------------------------------------------------------

  private clear(): void {
    if (this.mesh) {
      this.object.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = null;
    }
    this.geometry?.dispose();
    this.geometry = null;
    this.material?.dispose();
    this.material = null;
    this.segments = [];
  }
}

/**
 * A bone, pointing along +Y, one unit long.
 *
 * Head at the origin, tail at (0, 1, 0), and a square ring a little way along
 * where it is widest. Eight triangles: four from the head out to the ring,
 * four from the ring in to the tail.
 *
 * Not indexed, and coloured per face. Both are for the same reason: the shape
 * has to read as a solid with no light on it, which means every triangle needs
 * its own normal and its own brightness rather than sharing them with its
 * neighbours.
 */
function octahedron(): THREE.BufferGeometry {
  const w = BONE_WIDTH;
  const s = BONE_SHOULDER;

  const head = new THREE.Vector3(0, 0, 0);
  const tail = new THREE.Vector3(0, 1, 0);
  const ring = [
    new THREE.Vector3(w, s, 0),
    new THREE.Vector3(0, s, w),
    new THREE.Vector3(-w, s, 0),
    new THREE.Vector3(0, s, -w)
  ];

  const positions: number[] = [];
  const colors: number[] = [];

  // Four brightnesses around the bone, so turning it shows which way it faces.
  // Held well clear of black: this is a tint on the material colour, not a
  // light, and a face that goes dark reads as a hole rather than a shadow.
  const shade = [1, 0.78, 0.6, 0.78];

  const face = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, tint: number) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) colors.push(tint, tint, tint);
  };

  for (let i = 0; i < 4; i++) {
    const current = ring[i] as THREE.Vector3;
    const next = ring[(i + 1) % 4] as THREE.Vector3;
    const tint = shade[i] as number;
    face(head, next, current, tint);
    face(current, next, tail, tint);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Every bone under `root`, in a stable order. */
function collectBones(root: THREE.Object3D): THREE.Bone[] {
  const bones: THREE.Bone[] = [];
  root.traverse((child) => {
    if ((child as THREE.Bone).isBone) bones.push(child as THREE.Bone);
  });
  return bones;
}
