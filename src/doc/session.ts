// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Keeping the current document across a reload.
//
// Placing a full checklist is twenty minutes of careful work, and until now
// closing the tab threw all of it away. This is the smallest thing that fixes
// that: one slot, written on every change, read on startup.
//
// It is NOT the document library. `storage.ts` handles named documents, local
// or on the server. This is the scratch buffer underneath - what you had open,
// so that a refresh, a crash or a stray Ctrl-W is survivable. The two are
// separate because they answer different questions: "which of my documents is
// this" versus "what was I in the middle of".
//
// The document is stored as USDA text, the same as everywhere else, so there
// is no second format to keep in step. It costs a serialization per save,
// which is why saving is debounced by the caller rather than done per frame.
// ==========================================================================

import type { RiserDocument } from './types';
import { readUsda } from './usda-reader';
import { writeUsda } from './usda-writer';

export const SESSION_KEY = 'riser.session';

/** Current shape of the stored blob. */
const SESSION_VERSION = 1;

export interface SessionSnapshot {
  doc: RiserDocument;
  savedAt: string;
  /** The asset the document referenced, so it can be reloaded. */
  characterRef: string;
}

interface StoredSession {
  version: number;
  usda: string;
  savedAt: string;
  characterRef: string;
}

/**
 * Write the current document to the session slot.
 *
 * Returns false rather than throwing when the browser refuses - a private
 * window, or a full quota. Autosave failing is not a reason to interrupt
 * someone mid-placement, and the export path still works.
 */
export function saveSession(doc: RiserDocument, storage: Storage): boolean {
  try {
    const payload: StoredSession = {
      version: SESSION_VERSION,
      usda: writeUsda(doc),
      savedAt: new Date().toISOString(),
      characterRef: doc.characterRef
    };
    storage.setItem(SESSION_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read back the last session, or null when there is nothing usable.
 *
 * Every failure returns null rather than throwing. A corrupt or half-written
 * blob must not stop the app starting - the worst acceptable outcome is
 * beginning empty, and that is what this does.
 */
export function loadSession(storage: Storage): SessionSnapshot | null {
  let raw: string | null;
  try {
    raw = storage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (parsed.version !== SESSION_VERSION) return null;
    if (typeof parsed.usda !== 'string' || parsed.usda.length === 0) return null;

    return {
      doc: readUsda(parsed.usda),
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
      characterRef:
        typeof parsed.characterRef === 'string' ? parsed.characterRef : ''
    };
  } catch {
    return null;
  }
}

export function clearSession(storage: Storage): void {
  try {
    storage.removeItem(SESSION_KEY);
  } catch {
    // Nothing useful to do, and nothing depends on it having worked.
  }
}

/** True when a document holds anything worth restoring. */
export function isWorthSaving(doc: RiserDocument): boolean {
  return doc.guides.length > 0 || doc.curves.length > 0;
}

/**
 * Whether a character reference can be fetched again on startup.
 *
 * A bundled asset is a path the browser can request. An upload is just a file
 * name: the bytes lived in the user's file picker and were never ours to keep,
 * so the document can come back but the mesh cannot, and the app has to say so
 * rather than silently restoring guides with nothing to bind against.
 */
export function isReloadableRef(characterRef: string): boolean {
  return characterRef.startsWith('/') || /^https?:\/\//.test(characterRef);
}
