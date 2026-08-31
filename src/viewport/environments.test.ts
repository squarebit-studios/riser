import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_ENVIRONMENT,
  DEFAULT_USE_HDRI,
  ENVIRONMENTS,
  directionFromAzEl,
  environmentPreset,
  skyEquirectData
} from './environments';

describe('lighting environments', () => {
  it('offers the same four the Eye widget does', () => {
    expect(ENVIRONMENTS.map((e) => e.id)).toEqual([
      'studio',
      'day',
      'sunset',
      'night'
    ]);
  });

  it('ships the HDRI each one names', () => {
    // A preset pointing at a file that is not there fails at runtime, in the
    // viewport, as light that never changes - which is a confusing way to find
    // out that an asset was not copied.
    for (const preset of ENVIRONMENTS) {
      const path = join(process.cwd(), 'public', 'hdri', preset.hdri.file);
      expect(existsSync(path), `${preset.id} -> ${preset.hdri.file}`).toBe(true);
    }
  });

  it('credits the HDRIs it ships', () => {
    // They are CC0, but attribution is still the decent thing and the file
    // records where they came from.
    expect(existsSync(join(process.cwd(), 'public', 'hdri', 'CREDITS.txt'))).toBe(true);
  });

  it('explains every option, because they are read from a menu', () => {
    for (const preset of ENVIRONMENTS) {
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.hint.length).toBeGreaterThan(10);
    }
  });

  it('starts on studio, the neutral one', () => {
    // A character setup tool should open on light that flatters nothing and
    // hides nothing.
    expect(DEFAULT_ENVIRONMENT).toBe('studio');
    expect(environmentPreset('studio').background).toBeNull();
  });

  it('gives the coloured environments a matching background', () => {
    // A sunset that leaves the viewport charcoal reads as a bug: the character
    // warms and the world behind it does not.
    for (const id of ['day', 'sunset', 'night'] as const) {
      expect(environmentPreset(id).background, id).not.toBeNull();
    }
  });

  it('keeps every exposure and intensity in a sane range', () => {
    for (const preset of ENVIRONMENTS) {
      expect(preset.exposure).toBeGreaterThan(0.1);
      expect(preset.exposure).toBeLessThan(4);
      expect(preset.light.intensity).toBeGreaterThan(0);
      expect(preset.light.intensity).toBeLessThan(10);
      expect(preset.ambient).toBeGreaterThanOrEqual(0);
      expect(preset.ambient).toBeLessThan(1);
    }
  });

  it('lights each environment from its own direction', () => {
    // If two presets lit from the same angle they would differ only in colour,
    // and the point of switching is to move the light across the form.
    const seen = new Set(ENVIRONMENTS.map((e) => `${e.light.az}:${e.light.el}`));
    expect(seen.size).toBeGreaterThan(2);
  });

  it('puts the sunset key low, where it rakes', () => {
    // The reason sunset earns its place in a placement tool: a low sun is what
    // makes a crease or a joint pit readable.
    expect(environmentPreset('sunset').light.el).toBeLessThan(20);
    expect(environmentPreset('day').light.el).toBeGreaterThan(40);
  });

  it('falls back to studio for an unknown id', () => {
    expect(environmentPreset('nonsense' as never).id).toBe('studio');
  });
});

describe('turning azimuth and elevation into a direction', () => {
  it('points straight up at 90 degrees elevation', () => {
    const up = directionFromAzEl(0, 90);
    expect(up.y).toBeCloseTo(1, 6);
    expect(Math.hypot(up.x, up.z)).toBeCloseTo(0, 6);
  });

  it('points along +z at zero azimuth and elevation', () => {
    const forward = directionFromAzEl(0, 0);
    expect(forward.z).toBeCloseTo(1, 6);
    expect(forward.y).toBeCloseTo(0, 6);
  });

  it('swings to +x at 90 degrees azimuth', () => {
    expect(directionFromAzEl(90, 0).x).toBeCloseTo(1, 6);
  });

  it('always returns a unit vector', () => {
    for (const [az, el] of [[0, 0], [44, 38], [-38, 12], [180, -70]]) {
      expect(directionFromAzEl(az!, el!).length()).toBeCloseTo(1, 6);
    }
  });
});

describe('the procedural sky, for when HDRI is turned off', () => {
  it('defaults to photographed lighting', () => {
    // It lights a character better; the switch is for when it does not suit.
    expect(DEFAULT_USE_HDRI).toBe(true);
  });

  it('generates a sky for every environment except studio', () => {
    // Studio has none on purpose: RoomEnvironment is a real room with
    // softboxes in it, which beats any gradient we could write.
    expect(skyEquirectData('studio')).toBeNull();
    for (const id of ['day', 'sunset', 'night'] as const) {
      expect(skyEquirectData(id), id).not.toBeNull();
    }
  });

  it('fills the whole buffer with finite values', () => {
    // A NaN here becomes a black or blown environment map, and PMREM spreads
    // it across everything.
    const sky = skyEquirectData('day', 32, 16)!;
    expect(sky.data.length).toBe(32 * 16 * 4);
    for (const value of sky.data) expect(Number.isFinite(value)).toBe(true);
  });

  it('is high dynamic range, so the sun reads as a light', () => {
    // Clamped to 1 it would be a white circle rather than a source, and tone
    // mapping would have nothing to roll off.
    const sky = skyEquirectData('day', 128, 64)!;
    let peak = 0;
    for (let i = 0; i < sky.data.length; i += 4) peak = Math.max(peak, sky.data[i]!);
    expect(peak).toBeGreaterThan(1.5);
  });

  it('puts the sun where the preset says', () => {
    // Sunset's sun is low, so its brightest row belongs near the horizon -
    // which is the middle of an equirectangular map, not the top.
    const sky = skyEquirectData('sunset', 64, 32)!;
    let brightestRow = 0;
    let brightest = -1;
    for (let y = 0; y < sky.height; y++) {
      for (let x = 0; x < sky.width; x++) {
        const value = sky.data[(y * sky.width + x) * 4]!;
        if (value > brightest) {
          brightest = value;
          brightestRow = y;
        }
      }
    }
    const fraction = brightestRow / sky.height;
    expect(fraction).toBeGreaterThan(0.35);
    expect(fraction).toBeLessThan(0.65);
  });

  it('puts the day sun high', () => {
    const sky = skyEquirectData('day', 64, 32)!;
    let brightestRow = 0;
    let brightest = -1;
    for (let y = 0; y < sky.height; y++) {
      for (let x = 0; x < sky.width; x++) {
        const value = sky.data[(y * sky.width + x) * 4]!;
        if (value > brightest) {
          brightest = value;
          brightestRow = y;
        }
      }
    }
    expect(brightestRow / sky.height).toBeLessThan(0.4);
  });

  it('keeps night darker than day everywhere', () => {
    const mean = (id: 'day' | 'night'): number => {
      const sky = skyEquirectData(id, 64, 32)!;
      let total = 0;
      for (let i = 0; i < sky.data.length; i += 4) {
        total += sky.data[i]! + sky.data[i + 1]! + sky.data[i + 2]!;
      }
      return total / (sky.data.length / 4);
    };
    expect(mean('night')).toBeLessThan(mean('day'));
  });

  it('gives each environment its own key light for each path', () => {
    // An HDRI already carries a lot of ambient and specular energy; reusing
    // the procedural intensity on top of it blows a pale character out.
    for (const preset of ENVIRONMENTS) {
      expect(preset.hdri.light.intensity).toBeLessThanOrEqual(preset.light.intensity);
    }
  });
});
