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

// -------------------------------------------------------------------------
// Skeleton (UsdSkel)
// -------------------------------------------------------------------------

/**
 * A biped skeleton matching the blockout's proportions.
 *
 * Named to the convention Mixamo, Unreal and Rigify share, NOT to Riser's own
 * guide ids. The two deliberately differ: "shoulder" means the CLAVICLE in
 * every one of those rigs, while Riser's `shoulderL` guide is the upper-arm
 * joint. A stock asset that used our vocabulary would make the name matcher
 * look like it worked while never being tested against the collision that
 * actually breaks it.
 *
 * `path` is the UsdSkel joint path - the hierarchy lives in the STRING, not in
 * prim nesting, which is how UsdSkel encodes it. `head` is the joint's own
 * world position; `tail` is used only for skinning, so distance is measured to
 * the bone SEGMENT rather than to a point. Measuring to a point would give the
 * elbow authority over the whole forearm.
 */
const BIPED_JOINTS = [
  { path: 'Root', head: [0, 0, 0], tail: [0, 0.94, 0] },
  { path: 'Root/Hips', head: [0, 0.94, 0], tail: [0, 1.06, 0] },
  { path: 'Root/Hips/Spine', head: [0, 1.06, 0], tail: [0, 1.3, 0] },
  { path: 'Root/Hips/Spine/Chest', head: [0, 1.3, 0], tail: [0, 1.52, 0] },
  { path: 'Root/Hips/Spine/Chest/Neck', head: [0, 1.52, 0], tail: [0, 1.62, 0] },
  { path: 'Root/Hips/Spine/Chest/Neck/Head', head: [0, 1.62, 0], tail: [0, 1.82, 0] },

  { path: 'Root/Hips/Spine/Chest/UpperArmL', head: [0.14, 1.45, 0], tail: [0.24, 1.34, 0] },
  { path: 'Root/Hips/Spine/Chest/UpperArmL/LowerArmL', head: [0.31, 1.2, 0], tail: [0.37, 1.08, 0] },
  { path: 'Root/Hips/Spine/Chest/UpperArmL/LowerArmL/HandL', head: [0.43, 0.96, 0], tail: [0.47, 0.84, 0] },

  { path: 'Root/Hips/Spine/Chest/UpperArmR', head: [-0.14, 1.45, 0], tail: [-0.24, 1.34, 0] },
  { path: 'Root/Hips/Spine/Chest/UpperArmR/LowerArmR', head: [-0.31, 1.2, 0], tail: [-0.37, 1.08, 0] },
  { path: 'Root/Hips/Spine/Chest/UpperArmR/LowerArmR/HandR', head: [-0.43, 0.96, 0], tail: [-0.47, 0.84, 0] },

  { path: 'Root/Hips/ThighL', head: [0.1, 0.9, 0], tail: [0.1, 0.68, 0] },
  { path: 'Root/Hips/ThighL/CalfL', head: [0.1, 0.47, 0], tail: [0.1, 0.26, 0] },
  { path: 'Root/Hips/ThighL/CalfL/FootL', head: [0.1, 0.08, 0], tail: [0.1, 0.02, 0.12] },

  { path: 'Root/Hips/ThighR', head: [-0.1, 0.9, 0], tail: [-0.1, 0.68, 0] },
  { path: 'Root/Hips/ThighR/CalfR', head: [-0.1, 0.47, 0], tail: [-0.1, 0.26, 0] },
  { path: 'Root/Hips/ThighR/CalfR/FootR', head: [-0.1, 0.08, 0], tail: [-0.1, 0.02, 0.12] }
];

/** Joint influences per vertex. UsdSkel calls this elementSize. */
const INFLUENCES_PER_VERTEX = 4;

/**
 * A USD matrix literal for a pure translation.
 *
 * USD is row-vector: the translation lives in the LAST ROW, not the last
 * column. Writing it column-major would load without complaint and put every
 * bone in the wrong place.
 */
function translationMatrix(t) {
  return (
    '( (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 1, 0), (' +
    fmt(t[0]) + ', ' + fmt(t[1]) + ', ' + fmt(t[2]) + ', 1) )'
  );
}

function parentPathOf(path) {
  const at = path.lastIndexOf('/');
  return at === -1 ? null : path.slice(0, at);
}

