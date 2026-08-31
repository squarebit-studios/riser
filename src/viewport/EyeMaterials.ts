// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Giving a character's eyes their real look.
//
// A Squarebit Eye is a refracted iris projection - the iris is seen THROUGH a
// cornea with an index of refraction, not painted on the surface. No USD
// surface schema can express that, so an exported character arrives in any USD
// viewer, Riser included, as a pair of white spheres.
//
// Everything needed to fix that is already present. `io/eyeLook.ts` reads the
// 56 `squarebitEye:*` attributes the exporter writes onto each eye prim, and
// `vendor/squarebit-eye/` is the same shader the store's Eye widget runs. This
// is the join between them: look -> uniforms -> a patched material on the
// right meshes.
//
// WHY IT MATTERS HERE rather than being decoration. Riser's face template asks
// for eye guides, and an eye guide is placed by looking at the eye. On a white
// sphere there is no iris, no limbus and no pupil to aim at - the landmarks
// the marker exists to record are the exact things the missing shader was
// hiding.
//
// FAILURE IS ALWAYS SOFT. Every step here can fail on a character that has no
// eyes, a partial look, or a texture that will not load, and none of those are
// worth breaking a character load over. The eye falls back to the white
// stand-in it already had, which is what Riser showed before any of this
// existed.
// ==========================================================================

import * as THREE from 'three';
import {
  eyeLookFor,
  fileInsideUsdz,
  isUsableLook,
  type EyeLook
} from '../io/eyeLook';
import { EYE_CORE_GLSL } from '../vendor/squarebit-eye/eye-core';
// The vendored module is untyped JavaScript, copied verbatim from the Eye
// repo the way the store's widget copies it. Its shape is declared in
// src/vite-env.d.ts rather than edited here, so taking a newer version stays a
// file overwrite.
import {
  makeEyeUniforms,
  applyEyeShader,
  updateProjector
} from '../vendor/squarebit-eye/eye-material.js';

/**
 * Look parameter -> the option `makeEyeUniforms` takes for it.
 *
 * Exported so a test can check these names against the uniforms the module
 * really builds. A name that does not exist there fails silently at runtime,
 * which is exactly how the eyes came out black, and a spelling is not
 * something to find out about from a screenshot.
 */
export const TEXTURE_UNIFORMS = [
  ['irisTexture', 'irisMap'],
  ['scleraTexture', 'scleraMap']
] as const;

interface EyeUniforms {
  [key: string]: unknown;
}

/**
 * Applies Squarebit Eye looks to whichever meshes carry them.
 *
 * Holds the built materials so they can be disposed when the character
 * changes, and so a second call does not rebuild what is already right.
 */
export class EyeMaterials {
  private readonly applied = new Map<string, THREE.Material>();
  private readonly textures: THREE.Texture[] = [];
  /** Blob URLs minted for textures unpacked from a USDZ, so they can be revoked. */
  private readonly blobs: string[] = [];

  /** How many eyes are currently shaded. Reported to the user, and tested. */
  get count(): number {
    return this.applied.size;
  }

  /**
   * Shade every mesh that has a look.
   *
   * `baseUrl` is where the character's textures resolve from - the look stores
   * `irisTexture` as a path relative to the USD, exactly as the surface
   * textures are stored.
   */
  apply(
    meshes: readonly THREE.Mesh[],
    looks: readonly EyeLook[],
    baseUrl: string,
    /**
     * The character file itself, when it is a USDZ.
     *
     * A USDZ is a zip, and the eye's textures are packed inside it rather than
     * sitting beside it on the server. Without the archive there is nothing to
     * unpack them from and the maps are looked for next to the character,
     * which is right for a loose `.usda` and wrong for everything else.
     */
    archive?: ArrayBuffer
  ): number {
    if (looks.length === 0) return 0;

    const loader = new THREE.TextureLoader();
    let shaded = 0;

    for (const mesh of meshes) {
      const primPath = (mesh.userData.primPath as string) ?? '';
      const look = eyeLookFor(looks, primPath);
      if (!look || !isUsableLook(look)) continue;
      if (this.applied.has(primPath)) continue;

      try {
        const material = this.buildMaterial(mesh, look, loader, baseUrl, archive);
        if (!material) continue;

        mesh.material = material;
        this.applied.set(primPath, material);
        shaded++;
      } catch (error) {
        // One eye that will not shade must not cost the other one, nor the
        // character. The white stand-in stays on this mesh.
        console.warn(`Could not shade ${primPath} as a Squarebit Eye.`, error);
      }
    }
    return shaded;
  }

