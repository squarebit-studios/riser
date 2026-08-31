// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Lighting environments.
//
// The same arrangement the Eye widget on the store offers: four times of day -
// Studio, Day, Sunset, Night - and a switch between PHOTOGRAPHED lighting and
// a PROCEDURAL sky. A character lit in Riser then looks like the same
// character lit anywhere else of ours.
//
// This is not decoration on a marker-placement tool. Placing a joint means
// reading form, and form is only visible where light falls across it: a
// featureless wash flattens exactly the creases - an elbow pit, the inside of
// a knee - that a marker has to sit in the middle of. A low sunset key rakes
// across those and makes them readable.
//
// WHY BOTH PATHS. The HDRIs are real photographs and light a character the way
// a room does, with all the incidental bounce that makes a surface read. The
// procedural skies are a gradient plus a sun disc: cleaner, more neutral,
// completely predictable, and free of the colour cast a photograph carries.
// Neither is right for everyone, which is why it is a switch and not a
// decision made here. Turning HDRI off also means Riser works with nothing
// downloaded, which matters on a slow connection.
//
// The HDRIs are CC0 by Greg Zaal via Poly Haven; see public/hdri/CREDITS.txt.
//
// `skyEquirectData` is pure - no three.js - so the sky maths is testable on
// its own, and the controller wraps its buffer in a DataTexture.
// ==========================================================================

import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type EnvironmentId = 'studio' | 'day' | 'sunset' | 'night';

export const DEFAULT_ENVIRONMENT: EnvironmentId = 'studio';
/** Photographed lighting is the better default; the switch is for when it is not. */
export const DEFAULT_USE_HDRI = true;

interface KeyLight {
  color: number;
  intensity: number;
  /** Degrees. */
  az: number;
  el: number;
}

interface Sky {
  zenith: [number, number, number];
  horizon: [number, number, number];
  ground: [number, number, number];
  /** HDR - above 1, so the sun reads as a highlight rather than white. */
  sun: [number, number, number];
  sunAz: number;
  sunEl: number;
}

export interface EnvironmentPreset {
  id: EnvironmentId;
  label: string;
  hint: string;
  /** Key light for the PROCEDURAL sky. */
  light: KeyLight;
  ambient: number;
  /** Viewport background, or null to keep the app's own. */
  background: number | null;
  exposure: number;
  /**
   * The procedural sky, or undefined for Studio.
   *
   * Studio has none because the neutral answer already exists and is better
   * than a gradient: three's RoomEnvironment, which is a real room with
   * softboxes in it.
   */
  sky?: Sky;
  /**
   * The photographed alternative.
   *
   * `light` is a separate key from the procedural one because an HDRI already
   * carries a lot of ambient and specular energy, and reusing the procedural
   * intensities on top of it blows a pale character out.
   */
  hdri: { file: string; rotation: number; light: KeyLight };
}

export const ENVIRONMENTS: readonly EnvironmentPreset[] = [
  {
    id: 'studio',
    label: 'Studio',
    hint: 'Neutral and even - the fairest look at a grey character',
    light: { color: 0xffffff, intensity: 2.2, az: 27, el: 31 },
    ambient: 0.25,
    background: null,
    exposure: 1.0,
    hdri: {
      file: 'hdri-studio.exr',
      rotation: 0.85,
      light: { color: 0xffffff, intensity: 1.5, az: 44, el: 38 }
    }
  },
  {
    id: 'day',
    label: 'Day',
    hint: 'Open daylight, high sun - strong top light and clean shadows',
    light: { color: 0xfff4e0, intensity: 3.0, az: 20, el: 55 },
    ambient: 0.2,
    background: 0x9fb4c8,
    exposure: 0.95,
    sky: {
      zenith: [0.2, 0.42, 0.85],
      horizon: [0.78, 0.87, 0.96],
      ground: [0.34, 0.34, 0.37],
      sun: [6.0, 5.7, 5.0],
      sunAz: 20,
      sunEl: 55
    },
    hdri: {
      file: 'hdri-day.exr',
      rotation: 2.05,
      light: { color: 0xfff4e0, intensity: 2.0, az: 34, el: 52 }
    }
  },
  {
    id: 'sunset',
    label: 'Sunset',
    hint: 'Low raking sun - the best light for reading a crease or a joint pit',
    light: { color: 0xff8a3d, intensity: 2.4, az: -35, el: 9 },
    ambient: 0.18,
    background: 0x4a2f36,
    exposure: 1.1,
    sky: {
      zenith: [0.16, 0.13, 0.32],
      horizon: [0.98, 0.46, 0.2],
      ground: [0.1, 0.07, 0.09],
      sun: [9.0, 3.5, 1.2],
      sunAz: -35,
      sunEl: 8
    },
    hdri: {
      file: 'hdri-sunset.exr',
      rotation: 1.15,
      light: { color: 0xff8a3d, intensity: 1.7, az: -38, el: 12 }
    }
  },
  {
    id: 'night',
    label: 'Night',
    hint: 'Dim and cool - shows a silhouette without the surface detail',
    light: { color: 0x8fa0d8, intensity: 0.7, az: 40, el: 48 },
    ambient: 0.12,
    background: 0x080a14,
    exposure: 1.6,
    sky: {
      zenith: [0.01, 0.02, 0.06],
      horizon: [0.04, 0.06, 0.13],
      ground: [0.01, 0.01, 0.02],
      sun: [0.6, 0.65, 0.85],
      sunAz: 40,
      sunEl: 48
    },
    hdri: {
      file: 'hdri-night.exr',
      rotation: 0.4,
      light: { color: 0x8fa0d8, intensity: 0.5, az: 44, el: 48 }
    }
  }
];

