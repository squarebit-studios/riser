import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  AnimationPlayer,
  characterNodeNames,
  describeMatch,
  discoverClips,
  formatTimecode,
  matchClip,
  trackNodeName,
  wrapTime
} from './animation';

/** A clip that drives the named nodes' rotations, one track each. */
function clipFor(name: string, nodes: string[], duration = 1): THREE.AnimationClip {
  const tracks = nodes.map(
    (node) =>
      new THREE.QuaternionKeyframeTrack(
        `${node}.quaternion`,
        [0, duration],
        [0, 0, 0, 1, 0, 0, 0, 1]
      )
  );
  return new THREE.AnimationClip(name, duration, tracks);
}

/** A named object tree, standing in for a character's bones. */
function characterWith(names: string[]): THREE.Object3D {
  const root = new THREE.Object3D();
  root.name = 'Character';
  let parent: THREE.Object3D = root;
  for (const name of names) {
    const bone = new THREE.Bone();
    bone.name = name;
    parent.add(bone);
    parent = bone;
  }
  return root;
}

describe('finding the clips on a loaded asset', () => {
  it('finds nothing on a character that carries none', () => {
    // The overwhelmingly common case - a USD blockout, an OBJ - and the panel
    // has to say so rather than showing an empty transport.
    expect(discoverClips(new THREE.Object3D())).toEqual([]);
    expect(discoverClips(null)).toEqual([]);
  });

  it('reads them off the root, which is where USD and FBX leave them', () => {
    const root = new THREE.Object3D();
    root.animations = [clipFor('Walk', ['Hips'])];
    expect(discoverClips(root).map((c) => c.name)).toEqual(['Walk']);
  });

  it('folds in the list glTF returns beside the scene', () => {
    // glTF is the odd one out: three hands animations back on the GLTF object,
    // not on the scene. Both paths have to end up in the same list or the
    // format determines whether the timeline appears.
    const root = new THREE.Object3D();
    const clips = discoverClips(root, [clipFor('Walk', ['Hips'])]);
    expect(clips.map((c) => c.name)).toEqual(['Walk']);
  });

  it('drops clips with no tracks', () => {
    // FBX exporters emit "Take 001" for a scene where nothing moved. Listing
    // it would put a row in the selector that does nothing when chosen.
    const root = new THREE.Object3D();
    root.animations = [
      new THREE.AnimationClip('Take 001', 1, []),
      clipFor('Walk', ['Hips'])
    ];
    expect(discoverClips(root).map((c) => c.name)).toEqual(['Walk']);
  });

  it('does not list the same clip twice', () => {
    // A loader that puts its clips BOTH on the root and beside it would
    // otherwise produce two identical rows.
    const clip = clipFor('Walk', ['Hips']);
    const root = new THREE.Object3D();
    root.animations = [clip];
    expect(discoverClips(root, [clip])).toHaveLength(1);
  });
});

describe('reading the node a track drives', () => {
  it('reads the ordinary form', () => {
    expect(trackNodeName('ThighL.quaternion')).toBe('ThighL');
  });

  it('drops a namespace prefix, because three does', () => {
    // This is the trap that makes Mixamo clips look broken. three's parser
    // throws away everything before the last colon, so the track asks for
    // "Hips" - and a rig whose bone is still called "mixamorig:Hips" has no
    // object by that name. Matching has to model three's rule, not a kinder
    // one, or the app promises a fit it cannot deliver.
    expect(trackNodeName('mixamorig:Hips.position')).toBe('Hips');
  });

  it('returns null for a track that names no node', () => {
    expect(trackNodeName('.bones[Hips].position')).toBeNull();
  });
});

