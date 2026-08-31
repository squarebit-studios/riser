import { describe, it, expect } from 'vitest';
import { LocalStorageDocuments, StorageError } from './storage';
import { createDocument, type Guide, type RiserDocument, type Vec3 } from './types';
import * as M from './mutations';

/**
 * `LocalStorageDocuments` was written, tested in principle and then never
 * constructed by anything. These exercise it against a real Storage shape, in
 * the ways the Documents menu actually uses it.
 */

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
      faceIndex: 11,
      barycentric: [0.2, 0.3, 0.5],
      offset: [0, 0, 0]
    },
    source: 'user',
    confidence: 1
  };
}

function doc(name: string): RiserDocument {
  const d = createDocument('biped', './hero.usdc', { name, metersPerUnit: 1 });
  return M.placeGuide(d, guide('pelvis'));
}

describe('saving named documents', () => {
  it('assigns an id and lists what was saved', async () => {
    const library = new LocalStorageDocuments(fakeStorage());
    const summary = await library.save(doc('Hero'), undefined, '/assets/hero.usda');

    expect(summary.id).toBeTruthy();
    expect(summary.name).toBe('Hero');

    const listed = await library.list();
    expect(listed.map((s) => s.name)).toEqual(['Hero']);
  });

  it('keeps several documents apart', async () => {
    // The limitation this whole feature exists to remove: autosave is one
    // slot, so a second character used to write over the first.
    const library = new LocalStorageDocuments(fakeStorage());
    await library.save(doc('Hero'));
    await library.save(doc('Villain'));

    const listed = await library.list();
    expect(listed).toHaveLength(2);
    expect(new Set(listed.map((s) => s.name))).toEqual(new Set(['Hero', 'Villain']));
  });

  it('updates in place when given an id, rather than duplicating', async () => {
    const library = new LocalStorageDocuments(fakeStorage());
    const first = await library.save(doc('Hero'));

    let updated = doc('Hero');
    updated = M.placeGuide(updated, guide('chest', [0, 1.4, 0]));
    await library.save(updated, first.id);

    expect(await library.list()).toHaveLength(1);
    const { doc: loaded } = await library.load(first.id);
    expect(loaded.guides.map((g) => g.id)).toEqual(['pelvis', 'chest']);
  });

  it('remembers where the character can be fetched from', async () => {
    // The layer's own reference is relative to the exported file and means
    // nothing to a browser, so reopening a document needs this separately.
    const library = new LocalStorageDocuments(fakeStorage());
    const saved = await library.save(doc('Hero'), undefined, '/assets/hero.usda');

    const listed = await library.list();
    expect(listed[0]!.loadUrl).toBe('/assets/hero.usda');

    const { summary } = await library.load(saved.id);
    expect(summary.loadUrl).toBe('/assets/hero.usda');
  });

  it('records an empty load url for an upload', async () => {
    const library = new LocalStorageDocuments(fakeStorage());
    const saved = await library.save(doc('Uploaded'));
    const { summary } = await library.load(saved.id);
    expect(summary.loadUrl ?? '').toBe('');
  });

  it('lists newest first', async () => {
    const library = new LocalStorageDocuments(fakeStorage());
    await library.save(doc('Older'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await library.save(doc('Newer'));

    const names = (await library.list()).map((s) => s.name);
    expect(names[0]).toBe('Newer');
  });
});

describe('loading documents back', () => {
  it('round-trips guides and their bindings', async () => {
    const library = new LocalStorageDocuments(fakeStorage());
    const saved = await library.save(doc('Hero'));

    const { doc: loaded } = await library.load(saved.id);
    expect(loaded.guides).toHaveLength(1);
    expect(loaded.guides[0]!.binding!.faceIndex).toBe(11);
    expect(loaded.name).toBe('Hero');
    expect(loaded.characterRef).toBe('./hero.usdc');
  });

  it('refuses an id it does not have', async () => {
    const library = new LocalStorageDocuments(fakeStorage());
    await expect(library.load('nope')).rejects.toBeInstanceOf(StorageError);
  });
});

describe('deleting', () => {
  it('removes a document and leaves the others', async () => {
    const library = new LocalStorageDocuments(fakeStorage());
    const hero = await library.save(doc('Hero'));
    await library.save(doc('Villain'));

    await library.remove(hero.id);

    const listed = await library.list();
    expect(listed.map((s) => s.name)).toEqual(['Villain']);
    await expect(library.load(hero.id)).rejects.toBeInstanceOf(StorageError);
  });

  it('is quiet about deleting something that is already gone', async () => {
    const library = new LocalStorageDocuments(fakeStorage());
    await expect(library.remove('never-existed')).resolves.toBeUndefined();
  });
});

describe('when the browser refuses to store anything', () => {
  it('reports a useful reason rather than a bare failure', async () => {
    // Quota is the realistic case, and "save failed" with no reason sends
    // people looking in the wrong place.
    const storage = fakeStorage();
    storage.failWrites = true;
    const library = new LocalStorageDocuments(storage);

    await expect(library.save(doc('Hero'))).rejects.toBeInstanceOf(StorageError);
    await expect(library.save(doc('Hero'))).rejects.toThrow(/full/i);
  });

  it('starts empty rather than throwing when the index is corrupt', async () => {
    const storage = fakeStorage();
    storage.setItem('riser.index', 'not json');
    const library = new LocalStorageDocuments(storage);
    await expect(library.list()).resolves.toEqual([]);
  });
});
