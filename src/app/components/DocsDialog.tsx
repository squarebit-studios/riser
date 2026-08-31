// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The documentation, in the app.
//
// The docs were written as markdown in docs/ and, until now, could only be
// read by someone browsing the repository - which is nobody who needs them.
// Documentation a user cannot reach from the thing it documents is
// documentation that does not exist.
//
// Same arrangement as the changelog: the files in docs/ are the ones anybody
// edits, the build copies them into the site, and this fetches and renders
// them. There is no second copy to fall out of date.
//
// Rendering with `marked` rather than a hand-rolled parser. The changelog gets
// away with fifteen lines of regex because it is a flat list of bullets; these
// pages have tables, nested lists, images and cross-links, and a partial
// markdown renderer is a long tail of small wrongnesses.
// ==========================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import { Icon } from './ui/Icon';
import { SearchField } from './ui/Controls';

interface DocPage {
  /** File under docs/, without the extension. */
  slug: string;
  title: string;
  blurb: string;
}

/**
 * The pages, in reading order.
 *
 * Listed here rather than discovered, because a directory listing has no
 * opinion about what someone should read first - and "Getting started" being
 * first is most of the value of a contents page.
 */
const PAGES: readonly DocPage[] = [
  {
    slug: 'getting-started',
    title: 'Getting started',
    blurb: 'Load a character and place your first markers'
  },
  {
    slug: 'interface',
    title: 'The interface',
    blurb: 'Every panel, menu and control'
  },
  {
    slug: 'concepts',
    title: 'How it works',
    blurb: 'Bindings, provenance, smoothing and where documents live'
  },
  {
    slug: 'templates',
    title: 'Templates',
    blurb: 'What each template asks for, and where every guide goes'
  },
  { slug: 'keyboard', title: 'Keyboard', blurb: 'Shortcuts and mouse gestures' },
  { slug: 'faq', title: 'Questions', blurb: 'The things people ask' }
];

export function DocsDialog({
  onClose,
  initialSlug
}: {
  onClose: () => void;
  initialSlug?: string;
}): JSX.Element {
  const [slug, setSlug] = useState(initialSlug ?? PAGES[0]!.slug);
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setFailed(false);

    fetch(`/docs/${slug}.md`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.text();
      })
      .then((markdown) => {
        if (cancelled) return;
        // Images in the docs are written relative to docs/, which is also
        // where they are served from, so the only rewriting needed is to make
        // them absolute from the site root.
        const rewritten = markdown.replace(/\]\(images\//g, '](/docs/images/');
        setHtml(marked.parse(rewritten, { async: false }));
        bodyRef.current?.scrollTo({ top: 0 });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * Follow links between pages inside the dialog.
   *
   * The docs link to each other as `concepts.md#bindings`, which in a browser
   * would download a markdown file. Intercepting keeps the reader in the app;
   * anything external still opens in a new tab.
   */
  const onClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href');
    if (!href) return;

    const internal = href.match(/^([\w-]+)\.md(#.*)?$/);
    if (internal) {
      event.preventDefault();
      setSlug(internal[1]!);
      return;
    }
    if (/^https?:/.test(href)) {
      anchor!.setAttribute('target', '_blank');
      anchor!.setAttribute('rel', 'noreferrer');
    }
  }, []);

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return PAGES;
    return PAGES.filter(
      (page) =>
        page.title.toLowerCase().includes(query) ||
        page.blurb.toLowerCase().includes(query)
    );
  }, [search]);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/60 p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Riser documentation"
        data-testid="docs-dialog"
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-5xl animate-pop-in overflow-hidden rounded-popover border border-edge bg-panel-light shadow-popover"
      >
        {/* Contents ---------------------------------------------------- */}
        <nav className="flex w-60 shrink-0 flex-col border-r border-edge bg-panel">
          <div className="flex items-center gap-2 px-3 py-3">
            <Icon name="help" size={17} className="text-accent" />
            <h2 className="flex-1 font-semibold text-ink">Documentation</h2>
          </div>
          <div className="px-2.5 pb-2">
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder="Search pages"
              data-testid="docs-search"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
            {matches.map((page) => (
              <button
                key={page.slug}
                type="button"
                data-testid={`docs-page-${page.slug}`}
                onClick={() => setSlug(page.slug)}
                className={`mb-0.5 block w-full rounded-control px-2 py-1.5 text-left transition-colors ${
                  page.slug === slug
                    ? 'bg-accent-soft text-ink'
                    : 'text-ink-dim hover:bg-panel-lighter hover:text-ink'
                }`}
              >
                <span className="block truncate font-medium">{page.title}</span>
                <span className="block truncate text-[11px] text-ink-faint">
                  {page.blurb}
                </span>
              </button>
            ))}
            {matches.length === 0 && (
              <p className="px-2 py-4 text-center text-ink-faint">No page matches.</p>
            )}
          </div>
        </nav>

        {/* Page -------------------------------------------------------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-11 shrink-0 items-center gap-2 border-b border-edge px-4">
            <span className="flex-1 truncate font-medium text-ink">
              {PAGES.find((p) => p.slug === slug)?.title ?? 'Documentation'}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-control text-ink-faint transition-colors hover:bg-panel-lighter hover:text-ink"
            >
              <Icon name="close" size={16} />
            </button>
          </header>

          <div
            ref={bodyRef}
            onClick={onClick}
            className="rs-docs min-h-0 flex-1 overflow-y-auto px-6 py-5"
          >
            {failed && (
              <p className="py-10 text-center text-ink-faint">
                That page could not be loaded.
              </p>
            )}
            {!failed && html === null && (
              <p className="py-10 text-center text-ink-faint">Loading&hellip;</p>
            )}
            {html !== null && (
              // The content is our own documentation, built from files in this
              // repository - not user input, and not fetched from anywhere a
              // third party can write to.
              <div dangerouslySetInnerHTML={{ __html: html }} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export { PAGES as DOC_PAGES };