describe('matching a clip against a character', () => {
  const character = characterWith(['Hips', 'Spine', 'Chest']);
  const names = characterNodeNames(character);

  it('collects every named object, root included', () => {
    expect([...names].sort()).toEqual(['Character', 'Chest', 'Hips', 'Spine']);
  });

  it('applies when every track names a bone that is there', () => {
    const match = matchClip(clipFor('Walk', ['Hips', 'Spine']), names);
    expect(match.applies).toBe(true);
    expect(match.matched).toEqual(['Hips', 'Spine']);
    expect(match.missing).toEqual([]);
  });

  it('refuses when nothing it drives exists here', () => {
    // The case the whole module exists for. three binds by name and silently
    // ignores a track it cannot resolve, so a clip like this plays perfectly
    // and moves nothing - which looks like Riser is broken rather than like
    // the clip is for a different rig.
    const match = matchClip(clipFor('Walk', ['pelvis', 'spine_01']), names);
    expect(match.applies).toBe(false);
    expect(match.missing).toEqual(['pelvis', 'spine_01']);
  });

  it('reports a partial fit as partial rather than as success', () => {
    const match = matchClip(clipFor('Walk', ['Hips', 'TailTip']), names);
    expect(match.applies).toBe(true);
    expect(match.matched).toEqual(['Hips']);
    expect(match.missing).toEqual(['TailTip']);
  });

  it('names each absent bone once, however many tracks wanted it', () => {
    // A single missing bone usually costs three tracks - position, rotation,
    // scale - and listing it three times reads as three separate problems.
    const clip = new THREE.AnimationClip('Walk', 1, [
      new THREE.VectorKeyframeTrack('Tail.position', [0, 1], [0, 0, 0, 0, 0, 0]),
      new THREE.VectorKeyframeTrack('Tail.scale', [0, 1], [1, 1, 1, 1, 1, 1])
    ]);
    expect(matchClip(clip, names).missing).toEqual(['Tail']);
  });

  it('counts an unparseable track as missing, under its own name', () => {
    // It will not bind either way. Reporting it by name is the only thing
    // that tells the user which track the app gave up on.
    const clip = new THREE.AnimationClip('Legacy', 1, [
      new THREE.VectorKeyframeTrack('.bones[Hips].position', [0, 1], [0, 0, 0, 0, 0, 0])
    ]);
    expect(matchClip(clip, names).missing).toEqual(['.bones[Hips].position']);
  });
});

describe('explaining a mismatch', () => {
  const names = characterNodeNames(characterWith(['Hips', 'Spine']));

  it('names the bones the clip wanted, so there is something to act on', () => {
    const clip = clipFor('Walk', ['pelvis', 'spine_01']);
    const message = describeMatch(clip, matchClip(clip, names), 'gary.usdz');
    expect(message).toContain('pelvis');
    expect(message).toContain('gary.usdz');
    // The user's next move is a retarget in their own DCC, and saying so is
    // more use than saying the clip is invalid - it is not, it is for a
    // different rig.
    expect(message).toContain('retarget');
  });

  it('does not stop at three names without saying how many more', () => {
    const clip = clipFor('Walk', ['a', 'b', 'c', 'd', 'e']);
    expect(describeMatch(clip, matchClip(clip, names))).toContain('2 more');
  });

  it('says which joints stay still on a partial fit', () => {
    const clip = clipFor('Walk', ['Hips', 'Tail']);
    const message = describeMatch(clip, matchClip(clip, names));
    expect(message).toContain('1 of 2');
    expect(message).toContain('Tail');
  });

  it('has something to say about a clip with no tracks at all', () => {
    const clip = new THREE.AnimationClip('Take 001', 1, []);
    expect(describeMatch(clip, matchClip(clip, names))).toContain('nothing');
  });
});

describe('the timecode', () => {
  it('reads as a clock rather than as a float', () => {
    expect(formatTimecode(0)).toBe('0:00.00');
    expect(formatTimecode(1.5)).toBe('0:01.50');
    expect(formatTimecode(75.25)).toBe('1:15.25');
  });

  it('pads, so the readout does not jump about while it runs', () => {
    // A width that changes at 0:09.99 makes the whole transport twitch once a
    // second, which reads as the app struggling rather than as text.
    expect(formatTimecode(9.09)).toBe('0:09.09');
    expect(formatTimecode(9.9)).toHaveLength(7);
  });

  it('never prints a sixtieth second', () => {
    // Rounding 59.999 to hundredths carries. Splitting the seconds off before
    // rounding them would print "0:60.00", which is not a time.
    expect(formatTimecode(59.999)).toBe('1:00.00');
  });

  it('survives the values a duration can actually be', () => {
    // A clip with a single key has duration 0, and an unloaded transport asks
    // for the timecode before there is anything to ask about.
    expect(formatTimecode(-1)).toBe('0:00.00');
    expect(formatTimecode(NaN)).toBe('0:00.00');
  });
});

