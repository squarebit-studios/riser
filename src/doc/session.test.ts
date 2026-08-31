import { describe, it, expect } from 'vitest';
import {
  SESSION_KEY,
  clearSession,
  exportRefFor,
  isReloadableRef,
  isWorthSaving,
  loadSession,
  saveSession
} from './session';
import { createDocument, type Guide, type RiserDocument, type Vec3 } from './types';
import * as M from './mutations';

/** A Storage that lives in memory, so these need no browser. */
function fakeStorage(): Storage & { failWrites: boolean } {
  const map = new Map<string, string>();
  return {
    failWrites: false,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem(k: string, v: string) {
      if ((this as { failWrites: boolean }).failWrites) {
        throw new DOMException('QuotaExceededError');
      }
      map.set(k, v);
    }
  } as Storage & { failWrites: boolean };
}

function guide(id: string, pos: Vec3 = [0, 1, 0]): Guide {
  return {
    id,
    group: 'spine',
    position: pos,
    normal: [0, 1, 0],
    binding: {
      primPath: '/Riser/Character/Geom/Body',
      faceIndex: 42,
      barycentric: [0.25, 0.25, 0.5],
      offset: [0, 0, 0]
    },
    source: 'skeleton',
    confidence: 0.9
  };
}

function populated(): RiserDocument {
  let doc = createDocument('biped', '/assets/biped-blockout.usda', {
    name: 'In progress',
    metersPerUnit: 1
  });
  doc = M.placeGuide(doc, guide('pelvis', [0, 0.9, 0]));
  doc = M.placeGuide(doc, guide('chest', [0, 1.3, 0]));
  return doc;
}

describe('saving and restoring a session', () => {
  it('round-trips a document', () => {
    const storage = fakeStorage();
    const doc = populated();

    expect(saveSession(doc, storage, '/assets/biped-blockout.usda')).toBe(true);
    const restored = loadSession(storage);

    expect(restored).not.toBeNull();
    expect(restored!.doc.guides.map((g) => g.id)).toEqual(['pelvis', 'chest']);
    expect(restored!.doc.templateId).toBe('biped');
    // The URL the app can fetch again, which is NOT the reference written into
    // the exported layer.
    expect(restored!.loadUrl).toBe('/assets/biped-blockout.usda');
  });

  it('keeps bindings and provenance intact', () => {
    // A restored guide has to be as usable as the original: the binding is
    // what the server evaluates, and the source is what stops the next
    // automatic pass overwriting it.
    const storage = fakeStorage();
    saveSession(populated(), storage);

    const guides = loadSession(storage)!.doc.guides;
    expect(guides[0]!.binding!.faceIndex).toBe(42);
    expect(guides[0]!.binding!.primPath).toBe('/Riser/Character/Geom/Body');
    expect(guides[0]!.source).toBe('skeleton');
    expect(guides[0]!.confidence).toBeCloseTo(0.9, 5);
  });

  it('records when it was saved', () => {
    const storage = fakeStorage();
    saveSession(populated(), storage);
    const savedAt = loadSession(storage)!.savedAt;
    expect(Number.isNaN(Date.parse(savedAt))).toBe(false);
  });

  it('overwrites the previous session rather than accumulating', () => {
    const storage = fakeStorage();
    saveSession(populated(), storage);
    saveSession(createDocument('face', '/assets/x.usda'), storage);

    expect(loadSession(storage)!.doc.templateId).toBe('face');
    expect(loadSession(storage)!.doc.guides).toHaveLength(0);
  });

  it('clears', () => {
    const storage = fakeStorage();
    saveSession(populated(), storage);
    clearSession(storage);
    expect(loadSession(storage)).toBeNull();
  });
});

