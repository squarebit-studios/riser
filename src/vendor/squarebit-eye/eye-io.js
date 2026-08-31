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
// VENDORED from the Squarebit Eye repo (web/src/eye-io.js), and NOT a
// byte-for-byte copy: this store copy adds the widget-snapshot carrier the
// product page needs — the optional `settings` blob on buildLookDoc/toUsd and
// the `usdToDoc` parse that returns the raw doc (upstream's fromUsd goes
// straight to params). Those blocks are marked "STORE-ONLY" below; everything
// else is upstream verbatim, including the canonical LOOK_SCALARS set and its
// defaults, which are the numbers every DCC ships. Re-vendor by re-copying the
// repo file and re-applying the STORE-ONLY blocks (and this note).
// ==========================================================================

// ============================================================================
// web/src/eye-io.js — export/import Squarebit Eye LOOK SETTINGS to the interop
// carriers: JSON (params.py-compatible, SPEC §7) and USD (.usda, INTEROP §2).
//
// Canonical names are the SPEC / params.py look keys, so a look exported here
// re-imports in Maya/Blender via params.import_params. Note the ONE name the
// web shader spells differently: the §6b bulge dial is `displacementWeight`
// inside the widget but the canonical/JSON name is `corneaBulge` — the mapping
// lives here (LOOK_SCALARS: canonical name + widget slider id).
//
// Pure — no DOM, no three.js — so it runs under Node for tests. The one
// browser-only helper (readWidgetParams) is isolated at the bottom.
// ============================================================================

export const SPEC_ID = 'squarebit-eye/2';

// canonical look scalar -> [name, default, widgetSliderId|null].
// id null = the widget hardcodes this to its default (not slider-exposed);
// export still emits the full canonical set so DCC imports get everything.
// Names + set == params.py DOMAINS; defaults == eye-material.js makeEyeUniforms
// _params (the test cross-checks both). Emit order == usd_look.py LOOK_SCALARS
// so Maya/web .usda output matches byte-for-byte.
// Every default below is the SAME number the shipped shaders carry
// (tools/gen_materialx.py SCALARS / COMPOSE_IN). They are what an imported
// look file falls back to for any key it omits, so a drift here silently
// rewrites a customer's look on round-trip.
export const LOOK_SCALARS = [
  ['ior', 1.376, 'ior'],
  ['limbusRadius', 0.4875, null],
  ['limbusWidth', 0.04, null],
  ['limbusDarkening', 0.6, null],
  ['irisPlaneZ', 0.75, null],
  ['corneaRadius', 0.65, null],
  ['corneaApexZ', 1.05, null],
  ['corneaBulge', 1.0, 'bulge'],       // widget/shader name: displacementWeight
  ['refPupilRadius', 0.1667, null],
  ['irisHeightScale', 0.04, null],
  ['causticStrength', 0.5, 'caustic'],
  ['causticExponent', 2.0, null],
  ['causticShadowStrength', 0.35, null],
  ['irisWidth', 1.0, 'iw'],
  ['irisHeight', 1.0, 'ih'],
  ['pupilWidth', 1.0, 'pw'],
  ['pupilHeight', 1.0, 'ph'],
  ['pupilOffsetX', 0.0, 'pox'],
  ['pupilOffsetY', 0.0, 'poy'],
  ['pupilSquareness', 0.0, 'psq'],     // §4.6 pupil shape
  ['pupilNoiseAmount', 0.0, 'pna'],
  ['pupilNoiseFreq', 8.0, 'pnf'],
  ['pupilNoiseSeed', 0.0, 'pns'],
  ['pupilNoiseType', 0.0, null],
  ['pupilBlend', 0.08, 'pblend'],      // §4.6 soft pupil edge
  ['pupilBlendExp', 1.5, 'pbexp'],
  ['pupilBleedAmount', 0.2, 'pba'],    // §4.7 pupil light bleed
  ['pupilBleedWidth', 1.0, 'pbw'],
  ['pupilBleedExponent', 2.0, 'pbe'],
  ['pupilBleedLight', 1.0, 'pbl'],     // §4.7b light-reactive bleed
  ['pupilBleedSaturation', 0.5, null],
  ['limbusNoiseAmount', 0.0, null],    // §4.8 limbal ring breakup
  ['limbusNoiseFreq', 8.0, null],
  ['limbusNoiseSeed', 0.0, null],
  ['limbusLightResponse', 0.6, null],  // §4.8b light-dependent limbus
  ['scleraEmissive', 0.0, null],
  ['specPlaceX', 0.0, 'spx'],
  ['specPlaceY', 0.0, 'spy'],
  ['specPlaceSize', 0.08, 'sps'],
  ['specPlaceIntensity', 0.0, 'spi'],
  // §4.5b highlight form. Emitted AFTER the original four so the .usda
  // token order stays byte-identical with usd_look.py's LOOK_SCALARS.
  ['specPlaceSides', 0.0, null],
  ['specPlaceRoundness', 0.0, null],
  ['specPlaceWide', 1.0, null],
  ['specPlaceTall', 1.0, null],
  ['specPlaceRotate', 0.0, null],
  ['specPlaceCore', 0.35, null],
  ['specPlaceFalloff', 1.0, null],
];
export const MODES = ['MESH_NORMAL', 'VIRTUAL_CORNEA'];
export const DEFAULT_COLORS = {
  pupilColor: [0.02, 0.02, 0.02],
  scleraColor: [0.93, 0.91, 0.88],
  // white = the untinted highlight the scalar mask produced on its own
  specPlaceColor: [1, 1, 1],
};