describe('advancing the playhead', () => {
  it('runs forward inside the clip', () => {
    expect(wrapTime(0.4, 2, true)).toEqual({ time: 0.4, ended: false });
  });

  it('wraps to the start when looping', () => {
    expect(wrapTime(2.25, 2, true).time).toBeCloseTo(0.25, 9);
  });

  it('wraps correctly after a frame longer than the clip', () => {
    // A backgrounded tab or a garbage collection pause hands back a delta of
    // whole seconds. Subtracting one duration would leave the playhead past
    // the end and the character frozen on its last frame.
    expect(wrapTime(7.5, 2, true).time).toBeCloseTo(1.5, 9);
  });

  it('stops at the end when not looping, and says so', () => {
    expect(wrapTime(2.4, 2, false)).toEqual({ time: 2, ended: true });
  });

  it('lands exactly on the end rather than just short of it', () => {
    // The last frame is the one being judged as often as any other, and a
    // playhead that stops at 1.98 of a 2 second clip never shows it.
    expect(wrapTime(2, 2, false).time).toBe(2);
  });

  it('does not divide by a zero-length clip', () => {
    // Real: a single-key pose exported as an animation has duration 0. A
    // modulo here would put the playhead at NaN and freeze the character.
    expect(wrapTime(1, 0, true)).toEqual({ time: 0, ended: false });
    expect(wrapTime(1, 0, false)).toEqual({ time: 0, ended: true });
  });
});

// --------------------------------------------------------------------------
// The player, against the real bundled asset
// --------------------------------------------------------------------------

/**
 * three's FileLoader raises a ProgressEvent while reading the glTF's embedded
 * data URI, and Node has no such global. Nothing in Riser depends on it; the
 * stub only keeps the loader from throwing before it gets to the buffer.
 */
class StubProgressEvent extends Event {
  constructor(type: string, init: Record<string, unknown> = {}) {
    super(type);
    Object.assign(this, init);
  }
}
(globalThis as Record<string, unknown>).ProgressEvent ??= StubProgressEvent;

async function loadWalkingBiped(): Promise<{
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
}> {
  const path = join(process.cwd(), 'public', 'assets', 'biped-walk.gltf');
  const file = readFileSync(path);
  const gltf = await new GLTFLoader().parseAsync(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
    ''
  );
  return { scene: gltf.scene, clips: gltf.animations };
}

/**
 * These read the ACTUAL bundled asset through the ACTUAL loader, for the same
 * reason usd-assets.test.ts does: the feature rests on three reading what
 * tools/make-stock-assets.mjs writes, and a mocked clip would prove nothing
 * about either.
 */
