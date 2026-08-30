// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Generates the bundled blockout characters in public/assets.
//
// Run:  node tools/make-stock-assets.mjs
//
// These are deliberately real USD Mesh prims with explicit points and face
// indices, not USD's implicit Sphere/Capsule primitives. Two reasons:
//
//  1. Surface bindings name a TRIANGLE. An implicit primitive has no triangles
//     until a renderer tessellates it, and two renderers need not agree on how
//     - which would put the browser's face index and the server's on different
//     triangles.
//
//  2. Every face is a triangle (faceVertexCounts is all 3s), so the USD face
//     index and three.js's triangle index are the same number. That identity
//     is what lets the Python worker evaluate a binding the browser wrote
//     without a triangulation step that could reorder anything.
//
// Output is deterministic: same input, same bytes, so regenerating does not
// churn the repo.
// ==========================================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');

/** Decimal places in the emitted USDA. Sub-millimetre on a human. */
const PRECISION = 5;

const fmt = (n) => {
  const v = Math.abs(n) < 1e-9 ? 0 : n;
  const s = v.toFixed(PRECISION);
  return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
};

// -------------------------------------------------------------------------
// Geometry helpers
// -------------------------------------------------------------------------

function box(w, h, d, x, y, z, rotZ = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rotZ) g.rotateZ(rotZ);
  g.translate(x, y, z);
  return g;
}

function capsule(radius, length, x, y, z, rotZ = 0, rotX = 0) {
  // Low segment counts on purpose: a blockout wants readable form, not detail,
  // and a smaller mesh keeps the USDA file reviewable.
  const g = new THREE.CapsuleGeometry(radius, length, 4, 10);
  if (rotZ) g.rotateZ(rotZ);
  if (rotX) g.rotateX(rotX);
  g.translate(x, y, z);
  return g;
}

function sphere(radius, x, y, z, scaleY = 1) {
  const g = new THREE.SphereGeometry(radius, 14, 10);
  if (scaleY !== 1) g.scale(1, scaleY, 1);
  g.translate(x, y, z);
  return g;
}

/** Merge, weld and triangulate into a single indexed triangle mesh. */
function combine(parts) {
  const merged = mergeGeometries(parts.map((g) => g.toNonIndexed()), false);
  const indexed = toIndexed(merged);
  for (const part of parts) part.dispose();
  merged.dispose();

  assertNoDegenerateFaces(indexed);
  return indexed;
}

/**
 * Belt and braces: welding removes faces with repeated corners, but three
 * distinct vertices can still be collinear. Such a face would be picked up by
 * a raycast and then fail to produce a barycentric coordinate, which is a far
 * more confusing failure than a missing triangle.
 */
function assertNoDegenerateFaces(mesh) {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  let bad = 0;

  for (let t = 0; t < mesh.indices.length; t += 3) {
    a.fromArray(mesh.points[mesh.indices[t]]);
    b.fromArray(mesh.points[mesh.indices[t + 1]]);
    c.fromArray(mesh.points[mesh.indices[t + 2]]);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    if (ab.cross(ac).lengthSq() < 1e-20) bad++;
  }

  if (bad > 0) {
    throw new Error(`${bad} degenerate faces survived welding - asset is unusable`);
  }
}

/**
 * Weld identical positions into an index buffer, and DROP degenerate faces.
 *
 * The dropping is not tidiness. LatheGeometry - which CapsuleGeometry and the
 * sphere caps are built on - emits a full vertex grid including the pole row,
 * where consecutive vertices are the same point. Those faces have zero area,
 * which means no normal, no barycentric coordinate, and nothing for a marker
 * to bind to: a guide dropped on one would be unrecoverable by the server.
 * A raycast can never hit them either, so nothing is lost by removing them.
 */
function toIndexed(geometry) {
  const position = geometry.getAttribute('position');
  const map = new Map();
  const points = [];
  const indices = [];
  let dropped = 0;

  const vertexIndex = (i) => {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const key = `${fmt(x)},${fmt(y)},${fmt(z)}`;
    let index = map.get(key);
    if (index === undefined) {
      index = points.length;
      points.push([x, y, z]);
      map.set(key, index);
    }
    return index;
  };

  for (let i = 0; i < position.count; i += 3) {
    const a = vertexIndex(i);
    const b = vertexIndex(i + 1);
    const c = vertexIndex(i + 2);

    // After welding, a face whose corners are not three distinct vertices has
    // no area by construction.
    if (a === b || b === c || a === c) {
      dropped++;
      continue;
    }
    indices.push(a, b, c);
  }

  return { points, indices, dropped };
}

// -------------------------------------------------------------------------
// Characters
// -------------------------------------------------------------------------

/** A 1.75 m humanoid standing on y = 0, facing +Z. */
function bipedParts() {
  const body = [
    box(0.34, 0.26, 0.2, 0, 0.94, 0), // pelvis
    box(0.36, 0.46, 0.22, 0, 1.3, 0), // chest
    box(0.3, 0.14, 0.19, 0, 1.06, 0), // waist

    // Arms, slightly out from the body in a relaxed A-pose.
    capsule(0.055, 0.26, 0.24, 1.34, 0, 0.24),
    capsule(0.048, 0.24, 0.37, 1.08, 0, 0.2),
    box(0.09, 0.16, 0.04, 0.45, 0.88, 0),
    capsule(0.055, 0.26, -0.24, 1.34, 0, -0.24),
    capsule(0.048, 0.24, -0.37, 1.08, 0, -0.2),
    box(0.09, 0.16, 0.04, -0.45, 0.88, 0),

    // Legs.
    capsule(0.08, 0.34, 0.1, 0.68, 0),
    capsule(0.065, 0.32, 0.1, 0.26, 0),
    box(0.1, 0.07, 0.24, 0.1, 0.035, 0.05),
    capsule(0.08, 0.34, -0.1, 0.68, 0),
    capsule(0.065, 0.32, -0.1, 0.26, 0),
    box(0.1, 0.07, 0.24, -0.1, 0.035, 0.05)
  ];

  const head = [
    capsule(0.055, 0.06, 0, 1.58, 0), // neck
    sphere(0.105, 0, 1.71, 0.005, 1.15), // skull
    box(0.13, 0.09, 0.06, 0, 1.665, 0.09) // jaw / face plane
  ];

  return { body: combine(body), head: combine(head) };
}

