// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Drawing and editing curves on the character's surface.
//
// The interaction model:
//
//   click on the mesh          add a control vertex to the active curve,
//                              creating the curve on the first click
//   click on a control vertex  select it
//   drag a control vertex      slide it across the surface, re-binding
//   delete / backspace         remove the selected control vertex
//   C                          toggle the active curve open or closed
//   escape / enter             finish the curve
//
// Where a new control vertex goes is decided by `insertionIndex` rather than
// always appending, and it happens on EVERY click - there is no separate
// insert gesture. Tracing a jawline, people commonly work outwards from the
// chin in both directions; always appending would zig-zag the curve back and
// forth across the face, so a click between two existing vertices lands
// between them.
// ==========================================================================

import * as THREE from 'three';
import type { CharacterModel } from '../../io/CharacterModel';
import type { DocumentStore } from '../../doc/history';
import * as M from '../../doc/mutations';
import type { Curve, CurvePoint, TemplateDef } from '../../doc/types';
import {
  aimAtScreen,
  bindingFromPick,
  type PickResult,
  type SurfacePick,
  type SurfacePicker
} from '../../viewport/Picker';
import { LAYER_OVERLAY, type Viewport } from '../../viewport/Viewport';
import { worldToDocument } from '../../viewport/space';
import { curveDef } from '../../templates';
import { mirrorPick } from '../mirror';
import { needsVolume, resolvePlacement, type PlacementMode } from '../placement';
import type { Tool, ToolPointerEvent } from '../types';
import { insertionIndex } from './geometry';
import type { ControlVertexRef, CurveLayer } from './CurveLayer';

/** Default curve width, as a fraction of character height. */
const WIDTH_FRACTION = 0.0025;

export interface CurveToolDeps {
  viewport: Viewport;
  picker: SurfacePicker;
  /** How a click should be interpreted: on the skin, inside, or free. */
  getPlacementMode?: () => PlacementMode;
  layer: CurveLayer;
  store: DocumentStore;
  getCharacter: () => CharacterModel | null;
  /** Anchor for document space - see RiserApp.documentRoot. */
  getDocumentRoot: () => THREE.Object3D;
  getTemplate: () => TemplateDef;
  getActiveCurveId: () => string | null;
  setActiveCurveId: (id: string | null) => void;
  getSelectedPoint: () => ControlVertexRef | null;
  setSelectedPoint: (ref: ControlVertexRef | null) => void;
  isSymmetryEnabled: () => boolean;
  onNotice?: (message: string) => void;
}

export class CurveTool implements Tool {
  readonly id = 'curve' as const;

  private readonly overlayRaycaster = new THREE.Raycaster();
  private dragging: ControlVertexRef | null = null;

  constructor(private readonly deps: CurveToolDeps) {
    this.overlayRaycaster.layers.set(LAYER_OVERLAY);
  }

  activate(): void {
    this.deps.viewport.renderer.domElement.style.cursor = 'crosshair';
  }

  deactivate(): void {
    this.deps.viewport.renderer.domElement.style.cursor = '';
    this.dragging = null;
  }

  // -----------------------------------------------------------------------
  // Pointer handling
  // -----------------------------------------------------------------------

  onPointerDown(event: ToolPointerEvent): boolean {
    if (event.button !== 0) return false;

    const ref = this.controlVertexUnderPointer(event);
    if (!ref) return false;

    this.dragging = ref;
    this.deps.setSelectedPoint(ref);
    this.deps.setActiveCurveId(ref.curveId);
    return true;
  }

  onPointerMove(event: ToolPointerEvent): boolean {
    if (!this.dragging) return false;

    const pick = this.pickSurface(event.x, event.y);
    if (!pick) return true; // Off the mesh - hold rather than snap away.

    const { curveId, index } = this.dragging;
    const point = this.curvePointFromPick(pick, this.volumeThrough(event.x, event.y));
    this.deps.store.apply(
      (d) => M.moveCurvePoint(d, curveId, index, point),
      `Move ${this.curveLabel(curveId)} point`,
      { coalesceKey: `curve:${curveId}:${index}` }
    );
    return true;
  }

