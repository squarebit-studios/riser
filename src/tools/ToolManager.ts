// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Pointer routing, and the click-versus-drag decision everything rests on.
//
// The viewport has one left mouse button and two jobs for it: tumble the
// camera, and place a marker. AccuRIG-style tools resolve this the way every
// DCC does - a press that moves is a drag, a press that does not is a click -
// so the tool only acts on release, and only if the pointer stayed put.
//
// The threshold is the whole trick. Too small and a shaky hand tumbles instead
// of placing; too large and a deliberate small drag registers as a click.
//
// AND IT CANNOT BE ONE NUMBER, which is what it was. Four CSS pixels is the
// value DCC apps have converged on, and that is a value for a MOUSE: a mouse
// rests on a desk and a click moves it by nothing. A finger is not a mouse. A
// tap lands, rolls slightly and lifts, and four pixels of that is an ordinary
// tap rather than an attempt to drag anything.
//
// So on a tablet every tap was being read as a drag. The camera tumbled and
// the tool never got its click, which meant taps that were meant to place a
// marker or add a control vertex did nothing at all while the view span
// underneath them. Touch gets the slop a touch platform actually uses.
// ==========================================================================

import type { CameraRig } from '../viewport/CameraRig';
import type { Tool, ToolId, ToolPointerEvent } from './types';

export const DRAG_THRESHOLD_PX = 4;

/**
 * The same idea for a finger, which is a far blunter instrument.
 *
 * Ten to twelve points is what touch platforms treat as a tap rather than a
 * drag, and it is roughly the width of the contact patch: below this, nobody
 * moved anything on purpose.
 */
export const TOUCH_DRAG_THRESHOLD_PX = 12;

/** How far this kind of pointer may travel and still count as a click. */
export function dragThresholdFor(pointerType: string | undefined): number {
  return pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD_PX : DRAG_THRESHOLD_PX;
}

export class ToolManager {
  private tools = new Map<ToolId, Tool>();
  private active: Tool | null = null;

  private down = false;
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;
  private movedBeyondThreshold = false;
  /** Set from the pointer that started the gesture, since it depends on it. */
  private threshold = DRAG_THRESHOLD_PX;
  /** True while the active tool has claimed the current press. */
  private consuming = false;

  private readonly onPointerDown = (e: PointerEvent): void => this.handleDown(e);
  private readonly onPointerMove = (e: PointerEvent): void => this.handleMove(e);
  private readonly onPointerUp = (e: PointerEvent): void => this.handleUp(e);
  private readonly onKeyDown = (e: KeyboardEvent): void => this.handleKey(e);
  private readonly onContextMenu = (e: MouseEvent): void => e.preventDefault();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cameraRig: CameraRig
  ) {
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    canvas.addEventListener('keydown', this.onKeyDown);
  }

  register(tool: Tool): void {
    this.tools.set(tool.id, tool);
  }

  get activeToolId(): ToolId | null {
    return this.active?.id ?? null;
  }

  setActive(id: ToolId | null): void {
    if (this.active?.id === id) return;
    this.active?.deactivate();
    this.active = id ? (this.tools.get(id) ?? null) : null;
    this.active?.activate();
  }

  update(dt: number): void {
    this.active?.update?.(dt);
  }

  // -----------------------------------------------------------------------

  private toToolEvent(e: PointerEvent, isClick: boolean): ToolPointerEvent {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const event: ToolPointerEvent = {
      x,
      y,
      dx: x - this.lastX,
      dy: y - this.lastY,
      button: e.button,
      shiftKey: e.shiftKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      isClick,
      native: e
    };
    this.lastX = x;
    this.lastY = y;
    return event;
  }

  /**
   * Abandon the gesture in progress, so its release does nothing.
   *
   * For when something outside the tools takes the gesture over. A long press
   * opens the viewport menu, and the finger that opened it has not moved, so
   * without this the release still reads as a click: in curve mode that means
   * the menu opens AND a control vertex is added underneath it.
   */
  cancelGesture(): void {
    if (!this.down) return;
    this.down = false;
    this.consuming = false;
    this.movedBeyondThreshold = false;
    this.cameraRig.setEnabled(true);
  }

  private handleDown(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.down = true;
    this.downX = e.clientX - rect.left;
    this.downY = e.clientY - rect.top;
    this.lastX = this.downX;
    this.lastY = this.downY;
    this.movedBeyondThreshold = false;
    this.threshold = dragThresholdFor(e.pointerType);
    this.consuming = false;

    // Focus so keyboard shortcuts reach the canvas rather than the page.
    this.canvas.focus();

    if (!this.active) return;

    // A tool may claim the press immediately - grabbing an existing marker,
    // say - in which case the camera stands down for the whole gesture.
    const consumed = this.active.onPointerDown(this.toToolEvent(e, true));
    if (consumed) {
      this.consuming = true;
      this.cameraRig.setEnabled(false);
      this.canvas.setPointerCapture(e.pointerId);
    }
  }

  private handleMove(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (this.down && !this.movedBeyondThreshold) {
      const dist = Math.hypot(x - this.downX, y - this.downY);
      if (dist > this.threshold) this.movedBeyondThreshold = true;
    }

    if (!this.active) {
      this.lastX = x;
      this.lastY = y;
      return;
    }

    // Hover updates need to keep flowing while the button is up, which is why
    // this is not gated on `this.down`.
    this.active.onPointerMove(this.toToolEvent(e, !this.movedBeyondThreshold));
  }

  private handleUp(e: PointerEvent): void {
    const wasClick = this.down && !this.movedBeyondThreshold;
    this.down = false;

    if (this.active) {
      this.active.onPointerUp(this.toToolEvent(e, wasClick));
    }

    if (this.consuming) {
      this.consuming = false;
      this.cameraRig.setEnabled(true);
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
    }
    this.movedBeyondThreshold = false;
  }

  private handleKey(e: KeyboardEvent): void {
    if (this.active?.onKeyDown?.(e)) e.preventDefault();
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('keydown', this.onKeyDown);
    this.active?.deactivate();
    this.active = null;
    this.tools.clear();
  }
}
