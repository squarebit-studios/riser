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
  /**
   * Where the app FETCHED the character from, which is not the same thing as
   * the document's `characterRef`.
   *
   * The document's reference is written into the exported USD and is meant to
   * be resolved by whatever opens that file later, so it is a relative path
   * beside the layer. This is a URL this browser can request again. Conflating
   * them meant the exported layer carried a served path like
   * `/assets/biped-blockout.usda`, which resolves nowhere outside this app.
   */
  loadUrl: string;
}

interface StoredSession {
  version: number;
  usda: string;
  savedAt: string;
  loadUrl: string;
}

/**
 * Write the current document to the session slot.
 *
 * Returns false rather than throwing when the browser refuses - a private
 * window, or a full quota. Autosave failing is not a reason to interrupt
 * someone mid-placement, and the export path still works.
 */
export function saveSession(
  doc: RiserDocument,
  storage: Storage,
  loadUrl = ''
): boolean {
  try {
    const payload: StoredSession = {
      version: SESSION_VERSION,
      usda: writeUsda(doc),
      savedAt: new Date().toISOString(),
      loadUrl
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
      loadUrl: typeof parsed.loadUrl === 'string' ? parsed.loadUrl : ''
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
 * Whether the app can fetch this character again on startup.
 *
 * A bundled asset is a path the browser can request. An upload is just a file
 * name: the bytes lived in the user's file picker and were never ours to keep,
 * so the document can come back but the mesh cannot, and the app has to say so
 * rather than silently restoring guides with nothing to bind against.
 */
export function isReloadableRef(loadUrl: string): boolean {
  return loadUrl.startsWith('/') || /^https?:\/\//.test(loadUrl);
}

/**
 * The reference to WRITE into an exported layer for an asset loaded from
 * `loadUrl`.
 *
 * A relative path beside the layer, which is the conventional and most
 * portable choice in USD: put the two files in one directory and it resolves,
 * anywhere, for any tool. The served path the browser happened to fetch from
 * resolves only inside this app, and a bare upload filename resolves nowhere
 * at all.
 */
export function exportRefFor(loadUrl: string): string {
  const withoutQuery = loadUrl.split(/[?#]/)[0] ?? loadUrl;
  const name = withoutQuery.split(/[\\/]/).pop() ?? withoutQuery;
  return name ? `./${name}` : '';
}
