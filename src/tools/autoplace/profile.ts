// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Reading a character's shape from its vertices.
//
// Most uploads have no skeleton, so there is nothing exact to read and the app
// has to work out where things are from the mesh itself. This module does the
// measuring; fromProportions.ts turns the measurements into guides.
//
// The method is horizontal slabs. Slice the character into bands of height and
// describe each one - how wide, how deep, and crucially whether its cross
// section is ONE mass or TWO. That last question is what finds the crotch
// without any assumption about proportions: scanning up from the floor, the
// legs are two separate masses until they are not, and the height where they
// merge is the crotch on a child, a giant or a cartoon frog alike.
//
// Everything here is deliberately proportion-FREE. Standard human ratios are a
// fallback in fromProportions.ts for the guides the shape cannot locate; using
// them here would mean measuring a character and then ignoring the answer.
//
// Pure functions over plain arrays: no three.js, no renderer, fully testable
// against synthetic shapes whose landmarks are known exactly.
// ==========================================================================

import type { Vec3 } from '../../doc/types';

/** One horizontal band of the character. */
export interface Slab {
  /** Centre height of the band. */
  y: number;
  /** Vertices falling in it. Bands below this are treated as empty. */
  count: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
  /**
   * How many separate masses the cross section contains. One through the
   * torso; two through the legs; three where the arms are clear of the body
   * (arm, torso, arm) and four where hands flank two legs.
   */
  clusters: number;
  /** Centre in x of each mass, ascending. Length matches `clusters`. */
  clusterCenters: number[];
  /**
   * Whether the character's midline is INSIDE the mesh at this height.
   *
   * The single most useful signal in the profile. Below the crotch a vertical
   * line down the middle passes between the legs and hits nothing; above it,
   * it is inside the torso. Arms cannot affect it, which is exactly why it
   * beats counting masses - the arms split the cross section too, and a
   * count-based test finds where the ARMS merge rather than the legs.
   */
  centerOccupied: boolean;
  /**
   * Width of the mass containing the midline, ignoring limbs held clear.
   *
   * The torso's own width. `width` spans everything including outstretched
   * arms, which makes it useless for finding a waist.
   */
  centralWidth: number;
}

export interface BodyProfile {
  slabs: Slab[];
  minY: number;
  maxY: number;
  height: number;
  centerX: number;
  centerZ: number;
}

/** Below this many vertices a band is noise rather than anatomy. */
const MIN_SLAB_POINTS = 6;

/**
 * Bins used across a band's width when looking for a gap between two masses.
 *
 * Occupancy, not nearest-neighbour gaps. Measured against the real blockout,
 * a gap-versus-width threshold cannot separate legs: a standing human's legs
 * are a few centimetres apart across a 36cm stance, so the gap is a tenth of
 * the width and any threshold loose enough to catch it also splits a lumpy
 * torso. Asking instead "is there a run of genuinely EMPTY space inside this
 * cross section" is scale free and answers the actual question.
 */
const CLUSTER_BINS = 24;

/** Empty bins in a row, strictly inside the band, that count as a real gap. */
const MIN_EMPTY_RUN = 2;

/**
 * Measure a character's shape.
 *
 * `slabCount` trades resolution for noise. 64 puts each band at roughly 2.7cm
 * on a 1.75m human, which resolves a neck without every band being empty.
 */
export function buildProfile(points: readonly Vec3[], slabCount = 64): BodyProfile {
  const empty: BodyProfile = {
    slabs: [],
    minY: 0,
    maxY: 0,
    height: 0,
    centerX: 0,
    centerZ: 0
  };
  if (points.length === 0) return empty;

  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[2] < minZ) minZ = p[2];
    if (p[2] > maxZ) maxZ = p[2];
  }

  const height = maxY - minY;
  if (!(height > 0)) return empty;

  const buckets: Vec3[][] = Array.from({ length: slabCount }, () => []);
  for (const p of points) {
    // The topmost vertex would land one past the end; clamp it into the last
    // band rather than dropping the crown of the head.
    const t = (p[1] - minY) / height;
    const index = Math.min(slabCount - 1, Math.max(0, Math.floor(t * slabCount)));
    (buckets[index] as Vec3[]).push(p);
  }

  // The midline has to be known before the bands can be described, since each
  // band reports whether that line is inside it.
  //
  // The midpoint of the bounds, NOT the centroid. A centroid is pulled around
  // by wherever the mesh happens to be more densely tessellated, so on a
  // perfectly symmetric character it lands a fraction off centre - and every
  // guide placed relative to it then comes out asymmetric by twice that. The
  // bounds midpoint is the symmetry plane by construction.
  const centerX = (minX + maxX) / 2;

  const slabs = buckets.map((bucket, index) =>
    describeSlab(bucket, minY + ((index + 0.5) / slabCount) * height, centerX)
  );

  return {
    slabs,
    minY,
    maxY,
    height,
    centerX,
    centerZ: (minZ + maxZ) / 2
  };
}

