// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The left panel: what to place, what is placed, and what to do next.
//
// The old version was a flat list of every guide in the template. That is
// forty rows for a quadruped, which is not a checklist so much as a wall - and
// the question someone actually has ("what is left?") took a careful read of
// the whole thing to answer.
//
// Three changes, each aimed at one real question:
//
//   "where is the one I want"    search
//   "what is left"               filters, and per-group progress
//   "what do I do now"           guided mode
//
// GUIDED MODE IS ON BY DEFAULT and can be switched off for good. Someone
// opening Riser for the first time should see one instruction, not an
// inventory; someone on their fifth character wants the list. Both are right,
// so both exist, and the choice is remembered.
//
// This is also the tool's state, not a report of it: the highlighted entry is
// what the next click on the character will place.
// ==========================================================================

import { useMemo } from 'react';
import { useApp } from '../AppContext';
import { useUiStore, type GuideFilter } from '../state';
import { curvesByGroup, getTemplate, guidesByGroup } from '../../templates';
import type { GuideDef, RiserDocument, TemplateDef } from '../../doc/types';
import { Icon } from './ui/Icon';
import { Button, IconButton } from './ui/Button';
import {
  Chip,
  Disclosure,
  FilterChips,
  ProgressRing,
  SearchField
} from './ui/Controls';
import { ContextMenu, MenuItem, MenuSeparator, useContextMenu } from './ui/Menu';

