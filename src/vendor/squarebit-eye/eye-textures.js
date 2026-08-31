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
// VENDORED from the Squarebit Eye repo (web/src/eye-textures.js), and NOT a
// byte-for-byte copy: this store copy also emits the per-section iris LAYERS
// (opts.emitLayers / generateIrisLayers) the widget's .zip download hands out.
// Those blocks are marked "STORE-ONLY" below and allocate nothing on the live
// render path; everything else is upstream verbatim. Re-vendor by re-copying
// the repo file and re-applying the STORE-ONLY blocks (and this note).
// ==========================================================================

// Procedural eye textures (SPEC §6 disc layout), shared by the harness and
// the three.js demo. Deterministic — no Math.random. Real scanned texture
// sets can replace these; the disc layout contract is what matters.

/** Deterministic value-noise helpers (sin-hash lattice + smooth lerp). */
const hash2 = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const smooth = (t) => t * t * (3 - 2 * t);
const vnoise = (x, y) => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = smooth(x - xi);
  const ty = smooth(y - yi);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
};
/** Periodic 1-D noise in angle (wraps seamlessly at 2π). */
const anoise = (theta, freq, seed) =>
  vnoise(Math.cos(theta) * freq * 0.5 + 37.7 * seed,
         Math.sin(theta) * freq * 0.5 + 11.3 * seed);

/** Iris: RGB albedo, A = height (1 = surface). SPEC §6 disc layout with the
 *  authored pupil at refPupil01 and the limbus at disc radius 1.
 *
 *  Look modeled on Filter Forge #6466: deep sage-green body under many
 *  fine WISPY light filaments (soft, smoke-like — not hard lines), an
 *  amber/rust halo hugging the pupil with spikes radiating into the green,
 *  a brighter band mid-radius, and a gradual darkening toward the rim.
 *  Deliberately NO painted pupil and NO limbal ring — the shader renders
 *  both dynamically.
 *
 *  The look is art-directable when no scanned texture is supplied:
 *    opts.outerColor / opts.innerColor ([r,g,b] 0..1) — filament body color
 *      (its darker base and cooler accent are derived from it) and pupil
 *      halo color
 *    opts.detail       — angular frequency multiplier for the filaments (1)
 *    opts.fiberStrength — how strongly filaments read over the base (1)
 *    opts.haloSize     — pupil halo reach multiplier (1)
 *    opts.haloStrength — pupil halo opacity multiplier (1)
 *    opts.spotDensity  — pigment freckles/blotches, 0 = none (0)
 *    opts.spotScale    — freckle blotch size multiplier (1)
 *    opts.spotSpread   — how far freckles range radially from the
 *      mid-iris band (1)
 *    opts.spotSeed     — integer re-roll of the freckle layout (0)
 *    opts.spotColor    — freckle pigment color ([0.28, 0.14, 0.05])
 *    opts.fiberWaviness — polar-noise warp of the filament angle: 0 =
 *      straight strands (default), 1 = strongly wandering strands
 *    opts.fiberClumping — low-frequency angular density envelope: 0 =
 *      uniform (default), 1 = dense sectors alternating with sparse ones
 *    opts.spotIrregularity — domain-warps the freckle noise so blotches
 *      grow ragged organic outlines: 0 = off (default)
 *    opts.fiberStyle   — 0 wispy (default), 1 billow, 2 ridged
 *    opts.spotOpacity  — freckle blend strength (0.9 = historical default)
 *    opts.spotColorVary — per-blotch shade/opacity variation (0 = flat)
 *    opts.fiberGaps    — dark radial channels between strands (0 = none)
 *    opts.fiberCrypts  — larger round pockets carved into the structure
 *      and the height map (0 = none)
 *    opts.heteroAmount/heteroAngle/heteroSoftness/heteroColor — sectoral
 *      heterochromia: a noisy-edged color wedge (amount = fraction of the
 *      circle, 0 = off; angle in degrees; softness = edge feather)
 *  Defaults reproduce the sage-green/amber look (spots OFF).
 *  Returns {width, height, data}. */
