// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Loading a character from a URL or an uploaded file.
//
// USD is the primary path and the only one that arrives fully described:
// three's USDComposer reads `metersPerUnit` and `upAxis` from the stage and
// applies both to the root group before we see it. glTF declares metres and
// Y-up by specification. FBX and OBJ declare nothing useful, so they get the
// heuristic in normalize.ts and a "convert to USD" nudge in the UI.
// ==========================================================================

import * as THREE from 'three';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { CharacterModel, type CharacterSource } from './CharacterModel';
import { applyFit, computeFitTransform, guessUnitScale, visibleBounds } from './normalize';
import { applyStudioMaterial } from './studioMaterial';

/** Matches the decoder the store's ModelViewer already points at. */
const DRACO_DECODER_PATH = 'https://www.gstatic.com/draco/versioned/decoders/1.5.7/';

export type CharacterFormat = 'usd' | 'gltf' | 'fbx' | 'obj';

export const SUPPORTED_EXTENSIONS = [
  'usd',
  'usda',
  'usdc',
  'usdz',
  'glb',
  'gltf',
  'fbx',
  'obj'
] as const;

export function formatForExtension(ext: string): CharacterFormat | null {
  switch (ext.toLowerCase()) {
    case 'usd':
    case 'usda':
    case 'usdc':
    case 'usdz':
      return 'usd';
    case 'glb':
    case 'gltf':
      return 'gltf';
    case 'fbx':
      return 'fbx';
    case 'obj':
      return 'obj';
    default:
      return null;
  }
}

export function extensionOf(name: string): string {
  const clean = name.split(/[?#]/)[0] ?? name;
  const parts = clean.split('.');
  return parts.length > 1 ? (parts.pop() as string) : '';
}

let dracoLoader: DRACOLoader | null = null;
function getDracoLoader(): DRACOLoader {
  if (!dracoLoader) {
    dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
  }
  return dracoLoader;
}

export interface LoadOptions {
  /**
   * Height in metres to fit unitless assets to. Ignored for USD and glTF,
   * which state their own units.
   */
  fallbackHeight?: number;
  groundAlign?: boolean;
  recenterXZ?: boolean;
}

/** Load from a URL. */
/** Where a load has got to, for something to show a person. */
export interface LoadProgress {
  /** What is happening now: downloading, or working on what arrived. */
  stage: 'downloading' | 'parsing' | 'building';
  /** Bytes received so far. */
  received: number;
  /**
   * Total bytes, when the server said. Null when it did not, which happens
   * with chunked transfer encoding and means no percentage can be honest.
   */
  total: number | null;
}

export interface UrlLoadOptions extends LoadOptions {
  onProgress?: (progress: LoadProgress) => void;
  /** Aborts the download. A cancelled load throws `CancelledError`. */
  signal?: AbortSignal;
}

/** Thrown when a load is cancelled, so a caller can tell it from a failure. */
export class CancelledError extends Error {
  constructor() {
    super('Loading cancelled');
    this.name = 'CancelledError';
  }
}

export async function loadCharacterFromUrl(
  url: string,
  options: UrlLoadOptions = {}
): Promise<CharacterModel> {
  const format = formatForExtension(extensionOf(url));
  if (!format) throw new Error(`Unsupported character format: ${url}`);

  const { onProgress, signal, ...rest } = options;
  const buffer = await download(url, onProgress, signal);

  // Parsing a character is seconds of synchronous work on a big asset, and it
  // is the half a person cannot see happening. Saying so is the difference
  // between a progress bar that stops at 100% and one that explains itself.
  onProgress?.({ stage: 'parsing', received: buffer.byteLength, total: buffer.byteLength });
  const model = buildModel(buffer, url, format, rest);
  onProgress?.({ stage: 'building', received: buffer.byteLength, total: buffer.byteLength });
  return model;
}

/**
 * Fetch a character, reporting progress and stopping when asked.
 *
 * Streamed rather than `response.arrayBuffer()` because a 20MB character on a
 * slow connection is a long time to show nothing, and because a download
 * nobody can stop is a trap: the only way out was to reload the page and lose
 * the document.
 */
async function download(
  url: string,
  onProgress?: (progress: LoadProgress) => void,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const declared = response.headers.get('content-length');
  const total = declared ? Number(declared) : null;

  // No stream to read means no progress to report, which is the case in
  // jsdom and in any browser old enough to lack ReadableStream on a response.
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onProgress?.({ stage: 'downloading', received: buffer.byteLength, total });
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  onProgress?.({ stage: 'downloading', received: 0, total: Number.isFinite(total) ? total : null });

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      onProgress?.({ stage: 'downloading', received, total: Number.isFinite(total) ? total : null });
    }
    if (signal?.aborted) {
      // Releasing the lock lets the browser tear the connection down rather
      // than leaving it draining in the background.
      await reader.cancel().catch(() => undefined);
      throw new CancelledError();
    }
  }

  const buffer = new Uint8Array(received);
  let at = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, at);
    at += chunk.byteLength;
  }
  return buffer.buffer;
}

