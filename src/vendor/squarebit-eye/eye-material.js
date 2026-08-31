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
// VENDORED from the Squarebit Eye repo (web/src/eye-material.js), and NOT a
// byte-for-byte copy: this store copy also carries the §4.9f iris-diffuse-
// flatten control, which exists only in the web widget (no DCC counterpart)
// and is marked "STORE-ONLY" below. Everything else is upstream verbatim.
// Re-vendor by re-copying the repo file and re-applying the STORE-ONLY blocks
// (and this note); never fix an upstream bug here only.
// ==========================================================================

// squarebit-eye three.js integration (PLAN Phase 4, SPEC docs/SPEC.md).
//
// Patches a THREE.MeshPhysicalMaterial via onBeforeCompile so the material's
// base color is the projected iris/sclera composite from core/eye_core.glsl
// (fetched verbatim) — the physical material's own clearcoat/specular is the
// tear film (SPEC §3.10: the host BSDF composes). No `import three` anywhere:
// every function operates on caller-supplied objects, so this module has no
// version coupling.
//
// Usage (see web/demo.html):
//   const core = await loadEyeCore('../core/eye_core.glsl');
//   const eye = makeEyeUniforms({ irisMap, scleraMap });
//   applyEyeShader(material, core, eye);          // material: MeshPhysicalMaterial
//   ...per frame:
//   updateProjector(eye, projectorObject3D, { pupilRadius, lodBlend });
//   updateLightDir(eye, directionalLight);
//
// Animation-channel tier (what a rig keys per frame): pupilRadius, lodBlend,
// irisWidth, irisHeight, pupilWidth, pupilHeight, pupilOffsetX, pupilOffsetY —
// all accepted by updateProjector's opts. Everything else is look/lighting
// tuning via updateEyeParams.

/** Fetch + prep the core for GLSL ES 3.00 (strip desktop float suffixes). */
export async function loadEyeCore(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`loadEyeCore: HTTP ${resp.status} for ${url}`);
  return (await resp.text()).replace(/([0-9])f\b/g, '$1');
}

/** Fetch the SINGLE-SOURCE sclera SSS defaults (materialx/sss_defaults.json,
 *  emitted by tools/gen_sss_defaults.py from gen_materialx's SCALARS
 *  ScleraSssWeight + SCLERA_SSS_COLOR). Pass the result into makeEyeUniforms
 *  ({ sss }) so the realtime warm-sclera fill traces to the SAME numbers as
 *  Maya VP2 / Unreal / Storm — never a hand-tuned per-host magic value. */
export async function loadSssDefaults(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`loadSssDefaults: HTTP ${resp.status} for ${url}`);
  }
  const d = await resp.json();
  return { weight: d.weight, color: d.color };  // radius is offline-only
}

/** SPEC §4 defaults + derived values (§2, CPU-side — conformant here).
 *
 *  These ARE the shipped defaults of every other host (tools/gen_materialx.py
 *  SCALARS / COMPOSE_IN, gated by tools/defaults_check.py). Keep them in step:
 *  the store's product-page widget vendors this file, so a number that drifts
 *  here makes the advertised eye differ from the one the customer renders.
 *
 *  The two EXCEPTIONS are deliberate and are not look defaults at all:
 *  displacementWeight and refractionMode default to 0 because they describe
 *  what the CALLER's geometry is doing. This module cannot know whether the
 *  host applied the vertex-stage cornea bulge; an app that passes
 *  { displace: true } to applyEyeShader must also pass displacementWeight 1 +
 *  refractionMode 1 (web/demo.html and the store widget both do). Defaulting
 *  them ON would make an undisplaced sphere refract against a cornea that
 *  isn't there. */