export function generateIrisRGBA(size = 512, refPupil01 = 0.342, opts = {}) {
  const data = new Uint8Array(size * size * 4);
  // STORE-ONLY: optional per-section layer buffers (opts.emitLayers) so the
  // widget's export can hand out editable, re-stackable layers. Stacking
  // base -> heterochromia -> halo -> spots (normal alpha over) reproduces the
  // composite; height is the parallax/depth map. Guarded — the live render
  // path allocates nothing.
  const LB = opts.emitLayers
    ? {
        base: new Uint8Array(size * size * 4),
        halo: new Uint8Array(size * size * 4),
        hetero: new Uint8Array(size * size * 4),
        spots: new Uint8Array(size * size * 4),
        height: new Uint8Array(size * size * 4)
      }
    : null;
  // Second map. Same values as A, emitted separately so hosts that want a
  // real depth texture need not carry the albedo's alpha around.
  const depth = new Uint8Array(size * size);
  const sage = opts.outerColor ?? [0.46, 0.62, 0.47];  // lit filament body
  const amber = opts.innerColor ?? [0.47, 0.28, 0.10]; // pupil halo
  const detail = opts.detail ?? 1;
  const fiber = opts.fiberStrength ?? 1;
  const haloSize = opts.haloSize ?? 1;
  const haloStrength = opts.haloStrength ?? 1;
  const spotDensity = opts.spotDensity ?? 0;
  const spotScale = opts.spotScale ?? 1;
  const spotSpread = opts.spotSpread ?? 1;
  const spotSeed = opts.spotSeed ?? 0;
  const spotColor = opts.spotColor ?? [0.28, 0.14, 0.05];
  const fiberWaviness = opts.fiberWaviness ?? 0;
  const fiberClumping = opts.fiberClumping ?? 0;
  const spotIrregularity = opts.spotIrregularity ?? 0;
  // 0 = wispy (default), 1 = billow (creased abs-FBM bunches),
  // 2 = ridged (sharp bright crests — stringy fibers)
  const fiberStyle = Math.round(opts.fiberStyle ?? 0);
  // spot art direction: blend opacity (0.9 = the historical constant) and
  // per-blotch variation (0 = flat single pigment, unchanged output)
  const spotOpacity = opts.spotOpacity ?? 0.9;
  const spotColorVary = opts.spotColorVary ?? 0;
  // fiber gaps: dark radial valleys between strands; crypts: larger round
  // pockets carved in disc space (both 0 = none, unchanged output)
  const fiberGaps = opts.fiberGaps ?? 0;
  const fiberCrypts = opts.fiberCrypts ?? 0;
  // sectoral heterochromia: a color wedge with noisy, feathered edges.
  // amount = fraction of the circle covered (0 = off, unchanged output);
  // angle = wedge center in degrees; softness = edge feather.
  const heteroAmount = opts.heteroAmount ?? 0;
  const heteroAngle = opts.heteroAngle ?? 0;
  const heteroSoftness = opts.heteroSoftness ?? 0.15;
  const heteroColor = opts.heteroColor ?? [0.35, 0.28, 0.52];
  const heteroDark = [heteroColor[0] * 0.12, heteroColor[1] * 0.17,
                      heteroColor[2] * 0.16];
  const heteroRad = (heteroAngle * Math.PI) / 180;
  // DEPTH (SPEC 3.6 parallax). Historically these five weights were literals
  // in the alpha write, which welded relief to albedo: a crypt could not be
  // deep without also being dark. They are opts now, defaulting to exactly
  // the old literals, so an untouched bake is byte-identical.
  const depthBase = opts.depthBase ?? 0.35;
  const depthFibers = opts.depthFibers ?? 0.6;
  const depthCrypts = opts.depthCrypts ?? 0.4;
  const depthGaps = opts.depthGaps ?? 0.2;
  const depthCryptRim = opts.depthCryptRim ?? 0.28;
  // collarette: the ruff ridge at the pupil margin. The most readable relief
  // on a real iris, and nothing drove it before. 0 = off, output unchanged.
  const depthCollarette = opts.depthCollarette ?? 0;
  const depthCollaretteWidth = opts.depthCollaretteWidth ?? 0.18;
  // post-shaping, applied only when non-default so the default stays bitwise
  // identical (a (h-0.5)*1+0.5 round trip is NOT exact in floating point).
  const depthContrast = opts.depthContrast ?? 1;
  const depthBias = opts.depthBias ?? 0;
  const depthInvert = opts.depthInvert ?? false;
  const depthShaped = depthContrast !== 1 || depthBias !== 0 || depthInvert;
  // derived shades: between-filament base and cooler filament accents
  const darkGreen = [sage[0] * 0.12, sage[1] * 0.17, sage[2] * 0.16];
  const teal = [sage[0] * 0.78, sage[1] * 0.94, sage[2] * 1.11];
  const lerp3 = (a, b, t) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ];
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  for (let y = 0; y < size; ++y) {
    for (let x = 0; x < size; ++x) {
      const dx = ((x + 0.5) / size) * 2 - 1;
      const dy = ((y + 0.5) / size) * 2 - 1;
      const rho = Math.min(Math.hypot(dx, dy), 1.0);
      const th = Math.atan2(dy, dx);
      // 0 at the authored pupil edge, 1 at the limbus; inside the pupil the
      // detail continues (the shader may reveal it while dilating)
      const t = clamp01((rho - refPupil01) / (1 - refPupil01));

      // --- wispy filaments: several soft angular octaves whose phase
      // drifts with radius (smoke-like strands, never hard spokes).
      // fiberWaviness adds a 2-D polar-noise warp of the angle (varies
      // with BOTH angle and radius — seamless via the cos/sin lattice),
      // bending the strands into wandering, organic paths; two octaves
      // so big meanders carry finer wobble. 0 warps by exactly 0.
      const wav = fiberWaviness *
        (0.30 * (vnoise(Math.cos(th) * 3 + 91.7,
                        Math.sin(th) * 3 + t * 6.0 + 13.1) - 0.5) +
         0.12 * (vnoise(Math.cos(th) * 8 + 47.3,
                        Math.sin(th) * 8 + t * 14.0 + 67.9) - 0.5));
      const thw = th + wav;
      const drift1 = 2.2 * t + 1.2 * anoise(thw, 5, 1);
      const drift2 = 3.6 * t + 0.8 * anoise(thw, 9, 2);
      const w1 = anoise(thw + drift1 * 0.08, 110 * detail, 3);
      const w2 = anoise(thw + drift2 * 0.05, 230 * detail, 4);
      const w3 = anoise(thw + drift1 * 0.03, 420 * detail, 5);
      const w4 = anoise(thw - drift2 * 0.04, 60 * detail, 6);
      // Recombine the same four octaves per fiber style — ports stay
      // byte-exact because the octave inputs are shared:
      //   wispy  — soft-max blend (bright where any octave peaks)
      //   billow — abs-FBM (2|w|-1 creases: bunched, cresting ridges)
      //   ridged — 1-|2w-1| squared (sharp bright strand crests)
      let wisp;
      if (fiberStyle === 1) {
        wisp =
          0.4 * Math.abs(2 * w1 - 1) + 0.3 * Math.abs(2 * w2 - 1) +
          0.18 * Math.abs(2 * w3 - 1) + 0.12 * Math.abs(2 * w4 - 1);
        wisp = clamp01(wisp * 1.25);
      } else if (fiberStyle === 2) {
        const r1 = 1 - Math.abs(2 * w1 - 1);
        const r2 = 1 - Math.abs(2 * w2 - 1);
        const r3 = 1 - Math.abs(2 * w3 - 1);
        wisp = clamp01(
          (0.5 * r1 * r1 + 0.3 * r2 * r2 + 0.2 * r3 * r3) * 1.3 - 0.12);
      } else {
        // soft-max blend: bright where any octave peaks, dark in gaps
        wisp =
          0.34 * w1 + 0.26 * w2 + 0.18 * w3 + 0.22 * w4 +
          0.35 * Math.max(w1, w2) - 0.28;
        wisp = clamp01(wisp * 1.35);
      }
      wisp *= wisp * (1.6 - 0.6 * wisp); // gentle S-curve, keeps softness

      // radial intensity profile: dim at the pupil, brightest band around
      // t ~ 0.45, gently darker toward the rim (the reference vignettes)
      const band =
        0.42 + 0.58 * Math.exp(-(((t - 0.45) / 0.34) ** 2));
      const rimFade = 1.0 - 0.52 * smooth(clamp01((t - 0.55) / 0.45));
      // fiberClumping: low-frequency angular density envelope — dense
      // sectors alternate with sparse ones (iris crypts). 0 multiplies
      // by exactly 1.
      const clump = clamp01(1.0 - fiberClumping *
        (0.7 * anoise(th, 6, 21) + 0.3 * anoise(th, 13, 22)));
      // fiberGaps: sharp angular cellular valleys that drift with radius —
      // the dark channels between fiber strands. fiberCrypts: larger round
      // pockets in disc space, carved out of the structure (and dug into
      // the height map below, so the parallax reads them as deep). Both
      // multiply by exactly 1 at their 0 defaults.
      const gapN = anoise(thw + drift1 * 0.06, 30 * detail, 51);
      const gaps = fiberGaps * smooth(clamp01((0.42 - gapN) / 0.22));
      // fiberCrypts: organic pockets in the iris stroma (Brendon Souza's
      // radial-sample technique). A multi-octave field on the (angle-ring,
      // radius) cylinder — fine in angle, coarse in radius — so the blobs
      // stretch radially like real crypts; thresholded into holes, each with
      // a raised, lighter RIM (the procedural edge-detect: a band right at the
      // hole boundary). Replaces the old round disc-space pockets.
      const cca = 13 * detail; // angular frequency (fine => thin blobs)
      const ccr = 4.2;         // radial frequency (coarse => long blobs)
      const cf =
        0.55 * vnoise(Math.cos(thw) * cca + 21.0,
                      Math.sin(thw) * cca + t * ccr + 5.0) +
        0.30 * vnoise(Math.cos(thw) * cca * 2.1 + 61.0,
                      Math.sin(thw) * cca * 2.1 + t * ccr * 2.0 + 33.0) +
        0.15 * vnoise(Math.cos(thw) * cca * 4.3 + 9.0,
                      Math.sin(thw) * cca * 4.3 + t * ccr * 3.7 + 77.0);
      // holeS: 0 outside the pocket .. 1 deep inside (cf below threshold)
      const holeS = smooth(clamp01((0.46 - cf) / 0.16));
      const cryptHole = fiberCrypts * holeS;
      // rim: bright band hugging the pocket edge (peaks where holeS ~ 0.5)
      const cryptRim = fiberCrypts * 4.0 * holeS * (1.0 - holeS);
      const carve = clamp01(1 - 0.92 * gaps - 0.95 * cryptHole);
      let strength = clamp01(wisp * band * rimFade * fiber * clump * carve);
      // raised, lighter crypt rims (Brendon's outline add) — brighten the
      // stroma at the pocket edge so it reads as a raised lip, not a cut.
      strength = clamp01(strength + cryptRim * 0.8 * band * rimFade);

      // --- filament color: sage with teal drift per sector
      const coolMix = clamp01(0.5 + (anoise(th, 7, 7) - 0.5) * 1.4);
      const filament = lerp3(sage, teal, coolMix);
      let rgb = lerp3(darkGreen, filament, strength);
      const baseRgb = rgb;                  // §layer: base (pre hetero/halo/spots)
      let heteroSector = null, heteroM = 0; // §layer: heterochromia
      let spotVCol = null, spotA = 0;       // §layer: spots

      // --- sectoral heterochromia: recolor the fiber structure (same
      // strength field, different pigment) inside a wedge whose edges
      // wobble with angle and drift with radius — never a hard CG line.
      if (heteroAmount > 0) {
        let da = Math.abs(th - heteroRad);
        da = Math.min(da, 2 * Math.PI - da) / Math.PI;   // 0..1 from center
        const wobble =
          0.10 * (anoise(th, 9, 71) - 0.5) * 2 +
          0.05 * (anoise(th + t * 1.7, 17, 72) - 0.5) * 2;
        const half = Math.min(heteroAmount, 1) * 0.5;
        const m = smooth(clamp01(
          (half - da + wobble) / Math.max(heteroSoftness * 0.5, 1e-3)));
        const sector = lerp3(heteroDark, heteroColor, strength);
        rgb = lerp3(rgb, sector, m);
        heteroSector = sector;
        heteroM = m;
      }

      // --- amber pupil halo with radiating spikes melting into the green
      const spike = 0.05 + 0.12 * anoise(th, 46, 8) ** 2 +
        0.05 * anoise(th, 15, 9);
      const halo = Math.exp(-((t / ((0.11 + spike) * haloSize)) ** 2)) *
        (0.6 + 0.4 * wisp) * haloStrength;
      rgb = lerp3(rgb, amber, clamp01(halo));

      // faint warm streaks continuing outward from the halo
      const warmStreak = Math.exp(-(((t - 0.18 * haloSize) / 0.2) ** 2)) *
        Math.max(0, w4 - 0.55) * 1.5 * haloStrength;
      rgb = lerp3(rgb, amber, clamp01(warmStreak));
      // §layer: combined amber coverage (halo + warm streak) as one alpha
      const haloA = 1 - (1 - clamp01(halo)) * (1 - clamp01(warmStreak));

      // --- pigment freckles: irregular blotches thresholded from disc-space
      // noise, clustered on the mid-iris band (spread widens the band),
      // deterministic per seed. density 0 keeps the output byte-identical.
      if (spotDensity > 0) {
        const sf = 7 / Math.max(spotScale, 1e-3);
        // spotIrregularity: warp the blotch-noise domain so freckle
        // outlines grow ragged and organic. 0 offsets by exactly 0.
        const swb = spotIrregularity * 1.6;
        const swx = swb * (vnoise(dx * sf * 0.37 + 5.1,
                                  dy * sf * 0.37 + 9.2) - 0.5);
        const swy = swb * (vnoise(dx * sf * 0.37 + 77.7,
                                  dy * sf * 0.37 + 31.4) - 0.5);
        const sxx = dx * sf + swx + 53.1 * (spotSeed + 1);
        const syy = dy * sf + swy + 17.7 * (spotSeed + 1);
        const sn = 0.55 * vnoise(sxx, syy) +
          0.3 * vnoise(sxx * 2.3 + 11.4, syy * 2.3 + 71.2) +
          0.15 * vnoise(sxx * 5.1 + 37.9, syy * 5.1 + 5.3);
        const gate = Math.exp(
          -(((t - 0.5) / Math.max(0.3 * spotSpread, 1e-4)) ** 2));
        const thr = 0.97 - 0.42 * Math.min(spotDensity, 1);
        const mask = smooth(clamp01((sn * gate - thr) / 0.07));
        // per-blotch variation: a low-frequency noise re-shades each
        // freckle (lighter ones drift warm and more transparent, darker
        // ones cool and denser) so they stop reading as one flat pigment.
        // vary 0 multiplies by exactly 1 → byte-identical output.
        const vt = (vnoise(sxx * 0.45 + 91.3, syy * 0.45 + 47.7) - 0.5) * 2;
        const vCol = [
          clamp01(spotColor[0] * (1 + spotColorVary * vt * 0.51)),
          clamp01(spotColor[1] * (1 + spotColorVary * vt * 0.45)),
          clamp01(spotColor[2] * (1 + spotColorVary * vt * 0.39))
        ];
        const vOpacity =
          spotOpacity * (1 - spotColorVary * 0.3 * (0.5 - 0.5 * vt));
        rgb = lerp3(rgb, vCol, mask * vOpacity);
        spotVCol = vCol;
        spotA = mask * vOpacity;
      }

      // fine grain so nothing airbrushes
      const grain = 0.92 + 0.16 * (vnoise(dx * 28 + 7.3, dy * 28 + 41.1) - 0.5);

      const i = (y * size + x) * 4;
      data[i] = Math.max(0, Math.min(255, rgb[0] * grain * 255));
      data[i + 1] = Math.max(0, Math.min(255, rgb[1] * grain * 255));
      data[i + 2] = Math.max(0, Math.min(255, rgb[2] * grain * 255));
      // height: filaments raised, gaps sunken (drives the parallax); crypt
      // pockets dig deeper, and their rims push back UP so the parallax reads
      // a raised lip around each pocket (not just a flat dark cut).
      let h = (depthBase + depthFibers * wisp)
        * (1 - depthCrypts * cryptHole - depthGaps * gaps)
        + depthCryptRim * cryptRim;
      if (depthCollarette !== 0) {
        // smoothstep ridge peaking at the pupil edge (t = 0) and dying out by
        // depthCollaretteWidth, riding on top of the fiber relief.
        const c = clamp01(1 - t / Math.max(depthCollaretteWidth, 1e-4));
        h += depthCollarette * c * c * (3 - 2 * c);
      }
      if (depthShaped) {
        h = (h - 0.5) * depthContrast + 0.5 + depthBias;
        if (depthInvert) h = 1 - h;
      }
      const h8 = Math.max(0, Math.min(255, h * 255));
      data[i + 3] = h8;
      depth[y * size + x] = h8;

      if (LB) {
        const g = grain;
        const c = (v) => Math.max(0, Math.min(255, v * 255));
        LB.base[i] = c(baseRgb[0] * g); LB.base[i + 1] = c(baseRgb[1] * g);
        LB.base[i + 2] = c(baseRgb[2] * g); LB.base[i + 3] = 255;
        LB.halo[i] = c(amber[0]); LB.halo[i + 1] = c(amber[1]);
        LB.halo[i + 2] = c(amber[2]); LB.halo[i + 3] = c(haloA);
        if (heteroSector) {
          LB.hetero[i] = c(heteroSector[0]); LB.hetero[i + 1] = c(heteroSector[1]);
          LB.hetero[i + 2] = c(heteroSector[2]); LB.hetero[i + 3] = c(heteroM);
        }
        if (spotVCol) {
          LB.spots[i] = c(spotVCol[0]); LB.spots[i + 1] = c(spotVCol[1]);
          LB.spots[i + 2] = c(spotVCol[2]); LB.spots[i + 3] = c(spotA);
        }
        // follows the depth dials for free: re-reads the alpha just written
        LB.height[i] = h8; LB.height[i + 1] = h8;
        LB.height[i + 2] = h8; LB.height[i + 3] = 255;
      }
    }
  }
  return LB
    ? { width: size, height: size, data, depth, layers: LB }
    : { width: size, height: size, data, depth };
}

