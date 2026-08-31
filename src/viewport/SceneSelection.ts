// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Selecting and hiding the pieces a character is made of.
//
// A blockout is one mesh and needs none of this. A real character is not: Gary
// is 33 separate pieces with clothing layered over skin, and two things follow
// from that which a marker tool has to answer.
//
// WHICH PIECE AM I BINDING TO. A binding names a triangle of a specific mesh,
// and on a clothed character the surface under the cursor is often the suit
// rather than the body. Being able to see the list, and to see which entry
// lights up when you select it, is how that stops being a guess.
//
// LET ME GET AT WHAT IS UNDERNEATH. A hip marker belongs on the hip, and the
// spacesuit is in the way. Hiding a piece is the whole answer, and it is why
// the visibility toggle here is not decoration.
//
// HIGHLIGHTING IS A CLONE, NOT A TINT IN PLACE. Materials are shared: a
// character with no shading of its own gets ONE clay material across all
// thirty-odd pieces, so tinting the material would light up the entire
// character. The selected mesh gets its own tinted copy and the original comes
// straight back on deselect.
//
// HIDING IS `visible`, DELIBERATELY. Unlike the Show menu's "Character"
// toggle - which hides through a material so the mesh stays clickable - hiding
// a piece here is meant to take it out of the way ENTIRELY, including out of
// the raycast. That is the point: you hide the suit so the click reaches the
// body.
// ==========================================================================

import * as THREE from 'three';

/**
 * Tint applied to the selected piece.
 *
 * Kept low on purpose. At full strength the selected piece reads as a solid
 * block of colour, and the surface form goes with it - which is the wrong
 * trade in a tool whose whole job is placing markers on that surface. It has
 * to say "this one" without hiding the thing being pointed at.
 */
const HIGHLIGHT = 0x2a6ea8;
const HIGHLIGHT_INTENSITY = 0.22;

export interface SceneItem {
  /** Prim path, which is the stable identity a binding also uses. */
  primPath: string;
  /** Leaf name, which is what a person reads. */
  name: string;
  triangles: number;
  /** True when the piece is skinned by the character's rig. */
  skinned: boolean;
  /** How many materials it carries. More than one means grouped subsets. */
  materials: number;
  visible: boolean;
}

/**
 * The character's pieces, and which one is selected.
 *
 * Owns the highlight and the visibility overrides so both are undone cleanly
 * when the character changes.
 */
export class SceneSelection {
  private meshes: THREE.Mesh[] = [];
  private selected: string | null = null;

  /** Original materials of whatever is currently highlighted. */
  private highlighted: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] } | null =
    null;

  /** Pieces the user has hidden, by prim path. */
  private readonly hidden = new Set<string>();

  setCharacter(meshes: readonly THREE.Mesh[]): void {
    this.clearHighlight();

    // Restore BEFORE swapping the list, or the lookup searches the new
    // character for the old character's pieces, finds nothing, and leaves the
    // outgoing meshes invisible for good. They are usually about to be thrown
    // away, but "usually" is not a reason to leave an object in a state its
    // owner never asked for.
    //
    // Hiding is per character either way: a new one arriving with pieces
    // missing, for a reason nothing on screen explains, is a bug report
    // waiting to happen.
    for (const path of this.hidden) this.restoreVisibility(path);
    this.hidden.clear();

    this.meshes = [...meshes];
    this.selected = null;
  }

  /** Everything in the scene, in the order the file lists it. */
  items(): SceneItem[] {
    return this.meshes.map((mesh) => {
      const primPath = (mesh.userData.primPath as string) ?? '';
      const index = mesh.geometry.getIndex();
      const position = mesh.geometry.getAttribute('position');
      const triangles = Math.floor(
        (index?.count ?? position?.count ?? 0) / 3
      );

      return {
        primPath,
        name: primPath.split('/').pop() || mesh.name || 'Mesh',
        triangles,
        skinned: (mesh as THREE.SkinnedMesh).isSkinnedMesh === true,
        materials: Array.isArray(mesh.material) ? mesh.material.length : 1,
        visible: !this.hidden.has(primPath)
      };
    });
  }

  get selectedPath(): string | null {
    return this.selected;
  }

  /** Select a piece, or clear the selection with null. */
  select(primPath: string | null): void {
    if (primPath === this.selected) return;
    this.clearHighlight();
    this.selected = primPath;
    if (!primPath) return;

    const mesh = this.meshForPath(primPath);
    if (!mesh) {
      this.selected = null;
      return;
    }
    this.highlight(mesh);
  }

  /** Show or hide one piece. */
  setVisible(primPath: string, visible: boolean): void {
    const mesh = this.meshForPath(primPath);
    if (!mesh) return;

    if (visible) {
      this.hidden.delete(primPath);
      this.restoreVisibility(primPath);
      return;
    }
    this.hidden.add(primPath);
    mesh.visible = false;
    // The subdivided display surface is a child, and hiding the parent takes
    // it with it - which is what is wanted here.
  }

  /** Show everything again. */
  showAll(): void {
    for (const path of [...this.hidden]) this.setVisible(path, true);
  }

  get hiddenCount(): number {
    return this.hidden.size;
  }

  dispose(): void {
    this.clearHighlight();
    this.hidden.clear();
    this.meshes = [];
    this.selected = null;
  }

  // -----------------------------------------------------------------------

  private meshForPath(primPath: string): THREE.Mesh | undefined {
    return this.meshes.find((m) => (m.userData.primPath as string) === primPath);
  }

  private restoreVisibility(primPath: string): void {
    const mesh = this.meshForPath(primPath);
    if (mesh) mesh.visible = true;
  }

  /**
   * Tint a clone of the mesh's material.
   *
   * Emissive rather than base colour, so the highlight reads on a dark
   * character and on a pale one alike, and so a textured piece still shows its
   * texture underneath.
   */
  private highlight(mesh: THREE.Mesh): void {
    const original = mesh.material;
    const tint = (material: THREE.Material): THREE.Material => {
      const clone = material.clone();
      const standard = clone as THREE.MeshStandardMaterial;
      if (standard.emissive) {
        standard.emissive = new THREE.Color(HIGHLIGHT);
        standard.emissiveIntensity = HIGHLIGHT_INTENSITY;
      }
      return clone;
    };

    mesh.material = Array.isArray(original) ? original.map(tint) : tint(original);
    this.highlighted = { mesh, material: original };
  }

  private clearHighlight(): void {
    const held = this.highlighted;
    if (!held) return;

    const applied = held.mesh.material;
    held.mesh.material = held.material;
    // The clones are ours and nothing else refers to them.
    for (const material of Array.isArray(applied) ? applied : [applied]) {
      material.dispose();
    }
    this.highlighted = null;
  }
}
