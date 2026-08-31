// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Placing, moving and mirroring guide markers.
//
// The interaction model, in full:
//
//   click on the mesh        place the active guide there, advance the
//                            checklist to the next unplaced one
//   click on a marker        select it (and make it the active guide)
//   drag a marker            slide it across the surface, re-binding as it
//                            goes, so it is never floating off the skin
//   alt-drag a marker        lift it along its normal, into or out of the
//                            volume - this is how joint centres are set
//   delete / backspace       remove the selected guide
//
// Mirroring deserves a note. Reflecting a position across the symmetry plane
// gives a point in SPACE, which is not enough: a binding has to name a
// triangle. So the mirrored point is turned back into a real surface pick by
// casting a ray at it along the mirrored normal. If that misses - an asymmetric
// character, an arm behind the back - the mirror is skipped rather than
// guessed, because a guide bound to the wrong triangle is worse than one the
// user places by hand.
// ==========================================================================

import * as THREE from 'three';
import type { CharacterModel } from '../../io/CharacterModel';
import type { DocumentStore } from '../../doc/history';
import * as M from '../../doc/mutations';
import type { Guide, TemplateDef, Vec3 } from '../../doc/types';
import { unplacedGuideIds } from '../../doc/types';
import {
  aimAtScreen,
  bindingFromPick,
  type PickResult,
  type SurfacePick,
  type SurfacePicker
} from '../../viewport/Picker';
import { LAYER_OVERLAY, type Viewport } from '../../viewport/Viewport';
import { documentToWorld, worldToDocument } from '../../viewport/space';
import { mirrorPick } from '../mirror';
import {
  pointOnCameraPlane,
  resolvePlacement,
  type PlacementMode
} from '../placement';
import { nearestPointOnMeshes, offsetToTarget } from '../../viewport/nearest';
import { guideDef } from '../../templates';
import type { Tool, ToolPointerEvent } from '../types';
import type { MarkerLayer } from './MarkerLayer';


/** Metres of lift per pixel of alt-drag, scaled by character height. */
const LIFT_PER_PIXEL_FRACTION = 0.0006;

export interface MarkerToolDeps {
  viewport: Viewport;
  picker: SurfacePicker;
  /** How a click should be interpreted: on the skin, inside, or free. */
  getPlacementMode?: () => PlacementMode;
  layer: MarkerLayer;
  store: DocumentStore;
  getCharacter: () => CharacterModel | null;
  /** Anchor for document space - see RiserApp.documentRoot. */
  getDocumentRoot: () => THREE.Object3D;
  getTemplate: () => TemplateDef;
  getActiveGuideId: () => string | null;
  setActiveGuideId: (id: string | null) => void;
  getSelectedGuideId: () => string | null;
  setSelectedGuideId: (id: string | null) => void;
  isSymmetryEnabled: () => boolean;
  /** Surfaced in the UI when a mirror could not find a surface to bind to. */
  onNotice?: (message: string) => void;
}

type DragMode = 'none' | 'surface' | 'lift';

export class MarkerTool implements Tool {
  readonly id = 'marker' as const;

  private readonly overlayRaycaster = new THREE.Raycaster();
  private hoveredId: string | null = null;

  private dragMode: DragMode = 'none';
  private dragGuideId: string | null = null;
  private liftAccumulator = 0;
  /** Owned rather than allocated per move: free dragging fires every frame. */
  private readonly freeRaycaster = new THREE.Raycaster();

  constructor(private readonly deps: MarkerToolDeps) {
    this.overlayRaycaster.layers.set(LAYER_OVERLAY);
  }

  activate(): void {
    this.deps.viewport.renderer.domElement.style.cursor = 'crosshair';
  }

  deactivate(): void {
    this.deps.viewport.renderer.domElement.style.cursor = '';
    this.clearHover();
    this.dragMode = 'none';
    this.dragGuideId = null;
  }

  // -----------------------------------------------------------------------
  // Pointer handling
  // -----------------------------------------------------------------------

  onPointerDown(event: ToolPointerEvent): boolean {
    if (event.button !== 0) return false;

    const markerId = this.markerUnderPointer(event);
    if (!markerId) return false;

    // Grabbing an existing marker claims the gesture, so the camera does not
    // tumble underneath the drag.
    this.dragGuideId = markerId;
    this.dragMode = event.altKey ? 'lift' : 'surface';
    this.liftAccumulator = 0;
    this.deps.setSelectedGuideId(markerId);
    this.deps.setActiveGuideId(markerId);
    return true;
  }

