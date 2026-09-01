// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Select delegates a drag, and never lets a click through to create anything.
//
// The second half is the one worth testing. Select borrows its dragging from
// the marker and curve tools, and those same tools place a marker or extend a
// curve on a click that hits nothing. If a release ever reached a tool that
// had not claimed the press, this mode would quietly start dropping markers
// on the character, which is exactly the behaviour it exists to prevent.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import { SelectTool } from './SelectTool';
import type { Tool, ToolId, ToolPointerEvent } from './types';

function pointer(overrides: Partial<ToolPointerEvent> = {}): ToolPointerEvent {
  return {
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isClick: true,
    native: {} as PointerEvent,
    ...overrides
  };
}

/** A stand-in with the shape the real tools have, recording what it is sent. */
class FakeTool implements Tool {
  readonly seen: string[] = [];
  constructor(
    readonly id: ToolId,
    /** Whether there is something under the pointer for this tool to grab. */
    private grabs: boolean
  ) {}

  setGrabs(grabs: boolean): void {
    this.grabs = grabs;
  }

  activate(): void {}
  deactivate(): void {}

  onPointerDown(): boolean {
    this.seen.push('down');
    return this.grabs;
  }
  onPointerMove(): boolean {
    this.seen.push('move');
    return this.grabs;
  }
  onPointerUp(): boolean {
    this.seen.push('up');
    return this.grabs;
  }
  onKeyDown(): boolean {
    this.seen.push('key');
    return this.grabs;
  }
  update(): void {
    this.seen.push('update');
  }
}

function makeSelect(tools: Tool[]): SelectTool {
  return new SelectTool({
    viewport: { renderer: { domElement: { style: {} } } } as never,
    tools: () => tools
  });
}

describe('the select tool', () => {
  it('hands the whole gesture to the tool that grabbed something', () => {
    const marker = new FakeTool('marker', true);
    const curve = new FakeTool('curve', false);
    const select = makeSelect([marker, curve]);

    expect(select.onPointerDown(pointer())).toBe(true);
    select.onPointerMove(pointer());
    select.onPointerUp(pointer());

    expect(marker.seen).toEqual(['down', 'move', 'up']);
    // The curve tool was never even asked, because the marker claimed it
    // first, and it certainly never saw the release.
    expect(curve.seen).toEqual([]);
  });

  it('asks the next tool when the first has nothing under the pointer', () => {
    const marker = new FakeTool('marker', false);
    const curve = new FakeTool('curve', true);
    const select = makeSelect([marker, curve]);

    expect(select.onPointerDown(pointer())).toBe(true);
    select.onPointerUp(pointer());

    expect(marker.seen).toEqual(['down']);
    expect(curve.seen).toEqual(['down', 'up']);
  });

  it('creates nothing when the press grabbed nothing', () => {
    const marker = new FakeTool('marker', false);
    const curve = new FakeTool('curve', false);
    const select = makeSelect([marker, curve]);

    // A click on the character in marker mode places a marker. Here it must
    // reach neither tool's release handler at all.
    expect(select.onPointerDown(pointer())).toBe(false);
    expect(select.onPointerUp(pointer({ isClick: true }))).toBe(false);

    expect(marker.seen).toEqual(['down']);
    expect(curve.seen).toEqual(['down']);
    expect(marker.seen).not.toContain('up');
    expect(curve.seen).not.toContain('up');
  });

  it('lets the camera have a drag that started on nothing', () => {
    const marker = new FakeTool('marker', false);
    const select = makeSelect([marker]);

    select.onPointerDown(pointer());
    // Hover still updates, so a marker lights up under the pointer, but the
    // event is not claimed: returning true here would freeze the camera.
    expect(select.onPointerMove(pointer())).toBe(false);
    expect(marker.seen).toContain('move');
  });

  it('forgets its delegate on release, so a later drag cannot reach it', () => {
    const marker = new FakeTool('marker', true);
    const select = makeSelect([marker]);

    select.onPointerDown(pointer());
    select.onPointerUp(pointer());
    marker.setGrabs(false);

    // A new gesture that grabs nothing must not be delivered to the tool that
    // happened to be holding something a moment ago.
    expect(select.onPointerDown(pointer())).toBe(false);
    expect(select.onPointerUp(pointer())).toBe(false);
    expect(marker.seen.filter((e) => e === 'up')).toHaveLength(1);
  });

  it('passes keys and the frame tick through to the real tools', () => {
    const marker = new FakeTool('marker', true);
    const select = makeSelect([marker]);

    expect(select.onKeyDown({ key: 'Delete' } as KeyboardEvent)).toBe(true);
    // The overlays size themselves against the camera every frame and are
    // visible in this mode too.
    select.update(0.016);
    expect(marker.seen).toContain('update');
  });
});