// IMPORT-ONLY compatibility with look files written by older versions:
// old look key -> canonical key. Export never emits the old names.
export const LEGACY_ALIASES = {
  pupilBleed: 'pupilBleedAmount',      // pre-§4.7 name of the bleed strength
};
// Legacy look keys with no modern equivalent — silently dropped on import.
// pupilBleedColor: the §4.7 veil is colored from the light in-shader now.
export const LEGACY_IGNORED = ['pupilBleedColor'];

const round6 = (n) => Math.round(Number(n) * 1e6) / 1e6;

// --------------------------------------------------------------------------
// Canonical doc (the shared data model) from a flat canonical params object.
// --------------------------------------------------------------------------
/**
 * Build the canonical look doc.
 *
 * STORE-ONLY second argument: `settings` is the full widget snapshot
 * ({ params, tex, colors }) carried ALONGSIDE the canonical `look`, so an
 * exported file round-trips every slider + colour back into the widget. The
 * DCC-interop `look` stays exactly what upstream emits — a subset — and a
 * host that does not know `settings` simply ignores it.
 *
 * @param {Object} [params]
 * @param {?Object} [settings]
 */
export function buildLookDoc(params = {}, settings = null) {
  // Accept the web/three.js-native `displacementWeight` as an alias for the
  // canonical `corneaBulge` (the one name the shader spells differently).
  if (params.corneaBulge == null && params.displacementWeight != null) {
    params = { ...params, corneaBulge: params.displacementWeight };
  }
  const look = {};
  for (const [name, def] of LOOK_SCALARS) {
    const v = name in params && params[name] != null ? params[name] : def;
    look[name] = round6(v);
  }
  const mode = params.refractionMode ?? 0;
  look.refractionMode = MODES[mode] ?? MODES[0];
  look.pupilColor = (params.pupilColor ?? DEFAULT_COLORS.pupilColor).map(round6);
  look.scleraColor =
    (params.scleraColor ?? DEFAULT_COLORS.scleraColor).map(round6);
  look.specPlaceColor =
    (params.specPlaceColor ?? DEFAULT_COLORS.specPlaceColor).map(round6);

  const pupilR = round6(params.pupilRadius ?? 0.1667);
  const doc = {
    spec: SPEC_ID,
    look,
    textures: {
      iris: params.irisTexture ?? null,
      sclera: params.scleraTexture ?? null,
    },
    eyes: { L: { pupilRadius: pupilR }, R: { pupilRadius: pupilR } },
  };
  if (settings) doc.settings = settings;   // STORE-ONLY widget snapshot
  return doc;
}

