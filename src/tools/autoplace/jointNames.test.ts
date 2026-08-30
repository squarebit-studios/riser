import { describe, it, expect } from 'vitest';
import {
  BIPED_JOINT_HINTS,
  matchJointsToGuides,
  parseJointName,
  sideOfGuideId,
  tokenize
} from './jointNames';
import { getTemplate } from '../../templates';

/**
 * Joint lists as the common rigs actually spell them.
 *
 * These are the test's whole value. Matching logic can be made to pass against
 * names invented to suit it; only real conventions prove anything - and they
 * are adversarial, because the same English word means different bones in
 * different rigs.
 */
const MIXAMO = [
  'mixamorig:Hips',
  'mixamorig:Spine',
  'mixamorig:Spine1',
  'mixamorig:Spine2',
  'mixamorig:Neck',
  'mixamorig:Head',
  'mixamorig:HeadTop_End',
  'mixamorig:LeftShoulder',
  'mixamorig:LeftArm',
  'mixamorig:LeftForeArm',
  'mixamorig:LeftHand',
  'mixamorig:RightShoulder',
  'mixamorig:RightArm',
  'mixamorig:RightForeArm',
  'mixamorig:RightHand',
  'mixamorig:LeftUpLeg',
  'mixamorig:LeftLeg',
  'mixamorig:LeftFoot',
  'mixamorig:LeftToeBase',
  'mixamorig:RightUpLeg',
  'mixamorig:RightLeg',
  'mixamorig:RightFoot',
  'mixamorig:RightToeBase'
];

const UNREAL = [
  'root',
  'pelvis',
  'spine_01',
  'spine_02',
  'spine_03',
  'neck_01',
  'head',
  'clavicle_l',
  'upperarm_l',
  'lowerarm_l',
  'hand_l',
  'clavicle_r',
  'upperarm_r',
  'lowerarm_r',
  'hand_r',
  'thigh_l',
  'calf_l',
  'foot_l',
  'ball_l',
  'thigh_r',
  'calf_r',
  'foot_r',
  'ball_r'
];

const RIGIFY = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'shoulder.L',
  'upper_arm.L',
  'forearm.L',
  'hand.L',
  'shoulder.R',
  'upper_arm.R',
  'forearm.R',
  'hand.R',
  'thigh.L',
  'shin.L',
  'foot.L',
  'thigh.R',
  'shin.R',
  'foot.R'
];

/**
 * Our own rigged stock asset, which follows the same convention as the rigs
 * above rather than Riser's guide vocabulary - see the note in
 * tools/make-stock-assets.mjs.
 */
const RISER_STOCK = [
  'Root',
  'Hips',
  'Spine',
  'Chest',
  'Neck',
  'Head',
  'UpperArmL',
  'LowerArmL',
  'HandL',
  'UpperArmR',
  'LowerArmR',
  'HandR',
  'ThighL',
  'CalfL',
  'FootL',
  'ThighR',
  'CalfR',
  'FootR'
];

const BIPED_GUIDE_IDS = getTemplate('biped').guides.map((g) => g.id);

function match(joints: readonly string[]) {
  const result = matchJointsToGuides(BIPED_GUIDE_IDS, joints, BIPED_JOINT_HINTS);
  return new Map(result.map((m) => [m.guideId, m.jointName]));
}

describe('tokenize', () => {
  it('splits every separator convention', () => {
    expect(tokenize('upper_arm.L')).toEqual(['upper', 'arm', 'l']);
    expect(tokenize('mixamorig:LeftForeArm')).toEqual([
      'mixamorig',
      'left',
      'fore',
      'arm'
    ]);
    // 'bip01' splits at the letter-to-digit boundary too; parseJointName then
    // drops both the vendor word and the stray index.
    expect(tokenize('Bip01 L UpperArm')).toEqual(['bip', '01', 'l', 'upper', 'arm']);
  });

  it('splits letter-to-digit boundaries, which Mixamo relies on', () => {
    expect(tokenize('Spine1')).toEqual(['spine', '1']);
    expect(tokenize('spine_01')).toEqual(['spine', '01']);
  });
});

