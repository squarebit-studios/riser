// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The loaded character: its meshes, its skeleton if it has one, and the
// prim-path map that bindings resolve through.
//
// Guides bind to PRIM PATHS, never to three.js object UUIDs. A UUID is
// regenerated on every load, so a document saved in one session would fail to
// re-bind in the next. A prim path is stable across loads of the same asset,
// and is the same string the server sees when it opens the USD stage.
// ==========================================================================

import * as THREE from 'three';
import { visibleBounds } from './normalize';
import { PATHS } from '../doc/usda-writer';

export interface CharacterSource {
  /** Where the asset came from - a URL, or the name of an uploaded file. */
  ref: string;
  format: 'usd' | 'gltf' | 'fbx' | 'obj';
  /** Units the source declared, if it declared any. */
  metersPerUnit: number | null;
  upAxis: 'Y' | 'Z' | null;
}

export class CharacterModel {
  readonly root: THREE.Group;
  readonly source: CharacterSource;
  readonly meshes: THREE.Mesh[] = [];
  readonly skeleton: THREE.Skeleton | null;

  /**
   * Clips the asset arrived with.
   *
   * Kept rather than dropped, which is what used to happen: USD and FBX hang
   * their clips off the root group and glTF returns them beside the scene, and
   * all three were being read for geometry and thrown away. A character that
   * shipped with its own walk cycle should not need the walk cycle uploading
   * again separately.
   */
  readonly animations: THREE.AnimationClip[];

  private readonly byPrimPath = new Map<string, THREE.Mesh>();

  constructor(
    root: THREE.Group,
    source: CharacterSource,
    animations: readonly THREE.AnimationClip[] = []
  ) {
    this.root = root;
    this.source = source;
    this.animations = [...animations];

    // Paths are stamped as they will appear in the Riser layer, so a binding
    // written here resolves unchanged when OpenUSD opens the layer.
    assignPrimPaths(root, PATHS.character);

    let skeleton: THREE.Skeleton | null =
      (root as THREE.Group & { skeleton?: THREE.Skeleton }).skeleton ?? null;

    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;

      // Picking needs an index and normals; some OBJ and USD meshes arrive
      // with neither. Doing it once here keeps every later raycast honest.
      if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();

      this.meshes.push(mesh);
      const path = mesh.userData.primPath as string;
      if (path) this.byPrimPath.set(path, mesh);

      const skinned = mesh as THREE.SkinnedMesh;
      if (!skeleton && skinned.isSkinnedMesh && skinned.skeleton) {
        skeleton = skinned.skeleton;
      }
    });

    this.skeleton = skeleton;
  }

  /** World-space bounds of the visible geometry. */
  get bounds(): THREE.Box3 {
    return visibleBounds(this.root);
  }

  /** The mesh a binding refers to, or undefined if the asset no longer has it. */
  meshForPrimPath(primPath: string): THREE.Mesh | undefined {
    return this.byPrimPath.get(primPath);
  }

  get primPaths(): string[] {
    return [...this.byPrimPath.keys()];
  }

  /**
   * The mesh a binding should fall back to when its recorded prim path is
   * gone - the largest one, which for a character is the body. Used when the
   * user loads a document against a different build of the same character.
   */
  get primaryMesh(): THREE.Mesh | undefined {
    let best: THREE.Mesh | undefined;
    let bestCount = -1;
    for (const mesh of this.meshes) {
      const count = mesh.geometry.getAttribute('position')?.count ?? 0;
      if (count > bestCount) {
        bestCount = count;
        best = mesh;
      }
    }
    return best;
  }

  /** Named joints from the skeleton, for the nearest-joint hint. */
  get jointNames(): string[] {
    return this.skeleton?.bones.map((b) => b.name) ?? [];
  }

  /**
   * Closest skeleton joint to a world-space point, or null when the asset is
   * unrigged. This is a hint shown in the inspector, never a constraint.
   */
  nearestJoint(
    worldPoint: THREE.Vector3
  ): { name: string; distance: number; bone: THREE.Bone } | null {
    if (!this.skeleton || this.skeleton.bones.length === 0) return null;
    const p = new THREE.Vector3();
    let best: { name: string; distance: number; bone: THREE.Bone } | null = null;
    for (const bone of this.skeleton.bones) {
      bone.getWorldPosition(p);
      const distance = p.distanceTo(worldPoint);
      if (!best || distance < best.distance) {
        best = { name: bone.name, distance, bone };
      }
    }
    return best;
  }
}

/**
 * Walk the hierarchy and stamp every object with the prim path it will have
 * IN THE RISER LAYER - not the path it has in its own asset file.
 *
 * This distinction is the whole point of the function. three's USDLoader
 * returns a group standing in for the stage's pseudo-root, so a mesh in our
 * stock asset is at `/Character/Geom/Body` there. But the layer REFERENCES
 * that asset onto `/Riser/Character`, and USD maps the asset's default prim
 * onto the referencing prim - so the same mesh is at
 * `/Riser/Character/Geom/Body` on any stage that opens the layer.
 *
 * Writing the asset-local path would produce bindings that resolve in the
 * browser and resolve to nothing on the server. So the default prim's own name
 * is collapsed into the prefix, exactly as referencing does.
 *
 * Names are sanitised the way USD requires and de-duplicated per parent. USD
 * guarantees sibling names are unique, so the suffix never fires on a real USD
 * asset; glTF and FBX make no such promise, which is why it exists.
 */
export function assignPrimPaths(
  root: THREE.Object3D,
  prefix = '',
  collapseSingleRoot = true
): void {
  const usedByParent = new Map<THREE.Object3D, Set<string>>();

  const visit = (obj: THREE.Object3D, parentPath: string): void => {
    for (const child of obj.children) {
      let name = sanitizePrimName(child.name || child.type);

      let used = usedByParent.get(obj);
      if (!used) {
        used = new Set();
        usedByParent.set(obj, used);
      }
      if (used.has(name)) {
        let n = 1;
        while (used.has(`${name}_${n}`)) n++;
        name = `${name}_${n}`;
      }
      used.add(name);

      const path = `${parentPath}/${name}`;
      child.userData.primPath = path;
      visit(child, path);
    }
  };

  root.userData.primPath = prefix;

  // A single root child IS the asset's default prim, and referencing replaces
  // its name with the referencing prim's. Collapse it so our paths match.
  const onlyChild = root.children.length === 1 ? root.children[0] : undefined;
  if (collapseSingleRoot && onlyChild) {
    onlyChild.userData.primPath = prefix;
    visit(onlyChild, prefix);
    return;
  }

  visit(root, prefix);
}

/** USD prim names must be C-style identifiers. */
export function sanitizePrimName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned || 'Prim';
}
