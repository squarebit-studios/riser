// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Matching a rig's joint names to our template's guide ids.
//
// This is the whole difficulty of using a loaded skeleton. The geometry is
// exact and free - a joint already IS the position a guide wants - but no two
// rigs agree on what to call anything:
//
//   ours      ShoulderL   ElbowL      WristL    HipL      KneeL    AnkleL
//   Mixamo    LeftArm     LeftForeArm LeftHand  LeftUpLeg LeftLeg  LeftFoot
//   Unreal    upperarm_l  lowerarm_l  hand_l    thigh_l   calf_l   foot_l
//   Rigify    upper_arm.L forearm.L   hand.L    thigh.L   shin.L   foot.L
//   3ds Max   Bip01 L UpperArm ...
//
// Note how badly the words themselves collide. Mixamo's "LeftLeg" is the SHIN,
// not the leg; its "LeftArm" is the upper arm. Matching on substrings would
// confidently put the knee at the hip. So each guide declares an ordered list
// of exact cores it accepts, and a joint has to match one of them outright.
//
// Everything here is pure string work over plain data, so the whole matching
// table is testable against real rigs without loading a single mesh.
// ==========================================================================

export type Side = 'left' | 'right' | 'center';

export interface ParsedJoint {
  /** The name as the rig spelled it. */
  raw: string;
  /** Lowercase, punctuation and side tokens removed. */
  core: string;
  side: Side;
}

/**
 * Exporter prefixes that carry no anatomical meaning. Stripped before
 * anything else, or `mixamorig:LeftArm` never matches `arm`.
 */
const VENDOR_PREFIXES = [
  'mixamorig',
  'bip',
  'bip01',
  'bip001',
  'biped',
  'root',
  'armature',
  'rig',
  'def',
  'org',
  'mch'
];

/** Whole words that mean "left", once the name is split into tokens. */
const LEFT_WORDS = new Set(['l', 'lf', 'left']);
const RIGHT_WORDS = new Set(['r', 'rt', 'right']);

/**
 * Split a joint name into tokens on every convention in use: separators
 * (`_ . : - space`), camelCase boundaries, and letter-to-digit boundaries.
 *
 * That last split is not cosmetic. Mixamo spells the spine chain `Spine`,
 * `Spine1`, `Spine2` with no separator at all; without it those arrive as a
 * single token and match nothing, silently losing the entire torso on the most
 * common rig in existence.
 */
