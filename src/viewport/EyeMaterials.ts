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
/**
 * The authored projector matrix, in the space the character's root expects.
 *
 * Two conversions, both of which were wrong before and neither of which fails
 * loudly.
 *
 * CONVENTION. USD writes a row-vector matrix: basis in the rows, translation
 * in the last row. three is column-vector, basis in the columns. Reading a
 * row-major array as column-major transposes the 3x3, which IS the conversion,
 * and leaves the translation in slots 12 to 14 where both already agree. So
 * `fromArray` on the raw flat array is right, and a transpose on top of it
 * would be wrong.
 *
 * UNITS. The exporter converts the whole matrix to metres on the way out,
 * basis included, because the basis length is the eye radius. But three's USD
 * composer puts `metersPerUnit` on the root group as a scale, so the root's
 * children are in the file's own units. Handing it metres scales them a second
 * time, which on a centimetre character put the projector 1.7 metres from the
 * eye, down beside the origin, with no error anywhere.
 *
 * Premultiplying by the inverse unit scale takes basis and translation
 * together and leaves the homogeneous term alone, which is what dividing a
 * transform by a scale means.
 */
export function projectorLocalMatrix(
  authored: readonly number[],
  metersPerUnit?: number | null
): THREE.Matrix4 {
  const matrix = new THREE.Matrix4().fromArray(authored as number[]);
  const unit = metersPerUnit && metersPerUnit > 0 ? metersPerUnit : 1;
  if (unit === 1) return matrix;
  return matrix.premultiply(
    new THREE.Matrix4().makeScale(1 / unit, 1 / unit, 1 / unit)
  );
}

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
  /** Projector objects parented to the character, removed with it. */
  private readonly projectors: THREE.Object3D[] = [];

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
    archive?: ArrayBuffer,
    /**
     * The character's root.
     *
     * The authored projector matrix is in the USD stage's world space, and
     * `normalize` puts the whole stage into the viewport by transforming this
     * one object. So a projector parented here, carrying the authored matrix
     * as its local transform, lands exactly where the file says it should.
     */
    root?: THREE.Object3D,
    /**
     * What one unit of the source file is worth in metres.
     *
     * The exporter writes the projector matrix in METRES, while the root's
     * child space is in the file's own units - three's USD composer puts
     * `metersPerUnit` on the root group as a scale. Without this the projector
     * is placed a hundred times too close to the origin on a centimetre asset.
     */
    metersPerUnit?: number | null
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
        const material = this.buildMaterial(
          mesh,
          look,
          loader,
          baseUrl,
          archive,
          root,
          metersPerUnit
        );
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
    archive?: ArrayBuffer,
    root?: THREE.Object3D,
    metersPerUnit?: number | null
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

    // The projector is what places the iris inside the eye: the iris is
    // projected FROM it, not read from the mesh's UVs, so its transform is the
    // difference between an eye that looks where it should and one that does
    // not.
    //
    // `updateProjector` reads the frame off the object it is given and nothing
    // else - it has no `matrix` option, whatever the earlier call here implied.
    // Passing the eye MESH therefore projected from the eyeball's own
    // transform and silently discarded the matrix the exporter had gone to the
    // trouble of recording. The fix is to give it an object that really is
    // where the projector is.
    const projector = this.projectorFor(look, root, metersPerUnit);
    try {
      updateProjector(eye, projector ?? mesh, {
        // USD is Y-up and authors the projector looking down +Z, which is the
        // module's native convention rather than three's lookAt.
        forwardAxis: 'z'
      });
    } catch {
      // Without a usable projector the iris sits at the shader's default
      // placement, which is still an eye rather than a white sphere.
    }

    return material;
  }

  /**
   * An object standing where the file says the projector stands.
   *
   * Null when the look carries no matrix, or the character has no root to hang
   * it from, in which case the caller falls back to the mesh and the iris
   * lands at the shader's default rather than nowhere.
   *
   * The matrix is read with `fromArray`, and the convention change is exactly
   * what that does. USD writes a row-vector matrix with the basis in its rows
   * and the translation in the last row; three is column-vector with the basis
   * in columns. Reading a row-major array as column-major transposes the 3x3,
   * which is the conversion, and leaves the translation in slots 12 to 14,
   * where both conventions already agree.
   */
  private projectorFor(
    look: EyeLook,
    root?: THREE.Object3D,
    metersPerUnit?: number | null
  ): THREE.Object3D | null {
    const authored = look.params.projectorMatrix;
    if (!root || !Array.isArray(authored) || authored.length !== 16) return null;
    if (!authored.every((v) => Number.isFinite(v))) return null;

    const projector = new THREE.Object3D();
    projector.name = `SquarebitEyeProjector:${look.primPath.split('/').pop() ?? 'eye'}`;
    projector.matrixAutoUpdate = false;
    projector.matrix.copy(projectorLocalMatrix(authored, metersPerUnit));
    root.add(projector);
    this.projectors.push(projector);
    // The parent chain has to be current before the module reads it, and the
    // root's own transform is set by `normalize` well before shading.
    projector.updateWorldMatrix(true, false);
    return projector;
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
    for (const projector of this.projectors) projector.removeFromParent();
    this.projectors.length = 0;
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
