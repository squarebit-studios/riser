import { describe, it, expect } from 'vitest';
import { DocumentStore } from './history';
import * as M from './mutations';
import { createDocument, type Guide, type Curve, type Vec3 } from './types';
import { writeUsda } from './usda-writer';

function g(id: string, pos: Vec3 = [0, 1, 0]): Guide {
  return {
    id,
    group: 'spine',
    position: pos,
    normal: [0, 1, 0],
    binding: {
      primPath: '/Riser/Character/Body',
      faceIndex: 7,
      barycentric: [0.3, 0.3, 0.4],
      offset: [0, 0, 0]
    },
    source: 'user',
    confidence: 1
  };
}

function c(id: string, n = 3): Curve {
  return {
    id,
    group: 'face',
    closed: false,
    width: 0.005,
    points: Array.from({ length: n }, (_, i) => ({
      position: [i * 0.01, 1.5, 0] as Vec3,
      normal: [0, 0, 1] as Vec3,
      binding: null
    }))
  };
}

const fresh = () => new DocumentStore(createDocument('biped', './c.usdc'));

describe('mutations are pure', () => {
  it('placeGuide does not touch the input document', () => {
    const doc = createDocument('biped', './c.usdc');
    const next = M.placeGuide(doc, g('pelvis'));
    expect(doc.guides).toHaveLength(0);
    expect(next.guides).toHaveLength(1);
    expect(next).not.toBe(doc);
  });

  it('placeGuide replaces rather than duplicates an existing id', () => {
    let doc = createDocument('biped', './c.usdc');
    doc = M.placeGuide(doc, g('pelvis', [0, 1, 0]));
    doc = M.placeGuide(doc, g('pelvis', [0, 2, 0]));
    expect(doc.guides).toHaveLength(1);
    expect(doc.guides[0]!.position[1]).toBe(2);
  });

  it('placeGuide keeps insertion order when replacing', () => {
    let doc = createDocument('biped', './c.usdc');
    doc = M.placeGuide(doc, g('a'));
    doc = M.placeGuide(doc, g('b'));
    doc = M.placeGuide(doc, g('a', [9, 9, 9]));
    expect(doc.guides.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('curve point insert respects the index', () => {
    let doc = M.addCurve(createDocument('biped', './c.usdc'), c('browL', 3));
    doc = M.addCurvePoint(
      doc,
      'browL',
      { position: [99, 0, 0], normal: [0, 1, 0], binding: null },
      1
    );
    expect(doc.curves[0]!.points.map((p) => p.position[0])).toEqual([0, 99, 0.01, 0.02]);
  });

  it('curve point insert clamps an out-of-range index', () => {
    let doc = M.addCurve(createDocument('biped', './c.usdc'), c('browL', 2));
    doc = M.addCurvePoint(
      doc,
      'browL',
      { position: [42, 0, 0], normal: [0, 1, 0], binding: null },
      99
    );
    expect(doc.curves[0]!.points).toHaveLength(3);
    expect(doc.curves[0]!.points[2]!.position[0]).toBe(42);
  });

  it('setCurveWidth refuses a negative width', () => {
    let doc = M.addCurve(createDocument('biped', './c.usdc'), c('browL'));
    doc = M.setCurveWidth(doc, 'browL', -5);
    expect(doc.curves[0]!.width).toBe(0);
  });

  it('setTemplate drops ids the new template does not define', () => {
    let doc = createDocument('biped', './c.usdc');
    doc = M.placeGuide(doc, g('pelvis'));
    doc = M.placeGuide(doc, g('wristL'));
    doc = M.addCurve(doc, c('browL'));
    doc = M.setTemplate(doc, 'quadruped', new Set(['pelvis']), new Set());
    expect(doc.guides.map((x) => x.id)).toEqual(['pelvis']);
    expect(doc.curves).toHaveLength(0);
    expect(doc.templateId).toBe('quadruped');
  });

  it('setGuideOffset leaves the triangle binding alone', () => {
    let doc = M.placeGuide(createDocument('biped', './c.usdc'), g('hipL'));
    doc = M.setGuideOffset(doc, 'hipL', [0, -0.05, 0]);
    expect(doc.guides[0]!.binding!.faceIndex).toBe(7);
    expect(doc.guides[0]!.binding!.offset).toEqual([0, -0.05, 0]);
  });
});

describe('DocumentStore undo/redo', () => {
  it('starts with nothing to undo', () => {
    const store = fresh();
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
    expect(store.undo()).toBe(false);
    expect(store.redo()).toBe(false);
  });

  it('undoes one step at a time', () => {
    const store = fresh();
    store.apply((d) => M.placeGuide(d, g('a')), 'Place a');
    store.apply((d) => M.placeGuide(d, g('b')), 'Place b');
    expect(store.document.guides).toHaveLength(2);

    store.undo();
    expect(store.document.guides.map((x) => x.id)).toEqual(['a']);
    store.undo();
    expect(store.document.guides).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });

  it('redoes what it undid', () => {
    const store = fresh();
    store.apply((d) => M.placeGuide(d, g('a')), 'Place a');
    store.undo();
    expect(store.redo()).toBe(true);
    expect(store.document.guides.map((x) => x.id)).toEqual(['a']);
  });

  it('discards the redo branch after a new edit', () => {
    const store = fresh();
    store.apply((d) => M.placeGuide(d, g('a')), 'Place a');
    store.undo();
    store.apply((d) => M.placeGuide(d, g('z')), 'Place z');
    expect(store.canRedo).toBe(false);
    expect(store.document.guides.map((x) => x.id)).toEqual(['z']);
  });

  it('reports the label of the step it would undo', () => {
    const store = fresh();
    store.apply((d) => M.placeGuide(d, g('a')), 'Place pelvis');
    expect(store.undoLabel).toBe('Place pelvis');
  });

  it('ignores a mutation that changes nothing', () => {
    const store = fresh();
    store.apply((d) => d, 'No-op');
    expect(store.canUndo).toBe(false);
  });

  it('does not record a transient mutation', () => {
    const store = fresh();
    store.apply((d) => M.placeGuide(d, g('a')), 'Preview', { transient: true });
    expect(store.canUndo).toBe(false);
    expect(store.document.guides).toHaveLength(1);
  });

  it('collapses a coalesced drag into a single undo step', () => {
    const store = fresh();
    store.apply((d) => M.placeGuide(d, g('a', [0, 0, 0])), 'Place a');
    for (let i = 1; i <= 30; i++) {
      store.apply(
        (d) => M.moveGuide(d, 'a', [i * 0.01, 0, 0], [0, 1, 0], null),
        'Move a',
        { coalesceKey: 'move:a' }
      );
    }
    expect(store.document.guides[0]!.position[0]).toBeCloseTo(0.3, 6);

    // One undo returns to where the drag started, not to the previous frame.
    store.undo();
    expect(store.document.guides[0]!.position[0]).toBe(0);
    // A second returns to the empty document.
    store.undo();
    expect(store.document.guides).toHaveLength(0);
  });

  it('keeps separate drags separate', () => {
    const store = fresh();
    store.apply((d) => M.placeGuide(d, g('a')), 'Place a');
    store.apply((d) => M.moveGuide(d, 'a', [1, 0, 0], [0, 1, 0], null), 'Move a', {
      coalesceKey: 'move:a'
    });
    store.apply((d) => M.placeGuide(d, g('b')), 'Place b');
    store.apply((d) => M.moveGuide(d, 'b', [2, 0, 0], [0, 1, 0], null), 'Move b', {
      coalesceKey: 'move:b'
    });
    expect(store.document.guides).toHaveLength(2);
    store.undo();
    expect(store.document.guides.find((x) => x.id === 'b')!.position[0]).toBe(0);
  });

  it('returns to the exact starting document after undoing everything', () => {
    // The property that matters: any sequence of edits, fully undone, leaves a
    // document that serializes byte-for-byte to the original.
    const store = fresh();
    const before = writeUsda(store.document);

    const ops: Array<() => void> = [
      () => store.apply((d) => M.placeGuide(d, g('pelvis')), 'g1'),
      () => store.apply((d) => M.placeGuide(d, g('chest')), 'g2'),
      () => store.apply((d) => M.placeGuide(d, g('wristL')), 'g3'),
      () => store.apply((d) => M.addCurve(d, c('browL', 4)), 'c1'),
      () => store.apply((d) => M.addCurve(d, c('jawline', 9)), 'c2'),
      () => store.apply((d) => M.removeGuide(d, 'chest'), 'rm'),
      () => store.apply((d) => M.setCurveClosed(d, 'browL', true), 'close'),
      () => store.apply((d) => M.setCurveWidth(d, 'jawline', 0.02), 'width'),
      () => store.apply((d) => M.removeCurvePoint(d, 'jawline', 2), 'rmpt'),
      () => store.apply((d) => M.setName(d, 'Renamed'), 'name')
    ];

    // A fixed shuffle - deterministic, but not the order they are declared in.
    const order = [3, 0, 7, 1, 4, 9, 2, 6, 5, 8];
    let applied = 0;
    for (const i of order) {
      const op = ops[i];
      if (!op) continue;
      const versionBefore = store.version;
      op();
      // Some ops are no-ops depending on order (removing a curve point from a
      // curve that has not been added yet); only count the ones that landed.
      if (store.version !== versionBefore) applied++;
    }

    expect(applied).toBeGreaterThan(5);
    while (store.canUndo) store.undo();
    expect(writeUsda(store.document)).toBe(before);
  });

  it('redoing everything reaches the same place again', () => {
    const store = fresh();
    store.apply((d) => M.placeGuide(d, g('a')), '1');
    store.apply((d) => M.addCurve(d, c('x', 5)), '2');
    store.apply((d) => M.placeGuide(d, g('b')), '3');
    const after = writeUsda(store.document);

    while (store.canUndo) store.undo();
    while (store.canRedo) store.redo();
    expect(writeUsda(store.document)).toBe(after);
  });
});

describe('DocumentStore subscriptions and dirty state', () => {
  it('notifies subscribers on every change', () => {
    const store = fresh();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.apply((d) => M.placeGuide(d, g('a')), 'a');
    store.apply((d) => M.placeGuide(d, g('b')), 'b');
    expect(calls).toBe(2);
    off();
    store.apply((d) => M.placeGuide(d, g('c')), 'c');
    expect(calls).toBe(2);
  });

  it('tracks unsaved changes', () => {
    const store = fresh();
    expect(store.isDirty).toBe(false);
    store.apply((d) => M.placeGuide(d, g('a')), 'a');
    expect(store.isDirty).toBe(true);
    store.markSaved();
    expect(store.isDirty).toBe(false);
    store.undo();
    expect(store.isDirty).toBe(true);
  });

  it('reset clears history and starts clean', () => {
    const store = fresh();
    store.apply((d) => M.placeGuide(d, g('a')), 'a');
    store.reset(createDocument('quadruped', './horse.usdc'));
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
    expect(store.isDirty).toBe(false);
    expect(store.document.templateId).toBe('quadruped');
  });
});