export function makeEyeUniforms(opts = {}) {
  const p = {
    ior: 1.376, limbusRadius: 0.4875, limbusWidth: 0.04, limbusDarkening: 0.6,
    limbusNoiseAmount: 0, limbusNoiseFreq: 8, limbusNoiseSeed: 0,   // §4.8
    limbusLightResponse: 0.6,                                      // §4.8b
    irisPlaneZ: 0.75, corneaRadius: 0.65, corneaApexZ: 1.05,
    refPupilRadius: 0.1667, irisHeightScale: 0.04,
    causticStrength: 0.5, causticExponent: 2.0, causticShadowStrength: 0.35,
    refractionMode: 0, pupilColor: [0.02, 0.02, 0.02],   // see note above
    scleraColor: [0.93, 0.91, 0.88], displacementWeight: 0,
    irisWidth: 1, irisHeight: 1, pupilWidth: 1, pupilHeight: 1,  // §4.4
    pupilOffsetX: 0, pupilOffsetY: 0,
    pupilSquareness: 0, pupilNoiseAmount: 0,                     // §4.6
    pupilNoiseFreq: 8, pupilNoiseSeed: 0, pupilNoiseType: 0,
    pupilBlend: 0.08, pupilBlendExp: 1.5,                        // §4.6 soft edge
    // NOT SCALARS. gen_materialx.SCALARS says PupilBlend 0.18 / Exp 1.4 and
    // IrisHeightScale 0.0; the web/widget look ships 0.08 / 1.5 / 0.04 and
    // docs/SPEC.md §4 documented 0.04 for the height scale too. Held at the
    // web values pending Walt's call: with the §4.7 bleed now ON, a 0.18 edge
    // feather smears the pupil into a milky grey disc at the widget's pupil
    // radius (verified in the browser), and 0.0 flattens the iris parallax.
    // Whichever way it goes, it must move in SCALARS first, not here.
    pupilBleedAmount: 0.2, pupilBleedWidth: 1.0,                // §4.7 ON
    pupilBleedExponent: 2, pupilBleedLight: 1,
    pupilBleedSaturation: 0.5,
    irisDepthAO: 0, scleraGlow: 0, scleraScatter: 0, socketAO: 0, // §4.9
    irisDiffuseFlatten: 0,                       // §4.9f STORE-ONLY (web-only)
    // §7 surface response. Same six numbers as every other host
    // (gen_materialx.SCALARS). applyEyeShader drives the MeshPhysicalMaterial's
    // REAL clearcoat from them — three has a layered BSDF, so the eye keeps its
    // coat here and only the parameters feeding it were brought in line.
    coatWeight: 1.0, coatRoughness: 0.02, coatIor: 1.376,
    irisRoughness: 0.6, scleraRoughness: 0.3, scleraFilmRoughness: 0.08,
    specPlaceX: 0, specPlaceY: 0, specPlaceSize: 0.08,           // §4.5
    scleraEmissive: 0,
    specPlaceIntensity: 0,
    // §4.5b highlight FORM. sides names one of three shapes, snapped to a
    // whole number: 0 = circle, 3 = triangle, 4 = square. wide/tall scale
    // the shape along its own axes (square -> rectangle, triangle -> base
    // and height, circle -> ellipse) and turn with specPlaceRotate.
    // specPlaceCore is the sharp-to-soft dial (where the gradient starts).
    specPlaceSides: 0, specPlaceRoundness: 0,
    specPlaceWide: 1, specPlaceTall: 1, specPlaceRotate: 0,
    specPlaceCore: 0.35, specPlaceFalloff: 1,
    specPlaceColor: [1, 1, 1],
    ...opts.params,
  };
  // SINGLE-SOURCE sclera SSS (realtime wrap): weight + warm tint from
  // materialx/sss_defaults.json via loadSssDefaults(); when absent it is
  // neutral (weight 0 = off). No per-host magic numbers here.
  const sssW = opts.sss?.weight ?? 0;
  const sssC = opts.sss?.color ?? [0, 0, 0];
  return {
    // internal parameter block (rebuilt by updateEyeParams)
    _params: p,
    sbeW2P: { value: [1, 0, 0, 0, 1, 0, 0, 0, 1] }, // rows X/Y/Z, scale baked
    sbeOrigin: { value: [0, 0, 0] },
    sbePupilRadius: { value: 0.1667 },
    sbeLodBlend: { value: 0.0 },
    sbeLightDir: { value: [0.3, 0.5, 0.8] },
    sbeEta: { value: 1.0 / p.ior },
    sbeF0: { value: ((p.ior - 1) / (p.ior + 1)) ** 2 },
    sbeLimbusRadius: { value: p.limbusRadius },
    sbeLimbusWidth: { value: p.limbusWidth },
    sbeLimbusDarkening: { value: p.limbusDarkening },
    sbeLimbusNoise: { value: [p.limbusNoiseAmount, p.limbusNoiseFreq,
                              p.limbusNoiseSeed] },                 // §4.8
    sbeLimbusLightResp: { value: p.limbusLightResponse },          // §4.8b
    sbeLimbusMap: { value: null },     // optional ring-band texture
    sbeHasLimbusMap: { value: 0 },
    sbeIrisPlaneZ: { value: p.irisPlaneZ },
    sbeCorneaCenterZ: { value: p.corneaApexZ - p.corneaRadius },
    sbeCorneaApexZ: { value: p.corneaApexZ },
    sbeCorneaRadius: { value: p.corneaRadius },
    sbeDispWeight: { value: p.displacementWeight },
    sbeRefPupilRadius: { value: p.refPupilRadius },
    sbeIrisHeightScale: { value: p.irisHeightScale },
    sbeCausticStrength: { value: p.causticStrength },
    sbeCausticExponent: { value: p.causticExponent },
    sbeCausticShadow: { value: p.causticShadowStrength },
    sbeRefractionMode: { value: p.refractionMode },
    sbeIrisScale: { value: [p.irisWidth, p.irisHeight] },
    sbePupilScale: { value: [p.pupilWidth, p.pupilHeight] },
    sbePupilOffset: { value: [p.pupilOffsetX, p.pupilOffsetY] },
    sbePupilSquareness: { value: p.pupilSquareness },            // §4.6
    sbePupilNoise: { value: [p.pupilNoiseAmount, p.pupilNoiseFreq,
                             p.pupilNoiseSeed, p.pupilNoiseType] },
    sbePupilBlend: { value: p.pupilBlend },                      // §4.6 soft edge
    sbePupilBlendExp: { value: p.pupilBlendExp },
    sbePupilBleed: { value: [p.pupilBleedAmount, p.pupilBleedWidth,
                             p.pupilBleedExponent] },            // §4.7
    sbePupilBleedLight: { value: p.pupilBleedLight },            // §4.7b
    sbePupilBleedSat: { value: p.pupilBleedSaturation },
    sbeLightColor: { value: [1, 1, 1] },  // set by updateLightDir
    sbeIrisDepthAO: { value: p.irisDepthAO },                    // §4.9
    sbeScleraGlow: { value: p.scleraGlow },
    sbeScleraEmissive: { value: p.scleraEmissive },   // §4.9 white only
    sbeScleraScatter: { value: p.scleraScatter },        // §4.9d
    sbeSocketAO: { value: p.socketAO },                  // §4.9e
    sbeIrisFlatten: { value: p.irisDiffuseFlatten },     // §4.9f STORE-ONLY
    // §7 (weight, roughness, ior) + (iris, sclera dry, sclera film) roughness
    sbeCoat: { value: [p.coatWeight, p.coatRoughness, p.coatIor] },
    sbeRough: { value: [p.irisRoughness, p.scleraRoughness,
                        p.scleraFilmRoughness] },
    // §5 single-source sclera SSS: (weight, r, g, b) — realtime warm wrap fill
    sbeScleraSss: { value: [sssW, sssC[0], sssC[1], sssC[2]] },
    sbeSpecPlace: { value: [p.specPlaceX, p.specPlaceY] },
    sbeSpecSize: { value: p.specPlaceSize },
    sbeSpecInt: { value: p.specPlaceIntensity },
    sbeSpecShape: { value: [p.specPlaceSides, p.specPlaceRoundness,
                            p.specPlaceWide, p.specPlaceTall] },
    sbeSpecEdge: { value: [p.specPlaceRotate, p.specPlaceCore,
                           p.specPlaceFalloff] },
    sbeSpecColor: { value: p.specPlaceColor },
    sbePupilColor: { value: p.pupilColor.slice() },
    sbeScleraColor: { value: p.scleraColor.slice() },
    sbeIrisMap: { value: opts.irisMap ?? null },
    sbeScleraMap: { value: opts.scleraMap ?? null },
  };
}

