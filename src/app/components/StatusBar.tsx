// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The bottom strip: what to do next, and anything the app needs to say.
// ==========================================================================

import { useEffect } from 'react';
import { useApp } from '../AppContext';
import { useUiStore } from '../state';
import { curveDef, getTemplate, guideDef } from '../../templates';

/** Notices clear themselves; a warning that never leaves becomes furniture. */
const NOTICE_TIMEOUT_MS = 6000;

export function StatusBar(): JSX.Element {
  const app = useApp();
  const activeTool = useUiStore((s) => s.activeTool);
  const templateId = useUiStore((s) => s.templateId);
  const activeGuideId = useUiStore((s) => s.activeGuideId);
  const activeCurveId = useUiStore((s) => s.activeCurveId);
  const characterName = useUiStore((s) => s.characterName);
  const dirty = useUiStore((s) => s.dirty);
  const notice = useUiStore((s) => s.notice);
  useUiStore((s) => s.docRevision);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => useUiStore.getState().setNotice(null), NOTICE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const template = getTemplate(templateId);
  const prompt = nextAction();

  function nextAction(): string {
    if (!characterName) return 'Load a character to begin.';
    if (activeTool === 'curve') {
      const def = activeCurveId ? curveDef(template, activeCurveId) : undefined;
      return def
        ? `Click along the character to trace ${def.label}.`
        : 'Choose a curve from the list to start tracing.';
    }
    const def = activeGuideId ? guideDef(template, activeGuideId) : undefined;
    if (!def) {
      const remaining = template.guides.filter(
        (g) => !g.optional && !app.store.document.guides.some((p) => p.id === g.id)
      );
      return remaining.length === 0
        ? 'Every required guide is placed. Export the USD layer when ready.'
        : 'Choose a guide from the list to place it.';
    }
    return `Click the character to place ${def.label}.`;
  }

  const placed = app.store.document.guides.length;
  const required = template.guides.filter((g) => !g.optional).length;

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-edge bg-panel px-3 text-[11px] text-ink-faint">
      {/* The next thing to do, in words. This is the line a first-time user
          reads when they do not know what the interface wants from them, so
          it says what to do rather than reporting what is true. */}
      <span className={notice ? 'text-guide-active' : 'text-ink-dim'}>
        {notice ?? prompt}
      </span>

      <div className="flex-1" />

      <span className="hidden lg:inline" title="Markers placed">
        {placed} of {required} placed
      </span>
      <span className="hidden xl:inline" title="Undo history">
        {app.store.undoLabel ?? 'No edits yet'}
      </span>
      <span
        className={`flex items-center gap-1 ${dirty ? 'text-guide-active' : ''}`}
        title={dirty ? 'Your work is autosaved to this browser' : undefined}
      >
        {dirty && <span aria-hidden="true">•</span>}
        {dirty ? 'Unsaved' : 'Saved'}
      </span>
    </footer>
  );
}