// --------------------------------------------------------------------------
// JSON carrier (params.py-compatible)
// --------------------------------------------------------------------------
export function toJson(doc) {
  return JSON.stringify(doc, null, 2);
}

export function fromJson(text) {
  const doc = typeof text === 'string' ? JSON.parse(text) : text;
  return docToParams(doc);
}

// --------------------------------------------------------------------------
// USD carrier (.usda) — the projector Xform with namespaced custom attrs
// (INTEROP §2). Plain custom attrs; a codeless schema can come later.
// --------------------------------------------------------------------------
const usdStr = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
const usdNum = (n) => {
  const v = round6(n);
  return Number.isInteger(v) ? `${v}` : `${v}`;
};
const usdVec = (a) => `(${a.map(usdNum).join(', ')})`;

export function toUsd(doc) {
  const L = doc.look;
  const out = [
    '#usda 1.0',
    '(',
    '    defaultPrim = "SquarebitEye"',
    '    metersPerUnit = 1',
    '    upAxis = "Y"',
    ')',
    '',
    'def Xform "SquarebitEye" (',
    '    kind = "component"',
    ')',
    '{',
    `    custom string squarebitEye:spec = ${usdStr(doc.spec)}`,
  ];
  // STORE-ONLY: the widget snapshot, as one escaped JSON string attribute.
  if (doc.settings) {
    out.push(
      `    custom string squarebitEye:settings = ${usdStr(JSON.stringify(doc.settings))}`
    );
  }
  for (const [name] of LOOK_SCALARS) {
    out.push(`    custom float squarebitEye:${name} = ${usdNum(L[name])}`);
  }
  out.push(`    custom token squarebitEye:refractionMode = ${usdStr(L.refractionMode)}`);
  out.push(`    custom color3f squarebitEye:pupilColor = ${usdVec(L.pupilColor)}`);
  out.push(`    custom color3f squarebitEye:scleraColor = ${usdVec(L.scleraColor)}`);
  out.push(`    custom color3f squarebitEye:specPlaceColor = ${usdVec(L.specPlaceColor)}`);
  out.push(`    custom float squarebitEye:pupilRadius = ${usdNum(doc.eyes.L.pupilRadius)}`);
  if (doc.textures.iris) {
    out.push(`    custom asset squarebitEye:irisTexture = @${doc.textures.iris}@`);
  }
  if (doc.textures.sclera) {
    out.push(`    custom asset squarebitEye:scleraTexture = @${doc.textures.sclera}@`);
  }
  out.push('}', '');
  return out.join('\n');
}

/** STORE-ONLY: parse a .usda look into the canonical DOC (not params), so the
 *  widget can see the `settings` snapshot alongside `look`. Upstream's
 *  fromUsd is preserved below and is now this + docToParams. */
