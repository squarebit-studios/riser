// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Where documents live.
//
// One interface, two implementations. `LocalStorage` works with no account and
// is what an anonymous visitor gets. `ServerStorage` talks to the Riser module
// in the store backend and is what a signed-in user gets, so their work is
// waiting for them on the next machine.
//
// Documents are stored as USDA TEXT, not as JSON. That is deliberate: what the
// browser saves is exactly what the server opens with OpenUSD, so there is no
// second format to keep in sync and no way for the two to drift.
// ==========================================================================

import type { RiserDocument } from './types';
import { readUsda } from './usda-reader';
import { writeUsda } from './usda-writer';

export interface DocumentSummary {
  id: string;
  name: string;
  templateId: string;
  characterRef: string;
  updatedAt: string;
  /** Present for server documents; absent locally. */
  ownerId?: string;
}

export interface StoredDocument extends DocumentSummary {
  /** The USDA layer text. */
  usda: string;
}

export interface DocumentStorage {
  readonly kind: 'local' | 'server';
  list(): Promise<DocumentSummary[]>;
  load(id: string): Promise<{ summary: DocumentSummary; doc: RiserDocument }>;
  /** Create or overwrite. Returns the id, which the backend may assign. */
  save(doc: RiserDocument, id?: string): Promise<DocumentSummary>;
  remove(id: string): Promise<void>;
}

export class StorageError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

// -------------------------------------------------------------------------
// Local
// -------------------------------------------------------------------------

const LOCAL_PREFIX = 'riser.doc.';
const LOCAL_INDEX = 'riser.index';

export class LocalStorageDocuments implements DocumentStorage {
  readonly kind = 'local' as const;

  constructor(private readonly storage: Storage = window.localStorage) {}

  async list(): Promise<DocumentSummary[]> {
    return this.readIndex().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async load(id: string): Promise<{ summary: DocumentSummary; doc: RiserDocument }> {
    const raw = this.storage.getItem(LOCAL_PREFIX + id);
    if (raw === null) throw new StorageError(`No local document "${id}"`);
    const summary = this.readIndex().find((s) => s.id === id);
    if (!summary) throw new StorageError(`Local document "${id}" is not in the index`);
    return { summary, doc: readUsda(raw) };
  }

  async save(doc: RiserDocument, id?: string): Promise<DocumentSummary> {
    const docId = id ?? newId();
    const summary: DocumentSummary = {
      id: docId,
      name: doc.name,
      templateId: doc.templateId,
      characterRef: doc.characterRef,
      updatedAt: new Date().toISOString()
    };
    try {
      this.storage.setItem(LOCAL_PREFIX + docId, writeUsda(doc));
    } catch (err) {
      // Quota is the realistic failure here, and it is worth naming, because
      // "save failed" with no reason sends people looking in the wrong place.
      throw new StorageError(
        `Could not save locally - browser storage may be full. ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    const index = this.readIndex().filter((s) => s.id !== docId);
    index.push(summary);
    this.writeIndex(index);
    return summary;
  }

  async remove(id: string): Promise<void> {
    this.storage.removeItem(LOCAL_PREFIX + id);
    this.writeIndex(this.readIndex().filter((s) => s.id !== id));
  }

  private readIndex(): DocumentSummary[] {
    const raw = this.storage.getItem(LOCAL_INDEX);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as DocumentSummary[]) : [];
    } catch {
      // A corrupt index should not brick the app; the documents themselves are
      // still on disk and can be recovered by hand if it ever matters.
      return [];
    }
  }

  private writeIndex(index: DocumentSummary[]): void {
    this.storage.setItem(LOCAL_INDEX, JSON.stringify(index));
  }
}

// -------------------------------------------------------------------------
// Server
// -------------------------------------------------------------------------

/**
 * Talks to the `riser` module in the store backend.
 *
 * Authentication is the store's existing httpOnly session cookie, which is why
 * every request sends credentials and none of them touch a token. The cookie
 * is issued on `.squarebitstudios.com`, so it is already valid here - see
 * auth.controller.ts in squarebit-store, which sets COOKIE_DOMAIN.
 */
export class ServerDocuments implements DocumentStorage {
  readonly kind = 'server' as const;

  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) }
      });
    } catch (err) {
      throw new StorageError(
        `Could not reach the server: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (response.status === 401) {
      throw new StorageError('Your session has expired. Sign in again to save.', 401);
    }
    if (!response.ok) {
      throw new StorageError(
        `Server returned ${response.status} ${response.statusText}`,
        response.status
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async list(): Promise<DocumentSummary[]> {
    return this.request<DocumentSummary[]>('/riser/documents');
  }

  async load(id: string): Promise<{ summary: DocumentSummary; doc: RiserDocument }> {
    const stored = await this.request<StoredDocument>(
      `/riser/documents/${encodeURIComponent(id)}`
    );
    const { usda, ...summary } = stored;
    return { summary, doc: readUsda(usda) };
  }

  async save(doc: RiserDocument, id?: string): Promise<DocumentSummary> {
    const body = JSON.stringify({
      name: doc.name,
      templateId: doc.templateId,
      characterRef: doc.characterRef,
      usda: writeUsda(doc)
    });
    return id
      ? this.request<DocumentSummary>(`/riser/documents/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body
        })
      : this.request<DocumentSummary>('/riser/documents', { method: 'POST', body });
  }

  async remove(id: string): Promise<void> {
    await this.request<void>(`/riser/documents/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  }
}

// -------------------------------------------------------------------------
// File download / upload
// -------------------------------------------------------------------------

/** Offer the document as a `.usda` file. */
export function downloadUsda(doc: RiserDocument, filename?: string): void {
  const text = writeUsda(doc, { banner: true });
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? `${sanitizeFilename(doc.name)}.usda`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function readUsdaFile(file: File): Promise<RiserDocument> {
  return readUsda(await file.text());
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'riser';
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
