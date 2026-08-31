// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The right panel: what exactly is selected, and what the server will see.
//
// It deliberately shows the BINDING - prim path, face index, barycentric
// weights - and not just a position. When a marker ends up somewhere
// unexpected, the binding is the thing that explains why, and hiding it would
// make the one genuinely diagnostic piece of state invisible.
//
// TWO TABS, not two panels. Details answers "what is this marker"; Animation
// answers "does it still hold up when the character moves". They are two
// questions about the same character rather than two places to work, and
// giving the second one a panel of its own would cost the viewport width
// permanently to show something most sessions never open.
//
// Which tab is showing is LOCAL state, deliberately. It is not worth
// remembering across a reload - someone reopening a document has come back to
// place markers - and it is not worth putting in the UI store, where it would
// be one more thing every other component re-renders on.
// ==========================================================================

import React, { useMemo, useState } from 'react';
import { useApp } from '../AppContext';
import type { RiserApp } from '../RiserApp';
import { useUiStore } from '../state';
import { Button, SegmentedControl } from './ui/Button';
import { AnimationPanel } from './AnimationPanel';
import { BlendShapePanel } from './BlendShapePanel';
import { OutlinerPanel } from './OutlinerPanel';
import { curveDef, getTemplate, guideDef } from '../../templates';
import * as M from '../../doc/mutations';
import { documentToWorld } from '../../viewport/space';

type InspectorTab = 'details' | 'scene' | 'animation';

const TABS = [
  { value: 'details' as const, label: 'Details', icon: 'sliders' as const },
  { value: 'scene' as const, label: 'Scene', icon: 'list' as const },
  { value: 'animation' as const, label: 'Animation', icon: 'play' as const }
];

export function Inspector(): JSX.Element {
  const [tab, setTab] = useState<InspectorTab>('details');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-edge px-2 py-2">
        <SegmentedControl<InspectorTab>
          size="sm"
          value={tab}
          onChange={setTab}
          options={TABS}
        />
      </div>
      {/* Only the chosen tab is mounted. The player it drives lives on
          RiserApp, so playback carries on regardless of which tab is up. */}
      <div className="min-h-0 flex-1">
        {tab === 'details' && <Details />}
        {tab === 'scene' && <OutlinerPanel />}
        {tab === 'animation' && <AnimationPanel />}
      </div>
    </div>
  );
}

function Details(): JSX.Element {
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
            {/* Editable, because this is what an exported layer references
                and only the user knows where the asset lives in their
                pipeline. It defaults to a path beside the exported file,
                which is the portable choice. */}
            <label className="flex items-baseline gap-2 px-2 py-0.5">
              <span className="w-24 shrink-0 text-ink-faint">Reference</span>
              <input
                className="min-w-0 flex-1 rounded bg-panel-light px-1.5 py-0.5 font-mono text-[11px] text-ink-dim outline-none focus:text-ink"
                value={doc.characterRef}
                spellCheck={false}
                onChange={(e) => app.setCharacterRef(e.target.value)}
                title="The asset path written into the exported USD layer. Relative paths resolve beside the exported file."
              />
            </label>
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

      {/* Under the character, not under the selection: the shapes belong to
          the asset rather than to whichever marker happens to be picked. It
          was previously rendered inside `Field`, which put a copy of the whole
          panel in every labelled row of the inspector. */}
      <BlendShapePanel />

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
          documentToWorld(app.documentRoot, guide.position)
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
          <Field
            label="Source"
            value={
              guide.source === 'user'
                ? 'placed by you'
                : `${guide.source} (${Math.round(guide.confidence * 100)}% confidence)`
            }
            muted={guide.source !== 'user'}
          />
          <Field label="Position" value={formatVec(guide.position)} mono />
          {/* Where the marker sits relative to the skin. Without this the
              placement modes are invisible: an interior marker is drawn over
              the mesh by x-ray, so from the angle it was placed it looks
              exactly like a surface one, and the only way to tell was to
              orbit the camera. */}
          <DepthField app={app} guideId={guide.id} />
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

          <div className="mt-2 flex gap-1.5 px-1">
            <Button
              icon="frame"
              className="flex-1"
              onClick={() => app.frameSelection()}
            >
              Focus
            </Button>
            {guide.source !== 'user' && (
              <Button
                icon="check"
                className="flex-1"
                title="Keep it exactly here, and stop Auto-place replacing it"
                onClick={() => app.confirmGuide(def.id)}
              >
                Confirm
              </Button>
            )}
            <Button
              variant="danger"
              icon="trash"
              aria-label={`Remove ${def.label}`}
              onClick={() =>
                app.store.apply(
                  (d) => M.removeGuide(d, def.id),
                  `Remove ${def.label}`
                )
              }
            />
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

          <div className="mt-2 flex gap-1.5 px-1">
            <Button
              className="flex-1"
              onClick={() =>
                app.store.apply(
                  (d) => M.setCurveClosed(d, curve.id, !curve.closed),
                  curve.closed ? `Open ${def.label}` : `Close ${def.label}`
                )
              }
            >
              {curve.closed ? 'Open' : 'Close'}
            </Button>
            <Button
              variant="danger"
              icon="trash"
              aria-label={`Remove ${def.label}`}
              onClick={() =>
                app.store.apply(
                  (d) => M.removeCurve(d, curve.id),
                  `Remove ${def.label}`
                )
              }
            />
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

/**
 * How far below the surface a marker sits, in words.
 *
 * Centimetres rather than document units, because the number is being read by
 * a person judging whether a joint is in a sensible place, and "0.11" means
 * nothing without knowing what a unit is here.
 */
function describeDepth(depth: number): string {
  const cm = depth * 100;
  if (Math.abs(cm) < 0.01) return 'on the surface';
  if (cm < 0) return `${Math.abs(cm).toFixed(1)} cm above the surface`;
  return `${cm.toFixed(1)} cm inside`;
}

/**
 * The depth readout, measured once per selection rather than per render.
 *
 * It used to call `placementDepth` twice in one expression - once for the
 * value and once to decide whether to dim it - and React re-renders this panel
 * freely. On a production character each call was a nearest-point search over
 * 137k triangles plus five raycasts, so the readout cost more than a second
 * every time anything changed, and the user felt it as the marker itself being
 * slow to appear.
 */
function DepthField({ app, guideId }: { app: RiserApp; guideId: string }): JSX.Element {
  const revision = useUiStore((s) => s.docRevision);
  const depth = useMemo(
    () => app.placementDepth(guideId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app, guideId, revision]
  );

  return (
    <Field label="Depth" value={describeDepth(depth)} muted={Math.abs(depth) < 1e-4} />
  );
}