/** Distance from a point to the segment head->tail. */
function distanceToBone(point, joint) {
  const ax = joint.head[0], ay = joint.head[1], az = joint.head[2];
  const bx = joint.tail[0], by = joint.tail[1], bz = joint.tail[2];
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const lengthSq = abx * abx + aby * aby + abz * abz;

  let t = 0;
  if (lengthSq > 1e-12) {
    t = ((point[0] - ax) * abx + (point[1] - ay) * aby + (point[2] - az) * abz) / lengthSq;
    t = Math.max(0, Math.min(1, t));
  }
  const dx = point[0] - (ax + abx * t);
  const dy = point[1] - (ay + aby * t);
  const dz = point[2] - (az + abz * t);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Skin a mesh to the skeleton by inverse-square distance to the nearest bones.
 *
 * Crude next to a real bind, and deliberately so: this exists to give the app a
 * skeleton to reason about - the nearest-joint hint, the UsdSkel load path -
 * not to deform well. What it must be is normalized. Weights that do not sum
 * to one shrink the mesh when posed, which reads as a bug in the loader rather
 * than in the asset.
 */
function skinMesh(points, joints) {
  const indices = [];
  const weights = [];

  for (const point of points) {
    const ranked = joints
      .map((joint, index) => ({ index: index, distance: distanceToBone(point, joint) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, INFLUENCES_PER_VERTEX);

    const raw = ranked.map((r) => 1 / Math.pow(Math.max(r.distance, 1e-3), 2));
    const total = raw.reduce((sum, w) => sum + w, 0) || 1;

    for (let i = 0; i < INFLUENCES_PER_VERTEX; i++) {
      indices.push(ranked[i] ? ranked[i].index : 0);
      weights.push(ranked[i] ? raw[i] / total : 0);
    }
  }
  return { indices: indices, weights: weights };
}

function skinnedMeshPrim(name, mesh, joints, indent) {
  const inner = indent + '    ';
  const skin = skinMesh(mesh.points, joints);
  const lines = [];

  lines.push(indent + 'def Mesh "' + name + '" (');
  lines.push(inner + 'prepend apiSchemas = ["SkelBindingAPI"]');
  lines.push(indent + ')');
  lines.push(indent + '{');
  lines.push(inner + 'uniform token subdivisionScheme = "none"');
  lines.push(inner + 'point3f[] points = ' + wrap(
    mesh.points.map((p) => '(' + fmt(p[0]) + ', ' + fmt(p[1]) + ', ' + fmt(p[2]) + ')'),
    inner, 4
  ));
  lines.push(inner + 'int[] faceVertexCounts = ' + wrap(
    new Array(mesh.indices.length / 3).fill('3'), inner, 24
  ));
  lines.push(inner + 'int[] faceVertexIndices = ' + wrap(
    mesh.indices.map(String), inner, 18
  ));
  lines.push('');
  lines.push(inner + 'rel skel:skeleton = </Character/Skel>');
  lines.push(inner + 'matrix4d primvars:skel:geomBindTransform = ' + translationMatrix([0, 0, 0]));
  lines.push(inner + 'int[] primvars:skel:jointIndices = ' + wrap(
    skin.indices.map(String), inner, 20
  ) + ' (');
  lines.push(inner + '    elementSize = ' + INFLUENCES_PER_VERTEX);
  lines.push(inner + '    interpolation = "vertex"');
  lines.push(inner + ')');
  lines.push(inner + 'float[] primvars:skel:jointWeights = ' + wrap(
    skin.weights.map((w) => fmt(w)), inner, 12
  ) + ' (');
  lines.push(inner + '    elementSize = ' + INFLUENCES_PER_VERTEX);
  lines.push(inner + '    interpolation = "vertex"');
  lines.push(inner + ')');
  lines.push(indent + '}');
  return lines.join('\n');
}

function writeRiggedCharacter(filename, label, parts, joints) {
  const byPath = new Map(joints.map((j) => [j.path, j]));

  // Rest transforms are LOCAL - each joint relative to its parent. Bind
  // transforms are WORLD. Getting these the same way round is the difference
  // between a skeleton that loads and one that folds in on itself.
  const restTransforms = joints.map((joint) => {
    const parent = parentPathOf(joint.path);
    const parentJoint = parent ? byPath.get(parent) : null;
    const origin = parentJoint ? parentJoint.head : [0, 0, 0];
    return translationMatrix([
      joint.head[0] - origin[0],
      joint.head[1] - origin[1],
      joint.head[2] - origin[2]
    ]);
  });

  const out = [];
  out.push('#usda 1.0');
  out.push('(');
  out.push('    defaultPrim = "Character"');
  out.push('    metersPerUnit = 1');
  out.push('    upAxis = "Y"');
  out.push('    doc = "Riser stock asset: ' + label +
    '. Generated by tools/make-stock-assets.mjs - do not edit by hand."');
  out.push(')');
  out.push('');
  out.push('def SkelRoot "Character"');
  out.push('{');
  out.push('    def Skeleton "Skel"');
  out.push('    {');
  out.push('        uniform token[] joints = ' + wrap(
    joints.map((j) => '"' + j.path + '"'), '        ', 3
  ));
  out.push('        uniform matrix4d[] bindTransforms = ' + wrap(
    joints.map((j) => translationMatrix(j.head)), '        ', 1
  ));
  out.push('        uniform matrix4d[] restTransforms = ' + wrap(
    restTransforms, '        ', 1
  ));
  out.push('    }');
  out.push('');
  out.push('    def Scope "Geom"');
  out.push('    {');
  out.push(skinnedMeshPrim('Body', parts.body, joints, '        '));
  out.push(skinnedMeshPrim('Head', parts.head, joints, '        '));
  out.push('    }');
  out.push('}');

  const text = out.join('\n') + '\n';
  writeFileSync(join(OUT_DIR, filename), text, 'utf8');

  const tris = parts.body.indices.length / 3 + parts.head.indices.length / 3;
  console.log(
    filename.padEnd(28) + ' ' + String(tris).padStart(6) + ' tris  ' +
    String(joints.length).padStart(3) + ' joints  ' +
    (text.length / 1024).toFixed(0) + ' KB'
  );
}

mkdirSync(OUT_DIR, { recursive: true });
writeCharacter('biped-blockout.usda', 'biped blockout', bipedParts());
writeCharacter('quadruped-blockout.usda', 'quadruped blockout', quadrupedParts());
writeRiggedCharacter('biped-rigged.usda', 'rigged biped', bipedParts(), BIPED_JOINTS);

