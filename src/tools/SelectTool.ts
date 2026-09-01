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

  constructor(private readonly deps: SelectToolDeps) {}

  activate(): void {
    // The default arrow rather than a crosshair. A crosshair says "this click
    // will put something here", which is the one thing this mode does not do.
    this.deps.viewport.renderer.domElement.style.cursor = '';
  }

  deactivate(): void {
    this.delegate = null;
  }

  onPointerDown(event: ToolPointerEvent): boolean {
    for (const tool of this.deps.tools()) {
      if (tool === this) continue;
      if (tool.onPointerDown(event)) {
        this.delegate = tool;
        return true;
      }
    }
    // Nothing under the pointer, so the camera takes it. This is what makes
    // the mode feel like navigation with grabbing available, rather than a
    // mode you have to leave to look at the character.
    return false;
  }

  onPointerMove(event: ToolPointerEvent): boolean {
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