export function environmentPreset(id: EnvironmentId): EnvironmentPreset {
  return ENVIRONMENTS.find((e) => e.id === id) ?? ENVIRONMENTS[0]!;
}

/** A unit direction from azimuth and elevation in degrees. */
export function directionFromAzEl(azDeg: number, elDeg: number): THREE.Vector3 {
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  return new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el)
  ).normalize();
}

function lerp3(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * A procedural equirectangular sky, as a Float32 RGBA buffer.
 *
 * HDR: the sun exceeds 1, which is what makes it read as a light source rather
 * than a white circle once tone mapping is applied. Row 0 is the zenith and
 * longitude wraps across the width.
 *
 * Returns null for Studio, which uses RoomEnvironment instead.
 */
export function skyEquirectData(
  id: EnvironmentId,
  width = 256,
  height = 128
): { width: number; height: number; data: Float32Array } | null {
  const sky = environmentPreset(id).sky;
  if (!sky) return null;

  const data = new Float32Array(width * height * 4);
  const sun = directionFromAzEl(sky.sunAz, sky.sunEl);

  for (let y = 0; y < height; y++) {
    const lat = (0.5 - (y + 0.5) / height) * Math.PI;
    const t = lat / (Math.PI / 2); // +1 zenith, 0 horizon, -1 nadir
    const gradient =
      t >= 0 ? lerp3(sky.horizon, sky.zenith, t) : lerp3(sky.horizon, sky.ground, -t);

    for (let x = 0; x < width; x++) {
      const lon = ((x + 0.5) / width) * 2 * Math.PI - Math.PI;
      const dx = Math.sin(lon) * Math.cos(lat);
      const dy = Math.sin(lat);
      const dz = Math.cos(lon) * Math.cos(lat);

      const d = Math.max(0, dx * sun.x + dy * sun.y + dz * sun.z);
      // A tight core plus a soft glow, which is what a sun looks like through
      // atmosphere and what makes the highlight land somewhere rather than
      // everywhere.
      const disc = Math.pow(d, 500) + 0.18 * Math.pow(d, 8);

      const i = (y * width + x) * 4;
      data[i] = gradient[0] + sky.sun[0] * disc;
      data[i + 1] = gradient[1] + sky.sun[1] * disc;
      data[i + 2] = gradient[2] + sky.sun[2] * disc;
      data[i + 3] = 1;
    }
  }
  return { width, height, data };
}

/** Cache key: an environment looks different with and without its photograph. */
type CacheKey = `${EnvironmentId}:${'hdri' | 'sky'}`;

/**
 * Owns the scene's lighting, and the switch between environments.
 *
 * Holds the PMREM generator and every filtered texture, so switching back to
 * something already seen costs nothing and nothing leaks when the viewport
 * goes away.
 */
export class EnvironmentController {
  private readonly loader = new EXRLoader();
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly cache = new Map<CacheKey, THREE.Texture>();
  private readonly pending = new Map<CacheKey, Promise<THREE.Texture | null>>();

  private readonly key: THREE.DirectionalLight;
  private readonly fill: THREE.DirectionalLight;
  private readonly ambient: THREE.AmbientLight;

  private current: EnvironmentId = DEFAULT_ENVIRONMENT;
  private useHdri = DEFAULT_USE_HDRI;
  private disposed = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly basePath = 'hdri/'
  ) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    // Compiled now rather than on first use, so the first switch does not stall
    // a frame while a shader builds.
    this.pmrem.compileEquirectangularShader();

    this.key = new THREE.DirectionalLight(0xffffff, 1.5);
    this.fill = new THREE.DirectionalLight(0xffffff, 0.4);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.25);
    for (const light of [this.key, this.fill, this.ambient]) light.layers.enableAll();
    scene.add(this.key, this.fill, this.ambient);
  }

  get activeId(): EnvironmentId {
    return this.current;
  }

  get hdriEnabled(): boolean {
    return this.useHdri;
  }

  /**
   * Apply an environment, with or without its photograph.
   *
   * The lights and exposure change immediately and the image-based part
   * follows when it is ready, so pressing a preset always does something
   * visible at once rather than appearing to hang on a download. The
   * procedural sky is available instantly, which is what makes turning HDRI
   * off a usable answer to a slow connection.
   */
  async apply(id: EnvironmentId, useHdri: boolean): Promise<void> {
    const preset = environmentPreset(id);
    this.current = id;
    this.useHdri = useHdri;
    this.applyLights(preset, useHdri);

    const key: CacheKey = `${id}:${useHdri ? 'hdri' : 'sky'}`;
    const texture = await this.textureFor(preset, useHdri, key);
    // Another switch may have landed while this loaded; the newest wins.
    if (this.disposed || `${this.current}:${this.useHdri ? 'hdri' : 'sky'}` !== key) {
      return;
    }
    if (!texture) return;

    this.scene.environment = texture;
    this.scene.environmentRotation = new THREE.Euler(
      0,
      useHdri ? preset.hdri.rotation : 0,
      0
    );
  }

  /** The background this environment wants, or null for the app's own. */
  backgroundFor(id: EnvironmentId): number | null {
    return environmentPreset(id).background;
  }

  private applyLights(preset: EnvironmentPreset, useHdri: boolean): void {
    const light = useHdri ? preset.hdri.light : preset.light;
    const direction = directionFromAzEl(light.az, light.el);

    this.key.color.setHex(light.color);
    this.key.intensity = light.intensity;
    this.key.position.copy(direction).multiplyScalar(10);

    // Opposite and low, so a silhouette does not go solid black.
    this.fill.color.setHex(light.color);
    this.fill.intensity = light.intensity * 0.28;
    this.fill.position.set(-direction.x, 0.4, -direction.z).multiplyScalar(10);

    this.ambient.intensity = preset.ambient;
    this.renderer.toneMappingExposure = preset.exposure;
  }

  private textureFor(
    preset: EnvironmentPreset,
    useHdri: boolean,
    key: CacheKey
  ): Promise<THREE.Texture | null> {
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);

    if (!useHdri) {
      const texture = this.buildProcedural(preset);
      if (texture) this.cache.set(key, texture);
      return Promise.resolve(texture);
    }

    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const request = this.loader
      .loadAsync(`${this.basePath}${preset.hdri.file}`)
      .then((source) => {
        // PMREM is what turns an equirectangular image into usable IBL; the
        // source is only needed to produce it.
        const filtered = this.pmrem.fromEquirectangular(source).texture;
        source.dispose();
        if (this.disposed) {
          filtered.dispose();
          return null;
        }
        this.cache.set(key, filtered);
        return filtered;
      })
      .catch((error: unknown) => {
        // A missing or unreadable EXR must not take the viewport down. Fall
        // back to the procedural version of the same environment, which is
        // always available, rather than leaving the character unlit.
        console.warn(
          `Could not load the ${preset.label} HDRI; using the procedural sky.`,
          error
        );
        return this.buildProcedural(preset);
      })
      .finally(() => {
        this.pending.delete(key);
      });

    this.pending.set(key, request);
    return request;
  }

  /** The procedural environment: a generated sky, or a room for Studio. */
  private buildProcedural(preset: EnvironmentPreset): THREE.Texture | null {
    const sky = skyEquirectData(preset.id);

    if (!sky) {
      // Studio. A real room with softboxes beats any gradient we could write.
      const room = new RoomEnvironment();
      const texture = this.pmrem.fromScene(room, 0.04).texture;
      room.dispose();
      return texture;
    }

    const source = new THREE.DataTexture(
      sky.data,
      sky.width,
      sky.height,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    source.mapping = THREE.EquirectangularReflectionMapping;
    source.needsUpdate = true;

    const filtered = this.pmrem.fromEquirectangular(source).texture;
    source.dispose();
    return filtered;
  }

  dispose(): void {
    this.disposed = true;
    for (const texture of this.cache.values()) texture.dispose();
    this.cache.clear();
    this.pmrem.dispose();
    this.scene.remove(this.key, this.fill, this.ambient);
    this.key.dispose();
    this.fill.dispose();
  }
}