export function usdToDoc(text) {
  const look = {};
  const colors = {};
  let spec = SPEC_ID;
  let pupilRadius = 0.1667;
  let settings = null;   // STORE-ONLY
  const re = /squarebitEye:(\w+)\s*=\s*(.+)$/;
  for (const raw of String(text).split('\n')) {
    const m = raw.match(re);
    if (!m) continue;
    const [, name, rhsRaw] = m;
    const rhs = rhsRaw.trim();
    if (name === 'spec') { spec = rhs.replace(/^"|"$/g, ''); continue; }
    if (LEGACY_IGNORED.includes(name)) continue;  // e.g. pupilBleedColor
    if (name === 'settings') {   // STORE-ONLY widget snapshot
      try { settings = JSON.parse(rhs.replace(/^"|"$/g, '').replace(/\\"/g, '"')); }
      catch { settings = null; }
      continue;
    }
    if (name === 'refractionMode') { look.refractionMode = rhs.replace(/^"|"$/g, ''); continue; }
    if (name === 'pupilColor' || name === 'scleraColor' ||
        name === 'specPlaceColor') {
      colors[name] = rhs.replace(/[()]/g, '').split(',').map((s) => parseFloat(s));
      continue;
    }
    if (name === 'pupilRadius') { pupilRadius = parseFloat(rhs); continue; }
    if (name === 'irisTexture' || name === 'scleraTexture') {
      look[name] = rhs.replace(/^@|@$/g, ''); continue;
    }
    look[name] = parseFloat(rhs);
  }
  const doc = { spec, look, textures: {}, eyes: { L: { pupilRadius } } };
  doc.look.pupilColor = colors.pupilColor;
  doc.look.scleraColor = colors.scleraColor;
  doc.look.specPlaceColor = colors.specPlaceColor;
  if (settings) doc.settings = settings;   // STORE-ONLY
  return doc;
}

export function fromUsd(text) {
  return docToParams(usdToDoc(text));
}

// --------------------------------------------------------------------------
// Canonical doc -> flat params object (the form the widget/importers apply).
// refractionMode string -> int; corneaBulge stays canonical. Old look files
// are accepted via LEGACY_ALIASES (old key -> canonical); keys with no modern
// equivalent (LEGACY_IGNORED) are dropped silently. Output keys are ALWAYS
// canonical.
// --------------------------------------------------------------------------
export function docToParams(doc) {
  const look = { ...(doc.look || {}) };
  for (const [oldKey, newKey] of Object.entries(LEGACY_ALIASES)) {
    if (look[oldKey] != null && look[newKey] == null) look[newKey] = look[oldKey];
  }
  const p = {};
  for (const [name, def] of LOOK_SCALARS) {
    p[name] = name in look && look[name] != null ? Number(look[name]) : def;
  }
  // expose the web/three.js-native alias too, so the three.js widget can apply it
  p.displacementWeight = p.corneaBulge;
  const mode = look.refractionMode;
  p.refractionMode = typeof mode === 'string' ? Math.max(0, MODES.indexOf(mode)) : (mode ?? 0);
  if (look.pupilColor) p.pupilColor = look.pupilColor.map(Number);
  if (look.scleraColor) p.scleraColor = look.scleraColor.map(Number);
  if (look.specPlaceColor) p.specPlaceColor = look.specPlaceColor.map(Number);
  const eye = (doc.eyes && (doc.eyes.L || doc.eyes.R)) || {};
  if (eye.pupilRadius != null) p.pupilRadius = Number(eye.pupilRadius);
  return p;
}

// --------------------------------------------------------------------------
// Browser-only: read the widget's current look into a canonical params object.
// Maps each canonical scalar's widget slider id; falls back to the default when
// the widget doesn't expose it. (Kept out of the pure path above.)
// --------------------------------------------------------------------------
export function readWidgetParams(doc) {
  const numById = (id) => {
    const el = doc.getElementById(id);
    return el ? parseFloat(el.value) : undefined;
  };
  const p = {};
  for (const [name, def, id] of LOOK_SCALARS) {
    const v = id ? numById(id) : undefined;
    p[name] = v == null || Number.isNaN(v) ? def : v;
  }
  const modeEl = doc.getElementById('mode');
  p.refractionMode = modeEl ? parseInt(modeEl.value, 10) : 0;
  const pupil = numById('pupil');
  if (pupil != null && !Number.isNaN(pupil)) p.pupilRadius = pupil;
  return p;
}

// Browser-only: apply a canonical params object (from fromJson/fromUsd) back to
// the widget's sliders, firing 'input'/'change' so the harness re-renders.
// Inverse of readWidgetParams. Only params the widget exposes are applied.
export function applyWidgetParams(params, doc) {
  const setById = (id, value, event) => {
    const el = doc.getElementById(id);
    if (!el || value == null || Number.isNaN(Number(value))) return;
    el.value = String(value);
    el.dispatchEvent(new Event(event, { bubbles: true }));
  };
  for (const [name, , id] of LOOK_SCALARS) {
    if (id && name in params) setById(id, params[name], 'input');
  }
  if (params.refractionMode != null) setById('mode', params.refractionMode, 'change');
  if (params.pupilRadius != null) setById('pupil', params.pupilRadius, 'input');
}

// Parse a look file's text (JSON or .usda) -> canonical params. Dispatches by
// content so callers don't need the extension.
export function parseLookFile(text) {
  return String(text).trimStart().startsWith('#usda')
    ? fromUsd(text)
    : fromJson(text);
}