describe('parseJointName', () => {
  it('strips vendor prefixes', () => {
    expect(parseJointName('mixamorig:Hips').core).toBe('hips');
  });

  it('keeps a bare root joint, which is not a prefix', () => {
    // "root" is in the vendor prefix list, but a joint actually called Root is
    // real and common; stripping it would erase the joint entirely.
    expect(parseJointName('root').core).toBe('root');
  });

  it('reads the side from any position or spelling', () => {
    expect(parseJointName('LeftHand').side).toBe('left');
    expect(parseJointName('hand_r').side).toBe('right');
    expect(parseJointName('upper_arm.L').side).toBe('left');
    expect(parseJointName('Bip01 R Forearm').side).toBe('right');
    expect(parseJointName('Spine').side).toBe('center');
  });

  it('keeps index digits, normalised so the conventions agree', () => {
    // Spine1 and spine_01 are the same joint spelled two ways. Dropping the
    // digit instead would collapse Spine, Spine1 and Spine2 onto one guide.
    expect(parseJointName('spine_01').core).toBe('spine1');
    expect(parseJointName('Spine1').core).toBe('spine1');
    expect(parseJointName('neck_01').core).toBe('neck1');
  });

  it('drops a vendor prefix index but keeps an anatomical one', () => {
    expect(parseJointName('Bip01 L UpperArm').core).toBe('upperarm');
    expect(parseJointName('Bip01 L UpperArm').side).toBe('left');
    expect(parseJointName('mixamorig:LeftHandThumb1').core).toBe('handthumb1');
  });

  it('does not mistake a limb word for a side', () => {
    // "Leg" contains no side token; only whole words count.
    expect(parseJointName('LeftLeg').side).toBe('left');
    expect(parseJointName('LeftLeg').core).toBe('leg');
  });
});

describe('sideOfGuideId', () => {
  it('reads our L/R suffix convention', () => {
    expect(sideOfGuideId('wristL')).toBe('left');
    expect(sideOfGuideId('kneeR')).toBe('right');
    expect(sideOfGuideId('pelvis')).toBe('center');
  });
});

describe('matching real rigs', () => {
  it('matches our own rigged stock asset exactly', () => {
    const m = match(RISER_STOCK);
    expect(m.get('pelvis')).toBe('Hips');
    expect(m.get('chest')).toBe('Chest');
    expect(m.get('head')).toBe('Head');
    expect(m.get('shoulderL')).toBe('UpperArmL');
    expect(m.get('elbowR')).toBe('LowerArmR');
    expect(m.get('wristL')).toBe('HandL');
    expect(m.get('hipL')).toBe('ThighL');
    expect(m.get('kneeR')).toBe('CalfR');
    expect(m.get('ankleL')).toBe('FootL');
  });

  it('matches Mixamo, including its misleading limb names', () => {
    // The trap: Mixamo's "LeftArm" is the UPPER arm and "LeftLeg" is the SHIN.
    // A substring matcher puts the knee on the hip here.
    const m = match(MIXAMO);
    expect(m.get('pelvis')).toBe('mixamorig:Hips');
    expect(m.get('shoulderL')).toBe('mixamorig:LeftArm');
    expect(m.get('elbowL')).toBe('mixamorig:LeftForeArm');
    expect(m.get('wristL')).toBe('mixamorig:LeftHand');
    expect(m.get('hipL')).toBe('mixamorig:LeftUpLeg');
    expect(m.get('kneeL')).toBe('mixamorig:LeftLeg');
    expect(m.get('ankleL')).toBe('mixamorig:LeftFoot');
    expect(m.get('clavicleL')).toBe('mixamorig:LeftShoulder');
    expect(m.get('headTop')).toBe('mixamorig:HeadTop_End');

    // The spine chain resolves at all only because of the letter-to-digit
    // split - without it `Spine1` and `Spine2` are single tokens matching
    // nothing, and Mixamo loses its entire torso.
    expect(m.get('spine01')).toBe('mixamorig:Spine');
    expect(m.get('spine02')).toBeDefined();
  });

  it('matches Unreal skeleton naming', () => {
    const m = match(UNREAL);
    expect(m.get('pelvis')).toBe('pelvis');
    expect(m.get('root')).toBe('root');
    expect(m.get('clavicleL')).toBe('clavicle_l');
    expect(m.get('shoulderL')).toBe('upperarm_l');
    expect(m.get('elbowL')).toBe('lowerarm_l');
    expect(m.get('wristL')).toBe('hand_l');
    expect(m.get('hipR')).toBe('thigh_r');
    expect(m.get('kneeR')).toBe('calf_r');
    expect(m.get('ankleR')).toBe('foot_r');
    expect(m.get('toeBaseL')).toBe('ball_l');
    expect(m.get('spine01')).toBe('spine_01');
    expect(m.get('spine02')).toBe('spine_02');
    expect(m.get('chest')).toBe('spine_03');
    expect(m.get('neck')).toBe('neck_01');
  });

  it('cannot resolve the spine chain from names alone, and does not pretend to', () => {
    // Mixamo `Spine1` is the mid spine; Unreal `spine_01` is the lower one.
    // Identical core, different bone. The matcher gets each chain plausibly
    // ordered and leaves the exact split to orderSpineChain, which has the
    // hierarchy. Asserting a single "correct" answer here would be asserting
    // that one of the two conventions is wrong.
    const unreal = match(UNREAL);
    expect(unreal.get('spine01')).toBe('spine_01');
    expect(unreal.get('spine02')).toBe('spine_02');
    expect(unreal.get('chest')).toBe('spine_03');

    const mixamo = match(MIXAMO);
    const spineJoints = ['spine01', 'spine02', 'chest']
      .map((id) => mixamo.get(id))
      .filter((name): name is string => name !== undefined);
    // Every spine guide it does fill must be filled from the spine chain.
    for (const name of spineJoints) expect(name.toLowerCase()).toContain('spine');
    expect(spineJoints.length).toBeGreaterThanOrEqual(2);
  });

  it('matches Blender Rigify naming', () => {
    const m = match(RIGIFY);
    expect(m.get('pelvis')).toBe('hips');
    expect(m.get('chest')).toBe('chest');
    expect(m.get('shoulderL')).toBe('upper_arm.L');
    expect(m.get('elbowL')).toBe('forearm.L');
    expect(m.get('wristL')).toBe('hand.L');
    expect(m.get('hipL')).toBe('thigh.L');
    expect(m.get('kneeL')).toBe('shin.L');
    expect(m.get('ankleL')).toBe('foot.L');
  });

  it('matches nearly every joint each rig actually provides', () => {
    // Measured against the joints the rig HAS, not against the template's full
    // guide list. A rig with no clavicles cannot place clavicle guides, and
    // scoring it down for that would only encourage loosening the matcher
    // until it started guessing.
    const expectedMatches: Record<string, number> = {
      riser: 15,
      mixamo: 20,
      unreal: 20,
      rigify: 17
    };

    for (const [label, joints] of [
      ['riser', RISER_STOCK],
      ['mixamo', MIXAMO],
      ['unreal', UNREAL],
      ['rigify', RIGIFY]
    ] as const) {
      const matched = match(joints);
      expect(
        matched.size,
        `${label} matched ${matched.size} of ${joints.length} joints`
      ).toBeGreaterThanOrEqual(expectedMatches[label] as number);
    }
  });
});

