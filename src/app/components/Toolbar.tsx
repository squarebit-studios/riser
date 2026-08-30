// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The top bar: character, template, tools, view, and saving.
// ==========================================================================

import React, { useRef } from 'react';
import { useApp } from '../AppContext';
import { useUiStore } from '../state';
import { TEMPLATES } from '../../templates';
import { STOCK_CHARACTERS } from '../stock';
import { downloadUsda, readUsdaFile } from '../../doc/storage';
import { SUPPORTED_EXTENSIONS } from '../../io/loadCharacter';
import { MAX_SUBDIV_LEVEL, MIN_SUBDIV_LEVEL } from '../../viewport/SubdivSurface';

export function Toolbar(): JSX.Element {
  const app = useApp();
  const characterInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);

  const activeTool = useUiStore((s) => s.activeTool);
  const templateId = useUiStore((s) => s.templateId);
  const symmetry = useUiStore((s) => s.symmetry);
  const xray = useUiStore((s) => s.xray);
  const hasSkeleton = useUiStore((s) => s.characterHasSkeleton);
  const subdivLevel = useUiStore((s) => s.subdivLevel);
  const subdivClamped = useUiStore((s) => s.subdivClamped);
  const dirty = useUiStore((s) => s.dirty);
  // Re-render undo/redo enablement when the document changes.
  useUiStore((s) => s.docRevision);

  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-edge bg-panel px-3">
      <span className="mr-3 select-none text-sm font-semibold tracking-tight text-ink">
        Riser
      </span>

      {/* Character ------------------------------------------------------- */}
      <select
        className="rs-button max-w-[11rem] bg-panel-light"
        defaultValue=""
        onChange={(e) => {
          const url = e.target.value;
          if (url) void app.loadFromUrl(url);
          e.target.value = '';
        }}
        title="Load one of the bundled characters"
      >
        <option value="" disabled>
          Stock character
        </option>
        {STOCK_CHARACTERS.map((c) => (
          <option key={c.url} value={c.url}>
            {c.label}
          </option>
        ))}
      </select>

      <button className="rs-button" onClick={() => characterInput.current?.click()}>
        Upload
      </button>
      <input
        ref={characterInput}
        type="file"
        hidden
        accept={SUPPORTED_EXTENSIONS.map((e) => `.${e}`).join(',')}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void app.loadFromFile(file);
          e.target.value = '';
        }}
      />

      <Divider />

      {/* Template -------------------------------------------------------- */}
      <select
        className="rs-button bg-panel-light"
        value={templateId}
        onChange={(e) => app.applyTemplateChange(e.target.value)}
        title="Which rig layout to place"
      >
        {TEMPLATES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>

      <Divider />

      {/* Tools ----------------------------------------------------------- */}
      <ToggleButton
        active={activeTool === 'marker'}
        onClick={() => useUiStore.getState().setActiveTool('marker')}
        title="Marker tool (1)"
      >
        Markers
      </ToggleButton>
      <ToggleButton
        active={activeTool === 'curve'}
        onClick={() => useUiStore.getState().setActiveTool('curve')}
        title="Curve tool (2)"
      >
        Curves
      </ToggleButton>

      <Divider />

      <ToggleButton
        active={symmetry}
        onClick={() => useUiStore.getState().toggleSymmetry()}
        title="Mirror placements across the character's centre line"
      >
        Symmetry
      </ToggleButton>
      <ToggleButton
        active={xray}
        onClick={() => useUiStore.getState().toggleXray()}
        title="Draw markers and curves through the mesh"
      >
        X-ray
      </ToggleButton>

      <Divider />

      {/* Subdivision -----------------------------------------------------
          Display only. Bindings always name a control cage triangle, so
          changing this never moves a marker the user has placed. */}
      <label
        className="flex items-center gap-1.5 px-1 text-ink-dim"
        title={
          subdivClamped
            ? 'Subdivision level was reduced because the mesh is already dense.'
            : 'Catmull-Clark preview level. Markers still bind to the control cage.'
        }
      >
        <span className="text-[11px] uppercase tracking-wide text-ink-faint">Subdiv</span>
        <input
          type="range"
          min={MIN_SUBDIV_LEVEL}
          max={MAX_SUBDIV_LEVEL}
          step={1}
          value={subdivLevel}
          onChange={(e) => useUiStore.getState().setSubdivLevel(Number(e.target.value))}
          className="w-16 accent-guide-placed"
        />
        <span
          className={`w-3 font-mono text-[11px] ${
            subdivClamped ? 'text-guide-active' : 'text-ink-faint'
          }`}
        >
          {subdivLevel}
        </span>
      </label>

      <Divider />

      {/* Auto-place. Only offered when there is a rig to read; it never
          overwrites anything placed by hand, so it is safe to press twice. */}
      <button
        className="rs-button"
        onClick={() => app.autoPlaceFromSkeleton({ announce: true })}
        disabled={!hasSkeleton}
        title={
          hasSkeleton
            ? "Place guides from the character's own skeleton. Your own placements are kept."
            : 'This character has no skeleton to read guides from.'
        }
      >
        Auto-place
      </button>

      <Divider />

      <button
        className="rs-button"
        onClick={() => app.undo()}
        disabled={!app.store.canUndo}
        title={app.store.undoLabel ? `Undo ${app.store.undoLabel}` : 'Undo'}
      >
        Undo
      </button>
      <button
        className="rs-button"
        onClick={() => app.redo()}
        disabled={!app.store.canRedo}
        title={app.store.redoLabel ? `Redo ${app.store.redoLabel}` : 'Redo'}
      >
        Redo
      </button>

      <div className="flex-1" />

      <button className="rs-button" onClick={() => app.frameCharacter()} title="Frame all (F)">
        Frame
      </button>

      {/* Document -------------------------------------------------------- */}
      <button className="rs-button" onClick={() => documentInput.current?.click()}>
        Open
      </button>
      <input
        ref={documentInput}
        type="file"
        hidden
        accept=".usda,.usd"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            app.loadDocument(await readUsdaFile(file));
          } catch (err) {
            useUiStore
              .getState()
              .setError(err instanceof Error ? err.message : String(err));
          }
        }}
      />

      <button
        className="rs-button"
        onClick={() => {
          downloadUsda(app.store.document);
          app.store.markSaved();
        }}
        title="Download this document as a USD layer"
      >
        Export USD{dirty ? ' •' : ''}
      </button>
    </header>
  );
}

function Divider(): JSX.Element {
  return <div className="mx-1.5 h-5 w-px bg-edge" />;
}

function ToggleButton({
  active,
  onClick,
  title,
  children
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      className={`rs-button ${active ? 'rs-button-active' : ''}`}
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}
