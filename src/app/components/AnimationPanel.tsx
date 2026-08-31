// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// The timeline: play a clip on the loaded character and scrub it.
//
// WHY IT IS A TAB rather than a section under the marker details. Playback is
// a MODE of looking - you are watching the character rather than editing a
// marker - and everything on this tab is about that one activity. Blend
// shapes stayed in Details because firing one is a glance; a timeline is
// something you sit with.
//
// THE ONE RULE THIS FILE EXISTS TO OBEY. The playhead moves sixty times a
// second and React must never hear about it. The transport's React state is
// only what a person changed: which clip, playing or not, looping or not.
// Everything that moves per frame - the scrubber's position and the timecode -
// is written straight into the DOM from the viewport's frame callback, through
// refs. Putting the playhead in useState would re-render the whole inspector
// every frame, which is the exact cost this application is built to avoid, and
// it would do it while the user is trying to judge a marker against motion.
// ==========================================================================

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../AppContext';
import { useUiStore } from '../state';
import { formatTimecode } from '../../viewport/animation';
import { Button, IconButton } from './ui/Button';
import { Chip } from './ui/Controls';

/** Resolution of the scrub slider, in steps across the whole clip. */
const SCRUB_STEPS = 1000;

export function AnimationPanel(): JSX.Element {
  const app = useApp();
  const characterName = useUiStore((s) => s.characterName);
  const subdivLevel = useUiStore((s) => s.subdivLevel);
  const fileInput = useRef<HTMLInputElement>(null);

  // Redrawn only when a PERSON changes something - a clip chosen, play
  // pressed, a file added. Never per frame. See the header.
  const [, setTick] = useState(0);
  const redraw = (): void => setTick((n) => n + 1);

  const player = app.animation;
  const clips = player.clips;
  const selected = player.selectedName;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Section title="Animation">
        {!characterName ? (
          <p className="px-2 py-1 text-ink-faint">
            Load a character first. A clip is played on the character in front of you -
            there is nothing for it to drive on its own.
          </p>
        ) : (
          <>
            <p className="mb-2 px-2 text-[11px] leading-snug text-ink-faint">
              Play a clip to check your markers against motion. Nothing here changes the
              document.
            </p>

            <div className="px-1">
              <Button
                icon="upload"
                size="sm"
                className="w-full"
                data-testid="add-animation"
                onClick={() => fileInput.current?.click()}
              >
                Add clips from a file…
              </Button>
            </div>
            <p className="mt-1 px-2 text-[11px] text-ink-faint">
              glTF, FBX or USD. The clip’s tracks have to name bones this character has -
              Riser does not retarget.
            </p>

            <input
              ref={fileInput}
              type="file"
              hidden
              accept=".glb,.gltf,.fbx,.usd,.usda,.usdc,.usdz"
              data-testid="animation-file"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                await app.addAnimationFromFile(file);
                redraw();
              }}
            />
          </>
        )}
      </Section>

      {characterName && clips.length === 0 && (
        <Section title="Clips">
          <p className="px-2 py-1 text-ink-faint">
            This character has no animation. Add a file above, or open a character that
            carries its own.
          </p>
        </Section>
      )}

      {clips.length > 0 && (
        <>
          {/* The selector only earns its space once there is a choice to make.
              One clip needs no list; the transport already names it. */}
          {clips.length > 1 && (
            <Section title="Clips">
              <div className="max-h-48 space-y-0.5 overflow-y-auto px-1">
                {clips.map((clip) => {
                  const on = clip.name === selected;
                  return (
                    <button
                      key={clip.name}
                      type="button"
                      data-testid={`clip-${clip.name}`}
                      aria-pressed={on}
                      onClick={() => {
                        player.select(clip.name);
                        redraw();
                      }}
                      className={`flex w-full items-center gap-2 rounded-control px-2 py-1 text-left transition-colors hover:bg-panel-lighter ${
                        on ? 'text-accent' : 'text-ink-dim hover:text-ink'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{clip.name}</span>
                      <span className="shrink-0 font-mono text-[11px] text-ink-faint">
                        {formatTimecode(clip.duration)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Section>
          )}

          <Transport key={selected ?? ''} onChange={redraw} />

          {/* Said here rather than in a tooltip, because it is the answer to
              the first question anyone asks of this panel and getting it wrong
              costs them a bad rig. */}
          <Section title="What you are seeing">
            <p className="px-2 pb-1 text-[11px] leading-snug text-ink-faint">
              Markers stay where the resting mesh put them. A binding names a triangle of
              the neutral character, and a skinned mesh deforms on the GPU - so the leg
              swings through the knee guide rather than carrying it. Turn the skeleton on
              to watch the joints instead.
            </p>
            {subdivLevel > 0 && (
              <p className="px-2 pb-1 text-[11px] leading-snug text-guide-active">
                Subdivision is on, and the smooth surface is built from the resting cage -
                so the character will not move at all until you set Subdiv back to 0.
              </p>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

/**
 * Play, pause, loop, scrub, and the clock.
 *
 * Remounted whenever the chosen clip changes - hence the `key` at the call
 * site - so the slider's maximum and its starting position are set once, at
 * mount, rather than being kept in sync by an effect that has to guess when
 * the clip underneath it was swapped.
 */
function Transport({ onChange }: { onChange: () => void }): JSX.Element {
  const app = useApp();
  const player = app.animation;

  const scrub = useRef<HTMLInputElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  /**
   * True while the user is dragging the scrubber.
   *
   * Without it the frame callback writes the playhead back into the slider
   * under the user's finger, and a scrub during playback becomes a fight
   * between the two. A ref rather than state, because changing it must not
   * re-render anything.
   */
  const scrubbing = useRef(false);

  const [playing, setPlaying] = useState(player.playing);
  const [loop, setLoop] = useState(player.loop);
  const duration = player.duration;

  // The per-frame writer. Registered on the viewport's own loop, which is
  // already running; this adds no timer of its own and stops when the panel
  // unmounts.
  useEffect(() => {
    const write = (): void => {
      const time = player.time;
      if (clock.current) clock.current.textContent = formatTimecode(time);
      if (scrub.current && !scrubbing.current) {
        const fraction = duration > 0 ? time / duration : 0;
        scrub.current.value = String(Math.round(fraction * SCRUB_STEPS));
      }
      // Playback stops itself at the end of a clip that is not looping, and
      // the button has to notice. Comparing before setting keeps this from
      // being a re-render per frame.
      setPlaying((was) => (was === player.playing ? was : player.playing));
    };

    write();
    return app.viewport.onFrame(write);
  }, [app, player, duration]);

  return (
    <Section title="Transport">
      <div className="flex items-center gap-1.5 px-1">
        <IconButton
          icon={playing ? 'pause' : 'play'}
          label={playing ? 'Pause' : 'Play'}
          variant={playing ? 'default' : 'primary'}
          size="sm"
          data-testid="play-pause"
          onClick={() => {
            player.toggle();
            setPlaying(player.playing);
            onChange();
          }}
        />
        <IconButton
          icon="loop"
          label="Loop"
          size="sm"
          active={loop}
          data-testid="loop-toggle"
          onClick={() => {
            player.loop = !player.loop;
            setLoop(player.loop);
          }}
        />
        <span className="min-w-0 flex-1 truncate px-1 text-ink-dim">
          {player.selectedName}
        </span>
        <Chip>{formatTimecode(duration)}</Chip>
      </div>

      <div className="mt-2 flex items-center gap-2 px-2">
        <span
          ref={clock}
          data-testid="clip-time"
          className="w-14 shrink-0 font-mono text-[11px] text-ink-dim"
        >
          {formatTimecode(player.time)}
        </span>
        <input
          ref={scrub}
          type="range"
          min={0}
          max={SCRUB_STEPS}
          step={1}
          defaultValue={0}
          aria-label="Playhead"
          data-testid="scrub"
          onPointerDown={() => (scrubbing.current = true)}
          onPointerUp={() => (scrubbing.current = false)}
          onPointerCancel={() => (scrubbing.current = false)}
          // Keyboard scrubbing never sends a pointer event, so the flag is
          // cleared on blur too - otherwise arrowing along the timeline and
          // then clicking away leaves the slider permanently detached from
          // the playhead.
          onBlur={() => (scrubbing.current = false)}
          onInput={(event) => {
            const fraction = Number(event.currentTarget.value) / SCRUB_STEPS;
            player.seek(fraction * duration);
            if (clock.current) clock.current.textContent = formatTimecode(player.time);
          }}
          className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-panel-active accent-accent"
        />
      </div>
    </Section>
  );
}

function Section({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="border-b border-edge px-2 py-2.5">
      <h2 className="mb-1.5 px-2 text-xs font-medium uppercase tracking-wide text-ink-dim">
        {title}
      </h2>
      {children}
    </section>
  );
}