describe('playing the bundled animated biped', () => {
  it('ships two clips, so the selector has a choice to make', async () => {
    const { scene, clips } = await loadWalkingBiped();
    expect(discoverClips(scene, clips).map((c) => c.name)).toEqual(['Walk', 'Wave']);
  });

  it('drives joints the rigged USD biped also has', async () => {
    // The point of generating it from the same joint list: a clip authored in
    // one file has to land on a character loaded from another, and this is the
    // only test that can tell whether the two still agree on their names.
    const { clips } = await loadWalkingBiped();
    const usdBoneNames = new Set([
      'Root',
      'Hips',
      'Spine',
      'Chest',
      'ThighL',
      'ThighR',
      'CalfL',
      'CalfR',
      'UpperArmL',
      'UpperArmR',
      'LowerArmL',
      'LowerArmR'
    ]);
    expect(matchClip(clips[0]!, usdBoneNames).missing).toEqual([]);
  });

  it('poses the character when the playhead moves, and only then', async () => {
    const { scene, clips } = await loadWalkingBiped();
    const thigh = scene.getObjectByName('ThighL')!;
    const rest = thigh.quaternion.clone();

    const player = new AnimationPlayer();
    player.setCharacter(scene, clips);
    player.select(clips[0]!.name);

    player.seek(0.5);
    const posed = thigh.quaternion.clone();
    expect(posed.angleTo(rest)).toBeGreaterThan(0.1);

    // And scrubbing back is the same operation, not a special case.
    player.seek(0.25);
    expect(thigh.quaternion.angleTo(posed)).toBeGreaterThan(0.1);
  });

  it('advances only while playing', async () => {
    const { scene, clips } = await loadWalkingBiped();
    const player = new AnimationPlayer();
    player.setCharacter(scene, clips);
    player.select(clips[0]!.name);

    player.update(0.5);
    expect(player.time).toBe(0);

    player.play();
    player.update(0.5);
    expect(player.time).toBeCloseTo(0.5, 6);

    player.pause();
    player.update(0.5);
    expect(player.time).toBeCloseTo(0.5, 6);
  });

  it('pauses itself at the end when looping is off', async () => {
    const { scene, clips } = await loadWalkingBiped();
    const player = new AnimationPlayer();
    player.setCharacter(scene, clips);
    player.select(clips[0]!.name);
    player.loop = false;
    player.play();

    player.update(5);
    expect(player.playing).toBe(false);
    expect(player.time).toBeCloseTo(player.duration, 6);

    // Pressing play again replays rather than sitting at the end, which is
    // what every other transport in the world does.
    player.play();
    expect(player.time).toBe(0);
  });

  it('puts the character back when the clip is deselected', async () => {
    // Otherwise a stock asset is left frozen mid-stride with nothing on
    // screen still pointing at the cause.
    const { scene, clips } = await loadWalkingBiped();
    const thigh = scene.getObjectByName('ThighL')!;
    // Captured before a clip is selected. Selecting one poses the character
    // at t = 0 straight away, and the first frame of a walk is not the rest
    // pose, so reading it afterwards would measure against a pose rather than
    // against where the asset actually stands.
    const rest = thigh.quaternion.clone();

    const player = new AnimationPlayer();
    player.setCharacter(scene, clips);
    player.select(clips[0]!.name);

    player.seek(0.5);
    expect(thigh.quaternion.angleTo(rest)).toBeGreaterThan(0.1);

    player.select(null);
    expect(thigh.quaternion.angleTo(rest)).toBeLessThan(1e-6);
  });

  it('refuses a clip that names nothing on the character', async () => {
    const { clips } = await loadWalkingBiped();
    const player = new AnimationPlayer();
    player.setCharacter(characterWith(['pelvis', 'spine_01']), []);

    const result = player.addClips(clips);
    expect(result.added).toEqual([]);
    expect(player.clips).toHaveLength(0);
    expect(result.rejected[0]!.message).toContain('does not fit');
  });

  it('does not carry clips across to a different character', async () => {
    // They were bound by name to the previous rig. Re-binding them silently is
    // the retargeting this module refuses to do, only without telling anyone.
    const { scene, clips } = await loadWalkingBiped();
    const player = new AnimationPlayer();
    player.setCharacter(scene, clips);
    player.select(clips[0]!.name);
    expect(player.clips).toHaveLength(2);

    player.setCharacter(characterWith(['Hips']), []);
    expect(player.clips).toEqual([]);
    expect(player.selectedName).toBeNull();
  });

  it('renames a second clip rather than shadowing the first', async () => {
    // Names are what the selector shows and what a test addresses. Adding the
    // same file twice must not produce two rows called Walk.
    const { scene, clips } = await loadWalkingBiped();
    const player = new AnimationPlayer();
    player.setCharacter(scene, clips);
    player.select(clips[0]!.name);

    const again = await loadWalkingBiped();
    player.addClips(again.clips);
    expect(player.clips.map((c) => c.name)).toEqual([
      'Walk',
      'Wave',
      'Walk (2)',
      'Wave (2)'
    ]);
  });
});

describe('a character that ships with animation', () => {
  it('is not posed until the user asks for a clip', async () => {
    // Riser is a marker tool, and a marker belongs on the NEUTRAL character:
    // its binding names a triangle of the resting mesh, and every automatic
    // placement measures the resting silhouette. Auto-selecting on load meant
    // an animated character arrived posed at frame 0 of a walk, and markers
    // were placed against it without anyone choosing to.
    const { scene, clips } = await loadWalkingBiped();
    const thigh = scene.getObjectByName('ThighL')!;
    const rest = thigh.quaternion.clone();

    const player = new AnimationPlayer();
    player.setCharacter(scene, clips);

    expect(player.posed).toBe(false);
    expect(thigh.quaternion.angleTo(rest)).toBe(0);
  });

  it('still finds and lists the clips', () => {
    // Opt-in, not hidden: the panel has to show what the character shipped
    // with or nobody knows there is anything to play.
    return loadWalkingBiped().then(({ scene, clips }) => {
      const player = new AnimationPlayer();
      player.setCharacter(scene, clips);
      expect(player.clips.map((c) => c.name)).toEqual(['Walk', 'Wave']);
    });
  });
});