/** Load from a File chosen in a picker or dropped on the viewport. */
export async function loadCharacterFromFile(
  file: File,
  options: LoadOptions = {}
): Promise<CharacterModel> {
  const format = formatForExtension(extensionOf(file.name));
  if (!format) throw new Error(`Unsupported character format: ${file.name}`);
  const buffer = await file.arrayBuffer();
  return buildModel(buffer, file.name, format, options);
}

/** Load only the animation clips out of a file, ignoring its geometry. */
export async function loadClipsFromFile(
  file: File
): Promise<{ clips: THREE.AnimationClip[]; format: CharacterFormat }> {
  const format = formatForExtension(extensionOf(file.name));
  if (!format) throw new Error(`Unsupported animation format: ${file.name}`);
  const buffer = await file.arrayBuffer();

  // The whole file is parsed, geometry and all, and then all but the clips is
  // discarded. Wasteful, and deliberately so: none of three's loaders offers a
  // clips-only path, and half-parsing a glTF by hand to save a few
  // milliseconds is exactly the kind of shortcut that reads a buffer view
  // wrong on somebody else's exporter.
  const { root, animations } = await parseByFormat(buffer, file.name, format);
  root.clear();
  return { clips: animations, format };
}

async function buildModel(
  buffer: ArrayBuffer,
  ref: string,
  format: CharacterFormat,
  options: LoadOptions
): Promise<CharacterModel> {
  const { root, source, animations } = await parseByFormat(buffer, ref, format);

  // USD and glTF have already told us where they stand; only the unitless
  // formats get rescaled, and even then only the root transform moves.
  const needsUnitGuess = source.metersPerUnit === null;
  const bounds = visibleBounds(root);

  if (needsUnitGuess) {
    const guessed = guessUnitScale(bounds);
    root.scale.multiplyScalar(guessed);
    root.updateMatrixWorld(true);
    source.metersPerUnit = guessed;
  }

  const fit = computeFitTransform(visibleBounds(root), {
    targetHeight: needsUnitGuess ? (options.fallbackHeight ?? null) : null,
    groundAlign: options.groundAlign ?? true,
    recenterXZ: options.recenterXZ ?? true
  });
  applyFit(root, fit);

  // A character that arrived unshaded renders as a black silhouette, which is
  // useless to place markers on. Assets that brought real materials keep them.
  applyStudioMaterial(root);

  return new CharacterModel(root, source, animations);
}

/**
 * `animations` is the part that used to be dropped on the floor. Each loader
 * puts them somewhere different - three hangs them off the root group for USD
 * and FBX, and returns them beside the scene for glTF - so this is the one
 * place that difference has to be known about.
 */
async function parseByFormat(
  buffer: ArrayBuffer,
  ref: string,
  format: CharacterFormat
): Promise<{
  root: THREE.Group;
  source: CharacterSource;
  animations: THREE.AnimationClip[];
}> {
  switch (format) {
    case 'usd': {
      const group = new USDLoader().parse(buffer);
      // Recover what the composer applied to the root, so the layer we write
      // later declares the same units as the asset it references.
      // See USDComposer.js:134-146 - metersPerUnit becomes a uniform root
      // scale, and a Z-up stage becomes rotation.x = -PI/2.
      const metersPerUnit = group.scale.x !== 0 ? group.scale.x : 1;
      const upAxis: 'Y' | 'Z' =
        Math.abs(group.rotation.x + Math.PI / 2) < 1e-6 ? 'Z' : 'Y';
      return {
        root: group,
        source: { ref, format, metersPerUnit, upAxis },
        // UsdSkel SkelAnimation prims, built by USDComposer._buildAnimations.
        animations: group.animations ?? []
      };
    }

    case 'gltf': {
      const loader = new GLTFLoader();
      loader.setDRACOLoader(getDracoLoader());
      const gltf = await loader.parseAsync(buffer, '');
      // glTF is metres and Y-up by specification.
      return {
        root: gltf.scene,
        source: { ref, format, metersPerUnit: 1, upAxis: 'Y' },
        animations: gltf.animations ?? []
      };
    }

    case 'fbx': {
      const group = new FBXLoader().parse(buffer, '');
      // FBX carries a unit scale factor that the loader has already applied,
      // but it is unreliable in practice, so we treat FBX as unitless.
      return {
        root: group as THREE.Group,
        source: { ref, format, metersPerUnit: null, upAxis: null },
        animations: group.animations ?? []
      };
    }

    case 'obj': {
      const text = new TextDecoder().decode(buffer);
      const group = new OBJLoader().parse(text);
      // OBJ has no notion of time. Nothing to look for.
      return {
        root: group,
        source: { ref, format, metersPerUnit: null, upAxis: null },
        animations: []
      };
    }
  }
}

/** Free the shared DRACO worker pool. Called on app teardown. */
export function disposeLoaders(): void {
  dracoLoader?.dispose();
  dracoLoader = null;
}
