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
import type { Rect } from './SelectTool';

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

/** Records what the tool asked the scene to do, without a scene. */
class FakeMarquee {
  readonly threshold = 4;
  shown: Rect | null = null;
  selected: { rect: Rect; add: boolean }[] = [];
  cleared = 0;
  movedTo: { x: number; y: number }[] = [];
  endedMoves = 0;
  /** What `count()` should report, and what `covers()` should answer. */
  constructor(
    private selectedCount = 0,
    private covering = false
  ) {}

  show(rect: Rect | null): void {
    this.shown = rect;
  }
  select(rect: Rect, add: boolean): void {
    this.selected.push({ rect, add });
  }
  clear(): void {
    this.cleared++;
  }
  count(): number {
    return this.selectedCount;
  }
  covers(): boolean {
    return this.covering;
  }
  moveTo(x: number, y: number): void {
    this.movedTo.push({ x, y });
  }
  endMove(): void {
    this.endedMoves++;
  }
}

function makeSelect(
  tools: Tool[],
  marquee: FakeMarquee = new FakeMarquee()
): { select: SelectTool; marquee: FakeMarquee } {
  const select = new SelectTool({
    viewport: { renderer: { domElement: { style: {} } } } as never,
    tools: () => tools,
    marquee
  });
  return { select, marquee };
}

describe('the select tool', () => {
  it('hands the whole gesture to the tool that grabbed something', () => {
    const marker = new FakeTool('marker', true);
    const curve = new FakeTool('curve', false);
    const { select } = makeSelect([marker, curve]);

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
    const { select } = makeSelect([marker, curve]);

    expect(select.onPointerDown(pointer())).toBe(true);
    select.onPointerUp(pointer());

    expect(marker.seen).toEqual(['down']);
    expect(curve.seen).toEqual(['down', 'up']);
  });

  it('creates nothing when the press grabbed nothing', () => {
    const marker = new FakeTool('marker', false);
    const curve = new FakeTool('curve', false);
    const { select } = makeSelect([marker, curve]);

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
    const { select } = makeSelect([marker]);

    select.onPointerDown(pointer());
    // Hover still updates, so a marker lights up under the pointer, but the
    // event is not claimed: returning true here would freeze the camera.
    expect(select.onPointerMove(pointer())).toBe(false);
    expect(marker.seen).toContain('move');
  });

  it('forgets its delegate on release, so a later drag cannot reach it', () => {
    const marker = new FakeTool('marker', true);
    const { select } = makeSelect([marker]);

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
    const { select } = makeSelect([marker]);

    expect(select.onKeyDown({ key: 'Delete' } as KeyboardEvent)).toBe(true);
    // The overlays size themselves against the camera every frame and are
    // visible in this mode too.
    select.update(0.016);
    expect(marker.seen).toContain('update');
  });
});

describe('the select tool: dragging a box', () => {
  const at = (x: number, y: number, over: Partial<ToolPointerEvent> = {}) =>
    pointer({ x, y, isClick: false, ...over });

  it('leaves a short drag to the camera', () => {
    const { select, marquee } = makeSelect([new FakeTool('marker', false)]);
    select.onPointerDown(at(100, 100));
    // Inside the threshold: this is a click, or the start of a tumble, and
    // claiming it would make the camera unusable in this mode.
    expect(select.onPointerMove(at(102, 101))).toBe(false);
    expect(marquee.shown).toBeNull();
  });

  it('draws a box once the press has travelled far enough', () => {
    const { select, marquee } = makeSelect([new FakeTool('marker', false)]);
    select.onPointerDown(at(100, 100));
    expect(select.onPointerMove(at(140, 130))).toBe(true);
    expect(marquee.shown).toEqual({ x: 100, y: 100, width: 40, height: 30 });
  });

  it('normalises a box dragged up and to the left', () => {
    const { select, marquee } = makeSelect([new FakeTool('marker', false)]);
    select.onPointerDown(at(200, 200));
    select.onPointerMove(at(150, 160));
    expect(marquee.shown).toEqual({ x: 150, y: 160, width: 50, height: 40 });
  });

  it('selects what the box covered, and takes the box down', () => {
    const { select, marquee } = makeSelect([new FakeTool('marker', false)]);
    select.onPointerDown(at(100, 100));
    select.onPointerMove(at(160, 150));
    expect(select.onPointerUp(at(160, 150))).toBe(true);

    expect(marquee.shown).toBeNull();
    expect(marquee.selected).toHaveLength(1);
    expect(marquee.selected[0]?.rect).toEqual({ x: 100, y: 100, width: 60, height: 50 });
    expect(marquee.selected[0]?.add).toBe(false);
  });

  it('adds to the selection when shift is held', () => {
    const { select, marquee } = makeSelect([new FakeTool('marker', false)]);
    select.onPointerDown(at(0, 0, { shiftKey: true }));
    select.onPointerMove(at(50, 50, { shiftKey: true }));
    select.onPointerUp(at(50, 50, { shiftKey: true }));
    expect(marquee.selected[0]?.add).toBe(true);
  });

  it('clears the selection when you click nothing', () => {
    const { select, marquee } = makeSelect([new FakeTool('marker', false)]);
    select.onPointerDown(pointer({ x: 10, y: 10 }));
    select.onPointerUp(pointer({ x: 10, y: 10, isClick: true }));
    expect(marquee.cleared).toBe(1);
    expect(marquee.selected).toHaveLength(0);
  });

  it('clears the selection when you grab one thing instead', () => {
    const { select, marquee } = makeSelect([new FakeTool('marker', true)]);
    select.onPointerDown(pointer());
    expect(marquee.cleared).toBe(1);
  });
});

describe('the select tool: moving a selection', () => {
  it('drags everything selected instead of the one thing pressed', () => {
    const marker = new FakeTool('marker', true);
    // Several things selected, and the pointer is over one of them.
    const { select, marquee } = makeSelect([marker], new FakeMarquee(3, true));

    expect(select.onPointerDown(pointer({ x: 50, y: 50 }))).toBe(true);
    // The marker tool must never see it: it would move that one marker alone,
    // which is the opposite of what selecting several was for.
    expect(marker.seen).toEqual([]);

    select.onPointerMove(pointer({ x: 60, y: 55, isClick: false }));
    expect(marquee.movedTo).toEqual([{ x: 60, y: 55 }]);

    expect(select.onPointerUp(pointer({ x: 60, y: 55 }))).toBe(true);
    expect(marquee.endedMoves).toBe(1);
  });

  it('leaves a single selection to the tool that owns it', () => {
    const marker = new FakeTool('marker', true);
    // One thing selected is not a group, so the ordinary drag is right.
    const { select } = makeSelect([marker], new FakeMarquee(1, true));
    select.onPointerDown(pointer());
    expect(marker.seen).toEqual(['down']);
  });
});
