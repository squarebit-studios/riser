// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Naming, saving and reopening documents.
//
// Autosave already means work cannot be lost to a refresh, but it is a single
// slot: opening a second character silently writes over the first. This is the
// difference between "my work survives" and "I can have more than one".
//
// The list is loaded when the menu opens rather than held in state. It is read
// from storage, it is small, and a stale list that offers a document someone
// deleted in another tab is worse than a request.
// ==========================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../AppContext';
import { useUiStore } from '../state';
import type { DocumentSummary } from '../../doc/storage';

export function DocumentsMenu(): JSX.Element {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const dirty = useUiStore((s) => s.dirty);
  useUiStore((s) => s.docRevision);

  const refresh = useCallback(async () => {
    setDocuments(await app.listDocuments());
  }, [app]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // Close on a click anywhere else. Without this the menu stays open behind
  // the viewport and swallows the next click meant for the character.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const save = async (): Promise<void> => {
    await app.saveDocument();
    await refresh();
  };

  const saveAs = async (): Promise<void> => {
    const suggested = app.store.document.name;
    const name = window.prompt('Save this document as', suggested);
    if (!name) return;
    await app.saveDocument(name);
    await refresh();
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        className={`rs-button ${open ? 'rs-button-active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Save, open and manage documents"
        data-testid="documents-menu"
      >
        Documents{dirty ? ' •' : ''}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded border border-edge bg-panel-light shadow-xl">
          <div className="flex gap-1 border-b border-edge p-2">
            <button className="rs-button flex-1" onClick={save} data-testid="save-document">
              Save
            </button>
            <button className="rs-button flex-1" onClick={saveAs} data-testid="save-as">
              Save as
            </button>
            <button
              className="rs-button flex-1"
              onClick={() => {
                app.startNewDocument();
                setOpen(false);
              }}
              title="Start a new document, keeping the character that is loaded"
            >
              New
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto p-1" data-testid="document-list">
            {documents.length === 0 ? (
              <p className="px-2 py-3 text-center text-ink-faint">
                Nothing saved yet. Your work is kept across a reload either way.
              </p>
            ) : (
              documents.map((summary) => (
                <DocumentRow
                  key={summary.id}
                  summary={summary}
                  isOpen={summary.id === app.currentDocumentId}
                  onOpen={async () => {
                    await app.openDocument(summary.id);
                    setOpen(false);
                  }}
                  onDelete={async () => {
                    await app.deleteDocument(summary.id);
                    await refresh();
                  }}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentRow({
  summary,
  isOpen,
  onOpen,
  onDelete
}: {
  summary: DocumentSummary;
  isOpen: boolean;
  onOpen: () => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <div
      className={`group flex items-center gap-2 rounded px-2 py-1.5 ${
        isOpen ? 'bg-guide-active/15' : 'hover:bg-panel-lighter'
      }`}
    >
      <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <span className="block truncate text-ink">{summary.name}</span>
        <span className="block truncate text-[11px] text-ink-faint">
          {summary.templateId} · {formatWhen(summary.updatedAt)}
        </span>
      </button>
      <button
        className="rs-button opacity-0 transition-opacity group-hover:opacity-100"
        onClick={onDelete}
        title={`Delete "${summary.name}"`}
        aria-label={`Delete ${summary.name}`}
      >
        Delete
      </button>
    </div>
  );
}

/** A short, human reading of when something was saved. */
function formatWhen(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'unknown';

  const seconds = Math.max(0, (Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return new Date(then).toLocaleDateString();
}
