import { describe, it, expect } from 'vitest';
import {
  TEMPLATES,
  getTemplate,
  hasTemplate,
  validateTemplate,
  guidesByGroup,
  curvesByGroup,
  TemplateError,
  DEFAULT_TEMPLATE_ID
} from './index';
import { primName } from '../doc/usda-writer';
import type { TemplateDef } from '../doc/types';

describe('shipped templates', () => {
  it('loads every template', () => {
    expect(TEMPLATES.map((t) => t.id).sort()).toEqual(['biped', 'face', 'quadruped']);
  });

  it('has a valid default', () => {
    expect(hasTemplate(DEFAULT_TEMPLATE_ID)).toBe(true);
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))(
    '%s passes validation',
    (_id, template) => {
      expect(validateTemplate(template as TemplateDef)).toEqual([]);
    }
  );

  it.each(TEMPLATES.map((t) => [t.id, t] as const))(
    '%s has ids that survive prim-name sanitising uniquely',
    (_id, template) => {
      // Two guides whose ids sanitise to the same prim name would overwrite
      // each other in the USD layer.
      const t = template as TemplateDef;
      const guideNames = t.guides.map((g) => primName(g.id));
      expect(new Set(guideNames).size).toBe(guideNames.length);
      const curveNames = t.curves.map((c) => primName(c.id));
      expect(new Set(curveNames).size).toBe(curveNames.length);
    }
  );

  it.each(TEMPLATES.map((t) => [t.id, t] as const))(
    '%s labels every guide and curve',
    (_id, template) => {
      const t = template as TemplateDef;
      for (const g of t.guides) expect(g.label.length, `guide ${g.id}`).toBeGreaterThan(0);
      for (const c of t.curves) expect(c.label.length, `curve ${c.id}`).toBeGreaterThan(0);
    }
  );

  it('biped covers the joints an auto-rigger needs', () => {
    const biped = getTemplate('biped');
    const ids = new Set(biped.guides.map((g) => g.id));
    for (const required of [
      'root',
      'pelvis',
      'chest',
      'neck',
      'head',
      'shoulderL',
      'shoulderR',
      'elbowL',
      'elbowR',
      'wristL',
      'wristR',
      'hipL',
      'hipR',
      'kneeL',
      'kneeR',
      'ankleL',
      'ankleR'
    ]) {
      expect(ids.has(required), `biped is missing ${required}`).toBe(true);
    }
  });

  it('biped marks joint centres as interior', () => {
    // Interior guides get lifted off the skin; getting this wrong puts the
    // elbow on the surface of the arm rather than in the middle of it.
    const biped = getTemplate('biped');
    for (const id of ['elbowL', 'kneeR', 'shoulderL', 'hipL', 'eyeL']) {
      expect(biped.guides.find((g) => g.id === id)?.interior, id).toBe(true);
    }
  });

  it('biped marks surface features as not interior', () => {
    const biped = getTemplate('biped');
    for (const id of ['chin', 'noseTip', 'headTop', 'toeBaseL']) {
      expect(biped.guides.find((g) => g.id === id)?.interior, id).toBeFalsy();
    }
  });

  it('every left guide has a right partner', () => {
    for (const template of TEMPLATES) {
      const ids = new Set(template.guides.map((g) => g.id));
      for (const guide of template.guides) {
        if (!guide.id.endsWith('L')) continue;
        const partner = `${guide.id.slice(0, -1)}R`;
        expect(ids.has(partner), `${template.id}: ${guide.id} has no ${partner}`).toBe(
          true
        );
      }
    }
  });

  it('required guide counts stay manageable', () => {
    // A checklist nobody finishes is a checklist nobody starts. Optional
    // entries are unbounded; required ones are not.
    for (const template of TEMPLATES) {
      const required = template.guides.filter((g) => !g.optional);
      expect(required.length, `${template.id}`).toBeLessThanOrEqual(45);
      expect(required.length, `${template.id}`).toBeGreaterThan(4);
    }
  });
});

describe('getTemplate', () => {
  it('throws with a helpful message for an unknown id', () => {
    expect(() => getTemplate('octopod')).toThrow(TemplateError);
    expect(() => getTemplate('octopod')).toThrow(/biped/);
  });
});

describe('grouping helpers', () => {
  it('buckets guides into their declared groups', () => {
    const grouped = guidesByGroup(getTemplate('biped'));
    const spine = grouped.find((g) => g.group === 'spine');
    expect(spine?.guides.map((g) => g.id)).toContain('pelvis');
    // Every guide lands in exactly one bucket.
    const total = grouped.reduce((n, g) => n + g.guides.length, 0);
    expect(total).toBe(getTemplate('biped').guides.length);
  });

  it('omits groups with no entries', () => {
    for (const entry of curvesByGroup(getTemplate('biped'))) {
      expect(entry.curves.length).toBeGreaterThan(0);
    }
  });
});

describe('validateTemplate', () => {
  const base: TemplateDef = {
    id: 'test',
    label: 'Test',
    description: '',
    groups: [{ id: 'a', label: 'A' }],
    guides: [{ id: 'one', group: 'a', label: 'One' }],
    curves: []
  };

  it('accepts a well-formed template', () => {
    expect(validateTemplate(base)).toEqual([]);
  });

  it('catches a duplicate id', () => {
    const bad = { ...base, guides: [...base.guides, { id: 'one', group: 'a', label: 'Dup' }] };
    expect(validateTemplate(bad).join()).toMatch(/duplicate guide id "one"/);
  });

  it('catches an unknown group', () => {
    const bad = { ...base, guides: [{ id: 'x', group: 'nope', label: 'X' }] };
    expect(validateTemplate(bad).join()).toMatch(/unknown group "nope"/);
  });

  it('catches a one-way mirror', () => {
    const bad = {
      ...base,
      guides: [
        { id: 'l', group: 'a', label: 'L', mirror: 'r' },
        { id: 'r', group: 'a', label: 'R' }
      ]
    };
    expect(validateTemplate(bad).join()).toMatch(/mirrors "r", but it mirrors "nothing"/);
  });

  it('catches a mirror pointing at nothing', () => {
    const bad = {
      ...base,
      guides: [{ id: 'l', group: 'a', label: 'L', mirror: 'ghost' }]
    };
    expect(validateTemplate(bad).join()).toMatch(/mirrors unknown "ghost"/);
  });

  it('catches an empty template', () => {
    expect(validateTemplate({ ...base, guides: [] }).join()).toMatch(/no guides/);
  });
});
