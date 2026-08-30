// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The document store: one RiserDocument, an undo stack, and a subscription
// list.
//
// Undo is snapshot-based rather than inverse-command based, deliberately. The
// documents are small - a fully marked-up biped with face curves is tens of
// kilobytes - and mutations.ts already returns new values, so a snapshot costs
// a pointer copy of the arrays that did not change. Inverse commands would buy
// nothing here and would add a second implementation of every mutation, each
// with its own opportunity to be subtly wrong. Entries still carry a label, so
// the UI can say "Undo Place Marker" rather than just "Undo".
//
// Coalescing matters for drags: a marker dragged across the surface produces a
// mutation per frame, and without merging, one drag would need sixty undos.
// ==========================================================================

import type { RiserDocument } from './types';

const MAX_HISTORY = 100;

/** Milliseconds within which two same-key mutations merge into one undo step. */
const COALESCE_WINDOW_MS = 700;

export interface HistoryEntry {
  doc: RiserDocument;
  label: string;
  /** Mutations sharing a key merge while they keep arriving. */
  coalesceKey: string | null;
  at: number;
}

export interface ApplyOptions {
  /**
   * Merge with the previous entry when it shares this key and arrived
   * recently. Use something stable for the interaction, such as
   * `move:wristL`.
   */
  coalesceKey?: string;
  /** Change the document without touching the undo stack. */
  transient?: boolean;
}

export type DocumentListener = (doc: RiserDocument, store: DocumentStore) => void;

export class DocumentStore {
  private current: RiserDocument;
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private readonly listeners = new Set<DocumentListener>();

  /** Bumped on every change. Cheap way for consumers to test for staleness. */
  private revision = 0;
  /** Revision at the last save, for the unsaved-changes indicator. */
  private savedRevision = 0;

  constructor(initial: RiserDocument) {
    this.current = initial;
  }

  get document(): RiserDocument {
    return this.current;
  }

  get version(): number {
    return this.revision;
  }

  get isDirty(): boolean {
    return this.revision !== this.savedRevision;
  }

  markSaved(): void {
    this.savedRevision = this.revision;
    this.emit();
  }

  subscribe(listener: DocumentListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Apply a pure mutation and record it for undo. */
  apply(
    mutate: (doc: RiserDocument) => RiserDocument,
    label: string,
    options: ApplyOptions = {}
  ): RiserDocument {
    const next = mutate(this.current);
    if (next === this.current) return this.current;

    if (!options.transient) {
      const previous = this.past[this.past.length - 1];
      const key = options.coalesceKey ?? null;
      const now = Date.now();

      const canMerge =
        key !== null &&
        previous !== undefined &&
        previous.coalesceKey === key &&
        now - previous.at < COALESCE_WINDOW_MS;

      if (canMerge) {
        // Keep the ORIGINAL pre-drag snapshot; only refresh the clock, so the
        // whole drag collapses to one undo step.
        previous.at = now;
      } else {
        this.past.push({
          doc: this.current,
          label,
          coalesceKey: key,
          at: now
        });
        if (this.past.length > MAX_HISTORY) this.past.shift();
      }
      // Any new edit invalidates the redo branch.
      this.future = [];
    }

    this.current = next;
    this.revision++;
    this.emit();
    return next;
  }

  /** Replace the document wholesale - a load, or a reset. Clears history. */
  reset(doc: RiserDocument): void {
    this.current = doc;
    this.past = [];
    this.future = [];
    this.revision++;
    this.savedRevision = this.revision;
    this.emit();
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Label of the step undo would reverse, for the menu item. */
  get undoLabel(): string | null {
    return this.past[this.past.length - 1]?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.future[this.future.length - 1]?.label ?? null;
  }

  undo(): boolean {
    const entry = this.past.pop();
    if (!entry) return false;
    this.future.push({
      doc: this.current,
      label: entry.label,
      coalesceKey: null,
      at: Date.now()
    });
    this.current = entry.doc;
    this.revision++;
    this.emit();
    return true;
  }

  redo(): boolean {
    const entry = this.future.pop();
    if (!entry) return false;
    this.past.push({
      doc: this.current,
      label: entry.label,
      coalesceKey: null,
      at: Date.now()
    });
    this.current = entry.doc;
    this.revision++;
    this.emit();
    return true;
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.current, this);
  }
}