  onPointerMove(event: ToolPointerEvent): boolean {
    if (this.dragMode !== 'none' && this.dragGuideId) {
      if (this.dragMode === 'lift') return this.dragLift(event);
      // Free placement means the marker does not stick to the mesh, so the
      // drag moves it in the plane of the screen instead of sliding it along
      // the surface. Alt still lifts, in every mode.
      return this.placementMode() === 'free'
        ? this.dragFreely(event)
        : this.dragAcrossSurface(event);
    }
    this.updateHover(event);
    return false;
  }

  onPointerUp(event: ToolPointerEvent): boolean {
    const wasDragging = this.dragMode !== 'none';
    this.dragMode = 'none';
    this.dragGuideId = null;
    if (wasDragging) return true;

    // A click that landed on a marker was already handled as a selection in
    // onPointerDown; only a click on the mesh places anything.
    if (!event.isClick || event.button !== 0) return false;
    if (this.markerUnderPointer(event)) return false;

    return this.placeAtPointer(event);
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return false;
    const selected = this.deps.getSelectedGuideId();
    if (!selected) return false;

    const label = guideDef(this.deps.getTemplate(), selected)?.label ?? selected;
    this.deps.store.apply((d) => M.removeGuide(d, selected), `Remove ${label}`);
    this.deps.setSelectedGuideId(null);
    return true;
  }

  update(): void {
    this.deps.layer.update(this.deps.viewport.camera);
  }

  // -----------------------------------------------------------------------
  // Placement
  // -----------------------------------------------------------------------

  private placeAtPointer(event: ToolPointerEvent): boolean {
    const character = this.deps.getCharacter();
    const activeId = this.deps.getActiveGuideId();
    if (!character || !activeId) return false;

    const pick = this.pickSurface(event.x, event.y);
    if (!pick) return false;

    const template = this.deps.getTemplate();
    const def = guideDef(template, activeId);
    if (!def) return false;

    // Every crossing of the click ray, so a centre placement can be measured
    // rather than assumed. Gathered once and reused by the mirrored guide,
    // which shoots its own ray.
    const through = this.pickThrough(event.x, event.y);

    const guides: Guide[] = [
      this.guideFromPick(activeId, def.group, pick, !!def.interior, through)
    ];

    // Mirror before committing, so both guides land in one undo step.
    if (this.deps.isSymmetryEnabled() && def.mirror) {
      const mirrorDef = guideDef(template, def.mirror);
      const mirrored = this.mirrorPick(pick);
      if (mirrored && mirrorDef) {
        guides.push(
          this.guideFromPick(def.mirror, mirrorDef.group, mirrored, !!mirrorDef.interior)
        );
      } else if (mirrorDef) {
        this.deps.onNotice?.(
          `Placed ${def.label}, but could not find a surface for ${mirrorDef.label}. Place it by hand.`
        );
      }
    }

    this.deps.store.apply((d) => M.placeGuides(d, guides), `Place ${def.label}`);
    this.deps.setSelectedGuideId(activeId);
    this.advanceToNextUnplaced(guides.map((g) => g.id));
    return true;
  }

  private guideFromPick(
    id: string,
    group: string,
    surface: SurfacePick,
    interior: boolean,
    through?: readonly PickResult[]
  ): Guide {
    // The placement mode decides what the click meant; the result is a single
    // cage-local offset that composes the two displacements at play:
    //
    //   surface.offset   cage -> the smooth point the user actually clicked
    //                    (zero when subdivision is off)
    //   -localNormal*d   the inward push that puts a joint inside the volume
    //                    rather than on the skin
    const placement = resolvePlacement(this.placementMode(), surface, {
      interior,
      through,
      characterHeight: this.characterHeight()
    });
    const offset = placement.offset;

    if (!placement.measured) {
      // Worth saying: this is the one case where the depth is a guess rather
      // than a measurement, and the user is the only one who can fix it.
      this.deps.onNotice?.(
        'Could not measure the thickness here, so this joint was placed at an ' +
          'estimated depth. Alt-drag to set it.'
      );
    }

    // The document stores character-local coordinates, which is the space the
    // server evaluates bindings in.
    const local = this.localFromPick(surface.pick, offset);

    return {
      id,
      group,
      position: [local.x, local.y, local.z],
      normal: [surface.normal.x, surface.normal.y, surface.normal.z],
      binding: bindingFromPick(surface.pick, offset),
      // Anything placed through this tool is a deliberate act, including a
      // drag that adjusts an auto-placed guide - which is exactly when the
      // provenance has to flip, so a later fit stops overwriting it.
      source: 'user',
      confidence: 1
    };
  }

