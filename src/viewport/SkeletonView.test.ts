import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SkeletonView } from './SkeletonView';

/** A two-bone chain inside a skinned mesh, the way a loaded rig arrives. */
function riggedCharacter(): THREE.Object3D {
  const root = new THREE.Group();
  const hip = new THREE.Bone();
  hip.name = 'Hip';
  const spine = new THREE.Bone();
  spine.name = 'Spine';
  spine.position.set(0, 1, 0);
  hip.add(spine);

  const mesh = new THREE.SkinnedMesh(
    new THREE.BoxGeometry(1, 2, 1),
    new THREE.MeshStandardMaterial()
  );
  mesh.add(hip);
  mesh.bind(new THREE.Skeleton([hip, spine]));
  root.add(mesh);
  return root;
}

function unriggedCharacter(): THREE.Object3D {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
  return root;
}

/** The instanced bones, which is the only mesh the view draws. */
function bones(view: SkeletonView): THREE.InstancedMesh | undefined {
  return view.object.children.find(
    (c) => (c as THREE.InstancedMesh).isInstancedMesh
  ) as THREE.InstancedMesh | undefined;
}

describe('showing a character its own skeleton', () => {
  it('finds a rig and reports it', () => {
    const view = new SkeletonView();
    view.setCharacter(riggedCharacter());
    expect(view.hasSkeleton).toBe(true);
  });

  it('reports nothing for a character with no rig', () => {
    // The toggle is disabled off the back of this, so a wrong answer here is
    // a control that does nothing when pressed.
    const view = new SkeletonView();
    view.setCharacter(unriggedCharacter());
    expect(view.hasSkeleton).toBe(false);
  });

  it('starts hidden, and stays hidden without a rig', () => {
    const view = new SkeletonView();
    expect(view.object.visible).toBe(false);

    view.setCharacter(unriggedCharacter());
    view.setVisible(true);
    // Asking to show a skeleton that does not exist must not leave an empty
    // group switched on - that would draw the previous character's rig.
    expect(view.object.visible).toBe(false);
  });

  it('shows and hides on request once there is a rig', () => {
    const view = new SkeletonView();
    view.setCharacter(riggedCharacter());

    view.setVisible(true);
    expect(view.object.visible).toBe(true);
    view.setVisible(false);
    expect(view.object.visible).toBe(false);
  });

  it('draws a bone per link, not a dot per joint', () => {
    // Two joints make ONE bone between them. Counting joints instead was what
    // made the rig read as a scatter of markers rather than a skeleton.
    const view = new SkeletonView();
    view.setCharacter(riggedCharacter());

    const instanced = bones(view);
    expect(instanced).toBeDefined();
    expect(instanced!.count).toBe(1);
  });

  it('runs the bone from its head to its tail', () => {
    const view = new SkeletonView();
    view.setCharacter(riggedCharacter());
    view.setVisible(true);
    view.update();

    const matrix = new THREE.Matrix4();
    bones(view)!.getMatrixAt(0, matrix);

    // The geometry is a unit bone along +Y, so the instance starts at the
    // parent joint and its Y scale is the distance to the child.
    const head = new THREE.Vector3().setFromMatrixPosition(matrix);
    expect(head.y).toBeCloseTo(0, 5);

    const scale = new THREE.Vector3().setFromMatrixScale(matrix);
    expect(scale.y).toBeCloseTo(1, 5);

    // And it points at the child rather than merely being the right length.
    const tail = new THREE.Vector3(0, 1, 0).applyMatrix4(matrix);
    expect(tail.y).toBeCloseTo(1, 5);
    expect(tail.x).toBeCloseTo(0, 5);
    expect(tail.z).toBeCloseTo(0, 5);
  });

  it('is much thinner than it is long, so it reads as a bone', () => {
    // Measured on the geometry in world space, not on the scale vector. The
    // unit bone is already a tenth as wide as it is long, so equal scale
    // components are correct and comparing them proves nothing.
    const view = new SkeletonView();
    view.setCharacter(riggedCharacter());
    view.update();

    const mesh = bones(view)!;
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(0, matrix);

    const position = mesh.geometry.getAttribute('position');
    const vertex = new THREE.Vector3();
    let widest = 0;
    let longest = 0;
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(matrix);
      widest = Math.max(widest, Math.hypot(vertex.x, vertex.z));
      longest = Math.max(longest, vertex.y);
    }
    expect(longest).toBeCloseTo(1, 5);
    expect(widest).toBeLessThan(longest * 0.2);
    expect(widest).toBeGreaterThan(0);
  });

  it('follows the x-ray switch instead of always drawing through', () => {
    const view = new SkeletonView();
    view.setCharacter(riggedCharacter());
    const material = bones(view)!.material as THREE.Material;

    view.setXray(true);
    expect(material.depthTest).toBe(false);
    // Turning it off is the whole point of the control: it is how you see
    // which bones are actually behind the surface.
    view.setXray(false);
    expect(material.depthTest).toBe(true);
  });

  it('does not fall over when two joints share a position', () => {
    // A zero length bone has no direction, so the matrix that would aim it is
    // degenerate. It must collapse rather than produce NaN.
    const root = new THREE.Group();
    const a = new THREE.Bone();
    const b = new THREE.Bone();
    a.add(b); // b sits exactly on a
    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1));
    mesh.add(a);
    mesh.bind(new THREE.Skeleton([a, b]));
    root.add(mesh);

    const view = new SkeletonView();
    view.setCharacter(root);
    view.setVisible(true);
    expect(() => view.update()).not.toThrow();

    const matrix = new THREE.Matrix4();
    bones(view)!.getMatrixAt(0, matrix);
    for (const value of matrix.elements) expect(Number.isFinite(value)).toBe(true);
  });

  it('is never pickable', () => {
    // The marker tools raycast the scene. A bone in that list would let a
    // guide bind to the rig instead of the mesh.
    const view = new SkeletonView();
    view.setCharacter(riggedCharacter());

    const hits: THREE.Intersection[] = [];
    view.object.traverse((child) => {
      child.raycast(new THREE.Raycaster(), hits);
    });
    expect(hits).toEqual([]);
  });

  it('drops the old rig when a new character arrives', () => {
    const view = new SkeletonView();
    view.setCharacter(riggedCharacter());
    expect(view.object.children.length).toBeGreaterThan(0);

    view.setCharacter(unriggedCharacter());
    expect(view.hasSkeleton).toBe(false);
    expect(view.object.children.length).toBe(0);
  });

  it('clears on dispose', () => {
    const view = new SkeletonView();
    view.setCharacter(riggedCharacter());
    view.dispose();
    expect(view.hasSkeleton).toBe(false);
    expect(view.object.children.length).toBe(0);
  });

  it('survives being updated with nothing loaded', () => {
    const view = new SkeletonView();
    expect(() => view.update()).not.toThrow();
    view.setCharacter(null);
    expect(() => view.update()).not.toThrow();
  });
});
