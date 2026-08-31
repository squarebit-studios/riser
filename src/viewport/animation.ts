// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Animation clips: finding them, deciding whether they fit a character, and
// playing one back on a timeline.
//
// WHY A MARKER TOOL CARES. The same reason it fires blend shapes. A guide
// placed on a resting character has to still be right when the character
// moves, and there is no way to notice that a knee guide sits two centimetres
// proud of the leg at mid-stride without watching the leg move.
//
// So this is a VIEWER. It plays a clip and puts it back; it does not key,
// blend, retarget or export. The document is untouched throughout - see the
// note on markers at the bottom of this file, which is the one thing about
// this feature worth reading twice.
//
// RETARGETING IS OUT OF SCOPE, and that is a real limit rather than a
// simplification. three binds an animation track to a node by NAME:
// `ThighL.quaternion` finds the object called ThighL and nothing else. A clip
// whose tracks name bones the character does not have binds to nothing and
// plays perfectly, silently, doing absolutely nothing - which is the worst
// possible failure, because it looks like the app is broken rather than like
// the clip is wrong. `matchClip` exists to catch that before it happens.
// ==========================================================================

import * as THREE from 'three';

/**
 * How a clip's tracks line up against a character.
 *
 * `missing` carries node NAMES, not track names, and is deduplicated: one
 * absent bone usually costs three tracks, and reporting it three times reads
 * like three separate problems.
 */
export interface ClipMatch {
  /** Node names the clip drives that the character actually has. */
  matched: string[];
  /** Node names the clip drives that the character does not have. */
  missing: string[];
  /** True when at least one track will do something. */
  applies: boolean;
}

/**
 * Clips carried by a loaded asset.
 *
 * three hangs them off the root group for USD and FBX; glTF returns them
 * beside the scene instead, which is why the caller may pass a second list.
 * Both are folded together here so the rest of the app never has to know
 * which format it is looking at.
 *
 * Empty clips are dropped. A zero-track clip is legal - FBX exporters emit
 * "Take 001" for a static scene as a matter of course - and it would put a
 * row in the selector that does nothing when chosen.
 */
export function discoverClips(
  root: THREE.Object3D | null,
  extra: readonly THREE.AnimationClip[] = []
): THREE.AnimationClip[] {
  const found = [
    ...((root?.animations as THREE.AnimationClip[] | undefined) ?? []),
    ...extra
  ];

  const seen = new Set<THREE.AnimationClip>();
  const clips: THREE.AnimationClip[] = [];
  for (const clip of found) {
    if (!clip || seen.has(clip)) continue;
    seen.add(clip);
    if (clip.tracks.length === 0) continue;
    clips.push(clip);
  }
  return clips;
}

/**
 * Every name an animation track could bind to on this character.
 *
 * A plain traversal, deliberately - bones included only because they are
 * objects in the graph like anything else. It is tempting to add
 * `skeleton.bones` as well, on the grounds that a skeleton knows its own
 * bones, but that would list names the mixer cannot actually reach: with the
 * mixer rooted at the character group, three resolves a track by walking the
 * CHILDREN (PropertyBinding.findNode), and a bone that is not parented into
 * the scene will not be found however well the skeleton knows it. Listing it
 * would promise a match that never happens, which is worse than admitting it.
 */
export function characterNodeNames(root: THREE.Object3D | null): Set<string> {
  const names = new Set<string>();
  if (!root) return names;
  root.traverse((object) => {
    if (object.name) names.add(object.name);
  });
  return names;
}

/**
 * The node a track drives, or null when the name does not carry one.
 *
 * three's own parser rather than a regular expression of our own: track names
 * are a small grammar with several shapes in the wild - `Hips.quaternion`,
 * `mixamorig:Hips.position`, `.bones[Hips].position` out of older exporters -
 * and hand-rolling a second interpretation of it is how this file and the
 * mixer end up disagreeing about which clips apply.
 *
 * Worth knowing, because it surprises people: the parser DISCARDS everything
 * before the last colon or slash, so `mixamorig:Hips` parses as `Hips`. That
 * is three's rule, not ours, and it is why a Mixamo clip fails to bind to a
 * rig whose bones are still called `mixamorig:Hips` - the track asks for
 * `Hips` and no such object exists.
 */