describe('matching invariants', () => {
  it('never puts a left guide on a right joint', () => {
    for (const joints of [MIXAMO, UNREAL, RIGIFY, RISER_STOCK]) {
      for (const m of matchJointsToGuides(BIPED_GUIDE_IDS, joints, BIPED_JOINT_HINTS)) {
        const guideSide = sideOfGuideId(m.guideId);
        if (guideSide === 'center') continue;
        expect(parseJointName(m.jointName).side, `${m.guideId} -> ${m.jointName}`).toBe(
          guideSide
        );
      }
    }
  });

  it('never gives a centre guide a sided joint', () => {
    for (const m of matchJointsToGuides(BIPED_GUIDE_IDS, MIXAMO, BIPED_JOINT_HINTS)) {
      if (sideOfGuideId(m.guideId) !== 'center') continue;
      expect(parseJointName(m.jointName).side).toBe('center');
    }
  });

  it('uses each joint at most once', () => {
    // Rigs have far more joints than a template has guides. Sharing one would
    // stack two markers in the same place and report both as placed.
    for (const joints of [MIXAMO, UNREAL, RIGIFY]) {
      const result = matchJointsToGuides(BIPED_GUIDE_IDS, joints, BIPED_JOINT_HINTS);
      const used = result.map((m) => m.jointIndex);
      expect(new Set(used).size).toBe(used.length);
    }
  });

  it('gives each guide at most one joint', () => {
    const result = matchJointsToGuides(BIPED_GUIDE_IDS, UNREAL, BIPED_JOINT_HINTS);
    const ids = result.map((m) => m.guideId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reports lower confidence for the ambiguous aliases', () => {
    // "arm" is last in shoulderL's list precisely because rigs disagree on it.
    const viaUpperarm = matchJointsToGuides(['shoulderL'], ['upperarm_l'], BIPED_JOINT_HINTS);
    const viaArm = matchJointsToGuides(['shoulderL'], ['LeftArm'], BIPED_JOINT_HINTS);
    expect(viaUpperarm[0]!.confidence).toBeGreaterThan(viaArm[0]!.confidence);
  });

  it('returns nothing for a skeleton it does not recognise', () => {
    const result = matchJointsToGuides(
      BIPED_GUIDE_IDS,
      ['bone_a', 'bone_b', 'joint17'],
      BIPED_JOINT_HINTS
    );
    expect(result).toEqual([]);
  });

  it('handles an empty skeleton', () => {
    expect(matchJointsToGuides(BIPED_GUIDE_IDS, [], BIPED_JOINT_HINTS)).toEqual([]);
  });
});
