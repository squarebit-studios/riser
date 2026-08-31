/* eslint-disable */
// ==========================================================================
// Squarebit Eye - Copyright (c) 2026 Squarebit LLC. All rights reserved.
// Proprietary and confidential.
//
// Licensed under the Squarebit Eye End User License Agreement:
//   https://www.squarebitstudios.com/squarebit-eye/eula
// Use, copying, modification and distribution are permitted only under the
// terms of that agreement; not for redistribution outside those terms.
//
// SPDX-License-Identifier: LicenseRef-SquarebitEye-EULA
// Source: Squarebit Eye, github.com/squarebit-studios/SquarebitEye
//
// VENDORED VERBATIM from the Squarebit Eye repo (web/src/eye-geometry.js) —
// the SAME module a client integrates, with no store-only changes. Do not
// edit here; re-copy from that repo, which carries this header at source.
// ==========================================================================

// Canonical single-mesh eyeball for three.js — the same construction as the
// Maya generator (squarebit_eye.tool.create_eye_mesh): scleral sphere blended
// onto the corneal sphere, front = +Z, slight scleral sulcus at the limbus.
// Takes THREE as a parameter (this module never imports three).

// Quad-sphere base mesh for SHADER-DISPLACEMENT eyes (SPEC 6b): a subdivided
// cube projected onto the unit sphere, every vertex WELDED via exact integer
// cube-lattice keys — no pole fans and no duplicated wrap column, so
// averaged/analytic normals are continuous everywhere. Returns the surface
// geometry plus a QUAD-EDGE wireframe geometry (no triangle diagonals) that
// SHARES the position attribute. Normals are analytic (unit sphere); UVs are
// spherical (the u wrap crosses one thin quad column on the -X meridian —
// with a welded mesh that column blends the texture edges; the sclera map is
// low-contrast so it reads clean).
export function makeQuadSphereGeometry(THREE, { segments = 40 } = {}) {
  const n = segments;
  const pos = [];
  const uv = [];
  const idx = [];
  const verts = new Map();
  const vertex = (ix, iy, iz) => {
    const k = ix + ',' + iy + ',' + iz;
    let id = verts.get(k);
    if (id !== undefined) return id;
    let x = ix / n;
    let y = iy / n;
    let z = iz / n;
    const len = Math.hypot(x, y, z);
    x /= len; y /= len; z /= len;              // spherify (unit radius)
    id = pos.length / 3;
    pos.push(x, y, z);
    uv.push(0.5 + Math.atan2(y, x) / (2 * Math.PI),
            0.5 + Math.asin(Math.min(1, Math.max(-1, z))) / Math.PI);
    verts.set(k, id);
    return id;
  };
  const FACES = [
    { N: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { N: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
    { N: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { N: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { N: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { N: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  ];
  const wireSet = new Set();
  const wire = [];
  const edge = (a, b) => {
    const k = Math.min(a, b) + '_' + Math.max(a, b);
    if (!wireSet.has(k)) { wireSet.add(k); wire.push(a, b); }
  };
  for (const f of FACES) {
    const at = (i, j) => vertex(
      f.N[0] * n + f.u[0] * (2 * i - n) + f.v[0] * (2 * j - n),
      f.N[1] * n + f.u[1] * (2 * i - n) + f.v[1] * (2 * j - n),
      f.N[2] * n + f.u[2] * (2 * i - n) + f.v[2] * (2 * j - n));
    for (let i = 0; i < n; ++i)
      for (let j = 0; j < n; ++j) {
        const a = at(i, j), b = at(i + 1, j),
              c = at(i + 1, j + 1), d = at(i, j + 1);
        idx.push(a, b, c, a, c, d);
        edge(a, b); edge(a, d);
        if (i === n - 1) edge(b, c);
        if (j === n - 1) edge(d, c);
      }
  }
  const positions = new THREE.BufferAttribute(new Float32Array(pos), 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', positions);
  // unit sphere: the analytic normal IS the position (displacement hosts
  // recompute shading via the virtual cornea, so this stays correct)
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  geometry.setIndex(idx);
  const wireGeometry = new THREE.BufferGeometry();
  wireGeometry.setAttribute('position', positions);   // shared
  wireGeometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  wireGeometry.setIndex(wire);
  return { geometry, wireGeometry };
}

export function makeEyeballGeometry(THREE, {
  radius = 1.0,
  corneaApex = 1.05,
  corneaRadius = 0.65,
  limbusRadius = 0.4875,
  blendAngle = 0.12,
  widthSegments = 96,
  heightSegments = 64,
  irisWidth = 1.0,     // SPEC 4.4: bulge boundary follows the
  irisHeight = 1.0,    //   elliptical limbus
  bulgeWeight = 1.0,   // SPEC 6b: cornea bulge dial (0 = sphere)
} = {}) {
  const geo = new THREE.SphereGeometry(radius, widthSegments, heightSegments);
  const centerZ = corneaApex - corneaRadius;
  const la = Math.max(limbusRadius * irisWidth, 1e-4);
  const lb = Math.max(limbusRadius * irisHeight, 1e-4);
  const smooth = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; ++i) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const len = Math.hypot(x, y, z);
    if (len < 1e-9) continue;
    const dz = z / len;
    const theta = Math.acos(Math.min(1, Math.max(-1, dz)));
    const rxy = Math.hypot(x, y);
    let leff = limbusRadius;   // on-axis: fully inside the iris
    if (rxy > 1e-9) {
      const ct = x / rxy, st = y / rxy;
      leff = la * lb /
             Math.sqrt(Math.max(lb * lb * ct * ct + la * la * st * st, 1e-9));
    }
    const thetaLimbus = Math.asin(Math.min(1, leff));
    const w = smooth(thetaLimbus + blendAngle, thetaLimbus - blendAngle, theta);
    if (w <= 0) continue;
    const disc = centerZ * centerZ * dz * dz +
                 corneaRadius * corneaRadius - centerZ * centerZ;
    const t = centerZ * dz + Math.sqrt(Math.max(0, disc));
    const s = (radius * (1 + (t - 1) * w * bulgeWeight)) / len;
    pos.setXYZ(i, x * s, y * s, z * s);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}