function describeSlab(points: readonly Vec3[], y: number, centerX: number): Slab {
  if (points.length < MIN_SLAB_POINTS) {
    return {
      y,
      count: points.length,
      minX: 0,
      maxX: 0,
      minZ: 0,
      maxZ: 0,
      width: 0,
      depth: 0,
      clusters: 0,
      clusterCenters: [],
      centerOccupied: false,
      centralWidth: 0
    };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const xs: number[] = [];

  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[2] < minZ) minZ = p[2];
    if (p[2] > maxZ) maxZ = p[2];
    xs.push(p[0]);
  }

  const width = maxX - minX;
  const masses = findMasses(xs, minX, width);

  const central = masses.find((m) => m.min <= centerX && centerX <= m.max);

  return {
    y,
    count: points.length,
    minX,
    maxX,
    minZ,
    maxZ,
    width,
    depth: maxZ - minZ,
    clusters: masses.length,
    clusterCenters: masses.map((m) => (m.min + m.max) / 2),
    centerOccupied: central !== undefined,
    centralWidth: central ? central.max - central.min : 0
  };
}

interface Mass {
  min: number;
  max: number;
}

/**
 * Separate a band's x values into runs of occupied space.
 *
 * Bins across the band's own width and treats a run of empty bins as air.
 * Occupancy rather than nearest-neighbour gaps: measured against the real
 * blockout, a gap-versus-width threshold cannot separate legs, because a
 * standing figure's legs are a few centimetres apart across a 36cm stance, so
 * the gap is a tenth of the width and any threshold loose enough to catch it
 * also splits a lumpy torso.
 */
function findMasses(xs: readonly number[], minX: number, width: number): Mass[] {
  if (width <= 0) return [{ min: minX, max: minX }];

  const counts = new Array<number>(CLUSTER_BINS).fill(0);
  for (const x of xs) {
    const bin = Math.min(
      CLUSTER_BINS - 1,
      Math.max(0, Math.floor(((x - minX) / width) * CLUSTER_BINS))
    );
    counts[bin] = (counts[bin] as number) + 1;
  }

  const binWidth = width / CLUSTER_BINS;
  const masses: Mass[] = [];
  let runStart = -1;
  let empty = 0;

  for (let i = 0; i < CLUSTER_BINS; i++) {
    if ((counts[i] as number) > 0) {
      if (runStart === -1) runStart = i;
      empty = 0;
    } else if (runStart !== -1) {
      empty++;
      if (empty >= MIN_EMPTY_RUN) {
        masses.push({
          min: minX + runStart * binWidth,
          max: minX + (i - empty + 1) * binWidth
        });
        runStart = -1;
        empty = 0;
      }
    }
  }
  if (runStart !== -1) {
    masses.push({ min: minX + runStart * binWidth, max: minX + width });
  }

  return masses.length > 0 ? masses : [{ min: minX, max: minX + width }];
}

// -------------------------------------------------------------------------
// Landmarks
// -------------------------------------------------------------------------

/**
 * Heights and widths of the features a biped template needs.
 *
 * Every value is in the same space as the points that were measured.
 */
