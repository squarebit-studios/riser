// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The menu bar: File, Edit, View, Help.
//
// Menus are where features are FOUND. A toolbar can only hold what fits, and
// what fits is whatever the designer guessed you would need most - everything
// else becomes undiscoverable. The bar answers "what can this thing do?" for
// someone who has never used it, which is the question a consumer product has
// to answer in its first minute.
//
// So the rule here is that every action in Riser appears in a menu, whether or
// not it also has a button. The toolbar is a shortcut to the common few; this
// is the complete list.
//
// Disabled items stay visible for the same reason. "Export USD" greyed out
// with a tooltip teaches that exporting exists; hiding it teaches nothing.
// ==========================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../AppContext';
import { useUiStore } from '../state';
import { STOCK_CHARACTERS } from '../stock';
import { TEMPLATES } from '../../templates';
import { downloadUsda, readUsdaFile, type DocumentSummary } from '../../doc/storage';
import { SUPPORTED_EXTENSIONS } from '../../io/loadCharacter';
import { VIEW_MODES } from '../../viewport/ViewModes';
import {
  MenuBar as Bar,
  MenuBarMenu,
  MenuItem,
  MenuLabel,
  MenuSeparator
} from './ui/Menu';
import { Icon } from './ui/Icon';

export function MenuBar(): JSX.Element {
  const app = useApp();
  const characterInput = useRef<HTMLInputElement>(null);
  const layerInput = useRef<HTMLInputElement>(null);

  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const dirty = useUiStore((s) => s.dirty);
  const characterName = useUiStore((s) => s.characterName);
  const hasSkeleton = useUiStore((s) => s.characterHasSkeleton);
  const templateId = useUiStore((s) => s.templateId);
  const viewMode = useUiStore((s) => s.viewMode);
  const guided = useUiStore((s) => s.guided);
  const ui = useUiStore();
  useUiStore((s) => s.docRevision);

  // The document list is re-read every time the File menu opens, rather than
  // held as state. It is small, it is local, and a stale list that offers a
  // document deleted in another tab - or omits one saved a moment ago - is
  // worse than the read costs.
  const refresh = useCallback(async () => {
    setDocuments(await app.listDocuments());
  }, [app]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (): Promise<void> => {
    await app.saveDocument();
    await refresh();
  };

  const saveAs = async (): Promise<void> => {
    const name = window.prompt('Save this document as', app.store.document.name);
    if (!name) return;
    await app.saveDocument(name);
    await refresh();
  };

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 bg-panel px-2">
      <span className="flex select-none items-center gap-1.5 pl-1 pr-2 text-[13px] font-semibold tracking-tight text-ink">
        <Icon name="layers" size={16} className="text-accent" />
        Riser
      </span>

      <Bar>
        {/* ---------------------------------------------------------- File */}
        <MenuBarMenu id="file" label="File" onOpen={() => void refresh()}>
          <MenuItem
            label="New document"
            icon="plus"
            shortcut="Ctrl+N"
            description="Start over, keeping the character that is loaded"
            data-testid="new-document"
            onSelect={() => app.startNewDocument()}
          />
          <MenuItem
            label="Save"
            icon="save"
            shortcut="Ctrl+S"
            data-testid="save-document"
            onSelect={() => void save()}
          />
          <MenuItem
            label="Save as…"
            data-testid="save-as"
            onSelect={() => void saveAs()}
          />

          <MenuSeparator />
          <MenuLabel>Open character</MenuLabel>
          {STOCK_CHARACTERS.map((character) => (
            <MenuItem
              key={character.url}
              label={character.label}
              icon="cube"
              data-testid={`open-${character.url.split('/').pop()}`}
              onSelect={() => void app.loadFromUrl(character.url)}
            />
          ))}
          <MenuItem
            label="From your computer…"
            icon="upload"
            description="USD, glTF, FBX or OBJ"
            onSelect={() => characterInput.current?.click()}
          />

          {documents.length > 0 && (
            <>
              <MenuSeparator />
              <MenuLabel>Recent documents</MenuLabel>
              {documents.slice(0, 6).map((summary) => (
                <MenuItem
                  key={summary.id}
                  label={summary.name}
                  icon="document"
                  description={summary.templateId}
                  onSelect={() => void app.openDocument(summary.id)}
                />
              ))}
            </>
          )}

          <MenuSeparator />
          <MenuItem
            label="Import markers…"
            icon="download"
            description="Open a .usda layer from disk"
            onSelect={() => layerInput.current?.click()}
          />
          <MenuItem
            label={dirty ? 'Export USD •' : 'Export USD'}
            icon="upload"
            shortcut="Ctrl+E"
            description="Download this document as a USD layer"
            onSelect={() => {
              downloadUsda(app.store.document);
              app.store.markSaved();
            }}
          />
        </MenuBarMenu>

        {/* ---------------------------------------------------------- Edit */}
        <MenuBarMenu id="edit" label="Edit">
          <MenuItem
            label={app.store.undoLabel ? `Undo ${app.store.undoLabel}` : 'Undo'}
            icon="undo"
            shortcut="Ctrl+Z"
            disabled={!app.store.canUndo}
            onSelect={() => app.undo()}
          />
          <MenuItem
            label={app.store.redoLabel ? `Redo ${app.store.redoLabel}` : 'Redo'}
            icon="redo"
            shortcut="Ctrl+Y"
            disabled={!app.store.canRedo}
            onSelect={() => app.redo()}
          />

          <MenuSeparator />
          <MenuItem
            label="Place markers automatically"
            icon="sparkles"
            disabled={!app.canAutoPlace}
            description={
              !characterName
                ? 'Load a character first'
                : hasSkeleton
                  ? "Read from the character's own rig - exact"
                  : 'Measure the character - approximate'
            }
            onSelect={() => app.autoPlace({ announce: true })}
          />
          <MenuItem
            label="Confirm all suggestions"
            icon="check"
            description="Accept every automatic marker where it is"
            onSelect={() => {
              const n = app.confirmAllGuides();
              useUiStore
                .getState()
                .setNotice(
                  n === 0 ? 'Nothing was suggested.' : `Confirmed ${n} markers.`
                );
            }}
          />

          <MenuSeparator />
          <MenuItem
            label="Mirror placements"
            icon="mirror"
            checked={ui.symmetry}
            shortcut="S"
            onSelect={() => useUiStore.getState().toggleSymmetry()}
          />

          <MenuSeparator />
          <MenuItem
            label="Clear all markers"
            icon="trash"
            danger
            onSelect={() => app.clearGuides()}
          />
          <MenuItem
            label="Clear all curves"
            icon="trash"
            danger
            onSelect={() => app.clearCurves()}
          />
        </MenuBarMenu>

        {/* ---------------------------------------------------------- View */}
        <MenuBarMenu id="view" label="View">
          <MenuLabel>Shading</MenuLabel>
          {VIEW_MODES.map((mode) => (
            <MenuItem
              key={mode.id}
              label={mode.label}
              checked={viewMode === mode.id}
              description={mode.hint}
              onSelect={() => useUiStore.getState().setViewMode(mode.id)}
            />
          ))}

          <MenuSeparator />
          <MenuLabel>Show</MenuLabel>
          <MenuItem
            label="Character"
            checked={ui.showGeometry}
            onSelect={() => useUiStore.getState().toggleGeometry()}
          />
          <MenuItem
            label="Markers"
            checked={ui.showMarkers}
            onSelect={() => useUiStore.getState().toggleMarkers()}
          />
          <MenuItem
            label="Curves"
            checked={ui.showCurves}
            onSelect={() => useUiStore.getState().toggleCurves()}
          />
          <MenuItem
            label="Skeleton"
            checked={ui.showSkeleton}
            disabled={!hasSkeleton}
            description={hasSkeleton ? undefined : 'This character has no rig'}
            onSelect={() => useUiStore.getState().toggleSkeleton()}
          />
          <MenuItem
            label="Ground grid"
            checked={ui.showGrid}
            shortcut="G"
            onSelect={() => useUiStore.getState().toggleGrid()}
          />
          <MenuItem
            label="See markers through the body"
            checked={ui.xray}
            shortcut="X"
            onSelect={() => useUiStore.getState().toggleXray()}
          />

          <MenuSeparator />
          <MenuItem
            label="Step-by-step guidance"
            checked={guided}
            description="Show one marker to place at a time"
            onSelect={() => useUiStore.getState().setGuided(!guided)}
          />

          <MenuSeparator />
          <MenuItem
            label="Frame character"
            icon="frame"
            shortcut="A"
            onSelect={() => app.frameCharacter()}
          />
          <MenuItem
            label="Focus selection"
            shortcut="F"
            onSelect={() => app.frameSelection()}
          />
          <MenuItem label="Reset panels" onSelect={() => useUiStore.getState().resetLayout()} />
        </MenuBarMenu>

        {/* ------------------------------------------------------ Template */}
        <MenuBarMenu id="template" label="Template">
          <MenuLabel>Rig layout to place</MenuLabel>
          {TEMPLATES.map((template) => (
            <MenuItem
              key={template.id}
              label={template.label}
              checked={templateId === template.id}
              onSelect={() => app.applyTemplateChange(template.id)}
            />
          ))}
          <MenuSeparator />
          <MenuItem
            label="Choose the template before loading"
            icon="info"
            disabled
            description="Riser measures a quadruped along its length, not its height"
          />
        </MenuBarMenu>

        {/* ---------------------------------------------------------- Help */}
        <MenuBarMenu id="help" label="Help">
          <MenuItem
            label="Getting started"
            icon="help"
            onSelect={() => window.open('https://github.com/squarebit/riser#readme', '_blank')}
          />
          <MenuSeparator />
          <MenuLabel>Keyboard</MenuLabel>
          <MenuItem label="Markers tool" shortcut="1" disabled />
          <MenuItem label="Curves tool" shortcut="2" disabled />
          <MenuItem label="Frame character" shortcut="A" disabled />
          <MenuItem label="Focus selection" shortcut="F" disabled />
          <MenuItem label="Mirror on/off" shortcut="S" disabled />
          <MenuItem label="See through body" shortcut="X" disabled />
          <MenuItem label="Undo / redo" shortcut="Ctrl+Z / Y" disabled />
        </MenuBarMenu>
      </Bar>

      <div className="flex-1" />

      <span className="truncate pr-1 text-[12px] text-ink-faint" title={characterName ?? ''}>
        {characterName ?? 'No character'}
        {dirty && <span className="ml-1 text-accent">•</span>}
      </span>

      {/* Hidden file pickers ------------------------------------------- */}
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
      <input
        ref={layerInput}
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
    </div>
  );
}