export function TemplateBrowser(): JSX.Element {
  const app = useApp();
  const templateId = useUiStore((s) => s.templateId);
  const activeTool = useUiStore((s) => s.activeTool);
  const activeGuideId = useUiStore((s) => s.activeGuideId);
  const activeCurveId = useUiStore((s) => s.activeCurveId);
  const search = useUiStore((s) => s.guideSearch);
  const filter = useUiStore((s) => s.guideFilter);
  const guided = useUiStore((s) => s.guided);
  const collapsedGroups = useUiStore((s) => s.collapsedGroups);
  // Subscribing to the revision rather than the document keeps this component
  // out of the drag path - it re-renders on committed changes only.
  const docRevision = useUiStore((s) => s.docRevision);

  const template = getTemplate(templateId);
  const doc = app.store.document;
  const showingCurves = activeTool === 'curve';

  const state = useMemo(
    () => guideState(doc),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docRevision, doc]
  );

  const counts = useMemo(() => {
    let placed = 0;
    let auto = 0;
    let mine = 0;
    for (const def of template.guides) {
      const source = state.get(def.id);
      if (!source) continue;
      placed++;
      if (source === 'user') mine++;
      else auto++;
    }
    return {
      all: template.guides.length,
      unplaced: template.guides.length - placed,
      auto,
      mine
    };
  }, [template, state]);

  const menu = useContextMenu<string>();

  return (
    <div className="flex h-full flex-col">
      {guided && !showingCurves && (
        <GuidedCard template={template} state={state} />
      )}

      <div className="space-y-2 px-2.5 pb-2 pt-1">
        <SearchField
          value={search}
          onChange={(value) => useUiStore.getState().setGuideSearch(value)}
          placeholder={showingCurves ? 'Search curves' : 'Search markers'}
          data-testid="template-search"
        />
        {!showingCurves && (
          <FilterChips<GuideFilter>
            value={filter}
            onChange={(value) => useUiStore.getState().setGuideFilter(value)}
            options={[
              { value: 'all', label: 'All', count: counts.all },
              { value: 'unplaced', label: 'Left', count: counts.unplaced },
              { value: 'auto', label: 'Suggested', count: counts.auto },
              { value: 'mine', label: 'Mine', count: counts.mine }
            ]}
          />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {showingCurves ? (
          <CurveList
            template={template}
            doc={doc}
            search={search}
            activeCurveId={activeCurveId}
            collapsed={collapsedGroups}
          />
        ) : (
          <GuideList
            template={template}
            state={state}
            search={search}
            filter={filter}
            activeGuideId={activeGuideId}
            collapsed={collapsedGroups}
            onContextMenu={(event, id) => menu.open(event, id)}
          />
        )}
      </div>

      <ContextMenu point={menu.point} onClose={menu.close} label="Marker actions">
        {menu.target && (
          <GuideContextItems
            id={menu.target}
            placed={state.has(menu.target)}
            suggested={state.get(menu.target) !== undefined && state.get(menu.target) !== 'user'}
          />
        )}
      </ContextMenu>
    </div>
  );
}

/** id -> the source of the placed guide, or absent when unplaced. */
function guideState(doc: RiserDocument): Map<string, string> {
  return new Map(doc.guides.map((g) => [g.id, g.source]));
}

// -------------------------------------------------------------------------
// Guided mode
// -------------------------------------------------------------------------

/**
 * One instruction at a time.
 *
 * Shows the next thing to place, in words, with the hint the template author
 * wrote. The list stays underneath rather than being replaced: guided mode is
 * a suggestion about where to look, not a mode that takes the app away.
 */
function GuidedCard({
  template,
  state
}: {
  template: TemplateDef;
  state: Map<string, string>;
}): JSX.Element | null {
  const app = useApp();
  const activeGuideId = useUiStore((s) => s.activeGuideId);
  const characterName = useUiStore((s) => s.characterName);

  const remaining = template.guides.filter((g) => !g.optional && !state.has(g.id));
  const placedCount = template.guides.filter((g) => state.has(g.id)).length;

  // Whatever the user is working on, placed or not.
  //
  // Deliberately not "the next unplaced guide": placing a marker no longer
  // moves the selection, because the first placement is rarely the final one
  // and having the card jump on meant a nudge went to the wrong guide. The
  // card follows the user; Next is how they move it.
  const active = activeGuideId
    ? (template.guides.find((g) => g.id === activeGuideId) ?? null)
    : null;
  const current = active ?? remaining[0] ?? null;
  const isPlaced = current !== null && state.has(current.id);

  /** The next thing needing attention after this one. */
  const nextUp =
    remaining.find((g) => g.id !== current?.id) ?? null;

  if (!characterName) {
    return (
      <Card>
        {/* Deliberately not the same sentence as the status bar. Two copies of
            one instruction on screen at once reads as a rendering mistake, and
            the second one teaches nothing the first did not. */}
        <p className="font-medium text-ink">No character yet</p>
        <p className="mt-1 text-ink-dim">
          Pick one from <span className="text-ink">File &rsaquo; Open character</span>,
          or drop a file on the viewport.
        </p>
      </Card>
    );
  }

  if (!current) {
    return (
      <Card tone="done">
        <div className="flex items-center gap-2">
          <Icon name="check" size={16} className="text-curve" />
          <p className="font-medium text-ink">Every marker is placed.</p>
        </div>
        <p className="mt-1 text-ink-faint">
          {placedCount} of {template.guides.length}. Check the suggested ones, then
          export.
        </p>
      </Card>
    );
  }

  const isNext = current.id === activeGuideId;

  return (
    <Card tone={isPlaced ? 'done' : 'default'}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className={`text-[11px] font-medium uppercase tracking-wide ${
              isPlaced ? 'text-curve' : 'text-accent'
            }`}
          >
            {isPlaced ? 'Placed' : isNext ? 'Place this' : 'Next'}
          </p>
          <p className="mt-0.5 truncate font-medium text-ink">{current.label}</p>
        </div>
        <span className="shrink-0 font-mono text-[11px] text-ink-faint">
          {placedCount}/{template.guides.length}
        </span>
      </div>

      {current.hint && (
        <p className="mt-1.5 leading-snug text-ink-dim">{current.hint}</p>
      )}
      {current.interior && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-ink-faint">
          <Icon name="info" size={13} className="mt-px shrink-0" />
          Sits inside the body. Place it on the surface, then hold Alt and drag to
          push it in.
        </p>
      )}

      <div className="mt-2.5 flex items-center gap-1.5">
        {/* Next is the primary action once something is placed, because
            placing no longer advances on its own - the marker stays selected
            so it can be adjusted, and moving on is the user's call. */}
        <Button
          variant={isPlaced ? 'primary' : 'default'}
          size="sm"
          icon={isPlaced ? 'next' : undefined}
          data-testid="guided-next"
          onClick={() => useUiStore.getState().setActiveGuideId(nextUp?.id ?? null)}
          disabled={!nextUp}
        >
          {nextUp ? 'Next' : 'All placed'}
        </Button>
        {!isPlaced && (
          <Button
            variant={isNext ? 'ghost' : 'primary'}
            size="sm"
            onClick={() => useUiStore.getState().setActiveGuideId(current.id)}
            disabled={isNext}
          >
            {isNext ? 'Click the character' : 'Start'}
          </Button>
        )}
        <div className="flex-1" />
        <IconButton
          icon="close"
          size="sm"
          label="Turn off step-by-step"
          onClick={() => useUiStore.getState().setGuided(false)}
        />
      </div>

      {app.canAutoPlace && (
        <button
          type="button"
          onClick={() => app.autoPlace({ announce: true })}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-control py-1 text-[11px] text-ink-faint transition-colors hover:bg-panel-lighter hover:text-ink"
        >
          <Icon name="sparkles" size={13} />
          Or let Riser place them all
        </button>
      )}
    </Card>
  );
}

