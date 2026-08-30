// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Every legal change to a RiserDocument, as a pure function.
//
// Nothing mutates a document in place. Tools call these, the store records the
// result, and undo is a matter of handing back the previous value. Keeping the
// mutations pure is also what makes them testable without a renderer.
// ==========================================================================

import type {
  Curve,
  CurvePoint,
  Guide,
  RiserDocument,
  SurfaceBinding,
  Vec3
} from './types';

/** Insert or replace a guide, keeping the document's guide order stable. */
export function placeGuide(doc: RiserDocument, guide: Guide): RiserDocument {
  const index = doc.guides.findIndex((g) => g.id === guide.id);
  const guides =
    index === -1
      ? [...doc.guides, guide]
      : doc.guides.map((g, i) => (i === index ? guide : g));
  return { ...doc, guides };
}

export function placeGuides(doc: RiserDocument, guides: Guide[]): RiserDocument {
  return guides.reduce(placeGuide, doc);
}

export function removeGuide(doc: RiserDocument, id: string): RiserDocument {
  return { ...doc, guides: doc.guides.filter((g) => g.id !== id) };
}

export function removeAllGuides(doc: RiserDocument): RiserDocument {
  return { ...doc, guides: [] };
}

export function moveGuide(
  doc: RiserDocument,
  id: string,
  position: Vec3,
  normal: Vec3,
  binding: SurfaceBinding | null
): RiserDocument {
  return {
    ...doc,
    guides: doc.guides.map((g) =>
      g.id === id ? { ...g, position, normal, binding } : g
    )
  };
}

/**
 * Change only the off-surface offset, leaving the binding's triangle alone.
 * This is what dragging a guide into the volume does - the surface anchor is
 * still meaningful, the point just is not on the skin.
 */
export function setGuideOffset(
  doc: RiserDocument,
  id: string,
  offset: Vec3
): RiserDocument {
  return {
    ...doc,
    guides: doc.guides.map((g) =>
      g.id === id && g.binding ? { ...g, binding: { ...g.binding, offset } } : g
    )
  };
}

// -------------------------------------------------------------------------
// Curves
// -------------------------------------------------------------------------

export function addCurve(doc: RiserDocument, curve: Curve): RiserDocument {
  const index = doc.curves.findIndex((c) => c.id === curve.id);
  const curves =
    index === -1
      ? [...doc.curves, curve]
      : doc.curves.map((c, i) => (i === index ? curve : c));
  return { ...doc, curves };
}

export function removeCurve(doc: RiserDocument, id: string): RiserDocument {
  return { ...doc, curves: doc.curves.filter((c) => c.id !== id) };
}

export function removeAllCurves(doc: RiserDocument): RiserDocument {
  return { ...doc, curves: [] };
}

function mapCurve(
  doc: RiserDocument,
  id: string,
  fn: (curve: Curve) => Curve
): RiserDocument {
  return { ...doc, curves: doc.curves.map((c) => (c.id === id ? fn(c) : c)) };
}

/** Append a control vertex, or insert it at `index` when one is given. */
export function addCurvePoint(
  doc: RiserDocument,
  curveId: string,
  point: CurvePoint,
  index?: number
): RiserDocument {
  return mapCurve(doc, curveId, (curve) => {
    const points = [...curve.points];
    const at = index === undefined ? points.length : clamp(index, 0, points.length);
    points.splice(at, 0, point);
    return { ...curve, points };
  });
}

export function removeCurvePoint(
  doc: RiserDocument,
  curveId: string,
  index: number
): RiserDocument {
  return mapCurve(doc, curveId, (curve) => ({
    ...curve,
    points: curve.points.filter((_, i) => i !== index)
  }));
}

export function moveCurvePoint(
  doc: RiserDocument,
  curveId: string,
  index: number,
  point: CurvePoint
): RiserDocument {
  return mapCurve(doc, curveId, (curve) => ({
    ...curve,
    points: curve.points.map((p, i) => (i === index ? point : p))
  }));
}

export function setCurveClosed(
  doc: RiserDocument,
  curveId: string,
  closed: boolean
): RiserDocument {
  return mapCurve(doc, curveId, (curve) => ({ ...curve, closed }));
}

export function setCurveWidth(
  doc: RiserDocument,
  curveId: string,
  width: number
): RiserDocument {
  return mapCurve(doc, curveId, (curve) => ({ ...curve, width: Math.max(0, width) }));
}

// -------------------------------------------------------------------------
// Document-level
// -------------------------------------------------------------------------

export function setName(doc: RiserDocument, name: string): RiserDocument {
  return { ...doc, name };
}

export function setCharacterRef(
  doc: RiserDocument,
  characterRef: string,
  metersPerUnit?: number,
  upAxis?: 'Y' | 'Z'
): RiserDocument {
  return {
    ...doc,
    characterRef,
    metersPerUnit: metersPerUnit ?? doc.metersPerUnit,
    upAxis: upAxis ?? doc.upAxis
  };
}

/**
 * Switch templates. Guides and curves whose ids the new template does not know
 * about are dropped, because leaving them would mean the checklist and the
 * viewport disagree about what exists.
 */
export function setTemplate(
  doc: RiserDocument,
  templateId: string,
  keepGuideIds: Set<string>,
  keepCurveIds: Set<string>
): RiserDocument {
  return {
    ...doc,
    templateId,
    guides: doc.guides.filter((g) => keepGuideIds.has(g.id)),
    curves: doc.curves.filter((c) => keepCurveIds.has(c.id))
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
