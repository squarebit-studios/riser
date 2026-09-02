// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Select: grab what is already there, and never make anything new.
//
// The authoring tools each own a mode where clicking the character CREATES
// something - a marker, a control vertex. That is what they are for, and it is
// also the reason a person cannot safely reach into the scene and nudge a
// marker they can see: doing it in the marker tool means every click that
// misses leaves another marker behind, and doing it in the curve tool means
// every click that misses extends the curve.
//
// So this is the mode where nothing is created. Press down on a marker or a
// control vertex and it is selected and dragged; press down on anything else,
// including the character, and the gesture belongs to the camera.
//
// IT DELEGATES RATHER THAN REIMPLEMENTS. Dragging a marker is not a small
// piece of code: it re-raycasts the surface every frame, rewrites the binding
// the server will evaluate, honours alt to lift off the skin, respects free
// versus surface placement, and mirrors across the symmetry plane. All of that
// already exists and is tested. Writing a second copy here would be writing a
// second thing to be wrong.
//
// What makes the delegation safe is a shape both tools already have: their
// `onPointerDown` returns true ONLY when it grabbed something that exists, and
// their `onPointerUp` creates nothing when a drag was in progress. So handing
// a tool the gesture only after it has claimed one gives exactly the half of
// its behaviour this mode wants, and none of the half it does not.
// ==========================================================================

import type * as THREE from 'three';
import type { Tool, ToolId, ToolPointerEvent } from './types';
import { dragThresholdFor } from './ToolManager';

export interface SelectToolDeps {
  viewport: { renderer: THREE.WebGLRenderer };
  /**
   * The tools this one can borrow a drag from, in the order they are asked.
   *
   * Order decides who wins when a marker and a control vertex overlap on
   * screen, which is common on a face: markers are asked first because they
   * are the coarser thing and the one a person is more likely to be reaching
   * for when the two are on top of each other.
   */
  tools: () => readonly Tool[];

  /**
   * Everything the box needs that lives in the scene rather than in a gesture.
   *
   * The tool owns WHEN a box is drawn and what the pointer is doing; it owns
   * none of what is inside the box, because that means projecting every marker
   * and control vertex through the camera, and the app already holds the
   * document, the character and the camera together. Splitting it the other
   * way would mean handing this class most of the application.
   */
  marquee: {
    /** Draw the band, or clear it with null. */
    show(rect: Rect | null): void;
    /** Take everything inside, replacing the selection unless adding. */
    select(rect: Rect, add: boolean): void;
    /** Drop the selection entirely. */
    clear(): void;
    /** How many things are selected. */
    count(): number;
    /** Whether the pointer is over something already in the selection. */
    covers(x: number, y: number): boolean;
    /** Move everything selected to follow the pointer. */
    moveTo(x: number, y: number): void;
    /** The drag is over; the next one starts its own undo step. */
    endMove(): void;
  };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The box two corners make, normalised so width and height are positive. */
function rectBetween(ax: number, ay: number, bx: number, by: number): Rect {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.abs(bx - ax),
    height: Math.abs(by - ay)
  };
}

export class SelectTool implements Tool {
  readonly id: ToolId = 'select';

  /**
   * The tool currently being handed the gesture, if any.
   *
   * Set only when a tool claimed a pointer-down, which is the same thing as
   * saying it has hold of something. Cleared on pointer-up, so a tool can
   * never keep receiving a drag it did not start.
   */
  private delegate: Tool | null = null;

  /** Where a press that grabbed nothing began, until it becomes a box. */
  private bandFrom: { x: number; y: number } | null = null;
  private banding = false;
  /** True while the whole selection is being dragged as one. */
  private movingSelection = false;

  constructor(private readonly deps: SelectToolDeps) {}

  activate(): void {
    // The default arrow rather than a crosshair. A crosshair says "this click
    // will put something here", which is the one thing this mode does not do.
    this.deps.viewport.renderer.domElement.style.cursor = '';
  }

