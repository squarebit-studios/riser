// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The left rail: what to place, what is placed, and what is next.
//
// This is the spine of the app's flow. The active entry is what the next click
// on the mesh will place, so the list is not a passive report - it is the tool
// state, shown.
// ==========================================================================

import { useMemo } from 'react';
import { useApp } from '../AppContext';
import { useUiStore } from '../state';
import { curvesByGroup, getTemplate, guidesByGroup } from '../../templates';
import { guideProgress } from '../../doc/types';

export function Checklist(): JSX.Element {
  const app = useApp();
  const templateId = useUiStore((s) => s.templateId);
  const activeTool = useUiStore((s) => s.activeTool);
  const activeGuideId = useUiStore((s) => s.activeGuideId);
  const activeCurveId = useUiStore((s) => s.activeCurveId);
  // Subscribing to the revision rather than the document keeps this component
  // out of the drag path - it re-renders on committed changes only.
  const docRevision = useUiStore((s) => s.docRevision);

  const template = getTemplate(templateId);
  const doc = app.store.document;

  const placedGuides = useMemo(
    () => new Set(doc.guides.map((g) => g.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docRevision, doc]
  );
  const curvePointCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const curve of doc.curves) counts.set(curve.id, curve.points.length);
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docRevision, doc]);

  const progress = guideProgress(doc, template);
  const showingCurves = activeTool === 'curve';

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-edge px-3 py-2.5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-ink-dim">
            {showingCurves ? 'Curves' : 'Guides'}
          </h2>
          <span className="font-mono text-[11px] text-ink-faint">
            {Math.round(progress * 100)}%
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-panel-lighter">
          <div
            className="h-full rounded-full bg-guide-placed transition-[width] duration-200"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {showingCurves
          ? curvesByGroup(template).map((group) => (
              <section key={group.group} className="mb-3">
                <GroupHeading label={group.label} />
                {group.curves.map((def) => {
                  const count = curvePointCounts.get(def.id) ?? 0;
                  return (
                    <ListRow
                      key={def.id}
                      testId={`curve-${def.id}`}
                      label={def.label}
                      hint={def.hint}
                      optional={def.optional}
                      active={def.id === activeCurveId}
                      done={count > 0}
                      trailing={count > 0 ? `${count}` : undefined}
                      onClick={() => useUiStore.getState().setActiveCurveId(def.id)}
                    />
                  );
                })}
              </section>
            ))
          : guidesByGroup(template).map((group) => (
              <section key={group.group} className="mb-3">
                <GroupHeading
                  label={group.label}
                  count={`${group.guides.filter((g) => placedGuides.has(g.id)).length}/${group.guides.length}`}
                />
                {group.guides.map((def) => (
                  <ListRow
                    key={def.id}
                    testId={`guide-${def.id}`}
                    label={def.label}
                    hint={def.hint}
                    optional={def.optional}
                    interior={def.interior}
                    active={def.id === activeGuideId}
                    done={placedGuides.has(def.id)}
                    onClick={() => {
                      useUiStore.getState().setActiveGuideId(def.id);
                      useUiStore.getState().setSelectedGuideId(
                        placedGuides.has(def.id) ? def.id : null
                      );
                    }}
                  />
                ))}
              </section>
            ))}
      </div>
    </div>
  );
}

function GroupHeading({ label, count }: { label: string; count?: string }): JSX.Element {
  return (
    <div className="mb-1 flex items-baseline justify-between px-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </h3>
      {count && <span className="font-mono text-[10px] text-ink-faint">{count}</span>}
    </div>
  );
}

interface ListRowProps {
  /**
   * Stable hook for end-to-end tests. The accessible name of these rows is
   * composed from the label plus the "in" and "opt" badges, so matching on it
   * is brittle in a way that has nothing to do with what the test means.
   */
  testId: string;
  label: string;
  hint?: string;
  optional?: boolean;
  interior?: boolean;
  active: boolean;
  done: boolean;
  trailing?: string;
  onClick: () => void;
}

function ListRow({
  testId,
  label,
  hint,
  optional,
  interior,
  active,
  done,
  trailing,
  onClick
}: ListRowProps): JSX.Element {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      title={hint}
      className={[
        'rs-row group',
        active ? 'bg-guide-active/15 text-ink' : 'text-ink-dim hover:bg-panel-lighter'
      ].join(' ')}
    >
      <span
        className={[
          'h-2 w-2 shrink-0 rounded-full ring-1 transition-colors',
          done
            ? 'bg-guide-placed ring-guide-placed'
            : active
              ? 'bg-guide-active ring-guide-active'
              : 'bg-transparent ring-guide-unplaced'
        ].join(' ')}
      />
      <span className="flex-1 truncate">{label}</span>
      {interior && (
        <span
          className="text-[9px] uppercase tracking-wide text-ink-faint"
          title="Sits inside the volume - alt-drag to set its depth"
        >
          in
        </span>
      )}
      {optional && !done && (
        <span className="text-[9px] uppercase tracking-wide text-ink-faint">opt</span>
      )}
      {trailing && <span className="font-mono text-[10px] text-ink-faint">{trailing}</span>}
    </button>
  );
}