/** Iris depth as a standalone RGBA8 grayscale image (R=G=B=depth, A=255).
 *  A wrapper over generateIrisRGBA, not a reimplementation, so the standalone
 *  map can never drift from the albedo's alpha: one pass makes both. */
export function generateIrisDepthRGBA(size = 512, refPupil01 = 0.342,
                                      opts = {}) {
  const src = generateIrisRGBA(size, refPupil01, opts);
  const out = new Uint8Array(size * size * 4);
  for (let p = 0; p < size * size; ++p) {
    const v = src.depth[p];
    out[p * 4] = v; out[p * 4 + 1] = v; out[p * 4 + 2] = v; out[p * 4 + 3] = 255;
  }
  return { width: size, height: size, data: out };
}

/** STORE-ONLY. Procedural iris as editable, re-stackable layers (opts as
 *  generateIrisRGBA).
 *  Returns [{name, width, height, data}] - stack base -> heterochromia -> halo
 *  -> spots (normal alpha over) to reproduce the composite; height is the depth
 *  map. Empty sections (no spots / no heterochromia) are omitted. */
export function generateIrisLayers(size = 512, refPupil01 = 0.342, opts = {}) {
  const img = generateIrisRGBA(size, refPupil01, { ...opts, emitLayers: true });
  const L = img.layers;
  const wrap = (name, buf) => ({ name, width: size, height: size, data: buf });
  const out = [wrap('base', L.base)];
  if ((opts.heteroAmount ?? 0) > 0) out.push(wrap('heterochromia', L.hetero));
  out.push(wrap('halo', L.halo));
  if ((opts.spotDensity ?? 0) > 0) out.push(wrap('spots', L.spots));
  out.push(wrap('height', L.height));
  return out;
}

/** Sclera: warm near-white with faint veins; A = cavity/AO. */
export function generateScleraRGBA(size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; ++y) {
    for (let x = 0; x < size; ++x) {
      const u = (x + 0.5) / size, v = (y + 0.5) / size;
      const vein = 0.05 * (0.5 + 0.5 * Math.sin(u * 80 + Math.sin(v * 23) * 4));
      const i = (y * size + x) * 4;
      data[i] = Math.min(255, (0.97 - vein * 0.3) * 255);
      data[i + 1] = Math.min(255, (0.95 - vein) * 255);
      data[i + 2] = Math.min(255, (0.94 - vein) * 255);
      data[i + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

/** Plain-white sclera (1×1) — for hosts that want an untextured white. */
export function generateWhiteScleraRGBA() {
  return { width: 1, height: 1, data: new Uint8Array([250, 250, 250, 255]) };
}