/** Re-derive uniforms after changing look params (SPEC §2 CPU-side). */
export function updateEyeParams(eye, params) {
  Object.assign(eye._params, params);
  const p = eye._params;
  eye.sbeEta.value = 1.0 / Math.max(p.ior, 1.0);
  eye.sbeF0.value = ((p.ior - 1) / (p.ior + 1)) ** 2;
  eye.sbeLimbusRadius.value = p.limbusRadius;
  eye.sbeLimbusWidth.value = p.limbusWidth;
  eye.sbeLimbusDarkening.value = p.limbusDarkening;
  eye.sbeLimbusNoise.value = [p.limbusNoiseAmount, p.limbusNoiseFreq,
                              p.limbusNoiseSeed];                   // §4.8
  eye.sbeLimbusLightResp.value = p.limbusLightResponse;            // §4.8b
  eye.sbeIrisPlaneZ.value = p.irisPlaneZ;
  eye.sbeCorneaCenterZ.value = p.corneaApexZ - p.corneaRadius;
  eye.sbeCorneaApexZ.value = p.corneaApexZ;
  eye.sbeCorneaRadius.value = p.corneaRadius;
  eye.sbeDispWeight.value = p.displacementWeight;
  eye.sbeRefPupilRadius.value = p.refPupilRadius;
  eye.sbeIrisHeightScale.value = p.irisHeightScale;
  eye.sbeCausticStrength.value = p.causticStrength;
  eye.sbeCausticExponent.value = p.causticExponent;
  eye.sbeCausticShadow.value = p.causticShadowStrength;
  eye.sbeRefractionMode.value = p.refractionMode;
  eye.sbeIrisScale.value = [p.irisWidth, p.irisHeight];
  eye.sbePupilScale.value = [p.pupilWidth, p.pupilHeight];
  eye.sbePupilOffset.value = [p.pupilOffsetX, p.pupilOffsetY];
  eye.sbePupilSquareness.value = p.pupilSquareness;              // §4.6
  eye.sbePupilNoise.value = [p.pupilNoiseAmount, p.pupilNoiseFreq,
                             p.pupilNoiseSeed, p.pupilNoiseType];
  eye.sbePupilBlend.value = p.pupilBlend;                        // §4.6 soft edge
  eye.sbePupilBlendExp.value = p.pupilBlendExp;
  eye.sbePupilBleed.value = [p.pupilBleedAmount, p.pupilBleedWidth,
                             p.pupilBleedExponent];              // §4.7
  eye.sbePupilBleedLight.value = p.pupilBleedLight;              // §4.7b
  eye.sbePupilBleedSat.value = p.pupilBleedSaturation;
  eye.sbeIrisDepthAO.value = p.irisDepthAO;                      // §4.9
  eye.sbeScleraGlow.value = p.scleraGlow;
  eye.sbeScleraEmissive.value = p.scleraEmissive;
  eye.sbeScleraScatter.value = p.scleraScatter;         // §4.9d
  eye.sbeSocketAO.value = p.socketAO;                   // §4.9e
  eye.sbeIrisFlatten.value = p.irisDiffuseFlatten;      // §4.9f STORE-ONLY
  eye.sbeCoat.value = [p.coatWeight, p.coatRoughness, p.coatIor];   // §7
  eye.sbeRough.value = [p.irisRoughness, p.scleraRoughness,
                        p.scleraFilmRoughness];
  eye.sbeSpecPlace.value = [p.specPlaceX, p.specPlaceY];
  eye.sbeSpecSize.value = p.specPlaceSize;
  eye.sbeSpecInt.value = p.specPlaceIntensity;
  eye.sbeSpecShape.value = [p.specPlaceSides, p.specPlaceRoundness,
                            p.specPlaceWide, p.specPlaceTall];
  eye.sbeSpecEdge.value = [p.specPlaceRotate, p.specPlaceCore,
                           p.specPlaceFalloff];
  eye.sbeSpecColor.value = p.specPlaceColor;
}

