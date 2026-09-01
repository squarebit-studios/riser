// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The source file, as the file describes itself.
//
// The Scene tab shows the ACTOR: the character consolidated into the thing a
// person places markers on. This shows the SOURCE: every prim the USD
// contains, its type, and its attributes. Both are true and they answer
// different questions, which is why they are two tabs rather than one
// compromise.
//
// It exists because the same question kept costing hours: is the thing I am
// looking for actually in this file. The eye look was in it and unread. The
// quads were in it and were being guessed at from triangles. The blend shapes
// were not in it at all, which is a different problem from the panel being
// broken, and told apart only by looking.
//
// Read-only, deliberately. Riser writes a layer that REFERENCES the character
// and never modifies it, and an editable panel here would promise something
// the format does not do.
// ==========================================================================

import { useMemo, useState } from 'react';
import { useApp } from '../AppContext';
import { useUiStore } from '../state';
import { Icon } from './ui/Icon';
import { Chip, SearchField } from './ui/Controls';
import { searchPrims, type UsdPrim } from '../../io/usdInspect';

export function UsdPanel(): JSX.Element {
  const app = useApp();
  const characterName = useUiStore((s) => s.characterName);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const prims = app.usdPrims;
  const shown = useMemo(
    () => (prims ? searchPrims(prims, search).slice(0, 500) : []),
    [prims, search]
  );

  if (!characterName) {
    return (
      <p className="px-3 py-6 text-center text-ink-faint">
        Load a character to inspect its USD.
      </p>
    );
  }

  if (!prims) {
    return (
      <p className="px-3 py-6 text-center text-ink-faint">
        {/* Uploaded characters have no URL to read back, and a glTF or FBX is
            not USD at all. Saying so beats an empty list. */}
        Nothing to inspect. This view reads the character&rsquo;s USD, so it
        needs one of the bundled or linked assets.
      </p>
    );
  }

  const total = prims.length;
  const attributes = prims.reduce((sum, p) => sum + p.attributes.length, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 px-3 py-3">
        <span className="text-[11px] text-ink-faint">
          {total.toLocaleString()} prims, {attributes.toLocaleString()} attributes
        </span>
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search prims and attributes"
          data-testid="usd-search"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {shown.map((prim) => (
          <PrimRow
            key={prim.path}
            prim={prim}
            expanded={open === prim.path}
            onToggle={() => setOpen(open === prim.path ? null : prim.path)}
          />
        ))}

        {shown.length === 0 && (
          <p className="px-3 py-6 text-center text-ink-faint">
            Nothing matches &ldquo;{search}&rdquo;.
          </p>
        )}
        {prims.length > shown.length && search.trim() === '' && (
          <p className="px-3 py-3 text-center text-[11px] text-ink-faint">
            Showing the first {shown.length.toLocaleString()}. Search to reach
            the rest.
          </p>
        )}
      </div>
    </div>
  );
}

function PrimRow({
  prim,
  expanded,
  onToggle
}: {
  prim: UsdPrim;
  expanded: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <div className="rounded-control">
      <button
        type="button"
        onClick={onToggle}
        data-testid={`usd-prim-${prim.name}`}
        title={prim.path}
        className={`flex w-full items-center gap-2 px-1.5 py-1.5 text-left hover:bg-panel-lighter ${
          expanded ? 'text-ink' : 'text-ink-dim'
        }`}
        // Nesting is shown by indent rather than by a tree with expanders on
        // every level: the paths are deep and mostly uninteresting, and what
        // people search for is a leaf.
        style={{ paddingLeft: `${Math.min(prim.depth, 8) * 8 + 6}px` }}
      >
        <Icon
          name={prim.attributes.length > 0 ? 'sliders' : 'cube'}
          size={13}
          className="shrink-0 text-ink-faint"
        />
        <span className="min-w-0 flex-1 truncate">{prim.name}</span>
        {prim.typeName && <Chip tone="neutral">{prim.typeName}</Chip>}
        {prim.attributes.length > 0 && (
          <span className="shrink-0 font-mono text-[10px] text-ink-faint">
            {prim.attributes.length}
          </span>
        )}
      </button>

      {expanded && (
        <div className="mb-1 ml-4 space-y-1 border-l border-edge px-2 py-1">
          <p className="rs-selectable break-all font-mono text-[10px] text-ink-faint">
            {prim.path}
          </p>
          {prim.attributes.length === 0 && (
            <p className="text-[11px] text-ink-faint">No authored attributes.</p>
          )}
          {prim.attributes.map((attribute) => (
            <div key={attribute.name} className="text-[11px]">
              <div className="flex items-baseline gap-2">
                <span className="rs-selectable font-mono text-ink-dim">
                  {attribute.name}
                </span>
                {attribute.typeName && (
                  <span className="text-ink-faint">{attribute.typeName}</span>
                )}
                {attribute.interpolation && (
                  <Chip tone="neutral">{attribute.interpolation}</Chip>
                )}
              </div>
              <div className="rs-selectable break-all font-mono text-[10px] text-ink-faint">
                {attribute.summary}
                {attribute.preview && (
                  <span className="opacity-70"> &middot; {attribute.preview}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
