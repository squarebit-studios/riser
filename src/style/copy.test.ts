import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Copy style, enforced rather than remembered.
 *
 * The rule is about how the writing reads: an em-dash is almost always a
 * sentence that has not decided whether it wants a full stop, a colon or a
 * comma, and picking one makes the sentence say what it means.
 *
 * A test rather than a line in a review checklist, because this applies to
 * every changelog entry and every doc page anyone will ever add, and a rule
 * that depends on someone remembering it is a rule that decays.
 */

const ROOT = process.cwd();

/** Vendored code is copied verbatim from another repo. It is not our copy. */
const EXEMPT = ['src/vendor/', 'node_modules/', 'dist/', 'public/'];

const EM_DASH = '\u2014';

function walk(dir: string, extensions: string[], found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = toPosix(relative(ROOT, full));
    if (EXEMPT.some((skip) => rel.startsWith(skip))) continue;

    if (statSync(full).isDirectory()) {
      walk(full, extensions, found);
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      found.push(full);
    }
  }
  return found;
}

function toPosix(path: string): string {
  return path.split('\\').join('/');
}

/** Every offending line, named and quoted, so a failure is actionable. */
function offenders(files: string[]): string[] {
  const bad: string[] = [];
  for (const file of files) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        if (!line.includes(EM_DASH)) return;
        bad.push(`${toPosix(relative(ROOT, file))}:${index + 1}  ${line.trim().slice(0, 90)}`);
      });
  }
  return bad;
}

describe('copy style', () => {
  it('has no em-dashes in the changelog', () => {
    // Read inside the app, by users, from this exact file.
    expect(offenders([join(ROOT, 'CHANGELOG.md')])).toEqual([]);
  });

  it('has no em-dashes in the documentation', () => {
    // Same file, same reader: docs/ is served and rendered in the app.
    expect(offenders(walk(join(ROOT, 'docs'), ['.md']))).toEqual([]);
  });

  it('has no em-dashes in source', () => {
    // Interface strings and the comments around them. Vendored code is exempt
    // because editing it would turn re-copying a newer version into a merge
    // instead of an overwrite.
    expect(offenders(walk(join(ROOT, 'src'), ['.ts', '.tsx', '.css']))).toEqual([]);
  });

  it('has no em-dashes in the README', () => {
    expect(offenders([join(ROOT, 'README.md')])).toEqual([]);
  });
});
