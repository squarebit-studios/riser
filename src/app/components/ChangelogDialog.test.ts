import { describe, it, expect } from 'vitest';
import { parseChangelog } from './ChangelogDialog';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('reading the changelog', () => {
  it('parses the real CHANGELOG.md', () => {
    // Against the actual file, not a fixture. The parser exists to render that
    // one document, and a fixture would let the two drift - which is the whole
    // failure mode this feature is meant to avoid.
    const markdown = readFileSync(join(process.cwd(), 'CHANGELOG.md'), 'utf8');
    const releases = parseChangelog(markdown);

    expect(releases.length).toBeGreaterThanOrEqual(2);
    for (const release of releases) {
      expect(release.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(release.items.length).toBeGreaterThan(0);
    }
  });

  it('puts the newest release first', () => {
    const markdown = readFileSync(join(process.cwd(), 'CHANGELOG.md'), 'utf8');
    const [first] = parseChangelog(markdown);
    expect(first!.version).toBe('0.6.0');
  });

  it('matches the version the app reports', () => {
    // A changelog whose newest entry is not the running version is a changelog
    // someone forgot to write.
    const pkg = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf8')
    ) as { version: string };
    const markdown = readFileSync(join(process.cwd(), 'CHANGELOG.md'), 'utf8');
    expect(parseChangelog(markdown)[0]!.version).toBe(pkg.version);
  });

  it('reads a date when there is one', () => {
    const releases = parseChangelog('## [1.2.3] - 2026-01-02\n- Something\n');
    expect(releases[0]).toEqual({
      version: '1.2.3',
      date: '2026-01-02',
      items: ['Something']
    });
  });

  it('accepts the headings people actually write', () => {
    // Bracketed, bare, and v-prefixed all appear in the wild. Failing to
    // render because of a heading style would be a silly way to lose a page.
    for (const heading of ['## [1.0.0]', '## 1.0.0', '## v1.0.0']) {
      const releases = parseChangelog(`${heading}\n- One\n`);
      expect(releases, heading).toHaveLength(1);
      expect(releases[0]!.version).toBe('1.0.0');
    }
  });

  it('flattens section headings rather than dropping their bullets', () => {
    const releases = parseChangelog(
      '## [1.0.0] - 2026-01-01\n### Added\n- One\n### Fixed\n- Two\n'
    );
    expect(releases[0]!.items).toEqual(['One', 'Two']);
  });

  it('strips bold markers so the text reads plainly', () => {
    const releases = parseChangelog('## [1.0.0]\n- **Bold** and plain\n');
    expect(releases[0]!.items[0]).toBe('Bold and plain');
  });

  it('ignores prose outside a release', () => {
    const releases = parseChangelog('# Changelog\n\nSome preamble.\n\n## [1.0.0]\n- One\n');
    expect(releases).toHaveLength(1);
  });

  it('returns nothing for an empty document', () => {
    expect(parseChangelog('')).toEqual([]);
    expect(parseChangelog('# Changelog\n')).toEqual([]);
  });
});