export interface BodyLandmarks {
  groundY: number;
  topY: number;
  height: number;
  /** Where the legs merge into the torso. */
  crotchY: number;
  /** Where the arms join, taken as the top of the widest region. */
  shoulderY: number;
  /** Narrowest band above the shoulders. */
  neckY: number;
  /** Narrowest band between crotch and shoulders. */
  waistY: number;
  /** Half the distance between the two leg masses just below the crotch. */
  hipHalfWidth: number;
  /** Half the torso width at the shoulders. */
  shoulderHalfWidth: number;
  /** Furthest the character reaches sideways below the shoulders. */
  armReachX: number;
  /**
   * Height at which that furthest reach occurs - the hands, in any rest pose.
   *
   * Needed because an arm is not horizontal. In an A-pose the hands are well
   * below the shoulders, so placing an elbow by interpolating along the
   * shoulder line would put it in mid air beside the ribs.
   */
  armTipY: number;
  /** Front-to-back centre, for placing guides that sit on the mid-plane. */
  centerZ: number;
  /**
   * How much the shape actually looked like a biped, 0..1. Low values mean the
   * measurements are guesses and the caller should say so rather than present
   * them as fact.
   */
  confidence: number;
}

/**
 * Derive landmarks from a profile, or null when the shape is unusable.
 *
 * The order matters: the crotch is found first because it is the most reliable
 * signal in the whole profile - two masses becoming one is unambiguous - and
 * every later search is bounded by it.
 */
export function findLandmarks(profile: BodyProfile): BodyLandmarks | null {
  const { slabs, minY, maxY, height } = profile;
  if (slabs.length < 8 || height <= 0) return null;

  const occupied = slabs.filter((s) => s.count >= MIN_SLAB_POINTS);
  if (occupied.length < 6) return null;

  let confidence = 1;

  // --- crotch: the lowest height where two leg masses become one ---------
  const crotchIndex = findCrotchIndex(slabs);
  if (crotchIndex === -1) confidence *= 0.6;
  const crotchY =
    crotchIndex === -1 ? minY + height * 0.5 : (slabs[crotchIndex] as Slab).y;

  // --- shoulders: the top of the body's widest region --------------------
  const shoulderIndex = findShoulderIndex(slabs, crotchIndex);
  if (shoulderIndex === -1) confidence *= 0.6;
  const shoulderY =
    shoulderIndex === -1 ? minY + height * 0.8 : (slabs[shoulderIndex] as Slab).y;

  // Searches are bounded by the resolved HEIGHTS rather than by the raw
  // indices. When a landmark falls back, its index is -1, and using that
  // directly sent the waist search down to the ankles - the narrowest part of
  // the whole character, and confidently wrong.
  const crotchAt = indexAtY(slabs, crotchY);
  const shoulderAt = indexAtY(slabs, shoulderY);

  // --- neck: narrowest band above the shoulders --------------------------
  const neckIndex = narrowestBetween(slabs, shoulderAt + 1, slabs.length - 2);
  const neckY = neckIndex === -1 ? minY + height * 0.87 : (slabs[neckIndex] as Slab).y;

  // --- waist: narrowest band between crotch and shoulders ----------------
  const waistIndex = narrowestBetween(slabs, crotchAt + 1, shoulderAt - 1);
  const waistY =
    waistIndex === -1 ? crotchY + (shoulderY - crotchY) * 0.45 : (slabs[waistIndex] as Slab).y;

  // --- widths ------------------------------------------------------------
  const belowCrotch = slabs[Math.max(0, crotchAt - 2)] as Slab | undefined;
  const hipHalfWidth =
    belowCrotch && belowCrotch.clusters === 2
      ? Math.abs(
          ((belowCrotch.clusterCenters[1] as number) -
            (belowCrotch.clusterCenters[0] as number)) /
            2
        )
      : height * 0.05;

  const shoulderSlab = slabs[Math.max(0, shoulderAt)] as Slab | undefined;
  // The torso at the shoulder line, not the arm span.
  const shoulderHalfWidth = shoulderSlab
    ? (shoulderSlab.centralWidth > 0 ? shoulderSlab.centralWidth : shoulderSlab.width) / 2
    : height * 0.11;

  let armReachX = 0;
  let armTipY = shoulderY;
  for (const slab of slabs) {
    if (slab.count < MIN_SLAB_POINTS) continue;
    if (slab.y > shoulderY) continue;
    const reach = Math.max(Math.abs(slab.minX), Math.abs(slab.maxX));
    if (reach > armReachX) {
      armReachX = reach;
      armTipY = slab.y;
    }
  }

  // A body whose landmarks come out in the wrong order is not a biped, and
  // saying so is more useful than emitting nonsense confidently.
  if (!(crotchY < waistY && waistY < shoulderY && shoulderY < neckY)) {
    confidence *= 0.4;
  }

  // Ordering alone is not enough. A quadruped produces perfectly ordered
  // landmarks that are nonsense as biped anatomy - measured on the stock
  // horse, the "shoulders" land at 52% of its height, where a person's are at
  // 82%. Bounds wide enough for a child, a heroic build or a stylised figure,
  // and narrow enough to notice an animal.
  const crotchFraction = (crotchY - minY) / height;
  const shoulderFraction = (shoulderY - minY) / height;
  if (crotchFraction < 0.3 || crotchFraction > 0.62) confidence *= 0.5;
  if (shoulderFraction < 0.68 || shoulderFraction > 0.92) confidence *= 0.5;

  return {
    groundY: minY,
    topY: maxY,
    height,
    crotchY,
    shoulderY,
    neckY,
    waistY,
    hipHalfWidth,
    shoulderHalfWidth,
    armReachX: armReachX || height * 0.2,
    armTipY,
    centerZ: profile.centerZ,
    confidence
  };
}