  deactivate(): void {
    this.delegate = null;
    this.bandFrom = null;
    this.banding = false;
    this.movingSelection = false;
    // The band is drawn by the interface, so leaving the mode has to take it
    // down; nothing else will.
    this.deps.marquee.show(null);
  }

  onPointerDown(event: ToolPointerEvent): boolean {
    if (event.button !== 0) return false;

    // Pressing on something that is already part of a box selection moves the
    // whole selection. Asked BEFORE the tools are offered the press, because
    // they only know how to move the one thing under the pointer, and the
    // point of selecting several was to move them together.
    if (this.deps.marquee.count() > 1 && this.deps.marquee.covers(event.x, event.y)) {
      this.movingSelection = true;
      return true;
    }

    for (const tool of this.deps.tools()) {
      if (tool === this) continue;
      if (tool.onPointerDown(event)) {
        this.delegate = tool;
        // Grabbing one thing is a statement that the box is finished with.
        this.deps.marquee.clear();
        return true;
      }
    }

    // Nothing under the pointer. This might become a box and it might be the
    // camera, and which it is cannot be known yet: both start as a press on
    // empty space. So the press is remembered and nothing is claimed until it
    // has travelled far enough to be a deliberate drag, which is the same
    // rule that separates a click from a tumble everywhere else.
    this.bandFrom = { x: event.x, y: event.y };
    this.banding = false;
    return false;
  }

  onPointerMove(event: ToolPointerEvent): boolean {
    if (this.movingSelection) {
      this.deps.marquee.moveTo(event.x, event.y);
      return true;
    }

    if (this.bandFrom) {
      const from = this.bandFrom;
      const travelled = Math.hypot(event.x - from.x, event.y - from.y);
      if (!this.banding && travelled < dragThresholdFor(event.native?.pointerType)) {
        // Still short enough to be a click or the beginning of a tumble.
        // Claiming it here would make the camera unusable in this mode.
        //
        // Hover still goes through: the press has not become anything yet, so
        // as far as the person is concerned they are still just moving over
        // the character and things under the pointer should still light up.
        for (const tool of this.deps.tools()) {
          if (tool !== this) tool.onPointerMove(event);
        }
        return false;
      }
      this.banding = true;
      this.deps.marquee.show(rectBetween(from.x, from.y, event.x, event.y));
      return true;
    }

    if (this.delegate) return this.delegate.onPointerMove(event);

    // No drag in progress: let every tool update its own hover highlight so a
    // marker still lights up under the pointer, and claim nothing, so the
    // camera keeps working.
    for (const tool of this.deps.tools()) {
      if (tool !== this) tool.onPointerMove(event);
    }
    return false;
  }

  onPointerUp(event: ToolPointerEvent): boolean {
    if (this.movingSelection) {
      this.movingSelection = false;
      this.deps.marquee.endMove();
      return true;
    }

    const from = this.bandFrom;
    const banding = this.banding;
    this.bandFrom = null;
    this.banding = false;

    if (banding && from) {
      this.deps.marquee.show(null);
      // Shift adds to what is already selected, which is the one convention
      // every tool with a box shares.
      this.deps.marquee.select(
        rectBetween(from.x, from.y, event.x, event.y),
        event.shiftKey
      );
      return true;
    }

    // A press on empty space that never became a box is a click on nothing,
    // and a click on nothing means "select nothing".
    if (from && event.isClick && !event.shiftKey) this.deps.marquee.clear();

    const delegate = this.delegate;
    this.delegate = null;
    // Only the tool that claimed the press gets the release, so no other tool
    // sees a click it might place something for.
    return delegate ? delegate.onPointerUp(event) : false;
  }

  onKeyDown(event: KeyboardEvent): boolean {
    for (const tool of this.deps.tools()) {
      if (tool !== this && tool.onKeyDown?.(event)) return true;
    }
    return false;
  }

  update(dt: number): void {
    // The overlay layers size their markers against the camera every frame,
    // and they are visible in this mode too, so they still need the tick.
    for (const tool of this.deps.tools()) {
      if (tool !== this) tool.update?.(dt);
    }
  }
}