function Card({
  children,
  tone = 'default'
}: {
  children: React.ReactNode;
  tone?: 'default' | 'done';
}): JSX.Element {
  return (
    <div className="p-2.5 pb-1">
      <div
        className={`rounded-panel border p-2.5 ${
          tone === 'done'
            ? 'border-curve/30 bg-curve/5'
            : 'border-accent/25 bg-accent-soft'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------
// Lists
// -------------------------------------------------------------------------

function GuideList({
  template,
  state,
  search,
  filter,
  activeGuideId,
  collapsed,
  onContextMenu
}: {
  template: TemplateDef;
  state: Map<string, string>;
  search: string;
  filter: GuideFilter;
  activeGuideId: string | null;
  collapsed: string[];
  onContextMenu: (event: React.MouseEvent, id: string) => void;
}): JSX.Element {
  const query = search.trim().toLowerCase();

  const keep = (def: GuideDef): boolean => {
    if (query && !matches(def, query)) return false;
    const source = state.get(def.id);
    switch (filter) {
      case 'unplaced':
        return source === undefined;
      case 'auto':
        return source !== undefined && source !== 'user';
      case 'mine':
        return source === 'user';
      default:
        return true;
    }
  };

  const groups = guidesByGroup(template)
    .map((group) => ({ ...group, guides: group.guides.filter(keep) }))
    .filter((group) => group.guides.length > 0);

  if (groups.length === 0) return <Empty search={query} filter={filter} />;

  return (
    <>
      {groups.map((group) => {
        // A search is a request to see what matched. Honouring a collapse the
        // user set ten minutes ago would hide the answer they just asked for.
        const isOpen = query !== '' || !collapsed.includes(group.group);
        const placed = group.guides.filter((g) => state.has(g.id)).length;
        return (
          <Disclosure
            key={group.group}
            title={group.label}
            open={isOpen}
            onToggle={() => useUiStore.getState().toggleGroup(group.group)}
            badge={<ProgressRing done={placed} total={group.guides.length} />}
            data-testid={`group-${group.group}`}
          >
            {group.guides.map((def) => (
              <GuideRow
                key={def.id}
                def={def}
                source={state.get(def.id)}
                active={def.id === activeGuideId}
                onContextMenu={(event) => onContextMenu(event, def.id)}
              />
            ))}
          </Disclosure>
        );
      })}
    </>
  );
}

function matches(def: { id: string; label: string; hint?: string }, query: string): boolean {
  return (
    def.label.toLowerCase().includes(query) ||
    def.id.toLowerCase().includes(query) ||
    (def.hint?.toLowerCase().includes(query) ?? false)
  );
}

function GuideRow({
  def,
  source,
  active,
  onContextMenu
}: {
  def: GuideDef;
  source: string | undefined;
  active: boolean;
  onContextMenu: (event: React.MouseEvent) => void;
}): JSX.Element {
  const placed = source !== undefined;
  const suggested = placed && source !== 'user';

  return (
    <button
      data-testid={`guide-${def.id}`}
      title={def.hint}
      onContextMenu={onContextMenu}
      onClick={() => {
        useUiStore.getState().setActiveGuideId(def.id);
        useUiStore.getState().setSelectedGuideId(placed ? def.id : null);
      }}
      className={`rs-row ml-3 w-[calc(100%-0.75rem)] ${
        active
          ? 'bg-accent-soft text-ink'
          : 'text-ink-dim hover:bg-panel-lighter hover:text-ink'
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ring-1 transition-colors ${
          placed
            ? suggested
              ? 'bg-guide-suggested ring-guide-suggested'
              : 'bg-guide-placed ring-guide-placed'
            : active
              ? 'bg-guide-active ring-guide-active'
              : 'bg-transparent ring-guide-unplaced'
        }`}
      />
      <span className="min-w-0 flex-1 truncate">{def.label}</span>
      {suggested && <Chip tone="suggested">auto</Chip>}
      {def.interior && !suggested && (
        <span
          className="shrink-0 text-[9px] uppercase tracking-wide text-ink-faint"
          title="Sits inside the body - hold Alt and drag to set its depth"
        >
          in
        </span>
      )}
      {def.optional && !placed && (
        <span className="shrink-0 text-[9px] uppercase tracking-wide text-ink-faint">
          opt
        </span>
      )}
    </button>
  );
}

function CurveList({
  template,
  doc,
  search,
  activeCurveId,
  collapsed
}: {
  template: TemplateDef;
  doc: RiserDocument;
  search: string;
  activeCurveId: string | null;
  collapsed: string[];
}): JSX.Element {
  const query = search.trim().toLowerCase();
  const counts = new Map(doc.curves.map((c) => [c.id, c.points.length]));

  const groups = curvesByGroup(template)
    .map((group) => ({
      ...group,
      curves: group.curves.filter((c) => !query || matches(c, query))
    }))
    .filter((group) => group.curves.length > 0);

  if (groups.length === 0) return <Empty search={query} filter="all" />;

  return (
    <>
      {groups.map((group) => {
        const isOpen = query !== '' || !collapsed.includes(group.group);
        const done = group.curves.filter((c) => (counts.get(c.id) ?? 0) > 0).length;
        return (
          <Disclosure
            key={group.group}
            title={group.label}
            open={isOpen}
            onToggle={() => useUiStore.getState().toggleGroup(group.group)}
            badge={<ProgressRing done={done} total={group.curves.length} />}
          >
            {group.curves.map((def) => {
              const count = counts.get(def.id) ?? 0;
              const active = def.id === activeCurveId;
              return (
                <button
                  key={def.id}
                  data-testid={`curve-${def.id}`}
                  title={def.hint}
                  onClick={() => useUiStore.getState().setActiveCurveId(def.id)}
                  className={`rs-row ml-3 w-[calc(100%-0.75rem)] ${
                    active
                      ? 'bg-accent-soft text-ink'
                      : 'text-ink-dim hover:bg-panel-lighter hover:text-ink'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 shrink-0 rounded-full ring-1 ${
                      count > 0
                        ? 'bg-curve ring-curve'
                        : active
                          ? 'bg-guide-active ring-guide-active'
                          : 'bg-transparent ring-guide-unplaced'
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate">{def.label}</span>
                  {count > 0 && (
                    <span className="shrink-0 font-mono text-[10px] text-ink-faint">
                      {count}
                    </span>
                  )}
                  {def.optional && count === 0 && (
                    <span className="shrink-0 text-[9px] uppercase tracking-wide text-ink-faint">
                      opt
                    </span>
                  )}
                </button>
              );
            })}
          </Disclosure>
        );
      })}
    </>
  );
}

