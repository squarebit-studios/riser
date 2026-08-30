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

      {dragOver && (
        <div className="pointer-events-none absolute inset-4 flex items-center justify-center rounded-lg border-2 border-dashed border-guide-placed/70 bg-guide-placed/5">
          <span className="text-sm text-ink">Drop a character to load it</span>
        </div>
      )}

      {loading && (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
          <div className="rounded bg-panel-lighter/95 px-3 py-1.5 text-xs text-ink shadow-lg">
            {loading}...
          </div>
        </div>
      )}

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