  /** Move the checklist on to whatever still needs placing. */
  private advanceToNextUnplaced(justPlaced: string[]): void {
    const template = this.deps.getTemplate();
    const remaining = unplacedGuideIds(this.deps.store.document, template);
    const next = remaining.find((id) => !justPlaced.includes(id));
    this.deps.setActiveGuideId(next ?? null);
  }

  // -----------------------------------------------------------------------
  // Dragging
  // -----------------------------------------------------------------------

  private dragAcrossSurface(event: ToolPointerEvent): boolean {
    const id = this.dragGuideId;
    if (!id) return false;

    const pick = this.pickSurface(event.x, event.y);
    if (!pick) return true; // Off the mesh - hold position rather than snap away.

    const existing = this.deps.store.document.guides.find((g) => g.id === id);
    // Preserve whatever lift the guide already had, measured along its normal,
    // so sliding across the surface does not drag a joint centre back out to
    // the skin. The cage-to-limit part of the offset is recomputed from the new
    // pick; only the user's own lift carries over.
    const carriedLift = existing ? this.liftOf(existing) : 0;
    const n = pick.localNormal;
    const offset: Vec3 = [
      pick.offset[0] + n.x * carriedLift,
      pick.offset[1] + n.y * carriedLift,
      pick.offset[2] + n.z * carriedLift
    ];

    const local = this.localFromPick(pick.pick, offset);
    const binding = bindingFromPick(pick.pick, offset);
    const normal: Vec3 = [pick.normal.x, pick.normal.y, pick.normal.z];

    this.deps.store.apply(
      (d) => M.moveGuide(d, id, [local.x, local.y, local.z], normal, binding),
      `Move ${guideDef(this.deps.getTemplate(), id)?.label ?? id}`,
      { coalesceKey: `move:${id}` }
    );
    return true;
  }

  /**
   * Move a marker in the plane of the screen, ignoring the mesh.
   *
   * The plane passes through the marker's current position, so the marker
   * tracks the cursor exactly and does not jump on the first movement.
   *
   * It is still bound afterwards - to the nearest point on the character, with
   * the rest carried as offset. A marker that did not bind could not be
   * re-evaluated against new geometry by the worker, and re-evaluation is the
   * whole reason the document stores bindings rather than coordinates.
   */
  private dragFreely(event: ToolPointerEvent): boolean {
    const id = this.dragGuideId;
    const character = this.deps.getCharacter();
    if (!id || !character) return false;

    const guide = this.deps.store.document.guides.find((g) => g.id === id);
    if (!guide) return false;

    const current = documentToWorld(this.deps.getDocumentRoot(), guide.position);
    const { width, height } = this.deps.viewport.size;
    aimAtScreen(
      this.freeRaycaster,
      this.deps.viewport.camera,
      event.x,
      event.y,
      width,
      height
    );
    const target = pointOnCameraPlane(
      this.freeRaycaster,
      this.deps.viewport.camera,
      current
    );
    if (!target) return true;

    const nearest = nearestPointOnMeshes(character.meshes, target);
    if (!nearest) return true;

    const offset = offsetToTarget(nearest, target);
    const local = worldToDocument(this.deps.getDocumentRoot(), target.clone());
    const binding = {
      primPath: nearest.primPath,
      faceIndex: nearest.faceIndex,
      barycentric: nearest.barycentric,
      offset
    };

    this.deps.store.apply(
      (d) => M.moveGuide(d, id, local, guide.normal, binding),
      `Move ${guideDef(this.deps.getTemplate(), id)?.label ?? id}`,
      { coalesceKey: `move:${id}` }
    );
    return true;
  }

