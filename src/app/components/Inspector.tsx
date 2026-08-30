// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The right panel: what exactly is selected, and what the server will see.
//
// It deliberately shows the BINDING - prim path, face index, barycentric
// weights - and not just a position. When a marker ends up somewhere
// unexpected, the binding is the thing that explains why, and hiding it would
// make the one genuinely diagnostic piece of state invisible.
// ==========================================================================

import React from 'react';
import { useApp } from '../AppContext';
import { useUiStore } from '../state';
import { curveDef, getTemplate, guideDef } from '../../templates';
import * as M from '../../doc/mutations';
import { documentToWorld } from '../../viewport/space';

export function Inspector(): JSX.Element {
  const app = useApp();
  const templateId = useUiStore((s) => s.templateId);
  const activeTool = useUiStore((s) => s.activeTool);
  const selectedGuideId = useUiStore((s) => s.selectedGuideId);
  const activeCurveId = useUiStore((s) => s.activeCurveId);
  const characterName = useUiStore((s) => s.characterName);
  const hasSkeleton = useUiStore((s) => s.characterHasSkeleton);
  const subdivLevel = useUiStore((s) => s.subdivLevel);
  useUiStore((s) => s.docRevision);
  // Read after subscribing to the level, so the stats refresh when it changes.
  void subdivLevel;
  const subdiv = app.subdivStats;

  const template = getTemplate(templateId);
  const doc = app.store.document;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Section title="Character">
        {characterName ? (
          <>
            <Field label="Asset" value={characterName} mono />
            <Field label="Units" value={`${doc.metersPerUnit} m per unit`} />
            <Field label="Up axis" value={doc.upAxis} />
            <Field
              label="Skeleton"
              value={hasSkeleton ? 'present' : 'none'}
              muted={!hasSkeleton}
            />
            {subdiv && (
              <Field
                label="Subdivision"
                value={
                  subdiv.level === 0
                    ? `off - ${subdiv.cageFaces.toLocaleString()} cage faces`
                    : `level ${subdiv.level} - ${subdiv.limitFaces.toLocaleString()} faces from ${subdiv.cageFaces.toLocaleString()}`
                }
              />
            )}
          </>
        ) : (
          <p className="px-2 py-1 text-ink-faint">
            Load a stock character or drop a USD, glTF, FBX or OBJ file on the viewport.
          </p>
        )}
      </Section>

      {activeTool === 'marker' ? (
        <GuideDetails
          selectedGuideId={selectedGuideId}
          template={template}
          app={app}
        />
      ) : (
        <CurveDetails activeCurveId={activeCurveId} template={template} app={app} />
      )}

      <Section title="Document">
        <Field label="Template" value={template.label} />
        <Field label="Guides placed" value={`${doc.guides.length}`} />
        <Field label="Curves started" value={`${doc.curves.length}`} />
        <Field
          label="Control vertices"
          value={`${doc.curves.reduce((n, c) => n + c.points.length, 0)}`}
        />
      </Section>
    </div>
  );
}

function GuideDetails({
  selectedGuideId,
  template,
  app
}: {
  selectedGuideId: string | null;
  template: ReturnType<typeof getTemplate>;
  app: ReturnType<typeof useApp>;
}): JSX.Element {
  const guide = selectedGuideId
    ? app.store.document.guides.find((g) => g.id === selectedGuideId)
    : undefined;
  const def = selectedGuideId ? guideDef(template, selectedGuideId) : undefined;

  if (!def) {
    return (
      <Section title="Selection">
        <p className="px-2 py-1 text-ink-faint">
          Pick a guide from the list, then click the character to place it.
        </p>
      </Section>
    );
  }

  const model = app.characterModel;
  const nearest =
    guide && model
      ? model.nearestJoint(
          documentToWorld(app.viewport.characterRoot, guide.position)
        )
      : null;

  return (
    <Section title={def.label}>
      {def.hint && <p className="mb-2 px-2 text-ink-faint">{def.hint}</p>}
      <Field label="Id" value={def.id} mono />
      <Field label="Group" value={def.group} />
      {def.interior && (
        <Field label="Placement" value="inside the volume - alt-drag for depth" />
      )}

      {!guide ? (
        <p className="mt-2 px-2 text-ink-faint">Not placed yet.</p>
      ) : (
        <>
          <Field label="Position" value={formatVec(guide.position)} mono />
          {guide.binding ? (
            <>
              <Field label="Bound to" value={guide.binding.primPath} mono />
              <Field label="Face" value={`${guide.binding.faceIndex}`} mono />
              <Field
                label="Barycentric"
                value={formatVec(guide.binding.barycentric, 3)}
                mono
              />
              <Field label="Offset" value={formatVec(guide.binding.offset, 4)} mono />
            </>
          ) : (
            <Field label="Bound to" value="nothing - free in space" muted />
          )}

          {nearest && (
            <Field
              label="Nearest joint"
              value={`${nearest.name} (${(nearest.distance * 100).toFixed(1)} cm)`}
            />
          )}

          <div className="mt-2 flex gap-1 px-1">
            <button
              className="rs-button flex-1 bg-panel-light"
              onClick={() => app.frameSelection()}
            >
              Focus
            </button>
            <button
              className="rs-button flex-1 bg-panel-light"
              onClick={() =>
                app.store.apply(
                  (d) => M.removeGuide(d, def.id),
                  `Remove ${def.label}`
                )
              }
            >
              Remove
            </button>
          </div>
        </>
      )}
    </Section>
  );
}

