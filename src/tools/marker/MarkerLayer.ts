// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Drawing the guide markers.
//
// One InstancedMesh for every marker, so a fully marked-up biped costs a
// single draw call rather than sixty. Colour is per-instance; state changes
// (hover, select, place) rewrite one attribute rather than rebuilding a scene
// graph, which is what keeps hover feedback free.
//
// Two decisions worth stating:
//
//  * Markers draw with depthTest off. Half the guides in a rig are INSIDE the
//    character - elbow and hip centres, the eyeballs - and a marker you cannot
//    see is a marker you cannot check. X-ray is the default for that reason,
//    and can be turned off for the surface-feature pass.
//
//  * Marker size is recomputed per frame from distance to camera, so a marker
//    stays the same size on screen at any zoom. Without this you either lose
//    them when zoomed out or they swallow the face when zoomed in.
// ==========================================================================

import * as THREE from 'three';
import { LAYER_OVERLAY } from '../../viewport/Viewport';
import { GUIDE_COLORS, type GuideVisualState } from '../../viewport/palette';

/**
 * Marker diameter as a fraction of the visible world height at the marker's
 * distance - which is the same thing as a fraction of the viewport height on
 * screen, at any zoom.
 */
const SCREEN_FRACTION = 0.012;
const MIN_WORLD_RADIUS = 1e-4;
const MAX_INSTANCES = 512;
const DEFAULT_RADIUS = 0.01;

/**
 * State names are looked up in the layer's palette rather than fixed to the
 * guide states, so the curve tool can reuse this layer for its control
 * vertices instead of carrying a near-identical copy.
 */
export type PointPalette = Readonly<Record<string, number>>;

export interface MarkerVisual {
  id: string;
  position: THREE.Vector3;
  state: string;
}

/** Internal record: the visual plus the radius the last update computed. */
interface MarkerEntry extends MarkerVisual {
  radius: number;
}

export type { GuideVisualState };

const _matrix = new THREE.Matrix4();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();
const _cameraPos = new THREE.Vector3();
const NO_ROTATION = new THREE.Quaternion();

export class MarkerLayer {
  readonly mesh: THREE.InstancedMesh;

  private readonly entries: MarkerEntry[] = [];
  private readonly indexById = new Map<string, number>();
  /** Instance index -> marker id, for turning a raycast hit into a guide. */
  private readonly idByIndex: string[] = [];
  private readonly screenFraction: number;

  constructor(
    parent: THREE.Object3D,
    private readonly palette: PointPalette = GUIDE_COLORS,
    scaleFraction = SCREEN_FRACTION
  ) {
    this.screenFraction = scaleFraction;
    // Low-poly on purpose: at roughly ten pixels across nobody counts the
    // facets, and 512 instances of a 32-segment sphere wastes vertex work.
    const geometry = new THREE.SphereGeometry(1, 12, 8);
    const material = new THREE.MeshBasicMaterial({
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
      toneMapped: false
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES);
    this.mesh.name = 'MarkerLayer';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1000;
    this.mesh.layers.set(LAYER_OVERLAY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_INSTANCES * 3),
      3
    );
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    parent.add(this.mesh);
  }

  get count(): number {
    return this.mesh.count;
  }

  /** Replace the whole marker set. Cheap enough to call on every document change. */
  setMarkers(markers: MarkerVisual[]): void {
    this.entries.length = 0;
    this.indexById.clear();
    this.idByIndex.length = 0;

    const count = Math.min(markers.length, MAX_INSTANCES);
    for (let i = 0; i < count; i++) {
      const marker = markers[i] as MarkerVisual;
      this.entries.push({
        id: marker.id,
        position: marker.position.clone(),
        state: marker.state,
        radius: DEFAULT_RADIUS
      });
      this.indexById.set(marker.id, i);
      this.idByIndex[i] = marker.id;
    }
    this.mesh.count = count;

    for (let i = 0; i < count; i++) {
      this.writeColor(i, this.entries[i]!.state);
      this.writeMatrix(i);
    }
    this.flush();
  }

  /** Change one marker's state without rebuilding the set. */
  setState(id: string, state: string): void {
    const index = this.indexById.get(id);
    if (index === undefined) return;
    const entry = this.entries[index];
    if (!entry || entry.state === state) return;
    entry.state = state;
    this.writeColor(index, state);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Move one marker. Used during a drag, where a rebuild would be wasteful. */
  setPosition(id: string, position: THREE.Vector3): void {
    const index = this.indexById.get(id);
    if (index === undefined) return;
    this.entries[index]?.position.copy(position);
    this.writeMatrix(index);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  stateOf(id: string): string | null {
    const index = this.indexById.get(id);
    return index === undefined ? null : (this.entries[index]?.state ?? null);
  }

  positionOf(id: string): THREE.Vector3 | null {
    const index = this.indexById.get(id);
    return index === undefined ? null : (this.entries[index]?.position ?? null);
  }

  /**
   * Keep markers a constant size on screen. Called every frame; the cost is
   * one matrix write per marker, which is nothing next to a draw call.
   */
  update(camera: THREE.PerspectiveCamera): void {
    if (this.mesh.count === 0) return;

    camera.getWorldPosition(_cameraPos);
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);

    for (let i = 0; i < this.mesh.count; i++) {
      const entry = this.entries[i];
      if (!entry) continue;
      const distance = _cameraPos.distanceTo(entry.position);
      // World height the viewport spans at this distance, times the fraction
      // of the screen a marker should occupy.
      entry.radius = Math.max(
        MIN_WORLD_RADIUS,
        distance * tanHalfFov * this.screenFraction
      );
      this.writeMatrix(i);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Which marker is under the pointer, if any. Raycasts the instanced mesh
   * directly - three reports an instanceId, which maps straight back to an id.
   *
   * The caller passes a raycaster configured for the overlay layer; the
   * character's own picker uses a separate one so the two never interfere.
   */
  hitTest(raycaster: THREE.Raycaster): string | null {
    if (this.mesh.count === 0 || !this.mesh.visible) return null;
    const hits = raycaster.intersectObject(this.mesh, false);
    for (const hit of hits) {
      if (hit.instanceId === undefined) continue;
      const id = this.idByIndex[hit.instanceId];
      if (id) return id;
    }
    return null;
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  /** Turn X-ray off to check which markers are genuinely on the surface. */
  setXray(xray: boolean): void {
    const material = this.mesh.material as THREE.MeshBasicMaterial;
    if (material.depthTest === !xray) return;
    material.depthTest = !xray;
    material.needsUpdate = true;
  }

  private writeMatrix(index: number): void {
    const entry = this.entries[index];
    if (!entry) return;
    _scale.setScalar(entry.radius);
    _matrix.compose(entry.position, NO_ROTATION, _scale);
    this.mesh.setMatrixAt(index, _matrix);
  }

  private writeColor(index: number, state: string): void {
    // An unknown state name is a bug, but a magenta dot the user can see and
    // report beats a silent black one that reads as a rendering glitch.
    _color.setHex(this.palette[state] ?? 0xff00ff);
    this.mesh.setColorAt(index, _color);
  }

  private flush(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
