// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The contract between the pointer layer and the authoring tools.
// ==========================================================================

export type ToolId = 'select' | 'marker' | 'curve';

export interface ToolPointerEvent {
  /** Canvas-relative position in CSS pixels. */
  x: number;
  y: number;
  /** Movement since the previous event, in CSS pixels. */
  dx: number;
  dy: number;
  button: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /**
   * True when the pointer has not moved far enough since it went down to count
   * as a drag. Placement fires on a click, not on the end of a tumble.
   */
  isClick: boolean;
  /** The originating DOM event, for preventDefault and pointer capture. */
  native: PointerEvent;
}

export interface Tool {
  readonly id: ToolId;

  activate(): void;
  deactivate(): void;

  /** Return true to consume the event and suppress camera navigation. */
  onPointerDown(event: ToolPointerEvent): boolean;
  onPointerMove(event: ToolPointerEvent): boolean;
  onPointerUp(event: ToolPointerEvent): boolean;

  onKeyDown?(event: KeyboardEvent): boolean;
  /** Called every frame while the tool is active. */
  update?(dt: number): void;
}