  private buildMaterial(
    mesh: THREE.Mesh,
    look: EyeLook,
    loader: THREE.TextureLoader,
    baseUrl: string,
    archive?: ArrayBuffer
  ): THREE.Material | null {
    const params = look.params;

    // Start from the mesh's own material so anything the exporter did get
    // right - side, transparency, the sclera fallback colour - survives.
    const source = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const material = (source?.clone() ?? new THREE.MeshStandardMaterial()) as
      THREE.MeshStandardMaterial;
    material.name = `SquarebitEye:${look.primPath.split('/').pop() ?? 'eye'}`;

    // The maps are built BEFORE the uniforms and handed in as options, which
    // is the interface the module documents. The previous version made the
    // uniforms first and then assigned into `eye.irisMap` and `eye.scleraMap`,
    // names that do not exist: the real ones are `sbeIrisMap` and
    // `sbeScleraMap`. Writing to a missing key is not an error in JavaScript,
    // so both textures were dropped without a word and the shader sampled an
    // unbound map. The sclera is `sbeScleraColor * texture(sbeScleraMap, uv)`,
    // which multiplies toward black, and that is why a correctly shaded eye
    // rendered as a black one.
    const maps: Record<string, THREE.Texture> = {};
    for (const [key, option] of TEXTURE_UNIFORMS) {
      const path = params[key];
      if (typeof path !== 'string' || path.length === 0) continue;
      const texture = loader.load(this.textureUrl(path, baseUrl, archive));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      this.textures.push(texture);
      maps[option] = texture;
    }

    const eye = makeEyeUniforms({
      ...numericParams(params),
      ...maps
    }) as EyeUniforms;

    applyEyeShader(material, EYE_CORE_GLSL, eye);

    // Kept so the wiring can be inspected after the fact, by a test or by
    // anyone debugging an eye that does not look right.
    material.userData.squarebitEye = eye;

    // The projector is what places the iris inside the eye. Its matrix is
    // authored in the character's own units, which the exporter has already
    // converted - passing the mesh lets the module resolve the rest against
    // the object's world transform.
    try {
      updateProjector(eye, mesh, { matrix: params.projectorMatrix });
    } catch {
      // Without a projector the iris sits at the shader's default placement,
      // which is still an eye rather than a white sphere.
    }

    return material;
  }

  /**
   * Where a texture should actually be fetched from.
   *
   * Inside the archive first, because that is where a USDZ keeps it. Falling
   * back to a path beside the character covers a loose `.usda` that references
   * its maps as ordinary files, which is the other shape these assets come in.
   */
  private textureUrl(
    path: string,
    baseUrl: string,
    archive?: ArrayBuffer
  ): string {
    if (archive) {
      const packed = fileInsideUsdz(archive, path);
      if (packed) {
        const url = URL.createObjectURL(new Blob([packed], { type: mimeFor(path) }));
        this.blobs.push(url);
        return url;
      }
    }
    return resolve(baseUrl, path);
  }

  /** Drop the materials and textures this built. */
  dispose(): void {
    for (const material of this.applied.values()) material.dispose();
    this.applied.clear();
    for (const texture of this.textures) texture.dispose();
    this.textures.length = 0;
    for (const url of this.blobs) URL.revokeObjectURL(url);
    this.blobs.length = 0;
  }
}

/**
 * Only the numeric look values.
 *
 * `makeEyeUniforms` expects scalars and colours; the paths and the mode string
 * are handled separately, and passing them through would have it build
 * uniforms out of filenames.
 */
function numericParams(
  params: Record<string, number | string | number[]>
): Record<string, number | number[]> {
  const out: Record<string, number | number[]> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'number' || Array.isArray(value)) out[key] = value;
  }
  return out;
}

/** Image type for a packed texture, so the blob decodes as what it is. */
function mimeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'exr' || ext === 'hdr') return 'application/octet-stream';
  return 'image/jpeg';
}

/** Resolve a look's relative texture path against the character's own URL. */
function resolve(baseUrl: string, path: string): string {
  const clean = path.replace(/^\.\//, '');
  const slash = baseUrl.lastIndexOf('/');
  return slash === -1 ? clean : `${baseUrl.slice(0, slash + 1)}${clean}`;
}