// Animation-channel pairs updateProjector accepts beyond pupilRadius/lodBlend
// (SPEC §4.4 shape channels animators key for dilation/squints/appeal):
// [optA, optB, uniform] — each pair lands in the same vec2 uniform
// updateEyeParams derives, without the full look re-derive.
const PROJECTOR_ANIM_PAIRS = [
  ['irisWidth', 'irisHeight', 'sbeIrisScale'],
  ['pupilWidth', 'pupilHeight', 'sbePupilScale'],
  ['pupilOffsetX', 'pupilOffsetY', 'sbePupilOffset'],
];

/** SPEC §5: orthonormalize + sanitize the projector frame CPU-side and bake
 *  per-axis inverse scale into the world->projector rows. forwardAxis:
 *  'z' (SPEC/native) or 'negz' (three's lookAt convention).
 *
 *  opts also accepts the per-frame ANIMATION CHANNELS: pupilRadius, lodBlend,
 *  irisWidth, irisHeight, pupilWidth, pupilHeight, pupilOffsetX, pupilOffsetY.
 *  Omitted channels are left untouched (backward compatible); values are
 *  written through the internal param block, so a later updateEyeParams call
 *  keeps the animated state. */
export function updateProjector(eye, object3D, opts = {}) {
  object3D.updateWorldMatrix(true, false);
  const e = object3D.matrixWorld.elements; // column-major
  let X = [e[0], e[1], e[2]];
  let Y = [e[4], e[5], e[6]];
  let Z = [e[8], e[9], e[10]];
  const origin = [e[12], e[13], e[14]];
  if ((opts.forwardAxis ?? 'z') === 'negz') {
    Z = [-Z[0], -Z[1], -Z[2]];
    X = [-X[0], -X[1], -X[2]]; // keep the frame right-handed
  }
  const len = (v) => Math.hypot(v[0], v[1], v[2]);
  const sx = len(X), sy = len(Y), sz = len(Z);
  if (![sx, sy, sz, ...origin].every(Number.isFinite) ||
      sx < 1e-6 || sy < 1e-6 || sz < 1e-6) {
    console.error('squarebit-eye: degenerate projector transform — held');
    return;
  }
  // orthonormalize (SPEC §5): Z = fwd, Y ⟂ Z, X = Y×Z
  Z = Z.map((v) => v / sz);
  const d = Y[0] * Z[0] + Y[1] * Z[1] + Y[2] * Z[2];
  Y = [Y[0] - Z[0] * d, Y[1] - Z[1] * d, Y[2] - Z[2] * d];
  const yl = len(Y);
  Y = Y.map((v) => v / yl);
  X = [Y[1] * Z[2] - Y[2] * Z[1],
       Y[2] * Z[0] - Y[0] * Z[2],
       Y[0] * Z[1] - Y[1] * Z[0]];
  // rows scaled by inverse per-axis scale; column-major upload order
  const m = eye.sbeW2P.value;
  m[0] = X[0] / sx; m[3] = X[1] / sx; m[6] = X[2] / sx;
  m[1] = Y[0] / sy; m[4] = Y[1] / sy; m[7] = Y[2] / sy;
  m[2] = Z[0] / sz; m[5] = Z[1] / sz; m[8] = Z[2] / sz;
  eye.sbeOrigin.value = origin;
  if (opts.pupilRadius !== undefined) {
    eye.sbePupilRadius.value =
      Math.min(opts.pupilRadius, eye.sbeLimbusRadius.value - 0.001); // §4.1
  }
  if (opts.lodBlend !== undefined) eye.sbeLodBlend.value = opts.lodBlend;
  // Animation-channel tier (§4.4): rig-driven iris/pupil shape, routed to the
  // same uniforms updateEyeParams uses. In-core containment clamps (§4.4)
  // keep the pupil inside the limbus, matching the other hosts.
  const p = eye._params;
  for (const [a, b, uniform] of PROJECTOR_ANIM_PAIRS) {
    if (opts[a] === undefined && opts[b] === undefined) continue;
    if (opts[a] !== undefined) p[a] = opts[a];
    if (opts[b] !== undefined) p[b] = opts[b];
    eye[uniform].value = [p[a], p[b]];
  }
}