export function trackNodeName(trackName: string): string | null {
  try {
    return THREE.PropertyBinding.parseTrackName(trackName).nodeName ?? null;
  } catch {
    return null;
  }
}

/**
 * Which of a clip's tracks will land on this character.
 *
 * Names are compared EXACTLY, because that is what three does when it binds.
 * A looser comparison here would report a match that the mixer then fails to
 * make, which is worse than reporting the mismatch honestly: the user would
 * be told the clip fits and then watch nothing happen.
 */
export function matchClip(
  clip: THREE.AnimationClip,
  names: ReadonlySet<string>
): ClipMatch {
  const matched: string[] = [];
  const missing: string[] = [];

  for (const track of clip.tracks) {
    // A track whose target cannot be worked out is counted as missing under
    // its own name. It will not bind either way, and reporting it by name is
    // the only thing that lets a user see WHICH track the app gave up on.
    const node = trackNodeName(track.name) ?? track.name;
    const into = names.has(node) ? matched : missing;
    if (!into.includes(node)) into.push(node);
  }

  return { matched, missing, applies: matched.length > 0 };
}

/**
 * The match, in a sentence someone can act on.
 *
 * Naming the bones is the whole value of the message. "This clip does not fit"
 * leaves the user with nothing to do; "it drives mixamorig:Hips and this
 * character's joints are called Hips" tells them they need a retarget, which
 * Riser deliberately does not do.
 */
export function describeMatch(
  clip: THREE.AnimationClip,
  match: ClipMatch,
  characterName?: string | null
): string {
  const target = characterName ? `"${characterName}"` : 'this character';

  if (!match.applies) {
    // A clip with no tracks at all. Legal, and some exporters emit one per
    // scene whether anything moved or not.
    if (match.missing.length === 0) return `"${clip.name}" drives nothing at all.`;

    const wanted = match.missing.slice(0, 3).join(', ');
    const more = match.missing.length > 3 ? `, and ${match.missing.length - 3} more` : '';
    return (
      `"${clip.name}" does not fit ${target}: it drives ${wanted}${more}, ` +
      `and ${target} has no bone by any of those names. ` +
      `Riser does not retarget - the names have to match.`
    );
  }

  if (match.missing.length > 0) {
    const skipped = match.missing.slice(0, 3).join(', ');
    const more = match.missing.length > 3 ? ` and ${match.missing.length - 3} more` : '';
    return (
      `"${clip.name}" drives ${match.matched.length} of ` +
      `${match.matched.length + match.missing.length} joints. ` +
      `${skipped}${more} are not on ${target} and stay still.`
    );
  }

  return `"${clip.name}" drives all ${match.matched.length} of its joints.`;
}

/**
 * A playhead position, as a timecode.
 *
 * Minutes and hundredths rather than raw seconds or frames. Seconds alone
 * ("3.42") stop being readable the moment a clip is longer than a minute, and
 * frames would mean inventing a frame rate the clip never declared - glTF and
 * USD both store keys in seconds, and a made-up 24 or 30 would be wrong for
 * half the files that arrive.
 */
