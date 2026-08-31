import { describe, it, expect } from 'vitest';
import { parseChangelog, pillClassFor } from './ChangelogDialog';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Every entry of a release, whatever section it came from. */
function allItems(release: { groups: { items: string[] }[] }): string[] {
  return release.groups.flatMap((group) => group.items);
}

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
      expect(allItems(release).length).toBeGreaterThan(0);
    }
  });

  it('puts the newest release first', () => {
    // Ordered against the versions in the file itself rather than a literal,
    // which would need editing on every release and would fail as a reminder
    // rather than as a finding.
    const markdown = readFileSync(join(process.cwd(), 'CHANGELOG.md'), 'utf8');
    const versions = parseChangelog(markdown).map((r) =>
      r.version.split('.').map(Number)
    );

    for (let i = 1; i < versions.length; i++) {
      const [aMajor, aMinor, aPatch] = versions[i - 1]! as [number, number, number];
      const [bMajor, bMinor, bPatch] = versions[i]! as [number, number, number];
      const newer =
        aMajor > bMajor ||
        (aMajor === bMajor && aMinor > bMinor) ||
        (aMajor === bMajor && aMinor === bMinor && aPatch > bPatch);
      expect(newer, `${versions[i - 1]!.join('.')} should precede ${versions[i]!.join('.')}`).toBe(
        true
      );
    }
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
      groups: [{ kind: 'Changes', items: ['Something'] }]
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

  it('groups bullets under the section heading above them', () => {
    const releases = parseChangelog(
      '## [1.0.0] - 2026-01-01\n### Added\n- One\n### Fixed\n- Two\n'
    );
    expect(releases[0]!.groups).toEqual([
      { kind: 'Added', items: ['One'] },
      { kind: 'Fixed', items: ['Two'] }
    ]);
  });

  it('merges a section that appears twice in one release', () => {
    const releases = parseChangelog(
      '## [1.0.0]\n### Added\n- One\n### Fixed\n- Two\n### Added\n- Three\n'
    );
    expect(releases[0]!.groups.map((g) => g.kind)).toEqual(['Added', 'Fixed']);
    expect(releases[0]!.groups[0]!.items).toEqual(['One', 'Three']);
  });

  it('keeps entries from a release with no sections at all', () => {
    // Every release up to 0.8.4 was one flat list. Those entries still have to
    // render, rather than being dropped for lacking a heading.
    const releases = parseChangelog('## [1.0.0]\n- One\n- Two\n');
    expect(releases[0]!.groups).toHaveLength(1);
    expect(releases[0]!.groups[0]!.items).toEqual(['One', 'Two']);
  });

  it('does not let one release inherit the last section of the one before', () => {
    const releases = parseChangelog(
      '## [2.0.0]\n### Fixed\n- Old bug\n\n## [1.0.0]\n- Something\n'
    );
    expect(releases[1]!.groups[0]!.kind).not.toBe('Fixed');
  });

  it('strips bold markers so the text reads plainly', () => {
    const releases = parseChangelog('## [1.0.0]\n- **Bold** and plain\n');
    expect(allItems(releases[0]!)[0]).toBe('Bold and plain');
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

describe('the change kind pills', () => {
  it('gives Added, Fixed and Changed each their own colour', () => {
    const added = pillClassFor('Added');
    const fixed = pillClassFor('Fixed');
    const changed = pillClassFor('Changed');
    expect(new Set([added, fixed, changed]).size).toBe(3);
  });

  it('falls back to a neutral pill rather than nothing', () => {
    // An unrecognised heading still has to render. Losing entries because
    // someone invented a section would be worse than showing a grey label.
    const unknown = pillClassFor('Reticulated');
    expect(unknown.length).toBeGreaterThan(0);
    expect(unknown).toBe(pillClassFor('Changes'));
  });

  it('labels the real CHANGELOG.md with kinds it has colours for', () => {
    const markdown = readFileSync(join(process.cwd(), 'CHANGELOG.md'), 'utf8');
    const kinds = new Set(
      parseChangelog(markdown).flatMap((r) => r.groups.map((g) => g.kind))
    );

    // The point of the exercise: the recent releases are categorised, so the
    // reader can tell a new feature from a repair at a glance.
    expect(kinds.has('Added')).toBe(true);
    expect(kinds.has('Fixed')).toBe(true);
    expect(kinds.has('Changed')).toBe(true);
  });
});