/** Caustic light direction from a THREE.DirectionalLight (§4.2 host note). */
export function updateLightDir(eye, light) {
  const p = light.position, t = light.target.position;
  const d = [p.x - t.x, p.y - t.y, p.z - t.z];
  const l = Math.hypot(d[0], d[1], d[2]);
  if (l < 1e-4) { eye.sbeCausticStrength.value = 0; return; } // §4.2 guard
  eye.sbeLightDir.value = [d[0] / l, d[1] / l, d[2] / l];
  // §4.7: the bleed glow is colored by the light itself.
  if (light.color) {
    eye.sbeLightColor.value = [light.color.r, light.color.g, light.color.b];
  }
}

const FRAG_WRAPPER = /* glsl */ `
uniform mat3 sbeW2P;
uniform vec3 sbeOrigin;
uniform float sbePupilRadius, sbeLodBlend;
uniform vec3 sbeLightDir;
uniform float sbeEta, sbeF0, sbeLimbusRadius, sbeLimbusWidth,
              sbeLimbusDarkening, sbeIrisPlaneZ, sbeCorneaCenterZ,
              sbeRefPupilRadius, sbeIrisHeightScale, sbeCausticStrength,
              sbeCausticExponent, sbeCausticShadow;
uniform int sbeRefractionMode;
uniform vec2 sbeIrisScale, sbePupilScale, sbePupilOffset;
uniform float sbePupilSquareness;
uniform vec4 sbePupilNoise;   // (amount, freq, seed, type) — §4.6
uniform float sbePupilBlend, sbePupilBlendExp;   // §4.6 soft pupil edge
uniform vec3 sbePupilBleed;   // (amount, width, exponent) — §4.7
uniform float sbePupilBleedLight;  // light response — §4.7b
uniform float sbePupilBleedSat;    // rim hue vs neutral — §4.7
uniform vec3 sbeLightColor;        // §4.7 bleed glow color = light color
uniform vec2 sbeSpecPlace;
uniform float sbeSpecSize, sbeSpecInt;
uniform vec4 sbeSpecShape;   // sides, roundness, wide, tall
uniform vec3 sbeSpecEdge;    // rotate, core, falloff
uniform vec3 sbeSpecColor;
uniform vec3 sbePupilColor, sbeScleraColor, sbePupilBleedColor;
uniform float sbeScleraEmissive;
uniform sampler2D sbeIrisMap, sbeScleraMap;
uniform vec3 sbeLimbusNoise;       // (amount, freq, seed) — §4.8
uniform float sbeLimbusLightResp;  // §4.8b light-dependent limbus
uniform sampler2D sbeLimbusMap;    // §4.8 optional ring-band texture
uniform float sbeHasLimbusMap;
uniform float sbeIrisDepthAO;      // §4.9a crevice AO from iris height
uniform float sbeScleraGlow;       // §4.9b red transmission glow
uniform float sbeScleraScatter;    // §4.9d grazing-angle sclera scatter
uniform float sbeSocketAO;         // §4.9e eyelid/socket ambient occlusion
uniform float sbeIrisFlatten;      // §4.9f STORE-ONLY diffuse/spec normal split
float sbeIrisW = 0.0;              // iris weight, shared to the base-normal flatten
uniform vec4 sbeScleraSss;         // §5 single-source sclera SSS (w, r, g, b)
uniform vec3 sbeCoat;              // §7 (coatWeight, coatRoughness, coatIor)
uniform vec3 sbeRough;             // §7 (iris, sclera dry, sclera film)

// §7 surface response, written by sbeEyeColor and read by the patched
// <roughnessmap_fragment> / <lights_physical_fragment> chunks further down the
// shader. A global rather than a second projection: the region weight the
// response blends by (irisWeight) is already computed in sbeEyeColor, and
// three's chunk order runs <map_fragment> — where sbeEyeColor is called —
// before both consumers. Seeded with the DRY sclera so a host that somehow
// skips the base-colour patch still gets a sane surface instead of a mirror.
vec3 sbeSurf = vec3(0.3, 0.02, 1.0);   // (baseRoughness, filmRoughness, coatW)

vec3 sbeEyeColor(vec3 Pw, vec3 Nw, vec3 Vw, vec2 uv) {
  vec3 Pp = sbeW2P * (Pw - sbeOrigin);
  vec3 Np = normalize(sbeW2P * Nw);
  vec3 Vp = normalize(sbeW2P * Vw);
  vec3 Lp = normalize(sbeW2P * sbeLightDir);

  EcLook look;
  look.eta = sbeEta;                       look.F0 = sbeF0;
  look.limbusRadius = sbeLimbusRadius;     look.limbusWidth = sbeLimbusWidth;
  look.limbusDarkening = sbeLimbusDarkening;
  look.limbusNoiseAmount = sbeLimbusNoise.x;   // §4.8 ring breakup
  look.limbusNoiseFreq = sbeLimbusNoise.y;
  look.limbusNoiseSeed = sbeLimbusNoise.z;
  look.limbusLightResponse = sbeLimbusLightResp;   // §4.8b
  look.irisPlaneZ = sbeIrisPlaneZ;         look.corneaCenterZ = sbeCorneaCenterZ;
  look.refPupilRadius = sbeRefPupilRadius;
  look.irisHeightScale = sbeIrisHeightScale;
  look.causticStrength = sbeCausticStrength;
  look.causticExponent = sbeCausticExponent;
  look.causticShadowStrength = sbeCausticShadow;
  look.scleraWrapAmount = 0.0;             // lighting is the host BSDF's job
  look.refractionMode = sbeRefractionMode;
  look.irisScaleX = sbeIrisScale.x;        // §4.4 elliptical iris/pupil
  look.irisScaleY = sbeIrisScale.y;
  look.pupilScaleX = sbePupilScale.x;
  look.pupilScaleY = sbePupilScale.y;
  look.pupilOffsetX = sbePupilOffset.x;
  look.pupilOffsetY = sbePupilOffset.y;
  look.pupilSquareness = sbePupilSquareness;   // §4.6 pupil shape
  look.pupilNoiseAmount = sbePupilNoise.x;
  look.pupilNoiseFreq = sbePupilNoise.y;
  look.pupilNoiseSeed = sbePupilNoise.z;
  look.pupilNoiseType = sbePupilNoise.w;
  look.pupilBlend = sbePupilBlend;             // §4.6 soft pupil edge
  look.pupilBlendExp = sbePupilBlendExp;
  look.pupilBleedAmount = sbePupilBleed.x;     // §4.7 light bleed
  look.pupilBleedWidth = sbePupilBleed.y;
  look.pupilBleedExponent = sbePupilBleed.z;
  look.pupilBleedLight = sbePupilBleedLight;   // §4.7b — same light as
  look.bleedLightPS = ecXY(Lp);                //   the caustic (Lp above)

  EcIrisProj o = ecProjectIris(Pp, Vp, Np, sbePupilRadius, sbeLodBlend, look);

  float h = texture(sbeIrisMap, o.uv).a;
  vec2 uv2 = clamp(ecIrisParallax(o.uv, o.refractedDir, h,
                                  sbeIrisHeightScale,
                                  sbeLimbusRadius * sbeIrisScale),
                   vec2(0.0), vec2(1.0));
  vec3 irisAlbedo = texture(sbeIrisMap, uv2).rgb;
  float caustic = ecCausticKick(o.hitXY, o.hitR, vec2(Lp.x, Lp.y),
                                sbeCausticStrength, sbeCausticExponent,
                                sbeCausticShadow);
  // §4.7: bleed is ADDITIVE veiling light over the dark pupil, colored by
  // the light; saturation blends in the rim's own hue.
  float bleedLuma = dot(irisAlbedo, vec3(0.2126, 0.7152, 0.0722));
  vec3 bleedCol = sbeLightColor *
      mix(vec3(bleedLuma), irisAlbedo, sbePupilBleedSat);
  vec3 iris = mix(irisAlbedo * caustic,
                  sbePupilColor + bleedCol * o.bleedWeight, o.pupilMask);
  vec3 sclera = sbeScleraColor * texture(sbeScleraMap, uv).rgb;
  // §4.9b sclera glow: warm transmission where the light shines through
  // from behind (soft SSS read on the white).
  sclera += sbeScleraGlow * vec3(0.85, 0.28, 0.16) *
            pow(saturate(-dot(Nw, sbeLightDir)), 1.5);
  // §4.9d grazing sclera scatter: the white reads more subsurface energy at
  // grazing view angles (TLOU2 ref) — a Fresnel-weighted soft, slightly warm
  // brightening. 0 = neutral.
  sclera += sbeScleraScatter * pow(1.0 - saturate(dot(Nw, Vw)), 3.0)
          * vec3(0.9, 0.72, 0.66);
  // §4.8 optional limbus texture: grayscale scales the ring darkening
  // (white / no map = neutral).
  float ringMul = o.ringMul;
  if (sbeHasLimbusMap > 0.5) {
    ringMul = 1.0 - (1.0 - ringMul) * texture(sbeLimbusMap, o.limbusUV).r;
  }
  vec3 outCol = mix(sclera, iris, o.irisWeight) * ringMul;
  // §7 surface response for the host BSDF's REAL clearcoat. three.js layers
  // the coat itself (it multiplies the base by (1 - clearcoat * Fcc)), so we
  // feed it the two SURFACES — .baseRoughness under the film, .filmRoughness
  // on it — and deliberately do NOT apply .baseMul, which is the single-lobe
  // hosts' stand-in for exactly that layering and would double-count here.
  // The coat is front-gated: no tear film on the back of the eyeball. NOT a
  // hard step: step(0.0, Pp.z) cut the coat 1 -> 0 exactly on the projector-
  // space equator, and a layered host's coat both adds its own specular and
  // attenuates the base under it (three: 1 - clearcoat * Fcc), so the cut
  // drew a visible shading seam down the sclera — a great circle locked to
  // the gaze frame, showing wherever the equator swings into view. Roll the
  // film off smoothly instead: full film over the whole front hemisphere,
  // gone ~20 deg behind the equator; smoothstep is C1 at both ends, so no
  // crease survives at either edge of the band.
  float sbeFront = smoothstep(-0.35, 0.0, Pp.z);
  EcSurface s = ecSurfaceResponse(o.irisWeight, sbeFront,
                                  saturate(dot(Np, Vp)),
                                  sbeCoat.x, sbeCoat.y,
                                  sbeRough.x, sbeRough.y, sbeRough.z,
                                  sbeCoat.z);
  sbeSurf = vec3(s.baseRoughness, s.filmRoughness,
                 saturate(sbeCoat.x) * sbeFront);
  // §5 SINGLE-SOURCE sclera SSS (realtime wrap approximation) — the same
  // additive warm fill Storm/Maya VP2/Unreal apply: a wrap-lighting lift in the
  // sclera's shadowed/grazing region, gated to the WHITE by (1 - irisWeight),
  // tinted by SCLERA_SSS_COLOR, weight = ScleraSssWeight (sbeScleraSss, from
  // sss_defaults.json). Never darkens (wrapLift >= 0), never touches the iris.
  // ndv = headlight NdotV (rotation-invariant, so projector space is fine).
  {
    float ndv = saturate(dot(Np, Vp));
    float scleraFrac = saturate(1.0 - o.irisWeight);
    float wrapLift = max(ecScleraWrap(ndv, sbeScleraSss.x) - ndv, 0.0);
    outCol += outCol * (sbeScleraSss.yzw * (scleraFrac * wrapLift));
  }
  // §4.9e socket occlusion: the bare eyeball has no lids, so fake the soft
  // ambient shadow the eyelids/socket cast — darken toward the top (upper lid,
  // stronger) and bottom (lower lid, softer) in the world/socket frame; the
  // central palpebral fissure stays bright. Because the mesh is static and the
  // gaze moves via the projector, the iris slides into the upper-lid shade when
  // the eye looks up. 0 = neutral.
  float lidShade = smoothstep(0.15, 0.72, Nw.y) * 0.75
                 + smoothstep(0.15, 0.68, -Nw.y) * 0.32;
  outCol *= 1.0 - sbeSocketAO * saturate(lidShade);
  sbeIrisW = o.irisWeight;   // §4.9f STORE-ONLY: share to the base-normal flatten
  return outCol;
}
`;

