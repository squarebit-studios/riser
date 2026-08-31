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

/**
 * What a group of entries is: Added, Fixed, Changed and friends.
 *
 * Kept as a plain string rather than a union so an unrecognised heading still
 * renders, with the neutral pill, instead of being dropped. A changelog that
 * loses entries because someone invented a section is worse than one that
 * shows a label it has no colour for.
 */
export type ChangeKind = string;

export interface ChangeGroup {
  kind: ChangeKind;
  items: string[];
}

interface Release {
  version: string;
  date: string;
  groups: ChangeGroup[];
}

/**
 * Pill colours, matching the product changelogs on the store site so the two
 * read as the same thing: green for what is new, amber for what was broken,
 * blue for what moved.
 */
const KIND_STYLES: Record<string, string> = {
  Added: 'bg-emerald-500/15 text-emerald-400',
  Fixed: 'bg-amber-500/15 text-amber-400',
  Changed: 'bg-sky-500/15 text-sky-400',
  Removed: 'bg-rose-500/15 text-rose-400',
  Deprecated: 'bg-violet-500/15 text-violet-400',
  Security: 'bg-pink-500/15 text-pink-400'
};

const NEUTRAL_PILL = 'bg-panel-active text-ink-faint';

export function pillClassFor(kind: ChangeKind): string {
  return KIND_STYLES[kind] ?? NEUTRAL_PILL;
}

/**
 * The group an entry belongs to when the release has no `###` headings at all.
 *
 * Every release up to 0.8.4 was written as one flat list, and those entries are
 * still worth showing. They land here rather than being forced into a category
 * nobody chose for them.
 */
const UNLABELLED = 'Changes';

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
  let kind: ChangeKind = UNLABELLED;

  for (const raw of markdown.split('\n')) {
    const line = raw.trim();

    const heading = line.match(/^##\s+\[?v?([\d]+\.[\d]+\.[\d]+(?:-[\w.]+)?)\]?(?:\s*[-–]\s*(.+))?$/);
    if (heading) {
      if (current) releases.push(current);
      current = { version: heading[1]!, date: heading[2]?.trim() ?? '', groups: [] };
      // A new release starts unlabelled, so an old flat list still reads.
      kind = UNLABELLED;
      continue;
    }

    const section = line.match(/^###\s+(.+?)\s*$/);
    if (section) {
      kind = section[1]!;
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet && current) {
      const text = bullet[1]!.replace(/\*\*(.+?)\*\*/g, '$1');
      // Grouped as they arrive, so the order in the file is the order on
      // screen and a section repeated later merges rather than splitting.
      const group =
        current.groups.find((g) => g.kind === kind) ??
        (current.groups.push({ kind, items: [] }),
        current.groups[current.groups.length - 1]!);
      group.items.push(text);
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
              {release.groups.map((group) => (
                <div key={group.kind} className="mb-2.5 last:mb-0">
                  {/* The pill carries the category, so the entries below it do
                      not have to start with "Fixed:" to say what they are. */}
                  <span
                    data-testid={`change-kind-${group.kind}`}
                    className={`mb-1 inline-block rounded-full px-2 py-px text-[10px] font-semibold uppercase tracking-wide ${pillClassFor(
                      group.kind
                    )}`}
                  >
                    {group.kind}
                  </span>
                  <ul className="space-y-1">
                    {group.items.map((item, index) => (
                      <li
                        key={index}
                        className="flex gap-2 leading-snug text-ink-dim"
                      >
                        <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                        <span className="rs-selectable">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