/** A quadruped roughly the proportions of a large dog, facing +Z. */
function quadrupedParts() {
  const body = [
    box(0.26, 0.32, 0.86, 0, 0.66, 0), // barrel
    box(0.24, 0.26, 0.2, 0, 0.7, -0.5), // haunches

    // Front legs.
    capsule(0.045, 0.2, 0.11, 0.42, 0.32),
    capsule(0.038, 0.18, 0.11, 0.17, 0.32),
    box(0.08, 0.05, 0.14, 0.11, 0.025, 0.35),
    capsule(0.045, 0.2, -0.11, 0.42, 0.32),
    capsule(0.038, 0.18, -0.11, 0.17, 0.32),
    box(0.08, 0.05, 0.14, -0.11, 0.025, 0.35),

    // Back legs.
    capsule(0.052, 0.2, 0.11, 0.44, -0.42),
    capsule(0.04, 0.2, 0.11, 0.18, -0.36),
    box(0.08, 0.05, 0.15, 0.11, 0.025, -0.34),
    capsule(0.052, 0.2, -0.11, 0.44, -0.42),
    capsule(0.04, 0.2, -0.11, 0.18, -0.36),
    box(0.08, 0.05, 0.15, -0.11, 0.025, -0.34),

    // Tail.
    capsule(0.028, 0.26, 0, 0.74, -0.66, 0, Math.PI / 2.6)
  ];

  const head = [
    capsule(0.07, 0.22, 0, 0.82, 0.5, 0, Math.PI / 2.3), // neck
    box(0.15, 0.16, 0.22, 0, 0.94, 0.66), // skull
    box(0.1, 0.09, 0.16, 0, 0.9, 0.82), // muzzle
    box(0.05, 0.09, 0.02, 0.06, 1.04, 0.6), // ear
    box(0.05, 0.09, 0.02, -0.06, 1.04, 0.6)
  ];

  return { body: combine(body), head: combine(head) };
}

// -------------------------------------------------------------------------
// USDA emission
// -------------------------------------------------------------------------

function meshPrim(name, mesh, indent = '    ') {
  const inner = indent + '    ';
  const lines = [];

  lines.push(`${indent}def Mesh "${name}"`);
  lines.push(`${indent}{`);
  lines.push(`${inner}uniform token subdivisionScheme = "none"`);
  lines.push(`${inner}point3f[] points = ${wrap(
    mesh.points.map((p) => `(${fmt(p[0])}, ${fmt(p[1])}, ${fmt(p[2])})`),
    inner,
    4
  )}`);
  // Every face is a triangle - see the note at the top of this file.
  lines.push(`${inner}int[] faceVertexCounts = ${wrap(
    new Array(mesh.indices.length / 3).fill('3'),
    inner,
    24
  )}`);
  lines.push(`${inner}int[] faceVertexIndices = ${wrap(
    mesh.indices.map(String),
    inner,
    18
  )}`);
  lines.push(`${indent}}`);
  return lines.join('\n');
}

function wrap(items, indent, perLine) {
  if (items.length === 0) return '[]';
  if (items.length <= perLine) return `[${items.join(', ')}]`;
  const rows = [];
  for (let i = 0; i < items.length; i += perLine) {
    rows.push(indent + '    ' + items.slice(i, i + perLine).join(', '));
  }
  return `[\n${rows.join(',\n')}\n${indent}]`;
}

function writeCharacter(filename, label, parts) {
  const out = [];
  out.push('#usda 1.0');
  out.push('(');
  out.push('    defaultPrim = "Character"');
  out.push('    metersPerUnit = 1');
  out.push('    upAxis = "Y"');
  out.push(`    doc = "Riser stock asset: ${label}. Generated by tools/make-stock-assets.mjs - do not edit by hand."`);
  out.push(')');
  out.push('');
  out.push('def Xform "Character"');
  out.push('{');
  out.push('    def Scope "Geom"');
  out.push('    {');
  out.push(meshPrim('Body', parts.body, '        '));
  out.push(meshPrim('Head', parts.head, '        '));
  out.push('    }');
  out.push('}');

  const text = out.join('\n') + '\n';
  const path = join(OUT_DIR, filename);
  writeFileSync(path, text, 'utf8');

  const tris = parts.body.indices.length / 3 + parts.head.indices.length / 3;
  const verts = parts.body.points.length + parts.head.points.length;
  const dropped = parts.body.dropped + parts.head.dropped;
  console.log(
    `${filename.padEnd(28)} ${String(tris).padStart(6)} tris  ${String(verts).padStart(6)} verts  ` +
      `${String(dropped).padStart(4)} degenerate dropped  ${(text.length / 1024).toFixed(0)} KB`
  );
}

mkdirSync(OUT_DIR, { recursive: true });
writeCharacter('biped-blockout.usda', 'biped blockout', bipedParts());
writeCharacter('quadruped-blockout.usda', 'quadruped blockout', quadrupedParts());