export function tokenize(raw: string): string[] {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .split(/[\s_.:\-|/]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
}

/**
 * Normalise an index token so the conventions agree: Mixamo's `Spine1` and
 * Unreal's `spine_01` are the same joint and must produce the same core.
 */
function normalizeDigits(token: string): string {
  return /^\d+$/.test(token) ? String(Number.parseInt(token, 10)) : token;
}

/**
 * Reduce a joint name to a side and a comparable core.
 *
 * Index digits are KEPT, normalised. They carry real meaning - `Spine1` is not
 * `Spine`, and `Thumb1` is the knuckle while `Thumb3` is the tip - so dropping
 * them collapses distinct joints onto one guide. A leading digit group left
 * over from a vendor prefix (`Bip01 L UpperArm`) is dropped instead, because
 * that one is bookkeeping rather than anatomy.
 */
export function parseJointName(raw: string): ParsedJoint {
  let tokens = tokenize(raw).map(normalizeDigits);

  // Vendor prefixes only count at the front - "root" is a real joint name on
  // its own, and dropping it anywhere would erase it.
  while (tokens.length > 1 && VENDOR_PREFIXES.includes(tokens[0] as string)) {
    tokens = tokens.slice(1);
  }
  while (tokens.length > 1 && /^\d+$/.test(tokens[0] as string)) {
    tokens = tokens.slice(1);
  }

  let side: Side = 'center';
  const kept: string[] = [];
  for (const token of tokens) {
    if (LEFT_WORDS.has(token)) {
      side = 'left';
      continue;
    }
    if (RIGHT_WORDS.has(token)) {
      side = 'right';
      continue;
    }
    kept.push(token);
  }

  return { raw, core: kept.join(''), side };
}

/** The side a guide id implies, from its L/R suffix. */
export function sideOfGuideId(id: string): Side {
  if (/[a-z0-9]L$/.test(id)) return 'left';
  if (/[a-z0-9]R$/.test(id)) return 'right';
  return 'center';
}

export interface JointHint {
  /**
   * Accepted cores, best first. Position in this list becomes the match score,
   * so put the unambiguous names before the ones that collide.
   */
  cores: string[];
}

/**
 * What each biped guide will accept as a joint.
 *
 * Ordered deliberately. `upperarm` is unambiguous everywhere, so it leads;
 * `arm` is last because Mixamo means the upper arm by it while other rigs mean
 * the whole limb.
 */
export const BIPED_JOINT_HINTS: Readonly<Record<string, JointHint>> = {
  root: { cores: ['root', 'reference'] },
  pelvis: { cores: ['pelvis', 'hips', 'hip', 'cog', 'torso'] },
  // The spine chain is the one place names genuinely cannot decide the
  // answer: Mixamo's `Spine1` is the MID spine, Unreal's `spine_01` is the
  // LOWER one. Same string, different bone. These lists get the chain roughly
  // right, and `orderSpineChain` in fromSkeleton.ts corrects it using the
  // hierarchy, which is the only thing that actually knows.
  spine01: { cores: ['spine', 'spine1', 'spinelower', 'abdomen', 'waist'] },
  spine02: { cores: ['spine2', 'spinemid', 'chestlower'] },
  chest: {
    cores: ['chest', 'spine3', 'spineupper', 'upperchest', 'ribcage', 'torsoupper']
  },
  neck: { cores: ['neck', 'neck1', 'neckbase'] },
  head: { cores: ['head', 'skull'] },
  headTop: { cores: ['headtopend', 'headtop', 'headend', 'crown'] },

  clavicleL: { cores: ['clavicle', 'shoulder', 'collar', 'scapula'] },
  shoulderL: { cores: ['upperarm', 'armupper', 'shoulderjoint', 'arm'] },
  elbowL: { cores: ['lowerarm', 'forearm', 'elbow', 'armlower'] },
  wristL: { cores: ['hand', 'wrist'] },

  clavicleR: { cores: ['clavicle', 'shoulder', 'collar', 'scapula'] },
  shoulderR: { cores: ['upperarm', 'armupper', 'shoulderjoint', 'arm'] },
  elbowR: { cores: ['lowerarm', 'forearm', 'elbow', 'armlower'] },
  wristR: { cores: ['hand', 'wrist'] },

  hipL: { cores: ['thigh', 'upleg', 'upperleg', 'hip', 'legupper'] },
  kneeL: { cores: ['calf', 'shin', 'knee', 'lowerleg', 'leglower', 'leg'] },
  ankleL: { cores: ['foot', 'ankle'] },
  toeBaseL: { cores: ['toebase', 'ball', 'toe', 'toe1'] },
  toeTipL: { cores: ['toeend', 'toetip', 'toe2'] },

  hipR: { cores: ['thigh', 'upleg', 'upperleg', 'hip', 'legupper'] },
  kneeR: { cores: ['calf', 'shin', 'knee', 'lowerleg', 'leglower', 'leg'] },
  ankleR: { cores: ['foot', 'ankle'] },
  toeBaseR: { cores: ['toebase', 'ball', 'toe', 'toe1'] },
  toeTipR: { cores: ['toeend', 'toetip', 'toe2'] },

  thumbBaseL: { cores: ['handthumb1', 'thumb1', 'thumba', 'thumb'] },
  thumbTipL: { cores: ['handthumb3', 'thumb3', 'thumbc', 'thumbdistal'] },
  indexBaseL: { cores: ['handindex1', 'index1', 'indexa', 'index'] },
  indexTipL: { cores: ['handindex3', 'index3', 'indexc', 'indexdistal'] },
  pinkyBaseL: { cores: ['handpinky1', 'pinky1', 'littlefinger1', 'pinky'] },
  pinkyTipL: { cores: ['handpinky3', 'pinky3', 'littlefinger3'] },

  thumbBaseR: { cores: ['handthumb1', 'thumb1', 'thumba', 'thumb'] },
  thumbTipR: { cores: ['handthumb3', 'thumb3', 'thumbc', 'thumbdistal'] },
  indexBaseR: { cores: ['handindex1', 'index1', 'indexa', 'index'] },
  indexTipR: { cores: ['handindex3', 'index3', 'indexc', 'indexdistal'] },
  pinkyBaseR: { cores: ['handpinky1', 'pinky1', 'littlefinger1', 'pinky'] },
  pinkyTipR: { cores: ['handpinky3', 'pinky3', 'littlefinger3'] },

  jaw: { cores: ['jaw'] },
  eyeL: { cores: ['eye'] },
  eyeR: { cores: ['eye'] }
};

/** Quadruped rigs vary far more; these cover the common horse/dog naming. */
export const QUADRUPED_JOINT_HINTS: Readonly<Record<string, JointHint>> = {
  root: { cores: ['root', 'reference'] },
  pelvis: { cores: ['pelvis', 'hips', 'hip', 'croup'] },
  spineLower: { cores: ['spine', 'spine1', 'spinelower', 'loin'] },
  spineMid: { cores: ['spine2', 'spinemid', 'back'] },
  chest: { cores: ['chest', 'spine3', 'spineupper', 'withers', 'ribcage'] },
  neckBase: { cores: ['neck', 'neck1', 'neckbase'] },
  neckMid: { cores: ['neck2', 'neckmid'] },
  head: { cores: ['head', 'skull', 'poll'] },
  tailBase: { cores: ['tail', 'tail1', 'tailbase'] },
  tailMid: { cores: ['tail2', 'tailmid'] },
  tailTip: { cores: ['tailend', 'tailtip'] },

  scapulaL: { cores: ['scapula', 'shoulderblade', 'clavicle'] },
  shoulderFL: { cores: ['upperarm', 'shoulder', 'armupper'] },
  elbowFL: { cores: ['lowerarm', 'forearm', 'elbow'] },
  carpusL: { cores: ['carpus', 'wrist', 'frontknee'] },
  fetlockFL: { cores: ['fetlock', 'frontfetlock', 'metacarpus', 'cannon'] },
  hoofFL: { cores: ['hoof', 'fronthoof', 'foot', 'paw'] },

  scapulaR: { cores: ['scapula', 'shoulderblade', 'clavicle'] },
  shoulderFR: { cores: ['upperarm', 'shoulder', 'armupper'] },
  elbowFR: { cores: ['lowerarm', 'forearm', 'elbow'] },
  carpusR: { cores: ['carpus', 'wrist', 'frontknee'] },
  fetlockFR: { cores: ['fetlock', 'frontfetlock', 'metacarpus', 'cannon'] },
  hoofFR: { cores: ['hoof', 'fronthoof', 'foot', 'paw'] },

  hipL: { cores: ['thigh', 'upleg', 'upperleg', 'hip'] },
  stifleL: { cores: ['stifle', 'knee', 'shin', 'calf'] },
  hockL: { cores: ['hock', 'ankle', 'tarsus'] },
  fetlockBL: { cores: ['fetlock', 'backfetlock', 'metatarsus'] },
  hoofBL: { cores: ['hoof', 'backhoof', 'foot', 'paw'] },

  hipR: { cores: ['thigh', 'upleg', 'upperleg', 'hip'] },
  stifleR: { cores: ['stifle', 'knee', 'shin', 'calf'] },
  hockR: { cores: ['hock', 'ankle', 'tarsus'] },
  fetlockBR: { cores: ['fetlock', 'backfetlock', 'metatarsus'] },
  hoofBR: { cores: ['hoof', 'backhoof', 'foot', 'paw'] }
};

export const JOINT_HINTS_BY_TEMPLATE: Readonly<
  Record<string, Readonly<Record<string, JointHint>>>
> = {
  biped: BIPED_JOINT_HINTS,
  quadruped: QUADRUPED_JOINT_HINTS,
  face: BIPED_JOINT_HINTS
};

export interface JointMatch {
  guideId: string;
  /** Index into the skeleton's joint list. */
  jointIndex: number;
  jointName: string;
  /** 0..1. Falls off with how far down the alias list the match was found. */
  confidence: number;
}

/**
 * Match guide ids to joints.
 *
 * One joint can only serve one guide: rigs contain far more joints than a
 * template has guides, and letting two guides share a joint would stack two
 * markers in the same place and quietly report both as placed. Matches are
 * therefore taken best-first and each joint is consumed.
 */
export function matchJointsToGuides(
  guideIds: readonly string[],
  jointNames: readonly string[],
  hints: Readonly<Record<string, JointHint>>
): JointMatch[] {
  const parsed = jointNames.map(parseJointName);

  interface Candidate extends JointMatch {
    rank: number;
  }
  const candidates: Candidate[] = [];

  for (const guideId of guideIds) {
    const hint = hints[guideId];
    if (!hint) continue;
    const wantSide = sideOfGuideId(guideId);

    for (let jointIndex = 0; jointIndex < parsed.length; jointIndex++) {
      const joint = parsed[jointIndex] as ParsedJoint;

      // A sided guide must match a joint on that side. Without this, "hand"
      // matches both hands and the left wrist lands on whichever came first.
      if (wantSide !== 'center' && joint.side !== wantSide) continue;
      // A centre guide must not take a sided joint - the spine is not the
      // left spine.
      if (wantSide === 'center' && joint.side !== 'center') continue;

      const rank = hint.cores.indexOf(joint.core);
      if (rank === -1) continue;

      candidates.push({
        guideId,
        jointIndex,
        jointName: joint.raw,
        rank,
        // Later aliases are the ambiguous ones, so confidence falls with rank.
        confidence: Math.max(0.5, 1 - rank * 0.1)
      });
    }
  }

  candidates.sort((a, b) => a.rank - b.rank || a.guideId.localeCompare(b.guideId));

  const usedGuides = new Set<string>();
  const usedJoints = new Set<number>();
  const matches: JointMatch[] = [];

  for (const candidate of candidates) {
    if (usedGuides.has(candidate.guideId)) continue;
    if (usedJoints.has(candidate.jointIndex)) continue;
    usedGuides.add(candidate.guideId);
    usedJoints.add(candidate.jointIndex);
    matches.push({
      guideId: candidate.guideId,
      jointIndex: candidate.jointIndex,
      jointName: candidate.jointName,
      confidence: candidate.confidence
    });
  }

  return matches;
}
