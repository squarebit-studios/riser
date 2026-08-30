// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Non-pickable scene furniture: ground grid, symmetry plane, axis gizmo.
//
// Everything here lives on LAYER_OVERLAY and hangs off `Viewport.overlayRoot`,
// so it is excluded from picking by construction rather than by a name check.
// ==========================================================================

import * as THREE from 'three';
import { LAYER_OVERLAY } from './Viewport';
import { VIEWPORT_COLORS } from './palette';

export class Overlays {
  readonly root = new THREE.Group();
  private grid: THREE.GridHelper | null = null;
  private symmetryPlane: THREE.Mesh | null = null;
  private dark = true;
  private gridSize = 1;
  private gridDivisions = 20;
  private gridVisible = true;

  constructor(parent: THREE.Object3D) {
    this.root.name = 'Overlays';
    this.root.layers.set(LAYER_OVERLAY);
    parent.add(this.root);
    this.buildGrid(1);
  }

  /**
   * Rebuild the grid to suit the character's size. A 175cm human and a 1.75m
   * human need very different grid spacing, and guessing wrong makes the scene
   * read as either empty or striped.
   */
  fitTo(box: THREE.Box3): void {
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.z, size.y * 0.5);
    // Round the grid to a power-of-ten-ish step so divisions land on whole units.
    const step = Math.pow(10, Math.round(Math.log10(extent / 10)));
    const half = Math.max(step * 5, extent * 1.5);
    this.buildGrid(half * 2, Math.max(2, Math.round((half * 2) / step)));
    this.buildSymmetryPlane(box);
  }

  private buildGrid(size: number, divisions = 20): void {
    this.gridSize = size;
    this.gridDivisions = divisions;
    if (this.grid) {
      this.root.remove(this.grid);
      this.grid.geometry.dispose();
      (this.grid.material as THREE.Material).dispose();
    }
    const grid = new THREE.GridHelper(
      size,
      divisions,
      this.dark ? VIEWPORT_COLORS.gridAxis : VIEWPORT_COLORS.gridAxisLight,
      this.dark ? VIEWPORT_COLORS.grid : VIEWPORT_COLORS.gridLight
    );
    const material = grid.material as THREE.LineBasicMaterial;
    material.transparent = true;
    material.opacity = 0.65;
    material.depthWrite = false;
    grid.layers.set(LAYER_OVERLAY);
    grid.renderOrder = -1;
    grid.visible = this.gridVisible;
    this.grid = grid;
    this.root.add(grid);
  }

  /**
   * A faint plane at x = 0 shown while symmetry is on, so the user can see
   * which side of the character mirrored placement will land on.
   */
  private buildSymmetryPlane(box: THREE.Box3): void {
    if (this.symmetryPlane) {
      this.root.remove(this.symmetryPlane);
      this.symmetryPlane.geometry.dispose();
      (this.symmetryPlane.material as THREE.Material).dispose();
    }
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const geometry = new THREE.PlaneGeometry(size.z * 1.2, size.y * 1.2);
    const material = new THREE.MeshBasicMaterial({
      color: 0x4ea3ff,
      transparent: true,
      opacity: 0.06,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const plane = new THREE.Mesh(geometry, material);
    plane.rotation.y = Math.PI / 2;
    plane.position.set(0, center.y, center.z);
    plane.layers.set(LAYER_OVERLAY);
    plane.visible = false;
    this.symmetryPlane = plane;
    this.root.add(plane);
  }

  setSymmetryVisible(visible: boolean): void {
    if (this.symmetryPlane) this.symmetryPlane.visible = visible;
  }

  setGridVisible(visible: boolean): void {
    this.gridVisible = visible;
    if (this.grid) this.grid.visible = visible;
  }

  setTheme(dark: boolean): void {
    if (this.dark === dark) return;
    this.dark = dark;
    // GridHelper bakes its colours into a vertex attribute, so a theme change
    // means rebuilding it at the size it already had.
    this.buildGrid(this.gridSize, this.gridDivisions);
  }

  dispose(): void {
    this.root.traverse((obj) => {
      const o = obj as Partial<THREE.Mesh>;
      o.geometry?.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    });
    this.root.removeFromParent();
  }
}