  onPointerUp(event: ToolPointerEvent): boolean {
    const wasDragging = this.dragging !== null;
    this.dragging = null;
    if (wasDragging) return true;

    if (!event.isClick || event.button !== 0) return false;
    // A click on an existing control vertex already selected it on the way down.
    if (this.controlVertexUnderPointer(event)) return false;

    return this.addPointAtPointer(event);
  }

  onKeyDown(event: KeyboardEvent): boolean {
    const activeId = this.deps.getActiveCurveId();

    if (event.key === 'Delete' || event.key === 'Backspace') {
      const selected = this.deps.getSelectedPoint();
      if (!selected) return false;
      this.deps.store.apply(
        (d) => M.removeCurvePoint(d, selected.curveId, selected.index),
        `Remove ${this.curveLabel(selected.curveId)} point`
      );
      this.deps.setSelectedPoint(null);
      return true;
    }

    if ((event.key === 'c' || event.key === 'C') && activeId) {
      const curve = this.deps.store.document.curves.find((c) => c.id === activeId);
      if (!curve) return false;
      this.deps.store.apply(
        (d) => M.setCurveClosed(d, activeId, !curve.closed),
        curve.closed ? `Open ${this.curveLabel(activeId)}` : `Close ${this.curveLabel(activeId)}`
      );
      return true;
    }

    if (event.key === 'Escape' || event.key === 'Enter') {
      this.deps.setSelectedPoint(null);
      return true;
    }

    return false;
  }

  update(): void {
    this.deps.layer.update(this.deps.viewport.camera);
  }

  // -----------------------------------------------------------------------
  // Adding points
  // -----------------------------------------------------------------------

  private addPointAtPointer(event: ToolPointerEvent): boolean {
    const activeId = this.deps.getActiveCurveId();
    if (!activeId) return false;

    const pick = this.pickSurface(event.x, event.y);
    if (!pick) return false;

    const template = this.deps.getTemplate();
    const def = curveDef(template, activeId);
    if (!def) return false;

    const doc = this.deps.store.document;
    const existing = doc.curves.find((c) => c.id === activeId);
    const point = this.curvePointFromPick(pick, this.volumeThrough(event.x, event.y));

    // Mirrored curves are built alongside, so both sides stay in step and one
    // undo removes both points.
    const mirrorId = def.mirror;
    const mirrorPoint =
      this.deps.isSymmetryEnabled() && mirrorId ? this.mirrorPoint(pick) : null;
    if (this.deps.isSymmetryEnabled() && mirrorId && !mirrorPoint) {
      this.deps.onNotice?.(
        `Added to ${def.label}, but the mirrored side had no surface at that point.`
      );
    }

    if (!existing) {
      const curve = this.newCurve(activeId, def.group, !!def.closed, [point]);
      this.deps.store.apply(
        (d) => {
          let next = M.addCurve(d, curve);
          if (mirrorId && mirrorPoint) {
            const mirrorDef = curveDef(template, mirrorId);
            next = M.addCurve(
              next,
              this.newCurve(
                mirrorId,
                mirrorDef?.group ?? def.group,
                !!(mirrorDef?.closed ?? def.closed),
                [mirrorPoint]
              )
            );
          }
          return next;
        },
        `Start ${def.label}`
      );
      this.deps.setSelectedPoint({ curveId: activeId, index: 0 });
      return true;
    }

    const positions = existing.points.map((p) => p.position);
    const at = insertionIndex(positions, point.position, existing.closed);

    this.deps.store.apply(
      (d) => {
        let next = M.addCurvePoint(d, activeId, point, at);
        if (mirrorId && mirrorPoint) {
          const mirrorCurve = d.curves.find((c) => c.id === mirrorId);
          if (mirrorCurve) {
            const mirrorAt = insertionIndex(
              mirrorCurve.points.map((p) => p.position),
              mirrorPoint.position,
              mirrorCurve.closed
            );
            next = M.addCurvePoint(next, mirrorId, mirrorPoint, mirrorAt);
          } else {
            const mirrorDef = curveDef(template, mirrorId);
            next = M.addCurve(
              next,
              this.newCurve(
                mirrorId,
                mirrorDef?.group ?? def.group,
                !!(mirrorDef?.closed ?? def.closed),
                [mirrorPoint]
              )
            );
          }
        }
        return next;
      },
      `Add ${def.label} point`
    );
    this.deps.setSelectedPoint({ curveId: activeId, index: at });
    return true;
  }

