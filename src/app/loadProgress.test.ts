// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// That a finished load leaves no progress behind.
//
// The progress bar and the loading message are two pieces of state, and the
// obvious bug is the one where they disagree: a load ends, the message clears,
// and a bar sits at 43% over a character that is already on screen. Clearing
// them together is a property of the store rather than of whoever remembers to
// call both, which is what this pins.
// ==========================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from './state';

describe('load progress', () => {
  beforeEach(() => {
    useUiStore.getState().setLoading(null);
  });

  it('is cleared when the load finishes', () => {
    const store = useUiStore.getState();
    store.setLoading('Loading gary.usdz');
    store.setLoadProgress({ stage: 'downloading', received: 10, total: 100 });
    expect(useUiStore.getState().loadProgress).not.toBeNull();

    useUiStore.getState().setLoading(null);
    expect(useUiStore.getState().loadProgress).toBeNull();
    expect(useUiStore.getState().loading).toBeNull();
  });

  it('survives a new message, so progress is not lost mid-load', () => {
    const store = useUiStore.getState();
    store.setLoading('Loading gary.usdz');
    store.setLoadProgress({ stage: 'downloading', received: 10, total: 100 });
    useUiStore.getState().setLoading('Loading gary.usdz');
    expect(useUiStore.getState().loadProgress?.received).toBe(10);
  });

  it('carries a cancel only while there is something to cancel', () => {
    // Parsing is synchronous and already holds the bytes, so aborting the
    // fetch then would do nothing. A button that does nothing is worse than no
    // button, because it is tried at exactly the moment someone wants out.
    const store = useUiStore.getState();
    store.setLoadProgress({
      stage: 'downloading',
      received: 1,
      total: 100,
      cancel: () => undefined
    });
    expect(useUiStore.getState().loadProgress?.cancel).toBeDefined();

    store.setLoadProgress({ stage: 'parsing', received: 100, total: 100 });
    expect(useUiStore.getState().loadProgress?.cancel).toBeUndefined();
  });
});

describe('the smooth toggle', () => {
  it('actually smooths when it is switched on', () => {
    // It did not. The level defaulted to 0 and the toggle only flipped the
    // flag, so the effective level stayed 0: the button lit up and the
    // character did not move, which reads as a broken control.
    const store = useUiStore.getState();
    store.setSmoothing(false);
    store.setSubdivLevel(0);
    store.setSmoothing(false);

    useUiStore.getState().toggleSmoothing();
    const after = useUiStore.getState();
    expect(after.smoothing).toBe(true);
    expect(after.subdivLevel).toBeGreaterThan(0);
  });

  it('returns to the level you last chose', () => {
    const store = useUiStore.getState();
    store.setSubdivLevel(3);
    useUiStore.getState().toggleSmoothing();
    expect(useUiStore.getState().smoothing).toBe(false);
    useUiStore.getState().toggleSmoothing();
    expect(useUiStore.getState().subdivLevel).toBe(3);
  });

  it('leaves level 0 alone when it was chosen from the menu', () => {
    // Smoothing on at level 0 is a real state: the mesh as authored, drawn as
    // quads. Choosing it says something; arriving there by pressing Smooth
    // does not.
    const store = useUiStore.getState();
    store.setSubdivLevel(0);
    expect(useUiStore.getState().smoothing).toBe(true);
    expect(useUiStore.getState().subdivLevel).toBe(0);
  });
});
