// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// How the character is shaded: lit, flat, wireframe, or lit with wireframe.
//
// These are not decoration. Each answers a question the others cannot:
//
//   lit             what the character looks like. Materials, lighting, IBL.
//   flat            faceted shading, so every polygon's own plane is visible.
//                   Smooth shading hides topology; this shows what is really
//                   there, which is what you want before trusting a surface.
//   wireframe       edges alone, seen through. The only way to judge whether a
//                   marker meant for a joint centre is actually inside the
//                   limb rather than stuck to the near side of it.
//   lit wireframe   both, for placing on a dense mesh where the silhouette
//                   alone does not say where an edge loop runs.
//
// Two things make this fiddlier than swapping a material.
//
// SUBDIVISION. What the camera draws is not always the mesh this is handed. At
// subdivision level 0 the cage is displayed; above it, a limit-surface child
// is. The mode has to follow whatever is currently on screen, which is why
// `refresh` exists and why RiserApp calls it after every subdivision change.
//
// ORIGINAL MATERIALS. The asset's own materials must survive, because "lit" has
// to be able to return to exactly what the file described. They are stashed per
// mesh rather than rebuilt, and restored on dispose.
// ==========================================================================

import * as THREE from 'three';

export type ViewMode = 'lit' | 'flat' | 'wireframe' | 'litWireframe';

export const VIEW_MODES: readonly { id: ViewMode; label: string; hint: string }[] = [
  { id: 'lit', label: 'Lit', hint: 'The character as its materials describe it' },
  { id: 'flat', label: 'Flat', hint: 'Faceted shading, so every polygon is visible' },
  {
    id: 'wireframe',
    label: 'Wire',
    hint: 'Edges only, seen through - shows whether a guide is inside the volume'
  },
  { id: 'litWireframe', label: 'Lit wire', hint: 'Lit surface with its edges drawn over' }
];

export const DEFAULT_VIEW_MODE: ViewMode = 'lit';

/** Edge colour. Deliberately dim: the wireframe is context, not the subject. */
const WIRE_COLOR = 0x8d97a5;
const WIRE_OPACITY = 0.55;

/** Key under which a mesh's own material is kept while a mode overrides it. */
const ORIGINAL = 'riserOriginalMaterial';
/** Name given to the edge overlay, so it can be found and removed again. */
const WIRE_NAME = 'RiserWireframe';

/**
 * Applies a view mode to whichever meshes are currently displayed.
 *
 * Takes a getter rather than a list, because the set of displayed meshes
 * changes underneath it every time the subdivision level does.
 */
export class ViewModeController {
  private mode: ViewMode = DEFAULT_VIEW_MODE;
  /** Whether the character's surface is drawn at all - the Geometry toggle. */
  private surfaceVisible = true;
  private flatMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private wireMaterial: THREE.LineBasicMaterial | null = null;
  private hiddenMaterial: THREE.Material | null = null;
  /** Meshes this has touched, so they can all be put back on dispose. */
  private touched = new Set<THREE.Mesh>();

  constructor(
    private readonly displayedMeshes: () => THREE.Mesh[],
    /**
     * Quad edges for a displayed mesh, when subdivision can supply them.
     *
     * Optional because the view modes work perfectly well without it: the
     * triangle wireframe is what a renderer really draws. It is only wrong
     * once a surface is subdivided, where every quad carries the diagonal it
     * was triangulated along and the edge flow disappears into noise.
     */
    private readonly quadEdgesFor?: (mesh: THREE.Mesh) => THREE.BufferGeometry | null
  ) {}

  get current(): ViewMode {
    return this.mode;
  }

  setMode(mode: ViewMode): void {
    this.mode = mode;
    this.refresh();
  }

  /**
   * Show or hide the character's surface, independently of the shading mode.
   *
   * Hidden the same way `wireframe` suppresses the surface - an invisible
   * MATERIAL rather than `mesh.visible = false` - so the mesh stays pickable.
   * That is deliberate: someone who hides the geometry to see their markers
   * clearly still expects to be able to click the character and place one.
   */
  setSurfaceVisible(visible: boolean): void {
    if (this.surfaceVisible === visible) return;
    this.surfaceVisible = visible;
    this.refresh();
  }

  get isSurfaceVisible(): boolean {
    return this.surfaceVisible;
  }

  /**
   * Re-apply the current mode.
   *
   * Called after anything that changes what is on screen - a new character, a
   * subdivision level change - because a freshly built limit surface carries
   * the material it was constructed with and knows nothing about view modes.
   */
  refresh(): void {
    const meshes = this.displayedMeshes();
    const live = new Set(meshes);

    // Anything no longer displayed gets its own material back, or a rebuilt
    // limit surface would strand a flat clone on a mesh nobody can see.
    for (const mesh of this.touched) {
      if (!live.has(mesh)) this.restore(mesh);
    }

    for (const mesh of meshes) {
      this.stashOriginal(mesh);
      this.touched.add(mesh);
      this.applyTo(mesh);
    }
  }

