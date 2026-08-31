// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Drawing the character's own skeleton.
//
// Riser already READS a rig - Tier 0 automatic placement puts a guide at every
// joint it can name - but until now there was no way to SEE one. That made the
// most exact thing the app does the least inspectable: when a guide landed
// somewhere surprising, you could not tell whether the rig was odd or the name
// matching was.
//
// Drawn through the mesh on purpose. A skeleton is inside the character, so a
// depth-tested one is invisible exactly when it matters. This is the same
// reasoning as the marker layer's x-ray mode, and the same trade: the joints
// read as being in front of the surface rather than inside it, which is worth
// less than being able to see them at all.
// ==========================================================================

import * as THREE from 'three';

/** Bone colour. Warm, to read as different from markers and curves. */
const BONE_COLOR = 0xffb454;
/** Joint colour, slightly brighter so the joints read as the points of it. */
const JOINT_COLOR = 0xffd9a0;
/** Joint dot size, as a fraction of the skeleton's own extent. */
const JOINT_SCALE = 0.012;

/**
 * A skeleton overlay for one character.
 *
 * `THREE.SkeletonHelper` draws the bones; the joints are ours, because the
 * helper draws lines alone and a chain of lines does not show where a joint
 * actually sits when two bones are nearly collinear - which is precisely the
 * case at a spine or a finger.
 */
export class SkeletonView {
  readonly object = new THREE.Group();

  private helper: THREE.SkeletonHelper | null = null;
  private joints: THREE.InstancedMesh | null = null;
  private jointGeometry: THREE.SphereGeometry | null = null;
  private jointMaterial: THREE.MeshBasicMaterial | null = null;
  private bones: THREE.Bone[] = [];

  constructor() {
    this.object.name = 'RiserSkeleton';
    // Never pickable. The marker tools raycast whatever is in the scene, and a
    // bone in that list would let a guide bind to the rig instead of the mesh.
    this.object.raycast = () => {};
    this.object.visible = false;
  }

  /** True when there is a rig to show. Drives whether the toggle is offered. */
  get hasSkeleton(): boolean {
    return this.helper !== null;
  }

  /**
   * Show the skeleton belonging to `root`, or nothing if it has none.
   *
   * Takes the root rather than a `THREE.Skeleton` because `SkeletonHelper`
   * wants an object to walk: it finds the bones itself and, importantly, keeps
   * following their world matrices afterwards.
   */
  setCharacter(root: THREE.Object3D | null): void {
    this.clear();
    if (!root) return;

    this.bones = collectBones(root);
    if (this.bones.length === 0) return;

    const helper = new THREE.SkeletonHelper(root);
    // Seen through the character, which is where a skeleton always is.
    const material = helper.material as THREE.LineBasicMaterial;
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = true;
    material.opacity = 0.9;
    material.toneMapped = false;
    material.color = new THREE.Color(BONE_COLOR);
    helper.renderOrder = 3;
    helper.raycast = () => {};
    this.helper = helper;
    this.object.add(helper);

    this.buildJoints();
  }

  setVisible(visible: boolean): void {
    this.object.visible = visible && this.helper !== null;
  }

  /**
   * Follow the bones.
   *
   * `SkeletonHelper` updates itself, but the joint dots are our own instances
   * and have to be moved. Called every frame rather than on demand because a
   * rig can be driven by anything - the point is that it is never stale.
   */
  update(): void {
    if (!this.joints || !this.object.visible) return;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const rotation = new THREE.Quaternion();

    for (let i = 0; i < this.bones.length; i++) {
      const bone = this.bones[i]!;
      bone.updateWorldMatrix(true, false);
      bone.matrixWorld.decompose(position, rotation, scale);
      // Position only. A bone's own scale would make the dot an ellipsoid, and
      // its rotation cannot be seen on a sphere.
      matrix.compose(position, IDENTITY, this.jointSize);
      this.joints.setMatrixAt(i, matrix);
    }
    this.joints.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.clear();
  }

  // -----------------------------------------------------------------------

  private jointSize = new THREE.Vector3(1, 1, 1);

  private buildJoints(): void {
    // Sized against the rig's own extent, so a character authored in
    // centimetres does not get joints the size of the room.
    const box = new THREE.Box3();
    const point = new THREE.Vector3();
    for (const bone of this.bones) {
      bone.updateWorldMatrix(true, false);
      box.expandByPoint(point.setFromMatrixPosition(bone.matrixWorld));
    }
    const extent = box.getSize(new THREE.Vector3()).length();
    const radius = Math.max(extent * JOINT_SCALE, 1e-6);
    this.jointSize = new THREE.Vector3(radius, radius, radius);

    this.jointGeometry = new THREE.SphereGeometry(1, 8, 6);
    this.jointMaterial = new THREE.MeshBasicMaterial({
      color: JOINT_COLOR,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
      toneMapped: false
    });

    const joints = new THREE.InstancedMesh(
      this.jointGeometry,
      this.jointMaterial,
      this.bones.length
    );
    joints.frustumCulled = false;
    joints.renderOrder = 4;
    joints.raycast = () => {};
    this.joints = joints;
    this.object.add(joints);

    this.update();
  }

  private clear(): void {
    if (this.helper) {
      this.object.remove(this.helper);
      (this.helper.material as THREE.Material).dispose();
      this.helper.geometry.dispose();
      this.helper = null;
    }
    if (this.joints) {
      this.object.remove(this.joints);
      this.joints.dispose();
      this.joints = null;
    }
    this.jointGeometry?.dispose();
    this.jointGeometry = null;
    this.jointMaterial?.dispose();
    this.jointMaterial = null;
    this.bones = [];
    this.object.visible = false;
  }
}

const IDENTITY = new THREE.Quaternion();

/** Every bone under `root`, in a stable order. */
function collectBones(root: THREE.Object3D): THREE.Bone[] {
  const bones: THREE.Bone[] = [];
  root.traverse((child) => {
    if ((child as THREE.Bone).isBone) bones.push(child as THREE.Bone);
  });
  return bones;
}