function Empty({ search, filter }: { search: string; filter: GuideFilter }): JSX.Element {
  const message = search
    ? `Nothing matches "${search}".`
    : filter === 'unplaced'
      ? 'Nothing left to place.'
      : filter === 'auto'
        ? 'Nothing was placed automatically.'
        : filter === 'mine'
          ? 'You have not placed anything yet.'
          : 'This template is empty.';

  return (
    <p className="px-3 py-6 text-center text-ink-faint">
      {message}
      {(search || filter !== 'all') && (
        <button
          type="button"
          onClick={() => {
            useUiStore.getState().setGuideSearch('');
            useUiStore.getState().setGuideFilter('all');
          }}
          className="mt-2 block w-full text-accent hover:underline"
        >
          Show everything
        </button>
      )}
    </p>
  );
}

// -------------------------------------------------------------------------
// Right-click
// -------------------------------------------------------------------------

function GuideContextItems({
  id,
  placed,
  suggested
}: {
  id: string;
  placed: boolean;
  suggested: boolean;
}): JSX.Element {
  const app = useApp();
  return (
    <>
      <MenuItem
        label="Place this next"
        icon="marker"
        onSelect={() => useUiStore.getState().setActiveGuideId(id)}
      />
      <MenuItem
        label="Focus in viewport"
        icon="frame"
        disabled={!placed}
        onSelect={() => {
          useUiStore.getState().setSelectedGuideId(id);
          app.frameSelection();
        }}
      />
      {suggested && (
        <>
          <MenuSeparator />
          <MenuItem
            label="Confirm this guess"
            icon="check"
            description="Keeps it exactly where it is, and stops Auto-place replacing it"
            onSelect={() => app.confirmGuide(id)}
          />
        </>
      )}
      <MenuSeparator />
      <MenuItem
        label="Clear"
        icon="trash"
        danger
        disabled={!placed}
        onSelect={() => app.clearGuide(id)}
      />
    </>
  );
}

/** Kept so existing imports of the old name keep working. */
export const Checklist = TemplateBrowser;
