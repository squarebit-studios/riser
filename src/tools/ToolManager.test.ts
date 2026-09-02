// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// A tap is a tap, and a mouse is not a finger.
//
// The viewport gives one button two jobs: tumble the camera, and act on what
// was pressed. They are told apart by movement, and the threshold used to be
// four CSS pixels for everything. Four pixels is a MOUSE number: a mouse sits
// on a desk and a click moves it by nothing.
//
// A finger lands, rolls and lifts, and four pixels of roll is an ordinary tap.
// So on a tablet every tap was read as a drag: the camera tumbled, the tool
// never got its click, and taps meant to place a marker or add a control
// vertex did nothing while the view span underneath them.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import {
  DRAG_THRESHOLD_PX,
  TOUCH_DRAG_THRESHOLD_PX,
  dragThresholdFor
} from './ToolManager';

describe('how far a press may travel and still be a click', () => {
  it('holds a mouse to the tight DCC number', () => {
    expect(dragThresholdFor('mouse')).toBe(DRAG_THRESHOLD_PX);
    expect(dragThresholdFor('pen')).toBe(DRAG_THRESHOLD_PX);
    // An unknown or absent pointer type is treated as a mouse, which is the
    // safe direction: it errs towards tumbling rather than towards placing
    // something nobody asked for.
    expect(dragThresholdFor(undefined)).toBe(DRAG_THRESHOLD_PX);
  });

  it('gives a finger the room a finger needs', () => {
    expect(dragThresholdFor('touch')).toBe(TOUCH_DRAG_THRESHOLD_PX);
    expect(TOUCH_DRAG_THRESHOLD_PX).toBeGreaterThan(DRAG_THRESHOLD_PX);
  });

  it('accepts the roll of an ordinary tap', () => {
    // The exact failure that was reported: a tap that moved a handful of
    // pixels tumbled the camera instead of placing anything.
    const rollOfATap = 6;
    expect(rollOfATap).toBeGreaterThan(dragThresholdFor('mouse'));
    expect(rollOfATap).toBeLessThan(dragThresholdFor('touch'));
  });

  it('still lets a deliberate touch drag be a drag', () => {
    // The threshold has to stay well under the distance somebody moves when
    // they mean to orbit, or the camera would feel stuck.
    expect(dragThresholdFor('touch')).toBeLessThan(30);
  });
});
