// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The React host for the three.js viewport.
//
// This component renders ONE empty div and never re-renders because of
// anything happening in the scene. That is the boundary: below it, an
// imperative renderer at display rate; above it, ordinary React.
// ==========================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../AppContext';
import { useUiStore } from '../state';
import { SUPPORTED_EXTENSIONS, extensionOf, formatForExtension } from '../../io/loadCharacter';

export function Viewport3D(): JSX.Element {
  const app = useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const loading = useUiStore((s) => s.loading);
  const error = useUiStore((s) => s.error);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    app.mount(container);
    // Deliberately no cleanup here: AppProvider owns the instance's lifetime
    // and unmounts it once, when the whole app goes away. Unmounting on this
    // effect's cleanup would tear down the WebGL context on any parent
    // re-render that remounts the host.
  }, [app]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (!formatForExtension(extensionOf(file.name))) {
        useUiStore
          .getState()
          .setError(
            `${file.name} is not a format Riser reads. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}.`
          );
        return;
      }
      void app.loadFromFile(file);
    },
    [app]
  );

  return (
    <div
      className="relative h-full w-full"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div ref={containerRef} className="h-full w-full" />

      <ModeBanner />
      <SelectionBox />

      {dragOver && (
        <div className="pointer-events-none absolute inset-4 flex items-center justify-center rounded-lg border-2 border-dashed border-guide-placed/70 bg-guide-placed/5">
          <span className="text-sm text-ink">Drop a character to load it</span>
        </div>
      )}

      {loading && <LoadingBanner message={loading} />}

      {error && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center px-4">
          <div className="flex max-w-xl items-start gap-3 rounded border border-guide-error/40 bg-panel-lighter px-3 py-2 text-xs text-ink shadow-lg">
            <span className="flex-1">{error}</span>
            <button
              className="text-ink-faint hover:text-ink"
              onClick={() => useUiStore.getState().setError(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The box being dragged in Select mode.
 *
 * Drawn here rather than in the scene because it is interface, not geometry:
 * it wants crisp pixel edges at any zoom and the page's own accent colour, and
 * putting it in the renderer would mean maintaining a screen space overlay in
 * a scene that has no other use for one. It is one absolutely positioned div
 * that appears for the length of a drag.
 */
function SelectionBox(): JSX.Element | null {
  const rect = useUiStore((s) => s.marqueeRect);
  if (!rect) return null;

  return (
    <div
      className="pointer-events-none absolute border border-accent bg-accent/10"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height
      }}
    />
  );
}
/**
 * Which mode the next click is in, in the corner of the thing it acts on.
 *
 * The toolbar already says this, and it was not enough. A click on the
 * character does something different and irreversible-looking in each mode -
 * it drops a marker, it extends a curve, or it does nothing at all - and the
 * evidence for which was a small highlighted button at the top of the window,
 * nowhere near where the person is looking or clicking.
 *
 * So it is stated over the viewport, and it names the consequence rather than
 * the mode: "click to place a marker" is the thing somebody needs to know, and
 * "Markers" is only the name we happen to have given that. Placing modes are
 * tinted to match the thing they create; Select is quiet, because the point of
 * it is that clicking is safe.
 */
function ModeBanner(): JSX.Element | null {
  const activeTool = useUiStore((s) => s.activeTool);
  const loading = useUiStore((s) => s.loading);

  // One banner at a time. The loading banner is the more urgent news and it
  // is answering the same question: what is this window doing right now.
  if (loading) return null;

  const modes = {
    select: {
      label: 'Select',
      hint: 'Drag a marker or a point',
      tint: 'border-edge bg-panel-lighter/90 text-ink-faint'
    },
    marker: {
      label: 'Marker mode',
      hint: 'Click the character to place',
      tint: 'border-guide-placed/50 bg-guide-placed/10 text-ink'
    },
    curve: {
      label: 'Curve mode',
      hint: 'Click along the character to draw',
      tint: 'border-curve/50 bg-curve/10 text-ink'
    }
  } as const;

  const mode = modes[activeTool];
  if (!mode) return null;

  return (
    <div
      className="pointer-events-none absolute right-3 top-3 select-none"
      // Announced rather than silent: someone using a screen reader gets the
      // same warning about what a click is about to do.
      role="status"
      aria-live="polite"
    >
      <div
        className={`flex items-baseline gap-2 rounded-control border px-2.5 py-1.5 shadow-lg backdrop-blur-sm ${mode.tint}`}
      >
        <span className="text-xs font-semibold">{mode.label}</span>
        <span className="text-[11px] text-ink-faint">{mode.hint}</span>
      </div>
    </div>
  );
}
/**
 * What a character load is doing, and a way out of it.
 *
 * A character can be 20MB, which is a long time to show a word and a full
 * stop, and until now there was no way to stop one: the only exit from a
 * download somebody did not mean to start was reloading the page, which threw
 * away the document with it.
 *
 * The bar is shown only when the server declared a length. Without one there
 * is no honest percentage, so it shows what has arrived instead of inventing a
 * fraction.
 */
function LoadingBanner({ message }: { message: string }): JSX.Element {
  const progress = useUiStore((s) => s.loadProgress);

  const percent =
    progress && progress.total
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null;

  const stage =
    progress?.stage === 'parsing'
      ? 'Reading the file'
      : progress?.stage === 'building'
        ? 'Building the character'
        : null;

  return (
    <div className="absolute inset-x-0 top-3 flex justify-center px-4">
      <div className="w-full max-w-sm rounded-control bg-panel-lighter/95 px-3 py-2 shadow-lg">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-ink">
            {stage ?? message}
          </span>
          {progress && progress.received > 0 && (
            <span className="shrink-0 font-mono text-[10px] text-ink-faint">
              {megabytes(progress.received)}
              {progress.total ? ` / ${megabytes(progress.total)}` : ''}
            </span>
          )}
          {progress?.cancel && (
            <button
              type="button"
              data-testid="cancel-load"
              onClick={progress.cancel}
              className="shrink-0 rounded-control px-1.5 py-0.5 text-[11px] text-ink-faint transition-colors hover:bg-panel-hover hover:text-ink"
            >
              Cancel
            </button>
          )}
        </div>

        <div
          className="mt-1.5 h-1 overflow-hidden rounded-full bg-panel-active"
          role="progressbar"
          aria-valuenow={percent ?? undefined}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={stage ?? message}
          data-testid="load-progress"
        >
          <div
            className={`h-full rounded-full bg-accent transition-[width] duration-150 ${
              percent === null ? 'animate-pulse w-1/3' : ''
            }`}
            style={percent === null ? undefined : { width: `${percent}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/** Bytes as a person reads them. */
function megabytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