function CurveDetails({
  activeCurveId,
  template,
  app
}: {
  activeCurveId: string | null;
  template: ReturnType<typeof getTemplate>;
  app: ReturnType<typeof useApp>;
}): JSX.Element {
  const def = activeCurveId ? curveDef(template, activeCurveId) : undefined;
  const curve = activeCurveId
    ? app.store.document.curves.find((c) => c.id === activeCurveId)
    : undefined;

  if (!def) {
    return (
      <Section title="Selection">
        <p className="px-2 py-1 text-ink-faint">
          Pick a curve from the list, then click along the character to lay down control
          vertices.
        </p>
      </Section>
    );
  }

  return (
    <Section title={def.label}>
      {def.hint && <p className="mb-2 px-2 text-ink-faint">{def.hint}</p>}
      <Field label="Id" value={def.id} mono />
      {def.suggestedPoints && (
        <Field label="Suggested points" value={`${def.suggestedPoints}`} />
      )}

      {!curve ? (
        <p className="mt-2 px-2 text-ink-faint">
          Not started. Click the character to place the first control vertex.
        </p>
      ) : (
        <>
          <Field label="Control vertices" value={`${curve.points.length}`} />
          <Field label="Closed" value={curve.closed ? 'yes' : 'no'} />

          <label className="mt-2 flex items-center gap-2 px-2">
            <span className="w-24 shrink-0 text-ink-faint">Width</span>
            <input
              type="range"
              min={0.0002}
              max={0.02}
              step={0.0002}
              value={curve.width}
              onChange={(e) =>
                app.store.apply(
                  (d) => M.setCurveWidth(d, curve.id, Number(e.target.value)),
                  `Width ${def.label}`,
                  { coalesceKey: `width:${curve.id}` }
                )
              }
              className="flex-1 accent-curve"
            />
          </label>

          <div className="mt-2 flex gap-1 px-1">
            <button
              className="rs-button flex-1 bg-panel-light"
              onClick={() =>
                app.store.apply(
                  (d) => M.setCurveClosed(d, curve.id, !curve.closed),
                  curve.closed ? `Open ${def.label}` : `Close ${def.label}`
                )
              }
            >
              {curve.closed ? 'Open' : 'Close'}
            </button>
            <button
              className="rs-button flex-1 bg-panel-light"
              onClick={() =>
                app.store.apply(
                  (d) => M.removeCurve(d, curve.id),
                  `Remove ${def.label}`
                )
              }
            >
              Remove
            </button>
          </div>
        </>
      )}
    </Section>
  );
}

// -------------------------------------------------------------------------

function Section({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="border-b border-edge px-2 py-2.5">
      <h2 className="mb-1.5 px-2 text-xs font-medium uppercase tracking-wide text-ink-dim">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  mono,
  muted
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-baseline gap-2 px-2 py-0.5">
      <span className="w-24 shrink-0 text-ink-faint">{label}</span>
      <span
        className={[
          'flex-1 truncate',
          mono ? 'font-mono text-[11px]' : '',
          muted ? 'text-ink-faint' : 'text-ink-dim'
        ].join(' ')}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function formatVec(v: readonly [number, number, number], digits = 3): string {
  return `${v[0].toFixed(digits)}, ${v[1].toFixed(digits)}, ${v[2].toFixed(digits)}`;
}