  private applyTo(mesh: THREE.Mesh): void {
    const original = mesh.userData[ORIGINAL] as
      | THREE.Material
      | THREE.Material[]
      | undefined;

    // Hidden outright, whatever the mode says. The edge overlay goes too: a
    // wireframe is a way of drawing the geometry, so "don't draw the geometry"
    // has to mean it as well, or turning Geometry off in wireframe mode would
    // appear to do nothing.
    if (!this.surfaceVisible) {
      mesh.material = this.hidden();
      mesh.visible = true;
      this.setWireframe(mesh, false);
      return;
    }

    switch (this.mode) {
      case 'lit':
      case 'litWireframe':
        if (original) mesh.material = original;
        mesh.visible = true;
        break;

      case 'flat':
        mesh.material = this.flatFor(mesh);
        mesh.visible = true;
        break;

      case 'wireframe':
        // The surface is suppressed so the edges of the far side show through,
        // which is the whole point of looking at a wireframe when checking
        // whether a joint centre is inside a limb.
        //
        // Suppressed via an invisible MATERIAL, not `mesh.visible = false`.
        // three skips the children of an invisible object, and the wireframe
        // is a child - hiding the mesh would take the edges with it and leave
        // an empty viewport.
        mesh.material = this.hidden();
        mesh.visible = true;
        break;
    }

    const wanted = this.mode === 'wireframe' || this.mode === 'litWireframe';
    this.setWireframe(mesh, wanted);
  }

  /**
   * Flat shading, as a clone.
   *
   * A clone rather than a mutation of the original: `flatShading` is a property
   * of the material, and setting it in place would silently change how the
   * asset looks in every other mode too.
   */
  private flatFor(mesh: THREE.Mesh): THREE.Material | THREE.Material[] {
    const existing = this.flatMaterials.get(mesh);
    if (existing) return existing;

    const original = mesh.userData[ORIGINAL] as THREE.Material | THREE.Material[];
    const makeFlat = (material: THREE.Material): THREE.Material => {
      const clone = material.clone();
      (clone as THREE.MeshStandardMaterial).flatShading = true;
      clone.needsUpdate = true;
      return clone;
    };

    const flat = Array.isArray(original)
      ? original.map(makeFlat)
      : makeFlat(original);
    this.flatMaterials.set(mesh, flat);
    return flat;
  }

  /**
   * Add or remove the edge overlay.
   *
   * A child LineSegments rather than `material.wireframe = true`, for two
   * reasons: it can be drawn over a lit surface (which the material flag
   * cannot, since it replaces the surface), and it keeps its own colour and
   * opacity instead of inheriting whatever the asset's material happens to be.
   *
   * The overlay sits on the character's own layer, not the overlay layer, so
   * that hiding markers and curves does not also hide the wireframe - they are
   * different kinds of thing to the user.
   */
  private setWireframe(mesh: THREE.Mesh, wanted: boolean): void {
    const existing = mesh.getObjectByName(WIRE_NAME) as THREE.LineSegments | undefined;

    if (!wanted) {
      if (existing) {
        mesh.remove(existing);
        existing.geometry.dispose();
      }
      return;
    }
    if (existing) {
      existing.visible = true;
      return;
    }

    const geometry =
      this.quadEdgesFor?.(mesh) ?? new THREE.WireframeGeometry(mesh.geometry);
    const lines = new THREE.LineSegments(geometry, this.wire());
    lines.name = WIRE_NAME;
    // Never pickable: the guide tools raycast the character, and an edge
    // overlay in that list would let a marker bind to a line.
    lines.raycast = () => {};
    lines.matrixAutoUpdate = false;
    lines.updateMatrix();
    lines.renderOrder = 1;
    mesh.add(lines);
  }

  /** A material that draws nothing, leaving the object itself visible. */
  private hidden(): THREE.Material {
    if (!this.hiddenMaterial) {
      this.hiddenMaterial = new THREE.MeshBasicMaterial({ visible: false });
    }
    return this.hiddenMaterial;
  }

  private wire(): THREE.LineBasicMaterial {
    if (!this.wireMaterial) {
      this.wireMaterial = new THREE.LineBasicMaterial({
        color: WIRE_COLOR,
        transparent: true,
        opacity: WIRE_OPACITY,
        depthWrite: false,
        // Overlay colours are user interface, not lit surface, and must not be
        // shifted by the renderer's tone mapping - the same reason markers and
        // curves opt out.
        toneMapped: false
      });
    }
    return this.wireMaterial;
  }

  private stashOriginal(mesh: THREE.Mesh): void {
    if (mesh.userData[ORIGINAL] === undefined) {
      mesh.userData[ORIGINAL] = mesh.material;
    }
  }

  private restore(mesh: THREE.Mesh): void {
    const original = mesh.userData[ORIGINAL] as
      | THREE.Material
      | THREE.Material[]
      | undefined;
    if (original) mesh.material = original;
    mesh.visible = true;
    this.setWireframe(mesh, false);

    const flat = this.flatMaterials.get(mesh);
    if (flat) {
      if (Array.isArray(flat)) flat.forEach((m) => m.dispose());
      else flat.dispose();
      this.flatMaterials.delete(mesh);
    }
  }

  dispose(): void {
    for (const mesh of this.touched) this.restore(mesh);
    this.touched.clear();
    this.wireMaterial?.dispose();
    this.wireMaterial = null;
    this.hiddenMaterial?.dispose();
    this.hiddenMaterial = null;
  }
}
