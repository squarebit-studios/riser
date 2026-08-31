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
// VENDORED VERBATIM from the Squarebit Eye repo (core/eye_core.glsl, wrapped
// as a template literal; the repo's own copyright header is carried above
// instead of inside the literal). Do NOT edit the GLSL here - it is the same
// single source of truth every DCC host compiles, and a local edit makes the
// widget stop being the shipped eye. Re-copy from the repo instead.
// ==========================================================================

// GENERATED from SquarebitEye/core/eye_core.glsl (the single source of
// truth every DCC host compiles). Do not edit; re-copy from the repo.
export const EYE_CORE_GLSL = `
// ============================================================================
// eye_core.glsl — projection eye shader math core (single source of truth)
//
// Conforms to docs/SPEC.md v0.1.0. Section references (§) point there.
//
// DIALECTS — this one file compiles as:
//   GLSL  (default, no define)      Maya VP2.0 GL fragments, Blender, three.js
//   HLSL  (#define EC_HLSL)         Maya VP2.0 DX11 fragments, Unreal Custom nodes
//   C++   (#define EC_CPP,          CPU reference + unit/property/fuzz tests
//          include core/tests/ec_math.hpp first)
//   OSL   port is generated separately (no native vec2) — see core/README.md.
//
// PORTABILITY RULES (enforced in review):
//   * All float literals carry the 'f' suffix (C++ double-promotion trap).
//   * No swizzles — use ecXY()/ecV3() (C++ structs have no .xy).
//   * No 'out' params — small structs are returned instead.
//   * Branchless where it matters; ternaries compile to selects.
//
// CONVENTIONS (§1) — all inputs in PROJECTOR SPACE unless noted:
//   Right-handed, Y-up, +Z out of the eye through the pupil.
//   Origin = eyeball center. 1.0 = eyeball radius.
//   V = unit vector surface -> camera.  N = unit outward surface normal.
//   The host transforms P/V/N world->projector in fp32 BEFORE calling (§9),
//   and derives eta/F0/corneaCenterZ CPU-side (§2).
// ============================================================================

#ifndef EC_EYE_CORE_INCLUDED
#define EC_EYE_CORE_INCLUDED

// ---------------------------------------------------------------- dialect ---
#if defined(EC_HLSL)
  #define vec2 float2
  #define vec3 float3
  #define mix  lerp
  #define ecAtan2(y, x) atan2(y, x)
  // saturate, step, smoothstep, sign are native HLSL
#elif defined(EC_CPP)
  // ec_math.hpp (included by the host .cpp before this file) provides:
  // vec2/vec3, dot/cross/normalize/length/mix/clamp/min/max/step/smoothstep/
  // sign/saturate and ecAtan2.
#else // GLSL (default)
  #define ecAtan2(y, x) atan(y, x)
  float saturate(float x) { return clamp(x, 0.0f, 1.0f); }
#endif

#define EC_EPS      1e-5f
#define EC_EPS_RAD  1e-4f

// swizzle-free accessors (portability rule)
vec2 ecXY(vec3 v)          { return vec2(v.x, v.y); }
vec3 ecV3(vec2 v, float z) { return vec3(v.x, v.y, z); }

// ------------------------------------------------------------------ types ---

// Shared look parameters (§4). eta / F0 / corneaCenterZ are CPU-derived (§2):
//   eta = 1/ior;  F0 = ((ior-1)/(ior+1))^2;  corneaCenterZ = corneaApexZ - corneaRadius
struct EcLook {
  float eta;
  float F0;
  float limbusRadius;
  float limbusWidth;
  float limbusDarkening;
  float irisPlaneZ;
  float corneaCenterZ;
  float refPupilRadius;
  float irisHeightScale;
  float causticStrength;
  float causticExponent;
  float causticShadowStrength;
  float scleraWrapAmount;
  int   refractionMode;      // 0 = MESH_NORMAL, 1 = VIRTUAL_CORNEA (§4)
  // §4.4 — elliptical iris/pupil + decentered pupil. All default-neutral:
  // scales 1, offsets 0 reproduce the circular pipeline bit-for-bit.
  float irisScaleX;          // limbus semi-axis multiplier, X = width
  float irisScaleY;          // limbus semi-axis multiplier, Y = height
  float pupilScaleX;         // pupil semi-axis multiplier, X = width
  float pupilScaleY;         // pupil semi-axis multiplier, Y = height
  float pupilOffsetX;        // pupil center, projector plane units
  float pupilOffsetY;        //   (containment-clamped inside the limbus)
  // §4.6 — pupil shape: superellipse squareness + rim noise. All
  // default-neutral: squareness 0 and noiseAmount 0 reproduce the §4.4
  // elliptical pipeline bit-for-bit.
  float pupilSquareness;     // 0 = ellipse ... 1 = rounded rectangle (goat)
  float pupilNoiseAmount;    // rim-noise amplitude, fraction of pupil radius
  float pupilNoiseFreq;      // rim-noise base lobe count (integer-snapped)
  float pupilNoiseSeed;      // phase seed — re-rolls the rim pattern
  float pupilNoiseType;      // 0 = lattice (default), 1 = billow (creased
                             //   abs-FBM), 2 = ridged (sharp crests),
                             //   3 = scallop (1-D cellular: rounded lobes
                             //   with sharp notches — pupillary ruff)
  // §4.6 — soft pupil edge: the pupil fades into the iris instead of a hard
  // cut. Default-neutral toward the legacy edge too — pupilBlend 0 + exp 1
  // gives the crisp 0.01-AA boundary. Independent of the §4.7 light bleed.
  float pupilBlend;          // fringe width, fraction of pupil->limbus span
  float pupilBlendExp;       // edge profile exponent (>1 pushes the fade deeper)
  // §4.7 — pupil light bleed: veiling scatter of rim light into the pupil,
  // CIE disability-glare style falloff (L_v ~ 1/theta^x). Default-neutral:
  // amount 0 reproduces §4.4/§4.6 bit-for-bit.
  float pupilBleedAmount;    // veil strength at the pupil rim (0 = off)
  float pupilBleedWidth;     // reach into the pupil, fraction of the
                             //   local pupil radius (1 = center)
  float pupilBleedExponent;  // falloff shape (CIE glare x ≈ 1.5..2)
  // §4.7b — light-reactive bleed. Response 0 = uniform veil (§4.7 as-is);
  // 1 = the veil concentrates into a far-side crescent, same sign
  // convention and exponent family as the §4.2 caustic. bleedLightPS is
  // HOST-SET (not artist-facing): the projector-space primary light XY the
  // caustic already uses; |xy| < 1e-4 falls back to the uniform veil.
  float pupilBleedLight;     // 0 = uniform ... 1 = fully light-driven
  vec2  bleedLightPS;        // projector-space light dir XY (host-set)
  // §4.8 — limbal ring breakup: per-angle modulation of ring darkening
  // and width via the §4.6 lattice noise. All default-neutral: amount 0
  // reproduces the uniform ring bit-for-bit. Hosts may ALSO sample an
  // optional grayscale limbus texture at EcIrisProj.limbusUV to scale
  // the darkening (white / no map = neutral).
  float limbusNoiseAmount;   // ring breakup amplitude (0 = uniform)
  float limbusNoiseFreq;     // base lobe count around the ring
  float limbusNoiseSeed;     // re-rolls the breakup pattern
  // §4.8b — light-dependent limbus: the dark limbal ring is a cornea-
  // refraction effect (TLOU2 tech-art), so it FADES as the primary light
  // comes head-on (down the eye axis) and is strongest at grazing/side light.
  // 0 = static ring (legacy, bit-for-bit); 1 = fully light-driven (fades to
  // nothing head-on). Uses bleedLightPS, so it needs the host's light dir.
  float limbusLightResponse;
};

struct EcPolar {
  float r;
  float theta;
};

// Result of the projection pipeline steps 1-5 + region weights (§3).
// The host samples T_iris at .uv (after optional parallax), then composes.
struct EcIrisProj {
  vec2  uv;           // iris disc UV in [0,1]^2, clamped (§12.3)
  float pupilMask;    // 1 inside pupil (render pupilColor), soft §4.6 edge
  float irisWeight;   // 1 = iris/limbus region, 0 = sclera (by surface radius)
  float ringMul;      // limbus darkening multiplier, apply to iris+sclera blend
  vec2  limbusUV;     // §4.8 ring-band UV: x = angle01, y = across-band 0..1
                      //   (for the host's OPTIONAL limbus breakup texture)
  float fresnel;      // Schlick cornea Fresnel — reflection lerp weight (§3.10)
  vec3  refractedDir; // unit ray inside the eye (feed to parallax)
  float hitR;         // iris-plane hit radius (diagnostics / caustic)
  vec2  hitXY;        // iris-plane hit point (caustic)
  float bleedWeight;  // §4.7 additive rim-veil weight (see ecPupilDilate)
};

// ------------------------------------------------------- core functions -----

// §3.3 — refraction with clamped discriminant. I = unit incident dir pointing
// INTO the surface (i.e. -V), N = unit outward normal, eta = 1/ior (< 1 on
// entry, so real TIR cannot occur; the clamp guards fp noise at grazing).
// Result stays unit-length for unit inputs (at k==0 it is the unit tangent).
vec3 ecCorneaRefract(vec3 I, vec3 N, float eta) {
  float NdotI = clamp(dot(N, I), -1.0f, 1.0f);
  float k = 1.0f - eta * eta * (1.0f - NdotI * NdotI);
  k = max(k, 0.0f);
  return eta * I - (eta * NdotI + sqrt(k)) * N;
}

// §6 / PLAN §6 — virtual-cornea normal: implicit sphere centered on the
// projector axis. Makes refraction independent of the (possibly coarse,
// recomputed, or LOD-swapped) mesh normal.
vec3 ecVirtualCorneaNormal(vec3 P, float corneaCenterZ) {
  vec3 d = P - vec3(0.0f, 0.0f, corneaCenterZ);
  return d / max(length(d), EC_EPS);
}

// §3.4 — ray/plane intersection with plane z = irisPlaneZ. fp32 (§9).
// Valid rays travel -Z (into the eye); the guard keeps t finite for any input
// and t is clamped >= 0 so we never march backwards out of the eye.
vec2 ecIrisPlaneIntersect(vec3 P, vec3 R, float irisPlaneZ) {
  float rz = (R.z >= 0.0f) ? max(R.z, EC_EPS) : min(R.z, -EC_EPS);
  float t = (irisPlaneZ - P.z) / rz;
  t = max(t, 0.0f);
  return ecXY(P) + t * ecXY(R);
}

// §1 — polar iris coordinates. theta is meaningless at r ~ 0; every consumer
// of theta multiplies by a radius-derived factor, so this is safe by contract.
EcPolar ecPolar(vec2 p) {
  EcPolar o;
  o.r = length(p);
  o.theta = ecAtan2(p.y, p.x);
  return o;
}

// §4.4 — radius of an axis-aligned ellipse (semi-axes a, b) along the unit
// direction (cosT, sinT). Circular case (a == b) returns a for any direction.
float ecEllipseRadius(float a, float b, float cosT, float sinT) {
  float d = b * b * cosT * cosT + a * a * sinT * sinT;
  return a * b / sqrt(max(d, EC_EPS));
}

// §4.4 — distance from an interior point c to the boundary of the
// axis-aligned ellipse (semi-axes a, b) along unit direction u. Exact
// ray-ellipse intersection; the positive root always exists for c inside
// (guaranteed by the ecPupilGeom containment clamp).
float ecEllipseExit(vec2 c, vec2 u, float a, float b) {
  vec2 cn = vec2(c.x / a, c.y / b);
  vec2 un = vec2(u.x / a, u.y / b);
  float A = max(dot(un, un), EC_EPS);
  float B = dot(cn, un);
  float C = dot(cn, cn) - 1.0f;                    // < 0 strictly inside
  float disc = max(B * B - A * C, 0.0f);
  return (sqrt(disc) - B) / A;
}

// §4.6 — superellipse exponent from the artist-facing squareness dial.
// 0 -> n = 2 (ellipse, the §4.4 pipeline), 1 -> n = 20 (rounded rectangle —
// with pupilScaleX >> pupilScaleY this is the goat/sheep bar pupil).
float ecPupilExponent(float squareness) {
  return 2.0f / max(1.0f - 0.9f * saturate(squareness), 0.1f);
}

// §4.6 — radius of the axis-aligned superellipse |x/a|^n + |y/b|^n = 1 along
// the unit direction (cosT, sinT). n = 2 is the ellipse; consumers keep the
// exact ecEllipseRadius path at neutral squareness (pow vs sqrt would move
// last-bit results, and neutrality is bit-for-bit normative).
float ecSuperellipseRadius(float a, float b, float cosT, float sinT, float n) {
  float ca = pow(abs(cosT) / max(a, EC_EPS_RAD), n);
  float sb = pow(abs(sinT) / max(b, EC_EPS_RAD), n);
  return pow(max(ca + sb, EC_EPS), -1.0f / n);
}

// §4.6 — seamless periodic pupil rim noise (v2, hashed lattice). Sine
// harmonics gave every lobe an identical depth — a uniform starburst;
// seed/freq only relocated it. Here every lobe draws an independent random
// depth from a permutation-polynomial hash, smoothly interpolated around
// the circle (1-D periodic value noise), with a second octave for width
// variation and a LOW-frequency amplitude envelope so stretches of rim go
// nearly smooth while others crenellate deeply — irregular by design, and
// the seed re-rolls the whole pattern. The hash uses only *, +, floor on
// values kept inside fp32's exact-integer range, so it is bit-identical
// across every dialect (no precision-fragile sin hashes). Range ⊂ [-1, 1].
float ecMod289(float x) { return x - floor(x * (1.0f / 289.0f)) * 289.0f; }
float ecPermute(float x) { return ecMod289((34.0f * x + 1.0f) * x); }
// Random value in [-1, 1] for wrapped lattice index i of a k-lobe ring.
float ecLatticeVal(float i, float k, float s) {
  float idx = i - floor(i / k) * k;
  return ecPermute(ecPermute(idx + s) + idx) * (2.0f / 288.0f) - 1.0f;
}
// Periodic 1-D value noise over the ring: t01 in [0,1] wraps seamlessly.
float ecNoiseOctave(float t01, float k, float s) {
  float x = t01 * k;
  float j = floor(x);
  float t = x - j;
  t = t * t * (3.0f - 2.0f * t);
  return mix(ecLatticeVal(j, k, s), ecLatticeVal(j + 1.0f, k, s), t);
}
float ecPupilNoise(float theta, float freq, float seed) {
  float k = max(floor(freq + 0.5f), 1.0f);
  float s = floor(seed + 0.5f);
  float t01 = theta * (1.0f / 6.2831853f) + 0.5f;   // [-π,π] -> [0,1]
  // per-lobe depths + half-amplitude off-harmonic octave (widths vary)
  float detail = ecNoiseOctave(t01, k, s)
               + 0.5f * ecNoiseOctave(t01, 2.0f * k + 1.0f, s + 101.0f);
  // slow envelope, squared for contrast: smooth stretches vs deep clusters
  float env = 0.5f + 0.5f * ecNoiseOctave(
      t01, max(floor(k * 0.25f + 0.5f), 2.0f), s + 17.0f);
  return detail * (1.0f / 1.5f) * env * env;
}

// §4.6 — billow variant: abs-FBM over the SAME periodic lattice octaves
// (2·|octave| − 1 maps each octave to [-1,1] with sharp creases at its
// zero crossings — the bunched, ridged breakup of billow noise). Same
// amplitude envelope and range ⊂ [-1, 1], so the §4.6 containment bound
// holds unchanged.
float ecPupilNoiseBillow(float theta, float freq, float seed) {
  float k = max(floor(freq + 0.5f), 1.0f);
  float s = floor(seed + 0.5f);
  float t01 = theta * (1.0f / 6.2831853f) + 0.5f;
  float detail = (2.0f * abs(ecNoiseOctave(t01, k, s)) - 1.0f)
               + 0.5f * (2.0f * abs(ecNoiseOctave(t01, 2.0f * k + 1.0f,
                                                  s + 101.0f)) - 1.0f);
  float env = 0.5f + 0.5f * ecNoiseOctave(
      t01, max(floor(k * 0.25f + 0.5f), 2.0f), s + 17.0f);
  return detail * (1.0f / 1.5f) * env * env;
}

// §4.6 — ridged variant: 1 − 2·|octave| (billow negated) — sharp bright
// crests at octave zero crossings read as outward rim spikes. Same
// envelope; range ⊂ [-1, 1].
float ecPupilNoiseRidged(float theta, float freq, float seed) {
  float k = max(floor(freq + 0.5f), 1.0f);
  float s = floor(seed + 0.5f);
  float t01 = theta * (1.0f / 6.2831853f) + 0.5f;
  float detail = (1.0f - 2.0f * abs(ecNoiseOctave(t01, k, s)))
               + 0.5f * (1.0f - 2.0f * abs(ecNoiseOctave(
                     t01, 2.0f * k + 1.0f, s + 101.0f)));
  float env = 0.5f + 0.5f * ecNoiseOctave(
      t01, max(floor(k * 0.25f + 0.5f), 2.0f), s + 17.0f);
  return detail * (1.0f / 1.5f) * env * env;
}

// §4.6 — scallop variant: 1-D periodic cellular (Worley F1) over the
// angular lattice — one jittered feature point per lobe cell; the value
// peaks at each feature and drops in a sharp V between neighbors, giving
// rounded lobes with crisp notches (the scalloped pupillary-ruff margin).
// Same envelope; range ⊂ [-1, 1].
float ecPupilNoiseScallop(float theta, float freq, float seed) {
  float k = max(floor(freq + 0.5f), 1.0f);
  float s = floor(seed + 0.5f);
  float t01 = theta * (1.0f / 6.2831853f) + 0.5f;
  float x = t01 * k;
  float j = floor(x);
  float f1 = 2.0f;
  for (int c = -1; c <= 1; ++c) {
    float cell = j + float(c);
    // jittered feature point inside the (wrapped) cell
    float p = cell + 0.5f + 0.4f * ecLatticeVal(cell, k, s + 53.0f);
    f1 = min(f1, abs(x - p));
  }
  float env = 0.5f + 0.5f * ecNoiseOctave(
      t01, max(floor(k * 0.25f + 0.5f), 2.0f), s + 17.0f);
  return clamp(1.0f - 2.2f * f1, -1.0f, 1.0f) * env * env;
}

// §4.4/§4.6 — sanitized pupil/limbus geometry (normative). The pupil
// ellipse is capped relative to the limbus and its center is clamped so the
// WHOLE pupil stays inside the limbus for any input: in limbus-normalized
// space the pupil fits a disc of its largest normalized semi-axis times the
// worst-case §4.6 boundary reach, so |center_n| <= 1 - that reach
// guarantees containment.
struct EcPupilGeom {
  vec2 center;        // clamped pupil center (plane units)
  vec2 pupilAxes;     // pupil ellipse semi-axes  (Pa, Pb)
  vec2 limbusAxes;    // limbus ellipse semi-axes (La, Lb)
  // §4.6 pupil boundary shape, carried to ecPupilDilate:
  float exponent;     // superellipse exponent (2 = ellipse)
  float noiseAmount;  // rim-noise amplitude (0 = off)
  float noiseFreq;    // rim-noise base lobe count
  float noiseSeed;    // rim-noise phase seed
  float noiseType;    // 0 = lattice, 1 = billow
  // §4.7 pupil light bleed, carried to ecPupilDilate:
  float bleedAmount;  // veil strength at the rim (0 = off)
  float bleedWidth;   // reach into the pupil, dilation-f units
  float bleedExp;     // falloff exponent
  float bleedLight;   // §4.7b light response (0 = uniform)
  float bleedLightExp;// crescent shaping (= causticExponent, §4.2 family)
  vec2  bleedLightPS; // projector-space light XY (host-set)
  // §4.6 soft pupil edge, carried to ecPupilDilate:
  float blend;        // fringe width (fraction of pupil->limbus span)
  float blendExp;     // edge profile exponent (>1 = wider halo)
};
EcPupilGeom ecPupilGeom(float pupilRadius, EcLook look) {
  EcPupilGeom g;
  g.exponent = ecPupilExponent(look.pupilSquareness);
  g.noiseAmount = max(look.pupilNoiseAmount, 0.0f);
  g.noiseFreq = look.pupilNoiseFreq;
  g.noiseSeed = look.pupilNoiseSeed;
  g.noiseType = look.pupilNoiseType;
  g.bleedAmount = saturate(look.pupilBleedAmount);   // §4.7
  g.bleedWidth = look.pupilBleedWidth;
  g.bleedExp = look.pupilBleedExponent;
  g.bleedLight = saturate(look.pupilBleedLight);     // §4.7b
  g.bleedLightExp = look.causticExponent;
  g.bleedLightPS = look.bleedLightPS;
  g.blend = look.pupilBlend;                         // §4.6 soft pupil edge
  g.blendExp = look.pupilBlendExp;
  // §4.6 worst-case boundary reach vs the ellipse: superellipse corners
  // extend by at most 2^(1/2 - 1/n) (p-norm equivalence; exactly 1 at
  // n = 2) and rim noise by (1 + amount). Folding the reach into the caps
  // keeps rP < rL along every ray for ANY input; neutral params keep both
  // factors exactly 1 (exp2(0) = 1), preserving §4.4 bit-for-bit.
  float reach = exp2(0.5f - 1.0f / g.exponent) * (1.0f + g.noiseAmount);
  g.limbusAxes = vec2(max(look.limbusRadius * look.irisScaleX, EC_EPS_RAD),
                      max(look.limbusRadius * look.irisScaleY, EC_EPS_RAD));
  g.pupilAxes = vec2(
      clamp(pupilRadius * look.pupilScaleX, EC_EPS_RAD,
            0.98f * g.limbusAxes.x / reach),
      clamp(pupilRadius * look.pupilScaleY, EC_EPS_RAD,
            0.98f * g.limbusAxes.y / reach));
  vec2 cn = vec2(look.pupilOffsetX / g.limbusAxes.x,
                 look.pupilOffsetY / g.limbusAxes.y);
  float limit = max(1.0f - reach * max(g.pupilAxes.x / g.limbusAxes.x,
                                       g.pupilAxes.y / g.limbusAxes.y), 0.0f);
  float cl = length(cn);
  float k = (cl > limit) ? limit / max(cl, EC_EPS) : 1.0f;
  g.center = vec2(cn.x * k * g.limbusAxes.x, cn.y * k * g.limbusAxes.y);
  return g;
}

// §4.1/§4.4 — feature-preserving pupil dilation (normative formula),
// generalized to elliptical, decentered pupils. Along each ray from the
// pupil center, [pupil boundary, limbus boundary] maps linearly to the
// authored texture's [refPupilRadius, limbusRadius] — the texture stays
// circular and centered; limbus features stay pinned to the limbus.
// f < 0 => pupil. Neutral geometry reduces to the classic
// (rHit - pupilRadius) / (limbusRadius - pupilRadius).
struct EcDilated {
  vec2  uv;
  float pupilMask;
  float bleedWeight;  // §4.7 rim-veil weight — host composites ADDITIVELY
};
EcDilated ecPupilDilate(vec2 hit, EcPupilGeom g,
                        float refPupilRadius, float limbusRadius) {
  vec2 d = vec2(hit.x - g.center.x, hit.y - g.center.y);
  float rHit = length(d);
  // Direction from the pupil center. At the exact center it is undefined —
  // pick +X so rP/rL stay finite: §4.7 reads f's MAGNITUDE deep inside the
  // pupil (pre-§4.7 only its sign mattered there). The center pixel is
  // occluded by pupilMask = 1 either way, so neutral output is unchanged.
  vec2 u = (rHit > EC_EPS_RAD) ? d / rHit : vec2(1.0f, 0.0f);
  // §4.6 pupil boundary along u: ellipse at neutral squareness (exact §4.4
  // path — bit-for-bit normative), superellipse when squared off; rim noise
  // rides the boundary (amount 0 multiplies by exactly 1). The dilation
  // remap below follows automatically, so iris fibers compress/wobble with
  // the boundary like a real sphincter.
  float rP = (g.exponent <= 2.0f)
      ? ecEllipseRadius(g.pupilAxes.x, g.pupilAxes.y, u.x, u.y)
      : ecSuperellipseRadius(g.pupilAxes.x, g.pupilAxes.y, u.x, u.y,
                             g.exponent);
  // noiseType selects the algorithm; 0 keeps the exact lattice path.
  float thN = ecAtan2(u.y, u.x);
  float nz = (g.noiseType < 0.5f)
      ? ecPupilNoise(thN, g.noiseFreq, g.noiseSeed)
      : (g.noiseType < 1.5f)
          ? ecPupilNoiseBillow(thN, g.noiseFreq, g.noiseSeed)
          : (g.noiseType < 2.5f)
              ? ecPupilNoiseRidged(thN, g.noiseFreq, g.noiseSeed)
              : ecPupilNoiseScallop(thN, g.noiseFreq, g.noiseSeed);
  rP = rP * (1.0f + g.noiseAmount * nz);
  float rL = ecEllipseExit(g.center, u, g.limbusAxes.x, g.limbusAxes.y);
  // f: signed pupil->limbus distance, 0 at the pupil boundary, 1 at the limbus.
  float f = (rHit - rP) / max(rL - rP, EC_EPS_RAD);

  EcDilated o;
  // §4.6 — soft pupil edge: fade black -> iris over [0, g.blend] of the span
  // (0.01 AA floor), shaped by g.blendExp (>1 keeps the pupil darker further
  // out then falls off, a wider halo). blend 0 + exp 1 reproduces the legacy
  // crisp 0.01-AA edge, so neutral output is bit-for-bit unchanged.
  float m = smoothstep(0.0f, max(0.01f, g.blend), f);
  m = pow(m, max(g.blendExp, EC_EPS));
  o.pupilMask = 1.0f - m;
  // §4.7 pupil light bleed — a WEIGHT the host composites as ADDITIVE
  // veiling light over the dark pupil (never a mask ease: replacing the
  // pupil with full-brightness rim albedo read as paint, not glare).
  // Strongest at the rim (bt = 0), gone by bleedWidth (bt = 1) — the
  // pupil center stays dark. The clamped remap below samples the rim
  // ring inside the pupil, so the host's iris sample supplies the rim
  // hue. Amount 0 => weight 0 (neutral); follows the §4.6 boundary
  // since f is measured from the noisy superellipse.
  // Veil depth is a FRACTION of the local pupil radius along u
  // (bleedWidth 1 = reaches the center). An earlier form divided by the
  // per-direction iris band (rL − rP), which collapses along the long
  // axis of squared/bar pupils — the halo pinched into a bowtie meeting
  // at the center. Radius-proportional depth hugs the whole boundary at
  // a thickness scaling with local pupil size for ANY shape.
  float bt = saturate((1.0f - rHit / max(rP, EC_EPS_RAD)) /
                      max(g.bleedWidth, EC_EPS_RAD));
  float veil = g.bleedAmount * pow(max(1.0f - bt, 0.0f),
                                   max(g.bleedExp, 1.0f));
  // §4.7b — light-reactive veil: concentrate into the far-side crescent
  // (same sign convention as ecCausticKick: scatter exits opposite the
  // light), shaped by the §4.2 caustic exponent. Response 0 mixes by
  // exactly 0 (neutral §4.7); a degenerate light (|xy| ~ 0, e.g. light
  // straight down the eye axis) falls back to the uniform veil.
  float lLen = length(g.bleedLightPS);
  float sSide = dot(u, g.bleedLightPS / max(lLen, EC_EPS_RAD));
  float crescent = pow(saturate(-sSide), max(g.bleedLightExp, 1.0f));
  float lightGate = g.bleedLight * step(EC_EPS_RAD, lLen);
  o.bleedWeight = veil * mix(1.0f, crescent, lightGate);

  float fc = clamp(f, 0.0f, 1.0f);
  float rTex = refPupilRadius + fc * (limbusRadius - refPupilRadius);
  float rn = 0.5f * (rTex / max(limbusRadius, EC_EPS_RAD));
  o.uv = vec2(0.5f + rn * u.x, 0.5f + rn * u.y);
  return o;
}

// §3.8 — region weight by SURFACE radial coordinate (not the hit radius):
// 1 = iris side of the limbus band, 0 = sclera side. Arithmetic, branchless.
float ecIrisWeight(float rSurface, float limbusRadius, float limbusWidth) {
  return 1.0f - smoothstep(limbusRadius - limbusWidth,
                           limbusRadius + limbusWidth, rSurface);
}

// §4/§4.8 — procedural limbal ring (in-core always procedural; the host's
// optional texture modulates ON TOP via limbusUV). Returns a multiplier:
// 1 away from the ring, (1 - darkening) at its center. theta = surface
// azimuth; nAmount 0 scales width and darkening by exactly 1 (neutral).
float ecLimbusRing(float rSurface, float theta, float limbusRadius,
                   float limbusWidth, float darkening,
                   float nAmount, float nFreq, float nSeed) {
  float t01 = theta * (1.0f / 6.2831853f) + 0.5f;
  float k = max(floor(nFreq + 0.5f), 1.0f);
  float s = floor(nSeed + 0.5f);
  // independent lobes for darkening and width — the ring thins where it
  // lightens sometimes and not others, like a real limbal ring
  float nD = ecNoiseOctave(t01, k, s + 7.0f);
  float nW = ecNoiseOctave(t01, 2.0f * k + 1.0f, s + 43.0f);
  float w = max(limbusWidth * (1.0f + nAmount * 0.6f * nW), EC_EPS_RAD);
  float d = saturate(darkening * (1.0f + nAmount * nD));
  float ring = smoothstep(limbusRadius - 2.0f * w, limbusRadius, rSurface)
             * (1.0f - smoothstep(limbusRadius, limbusRadius + 2.0f * w, rSurface));
  return 1.0f - d * ring;
}

// §4.9 — sclera emissive MASK: where the white self-illuminates, as a plain
// multiplier for scleraColor * scleraEmissive. Texture-free and P-only, so a
// host can evaluate it on an EMISSION pin that never ran ecProjectIris — which
// is exactly Unreal's shape: the emissive Custom node rebuilds P from the
// primitive packs and has no projection result to read.
//
// Two earlier shapes were authored and REJECTED; they are recorded here so
// they do not get re-invented:
//   * a HARD region test (step at the limbus) draws a visible line where the
//     glow switches on;
//   * (1 - irisWeight) ALONE fills the limbal ring back in and flattens it,
//     because emission is not subject to the ring darkening that base colour
//     carries.
// The shipped mask is BOTH: the sclera's OWN §3.8 falloff, attenuated by the
// §4.8 ring, gated to the front hemisphere (the back pole also has small
// radial xy, so ungated it would mirror the glow onto the back of the eye).
//
// The ring term here is the STATIC darkening, NOT the §4.8b light-responsive
// one ecProjectIris applies to base colour: the glow has no light-response
// term of its own (it would need the primary light direction, which an
// emission pin does not carry), and the ring's static darkening is what the
// glow must respect.
float ecScleraEmissiveMask(vec3 P, float limbusRadius, float limbusWidth,
                           float irisScaleX, float irisScaleY,
                           float limbusDarkening, float nAmount,
                           float nFreq, float nSeed) {
  vec2 axes = vec2(max(limbusRadius * irisScaleX, EC_EPS_RAD),
                   max(limbusRadius * irisScaleY, EC_EPS_RAD));
  float rSurf = limbusRadius * length(vec2(P.x / axes.x, P.y / axes.y));
  float thSurf = ecAtan2(P.y, P.x);
  float frontGate = step(0.0f, P.z);
  float ringMul = mix(1.0f,
                      ecLimbusRing(rSurf, thSurf, limbusRadius, limbusWidth,
                                   limbusDarkening, nAmount, nFreq, nSeed),
                      frontGate);
  float scleraFrac =
      saturate(1.0f - ecIrisWeight(rSurf, limbusRadius, limbusWidth));
  return scleraFrac * ringMul * frontGate;
}

// §3.10 — Schlick Fresnel. F0 ~ 0.025 for the cornea (§2).
float ecFresnelSchlick(float NdotV, float F0) {
  float m = saturate(1.0f - saturate(NdotV));
  float m2 = m * m;
  return F0 + (1.0f - F0) * m2 * m2 * m;
}

// §7 — surface response: how the tear film and the tissue beneath it reach the
// host BSDF. The eye is a smooth dielectric film over tissue, so hosts split
// two ways and BOTH are served from here:
//   LAYERED  (Arnold coat, MDL fresnel_layer, MaterialX coat, Substrate coat
//            slab, three.js clearcoat) -> .coatF0 + .filmRoughness on the
//            coat, .baseRoughness on the base, and the host's own layering
//            supplies the energy split (do NOT also apply .baseMul there, it
//            would double-count). coatWeight goes on the host's coat weight,
//            gated to the front hemisphere by the host — .baseRoughness and
//            .filmRoughness are the two surfaces, not a blend of them.
//   SINGLE LOBE (UE Default Lit, hosts without a coat input) -> .roughness,
//            .specular and .baseMul, which collapse the layers. The collapse
//            costs little HERE specifically: under the cornea the base is a
//            REFRACTED image (§3), not a directly-lit rough surface, so the
//            second lobe was carrying far less than it does on a general
//            material.
// coatWeight 0 MUST reproduce the uncoated tissue exactly, and that state is a
// DRY eye: matte, no catchlight, no veiling sheen. It is reached by ROUGHNESS
// alone. The outermost interface is n ~ 1.376 either way (tear film 1.376,
// corneal epithelium / conjunctiva ~1.37-1.40), so drying the eye changes how
// the reflection SPREADS, never how much of it there is.
struct EcSurface {
  float roughness;      // single-lobe roughness   (UE MP_Roughness)
  float specular;       // single-lobe UE Specular (F0 = 0.08 * specular)
  float baseRoughness;  // tissue under the film   (layered hosts' base)
  float filmRoughness;  // the film itself         (layered hosts' coat)
  float coatF0;         // tear-film F0 at normal incidence (§2: ~0.025)
  float baseMul;        // §3.10 energy the base keeps under the film
};

EcSurface ecSurfaceResponse(float irisWeight, float frontGate, float NdotV,
                            float coatWeight, float coatRoughness,
                            float irisRoughness, float scleraRoughness,
                            float scleraFilmRoughness, float coatIor) {
  EcSurface o;
  float f  = (coatIor - 1.0f) / (coatIor + 1.0f);
  o.coatF0 = f * f;                       // 1.376 -> 0.0250 (§2, ecFresnelSchlick)
  // UNCOATED tissue — the dry eye. Desiccated stroma inside the limbus, dry
  // conjunctiva outside. Same smoothstep the sclera albedo and the §4.9
  // emissive blend by, so the roughness break lands exactly on the limbus and
  // never draws a seam.
  o.baseRoughness = mix(scleraRoughness, irisRoughness, irisWeight);
  // The film itself: optically smooth over the cornea, smooth but NOT a mirror
  // over the sclera, where the meniscus is thin and follows conjunctival
  // texture. That outer value needs its OWN scalar: reusing scleraRoughness
  // here made both ends of this blend identical at irisWeight 0, so coatWeight
  // was a no-op on the white and the sclera stayed pinned at its dry value
  // however wet the eye was dialled.
  o.filmRoughness = mix(scleraFilmRoughness, coatRoughness, irisWeight);
  // frontGate is the caller's film gate — a SMOOTH roll-off behind the
  // projector-space equator (smoothstep(-0.35, 0.0, Pp.z) at every host call
  // site), never a hard step: a step cut the film on the equator and drew a
  // shading seam down the sclera wherever that great circle swung into view.
  float w = saturate(coatWeight) * frontGate;   // no tear film on the back
  o.roughness = mix(o.baseRoughness, o.filmRoughness, w);
  // UE Specular 0.5 == F0 0.04 (IOR 1.5). coatF0 is what finally puts Unreal on
  // the same tear film as every other host. NOT blended by w: per the dry-eye
  // note above the wet and dry surfaces share the interface, and blending
  // toward 0.04 made the DRY eye the more reflective of the two — a broad
  // mid-roughness lobe at a HIGHER F0, which is exactly what reads as fog.
  o.specular  = o.coatF0 * 12.5f;                // 12.5 = 1/0.08
  // §3.10 energy. Light that lit the base crossed the film twice, so the base
  // keeps (1 - F)^2 of it. UE's clear coat applied precisely this and Default
  // Lit applies nothing: ShadingModels.ush:507-508 has RefractedDiffuse =
  // FresnelCoeff * Transmission * DefaultDiffuse with Lighting.Diffuse =
  // lerp(DefaultDiffuse, RefractedDiffuse, ClearCoat), FresnelCoeff = (1 - F)^2
  // at :435-437, and Transmission == 1 while Metallic is 0 (BRDF.ush:753). Drop
  // it and the film's own reflection lands on an unattenuated base, so the
  // refracted iris reads hazy instead of glazed.
  float t = 1.0f - ecFresnelSchlick(NdotV, o.coatF0);
  o.baseMul = mix(1.0f, t * t, w);
  return o;
}

// §4.2 — caustic kick (normative formula). Returns a color multiplier for the
// iris. lightPS = primary light direction in projector space, host-supplied
// (§4.2 host note); host sets causticStrength = 0 when |light.xy| < 1e-4.
float ecCausticKick(vec2 hitXY, float hitR, vec2 lightXY,
                    float strength, float exponent, float shadowStrength) {
  vec2 d2 = hitXY / max(hitR, EC_EPS_RAD);
  vec2 L2 = lightXY / max(length(lightXY), EC_EPS_RAD);
  float s = dot(d2, L2);                                  // -1 far ... +1 near
  float kick = strength * pow(saturate(-s), exponent);    // far-side brighten
  float shadow = shadowStrength * saturate(s);            // near-side darken
  return (1.0f + kick) * (1.0f - shadow);
}

// §4.5c — placed spec by DIRECTION. \`sdir\` is the highlight centre as a
// projector-space direction and need not be unit. This is the transform-driven
// entry point: a host converts a spec locator's world position with the same
// world->projector matrix it already builds (SPEC §5) and passes the result.
// Unlike (px, py) it can express the BACK hemisphere, where the front gate
// returns 0 instead of mirroring the highlight onto the front.
//
// §4.5b shape: \`sides\` names ONE OF THREE FORMS and is snapped to a whole
// number — 0 (or 1/2) = circle, 3 = triangle, 4 = square — with 5..12 kept
// as regular n-gons for looks that stored one. \`roundness\` eases the corners
// back toward the circle (0 = the shape as named, 1 = fully round),
// \`wide\`/\`tall\` scale it along its OWN axes so they turn with \`rotate\`, and
// core/falloff shape the edge that used to be a fixed smoothstep(0.35w, w).
// The RADIAL measure stays the angle to the centre; shape only decides how
// far the edge reaches per bearing, and every scale term is 1.0 at its
// default, so the unshaped path is arithmetically untouched.
float ecPlacedSpecDir(vec3 P, vec3 sdir, float size,
                      float sides, float roundness,
                      float wide, float tall, float rotate,
                      float core, float falloff) {
  vec3 d = P / max(length(P), EC_EPS);
  vec3 s = sdir / max(length(sdir), EC_EPS);
  float ang = acos(clamp(dot(d, s), -1.0f, 1.0f));

  // Shape ids are whole numbers. A fractional \`sides\` used to build a
  // fractional n-gon — 3.5 gave a lopsided shape with one split corner,
  // which is what made the dial read as "adds points" rather than "picks a
  // shape". Snapping means the slider lands on a form, never between two.
  float ns = floor(sides + 0.5f);

  float reach = 1.0f;
  // Inlined, not held in a \`bool\`: OSL reserves that word without providing
  // the type, so a named flag here compiled everywhere except Cycles and
  // Arnold-OSL — where it took the whole shader out, not just the branch.
  if ((ns >= 3.0f) || (wide != 1.0f) || (tall != 1.0f)) {
    // Tangent frame at the highlight centre: shape is a function of the
    // BEARING of the offset, which only exists in this frame.
    //
    // \`up\` is the PROJECTOR's up, not the axis furthest from s. Seeding the
    // frame with +Z — the old choice — degenerates exactly where catchlights
    // live: cross(+Z, s) vanishes at the cornea apex, so tx swung from +X to
    // +Y within a few degrees of centre and flipped again by placement
    // quadrant. \`wide\` therefore widened horizontally on a dead-centre
    // highlight and VERTICALLY on one nudged aside, and \`rotate\` had no
    // fixed zero. Seeding with +Y keeps tx horizontal and ty vertical for
    // every placement on the eye; +Z takes over only for a highlight at the
    // poles, where "horizontal" has no meaning left to preserve.
    vec3 up = (abs(s.y) > 0.999f) ? vec3(0.0f, 0.0f, 1.0f)
                                  : vec3(0.0f, 1.0f, 0.0f);
    vec3 tx = cross(up, s);
    tx = tx / max(length(tx), EC_EPS);
    vec3 ty = cross(s, tx);
    vec2 e = vec2(dot(d, tx), dot(d, ty));
    float el = length(e);
    vec2 b = (el > EC_EPS) ? e / el : vec2(1.0f, 0.0f);   // unit bearing

    // Into SHAPE space: undo \`rotate\`, then divide by the axes. Both happen
    // BEFORE the polygon is measured, and that order is the point. Scaling a
    // polygon's polar radius by an ellipse's afterwards — the old order —
    // multiplies two radii that peak at different bearings, so a square with
    // wide = 2 came out as a pincushioned star whose corners were pulled
    // INSIDE the circle it started from, not as a rectangle. Dividing first
    // makes the scale an affine map of the shape, and an affine map of a
    // polygon is still a polygon: a stretched square is a true rectangle, a
    // stretched triangle keeps straight edges with \`wide\` as its base and
    // \`tall\` as its height.
    float cs = cos(rotate), sn = sin(rotate);
    vec2 c = vec2(( b.x * cs + b.y * sn) / max(wide, EC_EPS),
                  (-b.x * sn + b.y * cs) / max(tall, EC_EPS));
    float cl = max(length(c), EC_EPS);

    // Normalized shape radius: 1 exactly on the boundary. Circle first, so
    // the ellipse case is the same arithmetic it always was. Deliberately
    // not called s-n-o-r-m: that spelling is an HLSL type modifier, and the
    // Maya VP2 and Unreal translations stop compiling on it.
    float shapeR = cl;
    if (ns >= 3.0f) {
      // Regular n-gon inscribed in the unit circle: its radius runs from
      // cos(pi/n) at an edge midpoint out to 1 at a corner.
      float k = 6.28318530718f / ns;
      // \`phase\` turns the n-gon into the shape the NAME promises. The bare
      // convention puts a corner at bearing 0, which draws the triangle
      // lying on its side pointing left and the square as a diamond — the
      // two things nobody means by "triangle" and "square". +30 deg stands
      // the triangle on its base with its apex up; +45 deg sits the square
      // flat, which is also what makes \`wide\`/\`tall\` read as width and
      // height rather than as diagonals.
      float phase = (ns == 3.0f) ? 0.52359877560f
                                 : ((ns == 4.0f) ? 0.78539816340f : 0.0f);
      float th = ecAtan2(c.y, c.x) - phase;
      // GLSL mod() by hand: HLSL fmod and C++ fmod keep the sign of the
      // dividend, which folds the wedge wrong for negative bearings.
      float wrap = (th + 3.14159265359f) / k;
      float a = (wrap - floor(wrap)) * k - 0.5f * k;
      float poly = cl * cos(a) / max(cos(0.5f * k), EC_EPS);
      shapeR = mix(poly, cl, saturate(roundness));
    }
    reach = 1.0f / max(shapeR, EC_EPS);
  }

  // core = where the gradient STARTS as a fraction of the reach, so it is the
  // sharp/soft dial: 0.999 leaves almost no ramp (hard-edged light), 0 ramps
  // from the very centre (soft glow). falloff then biases that ramp.
  float w = max(size * reach, EC_EPS_RAD);
  float t = smoothstep(clamp(core, 0.0f, 0.999f) * w, w, ang);
  if (falloff != 1.0f) t = pow(t, max(falloff, EC_EPS));
  // bright core, soft edge; front-gated (no mirror dot on the back pole)
  return (1.0f - t) * step(0.0f, d.z);
}

// Unchanged signature. The (px, py) form DERIVES z, so it can only ever place
// the highlight on the FRONT hemisphere; kept because every existing scene and
// look file stores those two scalars.
float ecPlacedSpecShaped(vec3 P, float px, float py, float size,
                         float sides, float roundness,
                         float wide, float tall, float rotate,
                         float core, float falloff) {
  float rr = px * px + py * py;
  vec3 s = vec3(px, py, sqrt(max(1.0f - rr, 0.0f)));  // rr > 1: rim placement
  return ecPlacedSpecDir(P, s, size, sides, roundness, wide, tall, rotate,
                         core, falloff);
}

// §4.5 — art-directed placed specular highlight ("placed spec"). Lighters
// pin the tear-film highlight to a spot ON the eye: (px, py) locate its
// center on the front unit hemisphere in projector XY (0,0 = cornea apex),
// size = outer angular radius in radians. The mask is glued to the surface
// (view-independent BY DESIGN — that is the art direction) and follows the
// projector, so it rides the gaze like everything else. Returns [0,1];
// the host multiplies by specPlaceIntensity and ADDS as emission (offline)
// or into the composite (realtime preview). Intensity 0 = feature off.

float ecPlacedSpec(vec3 P, float px, float py, float size) {
  // Round, default falloff: the historical highlight, kept as the two-arg
  // entry point so hosts that have not adopted the shaped form still link.
  // 0.35 = SCALARS/SpecPlaceCore, the single source every host reads; it is
  // spelled out here only because this shim takes no core argument.
  // sides 0 is the circle, so the roundness argument is inert here; it is
  // spelled 0 to match the shipped default rather than to mean anything.
  return ecPlacedSpecShaped(P, px, py, size, 0.0f, 0.0f, 1.0f, 1.0f, 0.0f,
                            0.35f, 1.0f);
}

// PLAN §5 — red-dominant wrap lighting for realtime sclera SSS. Host applies
// per light; offline targets use the renderer's BSSRDF instead.
float ecScleraWrap(float NdotL, float wrapAmount) {
  return saturate((NdotL + wrapAmount) / (1.0f + wrapAmount));
}

// SPEC §2/§6 — the canonical eyeball radius at polar direction dz (= the
// z component of the unit direction in projector space): 1.0 over the
// sclera, blending onto the corneal sphere (apex at corneaApexZ) inside the
// limbus, with the natural scleral sulcus at the seam. This is THE bulge
// definition — mesh generators bake it; displacement hosts (UE WPO,
// vertex-shader paths, Cycles/Arnold displacement) evaluate it live so the
// bulge follows the projector (gaze-tracking cornea on stylized eyes).
float ecEyeballRadius(float dz, float corneaApexZ, float corneaRadius,
                      float limbusRadius, float blendAngle) {
  float theta = acos(clamp(dz, -1.0f, 1.0f));
  float thetaLimbus = asin(clamp(limbusRadius, 0.0f, 1.0f));
  float w = 1.0f - smoothstep(thetaLimbus - blendAngle,
                              thetaLimbus + blendAngle, theta);
  float centerZ = corneaApexZ - corneaRadius;
  float disc = centerZ * centerZ * dz * dz +
               corneaRadius * corneaRadius - centerZ * centerZ;
  float t = centerZ * dz + sqrt(max(disc, 0.0f));
  return 1.0f + (t - 1.0f) * w;
}

// §6b/§4.4 — eyeball radius with an ELLIPTICAL limbus: the bulge boundary
// follows the limbus ellipse (semi-axes limbusRadius * irisScaleX/Y) by
// evaluating the canonical profile with the azimuth-dependent limbus radius.
// d = unit direction in projector space. Neutral scales reduce to
// ecEyeballRadius exactly.
float ecEyeballRadiusAniso(vec3 d, float corneaApexZ, float corneaRadius,
                           float limbusRadius, float irisScaleX,
                           float irisScaleY, float blendAngle) {
  float rxy = max(length(ecXY(d)), EC_EPS);
  float La = max(limbusRadius * irisScaleX, EC_EPS_RAD);
  float Lb = max(limbusRadius * irisScaleY, EC_EPS_RAD);
  float leff = ecEllipseRadius(La, Lb, d.x / rxy, d.y / rxy);
  return ecEyeballRadius(d.z, corneaApexZ, corneaRadius,
                         clamp(leff, 0.0f, 1.0f), blendAngle);
}

// §3.6 — single-tap parallax along the refracted ray (T0/T1).
// height01: T_iris alpha (1 = surface, 0 = deepest crevice).
// UV scale: the disc spans 2*La x 2*Lb plane units over 1 UV unit — the
// shift converts per axis (§4.4); circular limbus makes them equal.
vec2 ecIrisParallax(vec2 uv, vec3 R, float height01,
                    float heightScale, vec2 limbusAxes) {
  float rz = (R.z >= 0.0f) ? max(R.z, EC_EPS) : min(R.z, -EC_EPS);
  float depth = (1.0f - saturate(height01)) * heightScale;
  vec2 shift = (ecXY(R) / abs(rz)) * depth;
  return uv + vec2(shift.x * (0.5f / max(limbusAxes.x, EC_EPS_RAD)),
                   shift.y * (0.5f / max(limbusAxes.y, EC_EPS_RAD)));
}

// -------------------------------------------------- texture encoding -------

// SPEC 6 — decode a SAMPLED texel into the linear value the core expects.
// The host owns the sampler, so the host owns the decode; the core owns the
// transfer functions so every host agrees on the NUMBERS.
//
//   0 = Raw / linear  identity. The canonical Squarebit iris and sclera bakes
//                     hold LINEAR bytes (tools/export_web_iris.mjs: "the
//                     correct colourspace handling is the IDENTITY"), which is
//                     why this is the default in every host and reproduces the
//                     shipped look bit for bit.
//   1 = sRGB          IEC 61966-2-1 EOTF - what a paint package writes when an
//                     artist exports a hand-painted iris.
//   2 = Gamma 2.2     pure power, for a legacy 2.2-encoded plate.
//
// COLOUR channels ONLY. Iris alpha (height, SPEC 6), sclera alpha (cavity/AO)
// and the whole limbus map (grayscale breakup, SPEC 4.8) are DATA: running a
// transfer function over them is a bug, not a preference, so no host exposes
// a colour space for them.
//
// This is an ENCODING decode, not a colour-management transform: it changes
// the transfer function and never the primaries. That is deliberate - it is
// the part that is identical in every host and survives the SPEC 7 params
// round-trip, where an OCIO space name (which only means anything next to the
// config that defines it) would not.
float ecDecodeChannel(float c, int mode) {
  if (mode == 2) return pow(max(c, 0.0f), 2.2f);
  if (mode == 1) {
    float s = max(c, 0.0f);
    return (s <= 0.04045f) ? (s * (1.0f / 12.92f))
                           : pow((s + 0.055f) * (1.0f / 1.055f), 2.4f);
  }
  return c;
}

vec3 ecDecodeTexColor(vec3 c, int mode) {
  return vec3(ecDecodeChannel(c.x, mode), ecDecodeChannel(c.y, mode),
              ecDecodeChannel(c.z, mode));
}

// ------------------------------------------------------------- entry -------

// §3 pipeline steps 1-5 + 8 + 10 precursors, in normative order.
// P/V/N in projector space, V normalized surface->camera, N normalized.
// pupilRadius/lodBlend are the per-eye animated params (§4). The host then:
//   - applies ecIrisParallax with the sampled height (tier-gated),
//   - samples T_iris / T_sclera,
//   - applies ecCausticKick / ecScleraWrap / ringMul (T1+),
//   - composes with its native BSDF using .fresnel (§3.10).
EcIrisProj ecProjectIris(vec3 P, vec3 V, vec3 N,
                         float pupilRadius, float lodBlend, EcLook look) {
  // §3.2 refraction normal
  vec3 Nr = (look.refractionMode == 1)
              ? ecVirtualCorneaNormal(P, look.corneaCenterZ)
              : N;

  // §3.3 refract the view ray into the eye
  vec3 R = ecCorneaRefract(-V, Nr, look.eta);

  // §3.4 iris plane hit; §8 distance LOD lerps the UV INPUT (hit point)
  // toward the static front-facing projection (R = (0,0,-1) => hit = P.xy).
  vec2 hit = ecIrisPlaneIntersect(P, R, look.irisPlaneZ);
  hit = mix(hit, ecXY(P), saturate(lodBlend));

  // §3.5/§4.4 pupil geometry (containment-clamped) + dilation remap
  EcPupilGeom g = ecPupilGeom(pupilRadius, look);
  EcDilated dil = ecPupilDilate(hit, g, look.refPupilRadius,
                                look.limbusRadius);
  vec2 hitP = vec2(hit.x - g.center.x, hit.y - g.center.y);

  // §3.8 region weights from the SURFACE point via the equivalent circular
  // radius (elliptical limbus normalized back to limbusRadius units), gated
  // to the front hemisphere (the back pole also has small radial xy).
  float rSurf = look.limbusRadius *
      length(vec2(P.x / g.limbusAxes.x, P.y / g.limbusAxes.y));
  float frontGate = step(0.0f, P.z);

  EcIrisProj o;
  o.uv           = clamp(dil.uv, vec2(0.0f, 0.0f), vec2(1.0f, 1.0f));
  o.pupilMask    = dil.pupilMask * frontGate;
  o.bleedWeight  = dil.bleedWeight * frontGate;
  o.irisWeight   = ecIrisWeight(rSurf, look.limbusRadius, look.limbusWidth)
                 * frontGate;
  float thSurf = ecAtan2(P.y, P.x);
  // §4.8b light-dependent limbus: fade the ring as the light goes head-on.
  // lGraze = projector-space light XY magnitude (~0 head-on ... 1 grazing).
  // response 0 keeps the static darkening (legacy, bit-for-bit); response 1
  // scales it by lGraze so the ring nearly vanishes under direct frontal light.
  float lGraze = saturate(length(look.bleedLightPS));
  float limbusDark = look.limbusDarkening
                   * mix(1.0f, lGraze, saturate(look.limbusLightResponse));
  o.ringMul      = mix(1.0f,
                       ecLimbusRing(rSurf, thSurf, look.limbusRadius,
                                    look.limbusWidth, limbusDark,
                                    look.limbusNoiseAmount,
                                    look.limbusNoiseFreq,
                                    look.limbusNoiseSeed),
                       frontGate);  // no mirror ring on the back hemisphere
  // §4.8 ring-band UV for the host's optional limbus texture: x wraps the
  // ring, y spans the ring band (inner 0 .. outer 1).
  float lw4 = max(4.0f * look.limbusWidth, EC_EPS_RAD);
  o.limbusUV     = vec2(thSurf * (1.0f / 6.2831853f) + 0.5f,
                        saturate((rSurf - (look.limbusRadius -
                                           2.0f * look.limbusWidth)) / lw4));
  o.fresnel      = ecFresnelSchlick(dot(N, V), look.F0);
  o.refractedDir = R;
  o.hitR         = length(hitP);   // pupil-centered (caustic focuses there)
  o.hitXY        = hitP;
  return o;
}

#endif // EC_EYE_CORE_INCLUDED
`;
