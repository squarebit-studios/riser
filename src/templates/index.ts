// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Template registry.
//
// Templates are JSON data, not code, so adding a rig type is a file rather
// than a patch. They are validated on load because a malformed template does
// not fail loudly on its own - it fails later as a checklist entry that can
// never be satisfied, or a mirror button that does nothing.
// ==========================================================================

import type { CurveDef, GuideDef, TemplateDef } from '../doc/types';
import bipedJson from './biped.json';
import quadrupedJson from './quadruped.json';
import faceJson from './face.json';

const RAW_TEMPLATES = [bipedJson, quadrupedJson, faceJson] as unknown as TemplateDef[];

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

/**
 * Check the invariants the app relies on:
 *   - ids are unique within their kind,
 *   - every group referenced by a guide or curve exists,
 *   - mirrors are declared in both directions and point at each other.
 *
 * A one-way mirror is the interesting case: symmetry would place the partner
 * but the partner would not place back, which reads as a random failure.
 */
export function validateTemplate(template: TemplateDef): string[] {
  const problems: string[] = [];
  const groups = new Set(template.groups.map((g) => g.id));

  const check = (
    items: (GuideDef | CurveDef)[],
    kind: 'guide' | 'curve'
  ): Map<string, GuideDef | CurveDef> => {
    const byId = new Map<string, GuideDef | CurveDef>();
    for (const item of items) {
      if (byId.has(item.id)) problems.push(`duplicate ${kind} id "${item.id}"`);
      byId.set(item.id, item);
      if (!groups.has(item.group)) {
        problems.push(`${kind} "${item.id}" is in unknown group "${item.group}"`);
      }
    }
    for (const item of items) {
      if (!item.mirror) continue;
      const partner = byId.get(item.mirror);
      if (!partner) {
        problems.push(`${kind} "${item.id}" mirrors unknown "${item.mirror}"`);
      } else if (partner.mirror !== item.id) {
        problems.push(
          `${kind} "${item.id}" mirrors "${item.mirror}", but it mirrors "${
            partner.mirror ?? 'nothing'
          }"`
        );
      }
    }
    return byId;
  };

  check(template.guides, 'guide');
  check(template.curves, 'curve');

  if (template.guides.length === 0) problems.push('template has no guides');
  return problems;
}

const registry = new Map<string, TemplateDef>();

for (const template of RAW_TEMPLATES) {
  const problems = validateTemplate(template);
  if (problems.length > 0) {
    // Loud on purpose. A broken template ships broken behaviour, and the app
    // has no way to recover from it at runtime.
    throw new TemplateError(
      `Template "${template.id}" is invalid:\n  ${problems.join('\n  ')}`
    );
  }
  registry.set(template.id, template);
}

export const TEMPLATES: readonly TemplateDef[] = [...registry.values()];
export const DEFAULT_TEMPLATE_ID = 'biped';

export function getTemplate(id: string): TemplateDef {
  const template = registry.get(id);
  if (!template) {
    throw new TemplateError(
      `Unknown template "${id}". Available: ${[...registry.keys()].join(', ')}`
    );
  }
  return template;
}

export function hasTemplate(id: string): boolean {
  return registry.has(id);
}

export function guideDef(template: TemplateDef, id: string): GuideDef | undefined {
  return template.guides.find((g) => g.id === id);
}

export function curveDef(template: TemplateDef, id: string): CurveDef | undefined {
  return template.curves.find((c) => c.id === id);
}

/** Guides of a template bucketed by group, in template order. */
export function guidesByGroup(template: TemplateDef): { group: string; label: string; guides: GuideDef[] }[] {
  return template.groups
    .map((group) => ({
      group: group.id,
      label: group.label,
      guides: template.guides.filter((g) => g.group === group.id)
    }))
    .filter((entry) => entry.guides.length > 0);
}

export function curvesByGroup(template: TemplateDef): { group: string; label: string; curves: CurveDef[] }[] {
  return template.groups
    .map((group) => ({
      group: group.id,
      label: group.label,
      curves: template.curves.filter((c) => c.group === group.id)
    }))
    .filter((entry) => entry.curves.length > 0);
}
