import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readEyeLooks,
  eyeLookFor,
  isUsableLook,
  fileInsideUsdz
} from './eyeLook';

/**
 * Gary's inner USDC, taken out of the shipped USDZ.
 *
 * Read from the real bundled asset rather than a fixture: this module exists
 * to read what `tools/mb-to-usd.py` actually writes, and a fixture would let
 * the two drift apart silently.
 */
function garyCrate(): ArrayBuffer {
  const usdz = readFileSync(join(process.cwd(), 'public', 'assets', 'gary.usdz'));
  // A USDZ is an uncompressed zip; find the inner .usdc by its local header.
  const view = new DataView(usdz.buffer, usdz.byteOffset, usdz.byteLength);
  for (let i = 0; i < usdz.length - 30; i++) {
    if (view.getUint32(i, true) !== 0x04034b50) continue;
    const nameLength = view.getUint16(i + 26, true);
    const extraLength = view.getUint16(i + 28, true);
    const name = usdz.subarray(i + 30, i + 30 + nameLength).toString('utf8');
    if (!name.endsWith('.usdc')) continue;
    const size = view.getUint32(i + 22, true);
    const start = i + 30 + nameLength + extraLength;
    const slice = usdz.subarray(start, start + size);
    return slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength);
  }
  throw new Error('no .usdc inside the usdz');
}

describe('reading Squarebit Eye looks out of a USD', () => {
  const looks = readEyeLooks(garyCrate());

  it('finds a look on each eye', () => {
    // The whole reason this module exists: the look IS in the file, and
    // nothing was reading it, so the eyes rendered as white spheres.
    expect(looks).toHaveLength(2);
    expect(looks.map((l) => l.primPath.split('/').pop())).toEqual([
      'eye_l_geo',
      'eye_r_geo'
    ]);
  });

  it('reads the whole shipping interop set', () => {
    for (const look of looks) {
      expect(Object.keys(look.params).length).toBeGreaterThan(50);
      expect(isUsableLook(look)).toBe(true);
    }
  });

  it('reads the values, not just the names', () => {
    // An attribute's value lives on its OWN spec at `<prim>.<name>`, not on
    // the prim - reading the prim alone finds every name and no value at all,
    // which is exactly the shape this got wrong first.
    const left = looks[0]!;
    expect(left.params.ior).toBeCloseTo(1.376, 3);
    expect(left.params.corneaRadius).toBeCloseTo(0.65, 3);
    expect(left.params.refractionMode).toBe('MESH_NORMAL');
  });

  it('reads the projector matrix as sixteen numbers', () => {
    // This is what places the iris inside the eye. A matrix that arrived as a
    // string or a partial array would put the iris somewhere arbitrary.
    const matrix = looks[0]!.params.projectorMatrix;
    expect(Array.isArray(matrix)).toBe(true);
    expect(matrix as number[]).toHaveLength(16);
    for (const value of matrix as number[]) expect(Number.isFinite(value)).toBe(true);
  });

  it('keeps the texture paths relative, to resolve beside the character', () => {
    const left = looks[0]!;
    expect(String(left.params.irisTexture)).toMatch(/\.(jpg|png)$/i);
    expect(String(left.params.scleraTexture)).toMatch(/\.(jpg|png)$/i);
  });

  it('strips the namespace, because the shader names them without it', () => {
    for (const key of Object.keys(looks[0]!.params)) {
      expect(key.startsWith('squarebitEye:')).toBe(false);
    }
  });

  it('finds a look by prim path', () => {
    const path = looks[0]!.primPath;
    expect(eyeLookFor(looks, path)).toBe(looks[0]);
    expect(eyeLookFor(looks, '/not/a/prim')).toBeNull();
  });

  it('finds a look after the character has been reparented', () => {
    // The look's path is the one authored in the file; the mesh carries the
    // path Riser assigns on load. Comparing whole paths never matches, which
    // is how this first shipped: the looks were read correctly and applied to
    // nothing at all.
    const leaf = looks[0]!.primPath.split('/').pop()!;
    expect(eyeLookFor(looks, `/Riser/Character/Geom/${leaf}`)).toBe(looks[0]);
  });

  it('returns nothing for a character with no eyes', () => {
    // Most characters have none, and that is not an error.
    const plain = readFileSync(join(process.cwd(), 'public', 'assets', 'biped-blockout.usda'), 'utf8');
    expect(readEyeLooks(plain)).toEqual([]);
  });

  it('survives a file it cannot parse', () => {
    // A file three could not load either. Eyes are not worth a second error.
    expect(readEyeLooks('not usd at all {{{')).toEqual([]);
    expect(readEyeLooks(new ArrayBuffer(8))).toEqual([]);
  });

  it('refuses a look too sparse to build a shader from', () => {
    // A handful of stray attributes is not a look, and a material built from
    // one would be confidently wrong.
    expect(isUsableLook({ primPath: '/eye', params: { ior: 1.3 } })).toBe(false);
  });
});