export function formatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;

  // Rounded to hundredths FIRST, then split. Splitting first and truncating
  // each part looks equivalent and is not: 9.09 is held as 9.0899999..., so
  // the hundredths floor to 08 and the readout is quietly a frame behind. Any
  // carry the rounding produces then propagates through the split, which is
  // what stops 59.999 printing as the impossible 0:60.00.
  const total = Math.round(safe * 100);
  const minutes = Math.floor(total / 6000);
  const rest = total - minutes * 6000;
  const whole = Math.floor(rest / 100);
  const hundredths = rest % 100;

  return `${minutes}:${String(whole).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

/** The playhead after `dt`, and whether playback should stop there. */
export interface WrappedTime {
  time: number;
  /** True when a non-looping clip reached its end and should pause. */
  ended: boolean;
}

/**
 * Advance the playhead, wrapping or stopping at the end.
 *
 * Riser owns the playhead rather than letting AnimationMixer own it. The
 * mixer's own looping is perfectly good, but the timeline has to be able to
 * SCRUB - to be told a time rather than a delta - and a mixer driven by deltas
 * cannot be asked where it is without the two answers drifting apart. Keeping
 * the time here makes the loop rule a pure function, which is also the only
 * reason it can be tested at all.
 *
 * A zero-length clip is real: a single-key pose exported as an animation has a
 * duration of 0, and dividing by it would put the playhead at NaN and freeze
 * the character in whatever the last valid frame was.
 */
export function wrapTime(
  time: number,
  duration: number,
  loop: boolean
): WrappedTime {
  if (!(duration > 0)) return { time: 0, ended: !loop };

  if (time < duration) return { time: Math.max(0, time), ended: false };

  if (!loop) return { time: duration, ended: true };

  // Modulo rather than a subtraction, so a long frame - a tab that was in the
  // background, a garbage collection pause - lands in the right place instead
  // of somewhere past the end.
  const wrapped = time % duration;
  return { time: wrapped < 0 ? wrapped + duration : wrapped, ended: false };
}

/** What happened when clips were added to the player. */
export interface AddClipsResult {
  added: THREE.AnimationClip[];
  /** Clips that name nothing on this character, with the reason to show. */
  rejected: { clip: THREE.AnimationClip; message: string }[];
  /** Clips that landed, but only partly. Worth saying out loud.  */
  warnings: string[];
}

/**
 * Plays one clip on a character, on a playhead the timeline can scrub.
 *
 * PER-FRAME STATE LIVES HERE, not in React. The panel reads `time` inside the
 * viewport's frame callback and writes it straight into the DOM; if the
 * playhead were React state, every frame of playback would re-render the
 * inspector, which is the exact cost this application is shaped to avoid.
 *
 * The action is kept PAUSED at all times and its `time` is assigned directly.
 * That sounds perverse for something whose job is to play, but it is what
 * makes scrubbing and playing the same operation: both are "put the playhead
 * here and evaluate". `mixer.update(0)` re-evaluates a paused action at its
 * current time - see AnimationAction._updateTime, which short-circuits on a
 * zero delta - so one code path serves both.
 */
export class AnimationPlayer {
  private mixer: THREE.AnimationMixer | null = null;
  private root: THREE.Object3D | null = null;
  private names: ReadonlySet<string> = new Set();
  /** The asset's name, so a refusal can say which character it did not fit. */
  private characterName: string | null = null;

  private _clips: THREE.AnimationClip[] = [];
  private _selected: THREE.AnimationClip | null = null;
  private action: THREE.AnimationAction | null = null;

  private _time = 0;
  private _playing = false;
  private _loop = true;

  /**
   * Attach to a character, replacing whatever was loaded before.
   *
   * Clips are NOT carried across. They were bound by name to the previous
   * character's bones, and silently re-binding them to a new one is the
   * retargeting this module refuses to do - only now without telling anyone.
   */
  setCharacter(
    root: THREE.Object3D | null,
    clips: readonly THREE.AnimationClip[],
    characterName: string | null = null
  ): void {
    this.stopAndUnbind();
    this.root = root;
    this.names = characterNodeNames(root);
    this.characterName = characterName;
    this._clips = [];
    this._selected = null;
    this._time = 0;
    this._playing = false;
    this.mixer = root ? new THREE.AnimationMixer(root) : null;

    if (clips.length > 0) this.addClips(clips);
  }

  /**
   * Add clips, refusing the ones that would do nothing.
   *
   * A clip that binds to no node is rejected rather than added-and-inert. The
   * alternative - a row in the selector that plays silence - is precisely the
   * "fails silently" case this whole module is arranged to prevent.
   */
  addClips(clips: readonly THREE.AnimationClip[]): AddClipsResult {
    const result: AddClipsResult = { added: [], rejected: [], warnings: [] };
    if (!this.mixer) {
      for (const clip of clips) {
        result.rejected.push({
          clip,
          message: `No character is loaded, so there is nothing for "${clip.name}" to drive.`
        });
      }
      return result;
    }

    for (const clip of clips) {
      const match = matchClip(clip, this.names);
      if (!match.applies) {
        result.rejected.push({
          clip,
          message: describeMatch(clip, match, this.characterName)
        });
        continue;
      }
      // Names are what the selector shows and what tests address, so a second
      // "Walk" has to become "Walk (2)" rather than shadowing the first.
      clip.name = this.uniqueName(clip.name || 'Clip');
      this._clips.push(clip);
      result.added.push(clip);
      if (match.missing.length > 0) {
        result.warnings.push(describeMatch(clip, match, this.characterName));
      }
    }

    // Deliberately does NOT select a clip.
    //
    // Riser is a marker tool, and a marker belongs on the NEUTRAL character:
    // its binding names a triangle of the resting mesh, and every automatic
    // placement measures the resting silhouette. Selecting a clip on load
    // meant a character that shipped with animation arrived posed at frame 0
    // of a walk, which is nobody's bind pose, and the user placed markers
    // against it without ever choosing to.
    //
    // It also cost speed. A posed rig has to fall back to the skinning-aware
    // raycast, because the BVH indexes rest geometry - picking measured 5.3ms
    // posed against 0.54ms at rest on the same character.
    //
    // So a clip is opt-in. Loading finds them and lists them; playing one is
    // an act.
    return result;
  }

  private uniqueName(name: string): string {
    if (!this._clips.some((c) => c.name === name)) return name;
    let n = 2;
    while (this._clips.some((c) => c.name === `${name} (${n})`)) n++;
    return `${name} (${n})`;
  }

  get clips(): readonly THREE.AnimationClip[] {
    return this._clips;
  }

  get selectedName(): string | null {
    return this._selected?.name ?? null;
  }

  get duration(): number {
    return this._selected?.duration ?? 0;
  }

  get time(): number {
    return this._time;
  }

  get playing(): boolean {
    return this._playing;
  }

  /**
   * True while a clip is driving the rig, playing or paused.
   *
   * NOT the same question as `playing`, and the difference matters: a paused
   * playhead at t = 0.4 is still holding the character away from its bind
   * pose, and anything that reasons about rest geometry - the raycast BVH in
   * viewport/acceleration.ts, most of all - has to treat that as posed. Merely
   * selecting a clip poses the character too, because selecting it evaluates
   * the first frame, and the first frame of a walk is not a bind pose.
   */
  get posed(): boolean {
    return this.action !== null;
  }

  get loop(): boolean {
    return this._loop;
  }

  set loop(value: boolean) {
    this._loop = value;
  }

  /**
   * Choose the clip to play.
   *
   * The previous one is stopped and its influence reset, so the character goes
   * back to its rest pose rather than keeping whatever half-pose it was in.
   * Without that, switching clips leaves the bones the new clip does not drive
   * frozen wherever the old clip left them - which reads as the new clip being
   * broken.
   */
  select(name: string | null): boolean {
    const clip = name ? (this._clips.find((c) => c.name === name) ?? null) : null;
    if (name !== null && !clip) return false;

    this.stopAndUnbind();
    this._selected = clip;
    this._time = 0;
    this._playing = false;

    if (clip && this.mixer) {
      this.action = this.mixer.clipAction(clip);
      this.action.reset();
      this.action.play();
      // See the class comment: the action never runs itself.
      this.action.paused = true;
      this.apply();
    }
    return true;
  }

  play(): void {
    if (!this._selected) return;
    // Pressing play on a finished, non-looping clip should replay it rather
    // than sit at the end doing nothing, which is what every other transport
    // in the world does.
    if (!this._loop && this._time >= this.duration) this._time = 0;
    this._playing = true;
  }

  pause(): void {
    this._playing = false;
  }

  toggle(): void {
    if (this._playing) this.pause();
    else this.play();
  }

  /** Put the playhead somewhere. Clamped, because a slider can overshoot. */
  seek(time: number): void {
    if (!Number.isFinite(time)) return;
    this._time = Math.min(this.duration, Math.max(0, time));
    this.apply();
  }

  /**
   * Advance one frame. Called from the viewport's frame loop, never from React.
   *
   * Cheap to call with nothing loaded, which is why it is unconditional at the
   * call site rather than guarded there.
   */
  update(dt: number): void {
    if (!this._playing || !this._selected) return;
    const next = wrapTime(this._time + dt, this.duration, this._loop);
    this._time = next.time;
    if (next.ended) this._playing = false;
    this.apply();
  }

  /** Push the current playhead into the character. */
  private apply(): void {
    if (!this.mixer || !this.action) return;
    this.action.time = this._time;
    this.mixer.update(0);
  }

  /**
   * Put the character back where it was found.
   *
   * `action.stop()` is what does it, and it is worth knowing why: the mixer
   * keeps the value each bound property had before it started writing to it,
   * and restores it when the last action using that property goes away
   * (AnimationMixer._deactivateAction). Dropping the action without stopping
   * it leaves the character frozen in whatever half-stride was on screen, with
   * nothing left in the interface to explain it or undo it.
   */
  private stopAndUnbind(): void {
    if (this.action) {
      this.action.stop();
      if (this.root) this.mixer?.uncacheAction(this.action.getClip(), this.root);
      this.action = null;
    }
    this.mixer?.stopAllAction();
  }

  dispose(): void {
    this.stopAndUnbind();
    if (this.root) this.mixer?.uncacheRoot(this.root);
    this.mixer = null;
    this.root = null;
    this._clips = [];
    this._selected = null;
  }
}

// ==========================================================================
// A NOTE ON MARKERS DURING PLAYBACK - read this before "fixing" anything.
//
// Markers DO NOT follow a skinned character while a clip plays. They stay
// where the neutral mesh put them.
//
// This is not an oversight in the timeline, it falls out of what a binding is.
// `resolveBindingWorld` (viewport/Picker.ts) reads the mesh's `position`
// attribute and multiplies by `mesh.matrixWorld`. Skinning happens in the
// VERTEX SHADER: the CPU-side positions are the bind pose and never change,
// and on a skinned character the mesh's own matrix does not move either - the
// bones do. So the arithmetic is correct and the answer is the rest position,
// every frame.
//
// The honest reading of that is that playback currently checks the SHAPE of
// the motion, not the marker against it: you can see the leg swing through
// where the knee guide sits, which is already worth having, but you cannot yet
// see the guide ride the leg.
//
// The fix, when someone wants it, is a display-only change and belongs here
// rather than in the document: `THREE.SkinnedMesh.applyBoneTransform` gives the
// skinned position of a single vertex, so a bound marker can be resolved by
// skinning its three triangle corners and blending them barycentrically -
// three vertex evaluations per marker per frame, which is nothing. The offset
// needs the same treatment, rotated into the deformed triangle's frame, or
// every interior guide will pop out through the skin as the surface turns.
// What must NOT change is what gets STORED: the binding names a triangle of
// the neutral mesh, and it has to keep meaning that, or every document written
// before the change resolves somewhere else afterwards.
//
// One more limit worth knowing: above subdivision level 0 the displayed
// surface is a static limit mesh built from the cage (viewport/SubdivSurface),
// so it does not deform at all. The character appears to freeze while the
// clock runs. The skeleton overlay keeps moving, because it reads the bones.
// ==========================================================================