  private newCurve(
    id: string,
    group: string,
    closed: boolean,
    points: CurvePoint[]
  ): Curve {
    return {
      id,
      group,
      closed,
      width: this.defaultWidth(),
      points
    };
  }

  private placementMode(): PlacementMode {
    return this.deps.getPlacementMode?.() ?? 'auto';
  }

  /** The through-pick, but only when the current mode will actually use it. */
  private volumeThrough(x: number, y: number): PickResult[] | undefined {
    // Curve points carry no interior flag of their own, so only an explicit
    // centre placement needs the volume measured.
    if (!needsVolume(this.placementMode(), false)) return undefined;
    return this.pickThrough(x, y);
  }

  /** Every surface the click ray crosses, near to far. */
  private pickThrough(x: number, y: number): PickResult[] {
    const character = this.deps.getCharacter();
    if (!character) return [];
    const { width, height } = this.deps.viewport.size;
    return this.deps.picker.pickThrough(x, y, width, height, character.meshes);
  }

  private curvePointFromPick(
    surface: SurfacePick,
    through?: readonly PickResult[]
  ): CurvePoint {
    // The control vertex sits where the user clicked - on the limit surface
    // when subdivision is on - carried by the binding's offset from the cage
    // triangle it is bound to. With subdivision off the offset is zero and
    // this is exactly the old behaviour.
    const local = surface.pick.localPoint.clone();
    // The placement mode decides what the click meant. A curve is usually a
    // surface feature - a brow, a lip line - which is why `auto` leaves it on
    // the skin; but a spine curve genuinely belongs inside the torso, and
    // centre mode is how you say so.
    //
    // Curve points carry no `interior` flag of their own, so `auto` here is
    // simply the surface. Anyone wanting a curve through the volume asks for
    // it explicitly.
    const placement = resolvePlacement(this.placementMode(), surface, {
      interior: false,
      through,
      characterHeight: this.characterHeight()
    });
    const offset = placement.offset;

    local.x += offset[0];
    local.y += offset[1];
    local.z += offset[2];

    const world = surface.pick.object.localToWorld(local);
    const position = worldToDocument(this.deps.getDocumentRoot(), world);
    return {
      position,
      normal: [surface.normal.x, surface.normal.y, surface.normal.z],
      binding: bindingFromPick(surface.pick, offset)
    };
  }

  private mirrorPoint(pick: SurfacePick): CurvePoint | null {
    const character = this.deps.getCharacter();
    if (!character) return null;
    const mirrored = mirrorPick(pick, {
      picker: this.deps.picker,
      characterRoot: this.deps.getDocumentRoot(),
      meshes: character.meshes,
      characterHeight: this.characterHeight()
    });
    return mirrored ? this.curvePointFromPick(mirrored) : null;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private controlVertexUnderPointer(event: ToolPointerEvent): ControlVertexRef | null {
    const { width, height } = this.deps.viewport.size;
    aimAtScreen(
      this.overlayRaycaster,
      this.deps.viewport.camera,
      event.x,
      event.y,
      width,
      height
    );
    return this.deps.layer.hitTestControlVertex(this.overlayRaycaster);
  }

  private pickSurface(x: number, y: number): SurfacePick | null {
    const character = this.deps.getCharacter();
    if (!character) return null;
    const { width, height } = this.deps.viewport.size;
    return this.deps.picker.pick(x, y, width, height, character.meshes);
  }

  private curveLabel(id: string): string {
    return curveDef(this.deps.getTemplate(), id)?.label ?? id;
  }

  private defaultWidth(): number {
    // Stored in document units, which is what the USD `widths` attribute means.
    const character = this.deps.getCharacter();
    if (!character) return WIDTH_FRACTION;
    const worldHeight = this.characterHeight();
    const root = this.deps.getDocumentRoot();
    root.updateWorldMatrix(true, false);
    const scale = root.matrixWorld.getMaxScaleOnAxis() || 1;
    return (worldHeight / scale) * WIDTH_FRACTION;
  }

  private characterHeight(): number {
    const character = this.deps.getCharacter();
    if (!character) return 1;
    const size = character.bounds.getSize(new THREE.Vector3());
    return Math.max(size.y, 1e-3);
  }
}