describe('reading a look out of a USDZ archive', () => {
  it('finds the crate inside the archive', () => {
    // A USDZ is a zip, so the bytes a crate parser needs are the INNER file.
    // Handing it the archive parses to nothing, silently - which is how this
    // first shipped: the test above unzipped by hand and passed while the
    // running app fed the parser a zip and found no eyes at all.
    const usdz = readFileSync(join(process.cwd(), 'public', 'assets', 'gary.usdz'));
    const archive = usdz.buffer.slice(
      usdz.byteOffset,
      usdz.byteOffset + usdz.byteLength
    );
    const looks = readEyeLooks(archive);
    expect(looks).toHaveLength(2);
    expect(looks[0]!.params.ior).toBeCloseTo(1.376, 3);
  });
});

describe('textures packed inside the usdz', () => {
  function garyUsdz(): ArrayBuffer {
    const file = readFileSync(join(process.cwd(), 'public', 'assets', 'gary.usdz'));
    return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  }

  /**
   * The bug this exists to prevent.
   *
   * The eye look stores its maps as paths relative to the USD, and the first
   * version resolved them against the character's URL. That asks the server
   * for `/assets/gary_tex/T_Iris_Base_2_D.jpg`, which nobody ever unpacked.
   * In the dev server it came back `200 text/html` - the SPA fallback - so
   * there was no 404 to notice and the eyes rendered shaded but blank.
   */
  it('finds the iris map the look actually names', () => {
    const usdz = garyUsdz();
    const looks = readEyeLooks(usdz);
    expect(looks.length).toBeGreaterThan(0);

    const path = looks[0]!.params.irisTexture;
    expect(typeof path).toBe('string');

    const packed = fileInsideUsdz(usdz, path as string);
    expect(packed).not.toBeNull();

    // Really a JPEG, not just some bytes at an offset that happened to parse.
    const head = new Uint8Array(packed!);
    expect(head[0]).toBe(0xff);
    expect(head[1]).toBe(0xd8);
    expect(packed!.byteLength).toBeGreaterThan(10_000);
  });

  it('finds the sclera map too', () => {
    const usdz = garyUsdz();
    const looks = readEyeLooks(usdz);
    const packed = fileInsideUsdz(usdz, looks[0]!.params.scleraTexture as string);
    expect(packed).not.toBeNull();
    expect(new Uint8Array(packed!)[0]).toBe(0xff);
  });

  it('matches a leading ./ against the name the archive stores', () => {
    // The path is read from the look rather than written here. The converter
    // names the texture folder after the output file, so hardcoding one made
    // this fail on an asset that was perfectly correct, which is a test
    // reporting on its own assumptions rather than on the code.
    const usdz = garyUsdz();
    const authored = readEyeLooks(usdz)[0]!.params.scleraTexture as string;
    expect(authored.startsWith('./')).toBe(true);

    const dotted = fileInsideUsdz(usdz, authored);
    const bare = fileInsideUsdz(usdz, authored.slice(2));
    expect(bare).not.toBeNull();
    expect(dotted!.byteLength).toBe(bare!.byteLength);
  });

  it('returns null rather than guessing when a file is not there', () => {
    expect(fileInsideUsdz(garyUsdz(), './gary_tex/not_a_real_map.jpg')).toBeNull();
    expect(fileInsideUsdz(garyUsdz(), '')).toBeNull();
  });
});