/** Patch a MeshPhysicalMaterial (or MeshStandardMaterial): its diffuse color
 *  becomes the projected composite; everything else (clearcoat = tear film,
 *  roughness, env reflections) stays the host BSDF's business.
 *
 *  opts.displace: SPEC §6b SHADER DISPLACEMENT — vertex-stage cornea bulge
 *  evaluated in projector space on a spherical base mesh (the bulge follows
 *  the projector = gaze-tracking cornea). Set eye params
 *  { displacementWeight: 1, refractionMode: 1 } (virtual cornea supplies
 *  the displaced surface's correct refraction normal). Note: three's own
 *  worldPosition (env/shadow chunks) stays undisplaced — acceptable for the
 *  ~5% radial offset. */
export function applyEyeShader(material, coreGlsl, eye, opts = {}) {
  // three's <common> chunk already defines saturate() as a macro — the
  // core's GLSL fallback function definition would be macro-mangled into a
  // syntax error. Drop it; the macro serves the core's calls.
  coreGlsl = coreGlsl.replace(/float saturate\(float x\)[^\n]*\n/, '');
  const displace = !!opts.displace;
  material.defines = { ...(material.defines || {}), USE_UV: '' };
  // §7: the coat is the HOST's — three.js MeshPhysicalMaterial has a real
  // layered clearcoat and it stays. What changed is where its numbers come
  // from: these are the shipped SPEC §4 values (gen_materialx.SCALARS), not
  // whatever the caller happened to construct the material with. The shader
  // overrides both per pixel (sbeSurf); assigning them here is what turns on
  // three's USE_CLEARCOAT define, which is a COMPILE-time switch — a caller
  // that built the material with clearcoat 0 would otherwise have no coat
  // slab for the override to write into.
  //
  // KNOWN GAP: three welds the clearcoat's F0 to 0.04 (IOR 1.5). CoatIor
  // 1.376 -> F0 0.025 therefore reaches this host's BASE ior but NOT its coat
  // layer, so the web's coat reflects ~1.6x more at normal incidence than
  // Unreal's. There is no three.js input for it.
  const cp = eye._params;
  material.clearcoat = cp.coatWeight;
  material.clearcoatRoughness = cp.coatRoughness;
  material.roughness = cp.scleraRoughness;
  material.ior = cp.coatIor;
  material.onBeforeCompile = (shader) => {
    for (const [k, v] of Object.entries(eye)) {
      if (k[0] !== '_') shader.uniforms[k] = v;
    }
    const varyings = 'varying vec3 sbeWorldPos;\nvarying vec3 sbeWorldNormal;\n';
    if (displace) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>',
                 '#include <common>\n' + varyings +
                 'uniform mat3 sbeW2P;\nuniform vec3 sbeOrigin;\n' +
                 'uniform float sbeCorneaApexZ, sbeCorneaRadius,\n' +
                 '    sbeLimbusRadius, sbeDispWeight;\n' +
                 'uniform vec2 sbeIrisScale;\n' + coreGlsl)
        .replace('#include <project_vertex>',
                 // displaced world position; by linearity, scaling the
                 // projector-space radius by f == scaling (P - origin) by f
                 'vec4 sbeW4 = modelMatrix * vec4(transformed, 1.0);\n' +
                 '{\n' +
                 '  vec3 sbeRel = sbeW2P * (sbeW4.xyz - sbeOrigin);\n' +
                 '  float sbeR = max(length(sbeRel), 1e-6);\n' +
                 '  float sbeF = 1.0 + (ecEyeballRadiusAniso(sbeRel / sbeR,\n' +
                 '      sbeCorneaApexZ, sbeCorneaRadius, sbeLimbusRadius,\n' +
                 '      sbeIrisScale.x, sbeIrisScale.y,\n' +
                 '      0.12) - 1.0) * sbeDispWeight;\n' +
                 '  sbeW4.xyz = sbeOrigin + (sbeW4.xyz - sbeOrigin) * sbeF;\n' +
                 '}\n' +
                 'sbeWorldPos = sbeW4.xyz;\n' +
                 'sbeWorldNormal = normalize((modelMatrix * ' +
                 'vec4(objectNormal, 0.0)).xyz);\n' +
                 'vec4 mvPosition = viewMatrix * sbeW4;\n' +
                 'gl_Position = projectionMatrix * mvPosition;');
    } else {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + varyings)
        .replace('#include <worldpos_vertex>',
                 '#include <worldpos_vertex>\n' +
                 'sbeWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n' +
                 'sbeWorldNormal = normalize((modelMatrix * ' +
                 'vec4(objectNormal, 0.0)).xyz);');
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
               '#include <common>\n' + varyings + coreGlsl + FRAG_WRAPPER)
      .replace('#include <map_fragment>',
               '#include <map_fragment>\n{\n' +
               '  vec3 sbeV = normalize(cameraPosition - sbeWorldPos);\n' +
               '  diffuseColor.rgb = sbeEyeColor(sbeWorldPos,\n' +
               '      normalize(sbeWorldNormal), sbeV, vUv);\n}')
      // §4.5 placed spec and §4.9 sclera emissive are both EMISSION: unlit,
      // unshadowed, lighter-owned. The sclera glow used to ride base colour
      // with a bare (1 - irisWeight) mask, which the artist rejected twice —
      // once for the hard edge a region test draws at the limbus, once for
      // filling the limbal ring back in and flattening it. ecScleraEmissiveMask
      // is the shipped Unreal mask verbatim (sclera falloff * static ring *
      // front gate), and it lands on the same pin Unreal's does.
      .replace('#include <emissivemap_fragment>',
               '#include <emissivemap_fragment>\n{\n' +
               '  vec3 sbePp = sbeW2P * (sbeWorldPos - sbeOrigin);\n' +
               '  totalEmissiveRadiance += sbeSpecColor *\n' +
               '      (sbeSpecInt * ecPlacedSpecShaped(sbePp,\n' +
               '          sbeSpecPlace.x, sbeSpecPlace.y, sbeSpecSize,\n' +
               '          sbeSpecShape.x, sbeSpecShape.y,\n' +
               '          sbeSpecShape.z, sbeSpecShape.w,\n' +
               '          sbeSpecEdge.x, sbeSpecEdge.y, sbeSpecEdge.z));\n' +
               '  totalEmissiveRadiance += sbeScleraColor *\n' +
               '      (sbeScleraEmissive * ecScleraEmissiveMask(sbePp,\n' +
               '          sbeLimbusRadius, sbeLimbusWidth,\n' +
               '          sbeIrisScale.x, sbeIrisScale.y, sbeLimbusDarkening,\n' +
               '          sbeLimbusNoise.x, sbeLimbusNoise.y,\n' +
               '          sbeLimbusNoise.z));\n}')
      // §7 surface response -> the host BSDF. roughnessFactor is the tissue
      // UNDER the film; the clearcoat block is the film. Both come from
      // sbeSurf, which sbeEyeColor filled in <map_fragment> above.
      .replace('#include <roughnessmap_fragment>',
               '#include <roughnessmap_fragment>\nroughnessFactor = sbeSurf.x;')
      .replace('#include <lights_physical_fragment>',
               '#include <lights_physical_fragment>\n' +
               '#ifdef USE_CLEARCOAT\n' +
               'material.clearcoat = sbeSurf.z;\n' +
               'material.clearcoatRoughness = sbeSurf.y;\n' +
               '#endif')
      // §4.9f STORE-ONLY diffuse/specular normal split (TLOU2): flatten
      // the BASE (diffuse + subsurface) normal toward the gaze axis inside
      // the iris so it shades like a flat disc, while the clearcoat keeps
      // the sharp bulged cornea reflection. sbeIrisW is written by
      // sbeEyeColor (map_fragment, which runs before this chunk). 0 = off.
      .replace('#include <normal_fragment_maps>',
               '#include <normal_fragment_maps>\n{\n' +
               '  vec3 sbeGazeW = normalize(vec3(sbeW2P[0][2], sbeW2P[1][2],\n' +
               '      sbeW2P[2][2]));\n' +
               '  vec3 sbeGazeV = normalize((viewMatrix * vec4(sbeGazeW, 0.0)).xyz);\n' +
               '  sbeGazeV *= sign(dot(sbeGazeV, normal) + 1e-4);\n' +
               '  normal = normalize(mix(normal, sbeGazeV,\n' +
               '      clamp(sbeIrisFlatten * sbeIrisW, 0.0, 1.0)));\n' +
               '}');
  };
  material.customProgramCacheKey = () =>
    'squarebit-eye-v3' + (displace ? '-disp' : '');
  material.needsUpdate = true;
  return material;
}
