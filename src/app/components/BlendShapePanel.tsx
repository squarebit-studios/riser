// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Firing a character's blend shapes, to check markers against them.
//
// WHERE IT LIVES, and why. In the Details panel, under the character - not in
// the toolbar, and not as a mode. The toolbar is for what you touch on every
// marker; this is something you reach for occasionally, to answer one
// question: does this guide still sit where it should when the face moves?
//
// It appears ONLY when the loaded character has shapes. A permanently empty
// section teaches the user to ignore that part of the panel, and most
// characters have none.
//
// The shapes drive the mesh and nothing else. The document is untouched: a
// marker's binding names a triangle on the neutral mesh, and posing that mesh
// for a look does not change which triangle it is. Leaving a shape fired is
// therefore harmless, but the section says how many are active so nobody
// wonders later why their character is smiling.
// ==========================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../AppContext';
import { useUiStore } from '../state';
import {
  findBlendShapes,
  setWeight,
  weightOf
} from '../../viewport/blendShapes';
import { Button } from './ui/Button';
import { Chip, SearchField } from './ui/Controls';

export function BlendShapePanel(): JSX.Element | null {
  const app = useApp();
  const characterName = useUiStore((s) => s.characterName);
  // Blend shapes arrive after the character does, because reading them means
  // fetching its file back. Without this the list is built from an empty set
  // and never rebuilt, so a character full of shapes shows no panel at all.
  const blendShapeCount = useUiStore((s) => s.blendShapeCount);
  const [search, setSearch] = useState('');
  // Weights live on the three.js meshes, not in React. This is bumped to
  // redraw the sliders after a change; keeping the values themselves in React
  // would mean a second copy that could disagree with what is on screen.
  const [, setTick] = useState(0);
  const redraw = useCallback(() => setTick((n) => n + 1), []);

  // TWO SOURCES, ONE LIST.
  //
  // A glTF or FBX arrives with three morph targets already built, and those
  // are driven through `morphTargetInfluences`. A USD arrives with nothing:
  // three's USD loader does not read blend shapes at all, and a face rig's
  // worth could not be morph targets anyway, so Riser reads them itself and
  // applies the sparse deltas by hand.
  //
  // Both end up here as the same row, because the difference is Riser's
  // problem and not the reader's: a shape is a shape, and it should look and
  // behave the same whichever file it came from.
  const shapes = useMemo(() => {
    const rows: ShapeRow[] = findBlendShapes(app.characterModel?.meshes ?? []).map(
      (shape) => ({
        name: shape.name,
        meshes: shape.targets.length,
        weight: () => weightOf(shape),
        set: (value: number) => setWeight(shape, value)
      })
    );

    for (const name of app.blendShapes.names()) {
      rows.push({
        name,
        meshes: app.blendShapes.meshCountFor(name),
        weight: () => app.blendShapes.weightOf(name),
        // `live` while a slider is being dragged: the vertex shader shows it
        // at once and the fuller pass follows when it stops moving, so a drag
        // costs an upload rather than re-evaluating every moved vertex.
        set: (value: number, live?: boolean) =>
          app.blendShapes.setWeight(name, value, live)
      });
    }

    return rows.sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterName, app.characterModel, blendShapeCount]);

  // A new character means the previous one's shapes are gone; drop the filter
  // so the list is not mysteriously empty.
  useEffect(() => setSearch(''), [characterName]);

  if (shapes.length === 0) return null;

  const query = search.trim().toLowerCase();
  const shown = query
    ? shapes.filter((shape) => shape.name.toLowerCase().includes(query))
    : shapes;
  const active = shapes.filter((shape) => shape.weight() > 0.001).length;

  return (
    <section className="border-t border-edge px-3 py-3" data-testid="blend-shapes">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">
          Blend shapes
        </h3>
        {active > 0 && <Chip tone="accent">{active} on</Chip>}
        <span className="font-mono text-[11px] text-ink-faint">{shapes.length}</span>
      </div>

      <p className="mb-2 text-[11px] leading-snug text-ink-faint">
        Fire a shape to check your markers still sit right when the face moves.
        Nothing here changes the document.
      </p>

      {/* A face rig can carry a hundred shapes; a list that long needs a filter. */}
      {shapes.length > 8 && (
        <div className="mb-2">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Search shapes"
            data-testid="blend-shape-search"
          />
        </div>
      )}

      <div className="max-h-64 space-y-0.5 overflow-y-auto pr-0.5">
        {shown.map((shape) => (
          <ShapeRowView key={shape.name} shape={shape} onChange={redraw} />
        ))}
        {shown.length === 0 && (
          <p className="py-3 text-center text-ink-faint">No shape matches.</p>
        )}
      </div>

      <Button
        size="sm"
        className="mt-2 w-full"
        disabled={active === 0}
        data-testid="reset-blend-shapes"
        onClick={() => {
          for (const shape of shapes) shape.set(0);
          redraw();
        }}
      >
        Reset all
      </Button>
    </section>
  );
}

/**
 * A shape as the panel needs it, whatever is driving it underneath.
 *
 * `weight` is a function rather than a value because the truth lives on the
 * three.js side: a copy held in React is a second answer to the same question,
 * and the two disagree the moment anything else moves a weight.
 */
interface ShapeRow {
  name: string;
  /** How many meshes this one name drives. */
  meshes: number;
  weight: () => number;
  set: (weight: number, live?: boolean) => void;
}

function ShapeRowView({
  shape,
  onChange
}: {
  shape: ShapeRow;
  onChange: () => void;
}): JSX.Element {
  const weight = shape.weight();
  const on = weight > 0.001;

  const apply = (value: number, live = false): void => {
    shape.set(value, live);
    onChange();
  };

  return (
    <div className="flex items-center gap-2 rounded-control px-1 py-1 hover:bg-panel-lighter">
      {/* Clicking the name fires the shape outright. Dragging to 1.0 to see
          what a shape looks like is a chore repeated a hundred times on a
          face rig; a click is how people actually want to audition one. */}
      <button
        type="button"
        onClick={() => apply(on ? 0 : 1)}
        title={on ? 'Turn off' : 'Fire this shape'}
        data-testid={`blend-shape-${shape.name}`}
        className={`min-w-0 flex-1 truncate text-left transition-colors ${
          on ? 'text-accent' : 'text-ink-dim hover:text-ink'
        }`}
      >
        {shape.name}
      </button>

      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={weight}
        aria-label={shape.name}
        // Dragging is live; letting go is not. The distinction is what lets
        // the vertex shader carry the drag and the fuller pass finish the job.
        onChange={(event) => apply(Number(event.target.value), true)}
        onPointerUp={(event) =>
          apply(Number((event.target as HTMLInputElement).value))
        }
        onKeyUp={(event) =>
          apply(Number((event.target as HTMLInputElement).value))
        }
        className="h-1 w-20 shrink-0 cursor-pointer appearance-none rounded-full bg-panel-active accent-accent"
      />
      <span
        className={`w-7 shrink-0 text-right font-mono text-[11px] ${
          on ? 'text-accent' : 'text-ink-faint'
        }`}
      >
        {weight.toFixed(2)}
      </span>
    </div>
  );
}
