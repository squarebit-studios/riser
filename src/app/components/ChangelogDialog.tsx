// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// What changed, in the app.
//
// The same arrangement the rest of the Squarebit sites use: CHANGELOG.md is
// the file people edit, a copy is served from the site root, and the app
// fetches and renders it. Nobody maintains a second list, which is the only
// way a changelog stays true - a hand-written in-app copy goes stale the first
// time someone is in a hurry.
//
// Fetched when the dialog opens rather than at startup. It is a page almost
// nobody visits, and a character setup tool should not spend a request on it
// before it has drawn anything.
// ==========================================================================

import { useEffect, useState } from 'react';
import { Icon } from './ui/Icon';
import { APP_VERSION } from '../version';

interface Release {
  version: string;
  date: string;
  items: string[];
}

/**
 * Read the releases out of a Keep-a-Changelog style document.
 *
 * Deliberately forgiving: `## [0.6.0] - 2026-08-31`, `## 0.6.0` and
 * `## v0.6.0` all parse, and `### Added` headings are flattened rather than
 * rejected. A changelog that fails to render because someone wrote a heading
 * differently is worse than one that renders approximately.
 */
export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  let current: Release | null = null;

  for (const raw of markdown.split('\n')) {
    const line = raw.trim();

    const heading = line.match(/^##\s+\[?v?([\d]+\.[\d]+\.[\d]+(?:-[\w.]+)?)\]?(?:\s*[-–]\s*(.+))?$/);
    if (heading) {
      if (current) releases.push(current);
      current = { version: heading[1]!, date: heading[2]?.trim() ?? '', items: [] };
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet && current) {
      current.items.push(bullet[1]!.replace(/\*\*(.+?)\*\*/g, '$1'));
    }
  }
  if (current) releases.push(current);
  return releases;
}

export function ChangelogDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/CHANGELOG.md')
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.text();
      })
      .then((text) => {
        if (!cancelled) setReleases(parseChangelog(text));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/60 p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="What's new in Riser"
        data-testid="changelog-dialog"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-2xl animate-pop-in flex-col overflow-hidden rounded-popover border border-edge bg-panel-light shadow-popover"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-edge px-4 py-3">
          <Icon name="layers" size={18} className="text-accent" />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-ink">What&rsquo;s new</h2>
            <p className="text-[11px] text-ink-faint">
              You are running Riser {APP_VERSION}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-control text-ink-faint transition-colors hover:bg-panel-lighter hover:text-ink"
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {failed && (
            <p className="py-6 text-center text-ink-faint">
              The changelog could not be loaded.
            </p>
          )}
          {!failed && !releases && (
            <p className="py-6 text-center text-ink-faint">Loading&hellip;</p>
          )}
          {releases?.map((release) => (
            <section key={release.version} className="mb-5 last:mb-1">
              <div className="mb-1.5 flex items-baseline gap-2">
                <h3 className="font-semibold text-ink">{release.version}</h3>
                {release.version === APP_VERSION && (
                  <span className="rounded-full bg-accent-soft px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-accent">
                    current
                  </span>
                )}
                {release.date && (
                  <span className="text-[11px] text-ink-faint">{release.date}</span>
                )}
              </div>
              <ul className="space-y-1">
                {release.items.map((item, index) => (
                  <li
                    key={index}
                    className="flex gap-2 leading-snug text-ink-dim"
                  >
                    <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                    <span className="rs-selectable">{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