/**
 * The lowest band where the midline enters the body.
 *
 * Scanning up from the floor, the first height at which a vertical line down
 * the character's centre is inside the mesh, and stays inside. Below that the
 * line runs between the legs.
 *
 * Counting masses instead does not work: the arms split the cross section as
 * surely as the legs do, so on the real blockout that test found where the
 * ARMS merge, 63% of the way up, and called it the crotch. The midline is
 * blind to anything held out to the side.
 *
 * The run requirement stops a single noisy band, or a gap between the feet at
 * ankle height, from being mistaken for the crotch.
 */
function findCrotchIndex(slabs: readonly Slab[]): number {
  const RUN = 4;
  for (let i = 1; i < slabs.length - RUN; i++) {
    const below = slabs[i - 1] as Slab;
    if (below.count >= MIN_SLAB_POINTS && below.centerOccupied) continue;

    const above = slabs.slice(i, i + RUN);
    const insideAbove = above.every(
      (s) => s.count >= MIN_SLAB_POINTS && s.centerOccupied
    );
    if (insideAbove) return i;
  }
  return -1;
}

/**
 * The top of the widest part of the body.
 *
 * Arms make the character widest, and in any rest pose - A or T - the arms
 * begin at the shoulders, so the HIGHEST band that is still much wider than
 * the head is the shoulder line. Measuring against the head rather than
 * against an absolute width keeps this working on any build.
 */
function findShoulderIndex(slabs: readonly Slab[], crotchIndex: number): number {
  const top = slabs.length - 1;
  const headBandStart = Math.floor(slabs.length * 0.88);
  const headWidth = medianCentralWidth(slabs.slice(headBandStart, top + 1));
  if (headWidth <= 0) return -1;

  const threshold = headWidth * 1.8;
  const lowest = Math.max(crotchIndex + 1, 0);

  for (let i = top; i > lowest; i--) {
    const slab = slabs[i] as Slab;
    if (slab.count < MIN_SLAB_POINTS) continue;
    if (slab.width >= threshold) return i;
  }
  return -1;
}

/** Index of the band containing `y`, clamped into range. */
function indexAtY(slabs: readonly Slab[], y: number): number {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < slabs.length; i++) {
    const distance = Math.abs((slabs[i] as Slab).y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/**
 * Index of the band with the narrowest TORSO in [from, to], or -1.
 *
 * Measured on the central mass rather than the full span. A waist band that
 * happens to have the forearms passing through it is two feet wide overall and
 * would never win on total width, which is how the waist ended up at the
 * ankles the first time this ran.
 */
function narrowestBetween(slabs: readonly Slab[], from: number, to: number): number {
  let bestIndex = -1;
  let bestWidth = Infinity;
  for (let i = Math.max(0, from); i <= Math.min(slabs.length - 1, to); i++) {
    const slab = slabs[i] as Slab;
    if (slab.count < MIN_SLAB_POINTS) continue;
    const torso = slab.centralWidth > 0 ? slab.centralWidth : slab.width;
    if (torso < bestWidth) {
      bestWidth = torso;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function medianCentralWidth(slabs: readonly Slab[]): number {
  const widths = slabs
    .filter((s) => s.count >= MIN_SLAB_POINTS)
    .map((s) => (s.centralWidth > 0 ? s.centralWidth : s.width))
    .sort((a, b) => a - b);
  if (widths.length === 0) return 0;
  return widths[Math.floor(widths.length / 2)] as number;
}
