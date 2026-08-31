// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Publish the version and the changelog to the site.
//
// `package.json` is the single source of truth for the version, and
// `CHANGELOG.md` is the one file anybody edits. This copies both into
// `public/`, which Vite folds into the build, so the served copies cannot fall
// behind the sources.
//
// That is not hypothetical tidiness: `version.json` was maintained by hand
// beside `package.json` and had already drifted two releases - it said 0.4.1
// while the package said 0.5.0, and nothing read either of them.
//
// Runs before `dev` and before `build`, so the files exist in both.
// ==========================================================================

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const [major, minor, patch] = String(pkg.version).split('.');
const payload = {
  riser: {
    MAJOR: Number(major) || 0,
    MINOR: Number(minor) || 0,
    PATCH: Number(patch) || 0
  },
  version: pkg.version,
  builtAt: new Date().toISOString()
};

const text = JSON.stringify(payload, null, 2) + '\n';

// The repo root copy, which is the file that has always lived there.
writeFileSync(join(root, 'version.json'), text);

// And into public/, which Vite copies into the build. Generated rather than
// committed, so a deployed Riser can be asked what it is running - the one
// question that comes up on every bug report.
const publicDir = join(root, 'public');
mkdirSync(publicDir, { recursive: true });
writeFileSync(join(publicDir, 'version.json'), text);

// The changelog is served the same way and read by the in-app dialog, so
// nobody maintains a second list of what changed.
copyFileSync(join(root, 'CHANGELOG.md'), join(publicDir, 'CHANGELOG.md'));

console.log(`version.json + CHANGELOG.md -> ${pkg.version}`);