describe('a broken session must never stop the app starting', () => {
  it('returns null when there is nothing stored', () => {
    expect(loadSession(fakeStorage())).toBeNull();
  });

  it('returns null for a truncated blob', () => {
    const storage = fakeStorage();
    storage.setItem(SESSION_KEY, '{"version":1,"usda":"#usda 1.0');
    expect(loadSession(storage)).toBeNull();
  });

  it('returns null for text that is not JSON at all', () => {
    const storage = fakeStorage();
    storage.setItem(SESSION_KEY, 'not json');
    expect(loadSession(storage)).toBeNull();
  });

  it('returns null when the USDA inside is unreadable', () => {
    // The blob parses but the layer does not. Starting empty is the worst
    // acceptable outcome here.
    const storage = fakeStorage();
    storage.setItem(
      SESSION_KEY,
      JSON.stringify({ version: 1, usda: 'garbage', savedAt: '', loadUrl: '' })
    );
    expect(loadSession(storage)).toBeNull();
  });

  it('ignores a session written by a different version', () => {
    const storage = fakeStorage();
    storage.setItem(
      SESSION_KEY,
      JSON.stringify({ version: 99, usda: '#usda 1.0\n', savedAt: '', characterRef: '' })
    );
    expect(loadSession(storage)).toBeNull();
  });

  it('survives storage that throws on read', () => {
    const hostile = {
      getItem() {
        throw new DOMException('SecurityError');
      }
    } as unknown as Storage;
    expect(loadSession(hostile)).toBeNull();
  });
});

describe('saving when the browser refuses', () => {
  it('reports failure instead of throwing', () => {
    // A private window or a full quota must not interrupt someone mid
    // placement. Export still works, so this is a degraded state, not a lost
    // one.
    const storage = fakeStorage();
    storage.failWrites = true;
    expect(saveSession(populated(), storage)).toBe(false);
  });
});

describe('isWorthSaving', () => {
  it('is false for an untouched document', () => {
    expect(isWorthSaving(createDocument('biped', ''))).toBe(false);
  });

  it('is true once anything has been placed', () => {
    expect(isWorthSaving(populated())).toBe(true);
  });

  it('is true for curves alone', () => {
    const doc = M.addCurve(createDocument('biped', ''), {
      id: 'browL',
      group: 'face',
      closed: false,
      width: 0.004,
      points: []
    });
    expect(isWorthSaving(doc)).toBe(true);
  });
});

describe('exportRefFor', () => {
  it('writes a relative path beside the layer', () => {
    // The conventional and most portable choice in USD: put the two files in
    // one directory and the reference resolves, for any tool, anywhere.
    expect(exportRefFor('/assets/biped-blockout.usda')).toBe('./biped-blockout.usda');
    expect(exportRefFor('https://cdn.example.com/rigs/hero.usdc')).toBe('./hero.usdc');
  });

  it('does not carry the served path into the exported file', () => {
    // A path like /assets/x.usda resolves only inside this app. A layer
    // carrying it opens nowhere else, which defeats referencing the asset
    // rather than copying it.
    expect(exportRefFor('/assets/x.usda')).not.toContain('/assets/');
  });

  it('handles a bare upload name and a windows path', () => {
    expect(exportRefFor('hero.fbx')).toBe('./hero.fbx');
    // Escaped backslashes: an upload's name on Windows really does arrive with
    // them, and an unescaped literal here would collapse to no separators at
    // all and quietly test nothing.
    expect(exportRefFor('C:\\shows\\hero\\hero.usdc')).toBe('./hero.usdc');
  });

  it('strips a query string', () => {
    expect(exportRefFor('/assets/x.usda?v=3')).toBe('./x.usda');
  });

  it('is empty for an empty input', () => {
    expect(exportRefFor('')).toBe('');
  });
});

describe('isReloadableRef', () => {
  it('accepts a bundled asset path', () => {
    expect(isReloadableRef('/assets/biped-blockout.usda')).toBe(true);
  });

  it('accepts an absolute URL', () => {
    expect(isReloadableRef('https://example.com/hero.usdc')).toBe(true);
  });

  it('rejects an uploaded file name', () => {
    // The bytes were in the user's file picker and were never ours to keep,
    // so the document can come back but the mesh cannot. Saying so beats
    // restoring guides with nothing to bind against.
    expect(isReloadableRef('hero.fbx')).toBe(false);
    expect(isReloadableRef('')).toBe(false);
  });
});
