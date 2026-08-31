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

  it('draws a joint for every bone', () => {
    const view = new SkeletonView();
    view.setCharacter(riggedCharacter());

    const instanced = view.object.children.find(
      (c) => (c as THREE.InstancedMesh).isInstancedMesh
    ) as THREE.InstancedMesh | undefined;
    expect(instanced).toBeDefined();
    expect(instanced!.count).toBe(2);
  });

  it('puts the joints where the bones are', () => {
    const character = riggedCharacter();
    const view = new SkeletonView();
    view.setCharacter(character);
    view.setVisible(true);
    view.update();

    const instanced = view.object.children.find(
      (c) => (c as THREE.InstancedMesh).isInstancedMesh
    ) as THREE.InstancedMesh;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    instanced.getMatrixAt(1, matrix);
    position.setFromMatrixPosition(matrix);
    // The child bone sits one unit up from its parent.
    expect(position.y).toBeCloseTo(1, 5);
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
