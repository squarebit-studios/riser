// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// What the character is actually made of.
//
// A blockout is one mesh and needs no outliner. A production character is
// thirty-odd pieces with clothing over skin, and two questions follow that a
// marker tool has to answer: which piece is under my cursor, and how do I get
// at the one underneath it.
//
// So this is a list with a highlight and a visibility toggle, not a full scene
// graph. Riser does not let anyone reparent, rename or delete a piece, and a
// tree that implied otherwise would be promising an editor that is not here.
//
// Selection is driven from THIS LIST, not from clicking the viewport. A click
// in the viewport already means "place a marker", which is the whole job, and
// overloading it would make the primary action ambiguous to save a trip to a
// panel.
// ==========================================================================

import { useMemo, useState } from 'react';
import { useApp } from '../AppContext';
import { useUiStore } from '../state';
import { Icon } from './ui/Icon';
import { Button } from './ui/Button';
import { Chip, SearchField } from './ui/Controls';

export function OutlinerPanel(): JSX.Element {
  const app = useApp();
  const characterName = useUiStore((s) => s.characterName);
  const [search, setSearch] = useState('');
  // Selection and visibility live on the three.js side. This redraws the list
  // after a change rather than keeping a second copy that could disagree with
  // what is on screen.
  const [tick, setTick] = useState(0);
  const redraw = (): void => setTick((n) => n + 1);

  // `tick` belongs in these deps. Without it the list was memoised on the
  // character alone, so hiding a piece never refreshed `item.visible`: the row
  // went on showing the "hide" icon and the next click sent
  // setVisible(path, false) a second time. Hiding worked and showing was
  // unreachable, which reads as a broken toggle when the toggle is fine and
  // the list it draws from is stale.
  const items = useMemo(
    () => app.scene.items(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [characterName, app.characterModel, tick]
  );

  if (!characterName) {
    return (
      <p className="px-3 py-6 text-center text-ink-faint">
        Load a character to see what it is made of.
      </p>
    );
  }

  const query = search.trim().toLowerCase();
  const shown = query
    ? items.filter((item) => item.name.toLowerCase().includes(query))
    : items;
  const selected = app.scene.selectedPath;
  const hidden = app.scene.hiddenCount;

  const total = items.reduce((sum, item) => sum + item.triangles, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 px-3 py-3">
        <div className="flex items-baseline gap-2">
          <span className="flex-1 text-[11px] text-ink-faint">
            {items.length} pieces, {total.toLocaleString()} triangles
          </span>
          {hidden > 0 && (
            <Button
              size="sm"
              variant="ghost"
              data-testid="show-all-pieces"
              onClick={() => {
                app.scene.showAll();
                redraw();
              }}
            >
              Show all
            </Button>
          )}
        </div>
        {items.length > 8 && (
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Search pieces"
            data-testid="outliner-search"
          />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {shown.map((item) => {
          const isSelected = item.primPath === selected;
          return (
            <div
              key={item.primPath}
              className={`group flex items-center gap-1 rounded-control pr-1 ${
                isSelected ? 'bg-accent-soft' : 'hover:bg-panel-lighter'
              }`}
            >
              <button
                type="button"
                data-testid={`piece-${item.name}`}
                title={item.primPath}
                onClick={() => {
                  app.scene.select(isSelected ? null : item.primPath);
                  redraw();
                }}
                className={`flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1.5 text-left ${
                  isSelected ? 'text-ink' : 'text-ink-dim'
                } ${item.visible ? '' : 'opacity-45'}`}
              >
                <Icon
                  name={item.skinned ? 'bone' : 'cube'}
                  size={14}
                  className="shrink-0 text-ink-faint"
                />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                {item.materials > 1 && (
                  <Chip tone="neutral">{item.materials} mats</Chip>
                )}
                <span className="shrink-0 font-mono text-[10px] text-ink-faint">
                  {item.triangles.toLocaleString()}
                </span>
              </button>

              {/* Hiding a piece is how you reach the one underneath it, which
                  on a clothed character is most of the reason this list is
                  here at all. */}
              <button
                type="button"
                aria-label={`${item.visible ? 'Hide' : 'Show'} ${item.name}`}
                title={`${item.visible ? 'Hide' : 'Show'} ${item.name}`}
                data-testid={`toggle-${item.name}`}
                onClick={() => {
                  app.scene.setVisible(item.primPath, !item.visible);
                  redraw();
                }}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-control transition-colors hover:bg-panel-hover ${
                  item.visible
                    ? 'text-ink-faint opacity-0 group-hover:opacity-100'
                    : 'text-guide-active'
                }`}
              >
                <Icon name={item.visible ? 'eye' : 'eyeOff'} size={14} />
              </button>
            </div>
          );
        })}

        {shown.length === 0 && (
          <p className="px-3 py-6 text-center text-ink-faint">
            Nothing matches &ldquo;{search}&rdquo;.
          </p>
        )}
      </div>
    </div>
  );
}