  private dragLift(event: ToolPointerEvent): boolean {
    const id = this.dragGuideId;
    if (!id) return false;

    const guide = this.deps.store.document.guides.find((g) => g.id === id);
    if (!guide?.binding) return true;

    // Vertical pointer movement reads as "further in" - dragging down pushes
    // the guide below the surface, which matches how the normal points out.
    this.liftAccumulator -= event.dy * LIFT_PER_PIXEL_FRACTION * this.characterHeight();

    const n = guide.normal;
    const base = guide.binding.offset;
    const offset: Vec3 = [
      base[0] + n[0] * this.liftAccumulator,
      base[1] + n[1] * this.liftAccumulator,
      base[2] + n[2] * this.liftAccumulator
    ];

    this.deps.store.apply((d) => M.setGuideOffset(d, id, offset), `Lift ${id}`, {
      coalesceKey: `lift:${id}`
    });
    return true;
  }

  // -----------------------------------------------------------------------
  // Hover
  // -----------------------------------------------------------------------

  private updateHover(event: ToolPointerEvent): void {
    const id = this.markerUnderPointer(event);
    if (id === this.hoveredId) return;
    this.clearHover();
    if (!id) return;
    this.hoveredId = id;
    this.deps.layer.setState(id, 'hover');
  }

  private clearHover(): void {
    if (!this.hoveredId) return;
    const id = this.hoveredId;
    this.hoveredId = null;
    // Restore whichever state the marker should show now.
    const isActive = this.deps.getActiveGuideId() === id;
    const isPlaced = this.deps.store.document.guides.some((g) => g.id === id);
    this.deps.layer.setState(id, isActive ? 'active' : isPlaced ? 'placed' : 'unplaced');
  }

  // -----------------------------------------------------------------------
  // Geometry helpers
  // -----------------------------------------------------------------------

  private markerUnderPointer(event: ToolPointerEvent): string | null {
    const { width, height } = this.deps.viewport.size;
    aimAtScreen(
      this.overlayRaycaster,
      this.deps.viewport.camera,
      event.x,
      event.y,
      width,
      height
    );
    return this.deps.layer.hitTest(this.overlayRaycaster);
  }

  /**
   * Signed lift a guide currently carries along its own normal, in cage-local
   * units. Recovered rather than stored, because the binding keeps one offset
   * and the cage-to-limit part of it belongs to whichever triangle the guide
   * is on now.
   */
  private liftOf(guide: Guide): number {
    if (!guide.binding) return 0;
    const o = guide.binding.offset;
    const n = guide.normal;
    return o[0] * n[0] + o[1] * n[1] + o[2] * n[2];
  }

  private pickSurface(x: number, y: number): SurfacePick | null {
    const character = this.deps.getCharacter();
    if (!character) return null;
    const { width, height } = this.deps.viewport.size;
    return this.deps.picker.pick(x, y, width, height, character.meshes);
  }

  /**
   * Reflect a pick across the character's symmetry plane and turn it back into
   * a real surface pick. Delegates to the shared helper so the marker and
   * curve tools mirror identically.
   */
  private mirrorPick(pick: SurfacePick): SurfacePick | null {
    const character = this.deps.getCharacter();
    if (!character) return null;
    return mirrorPick(pick, {
      picker: this.deps.picker,
      characterRoot: this.deps.getDocumentRoot(),
      meshes: character.meshes,
      characterHeight: this.characterHeight()
    });
  }

  /** Pick position plus off-surface offset, in document space. */
  private localFromPick(pick: { object: THREE.Mesh; localPoint: THREE.Vector3 }, offset: Vec3): THREE.Vector3 {
    const local = pick.localPoint.clone();
    local.x += offset[0];
    local.y += offset[1];
    local.z += offset[2];
    const world = pick.object.localToWorld(local);
    const doc = worldToDocument(this.deps.getDocumentRoot(), world);
    return new THREE.Vector3(doc[0], doc[1], doc[2]);
  }

  private placementMode(): PlacementMode {
    return this.deps.getPlacementMode?.() ?? 'auto';
  }

  /** Every surface the click ray crosses, near to far. */
  private pickThrough(x: number, y: number): PickResult[] {
    const character = this.deps.getCharacter();
    if (!character) return [];
    const { width, height } = this.deps.viewport.size;
    return this.deps.picker.pickThrough(x, y, width, height, character.meshes);
  }

  private characterHeight(): number {
    const character = this.deps.getCharacter();
    if (!character) return 1;
    const size = character.bounds.getSize(new THREE.Vector3());
    return Math.max(size.y, 1e-3);
  }
}
