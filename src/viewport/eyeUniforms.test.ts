// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// That the eye's texture options are spelled the way the shader expects.
//
// This exists because of a bug that was invisible from every angle a test
// usually looks from. `EyeMaterials` built the uniforms and then assigned into
// `eye.irisMap` and `eye.scleraMap`. Those keys do not exist - the module
// builds `sbeIrisMap` and `sbeScleraMap`, and takes `irisMap` only as an
// OPTION when constructing them. Writing to a missing property is silent in
// JavaScript, so both maps were dropped without an error, a warning, or a
// failed request.
//
// The shader then sampled an unbound sampler. `sbeScleraColor *
// texture(sbeScleraMap, uv).rgb` multiplies toward black, so the eyes rendered
// black while every test around them passed: the looks parsed, the textures
// existed in the archive and decoded, and the material was created and
// applied. Everything was true except the one join that mattered.
//
// So this test asserts the join itself, against the real vendored module,
// with no DOM and no renderer.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { makeEyeUniforms } from '../vendor/squarebit-eye/eye-material.js';
import { TEXTURE_UNIFORMS } from './EyeMaterials';

interface UniformSet {
  [name: string]: { value?: unknown } | undefined;
}

describe('eye texture options', () => {
  it('every option EyeMaterials passes actually lands on a uniform', () => {
    // Sentinels rather than real textures: this is about names, and a
    // recognisable object proves the value travelled rather than merely that
    // something is there.
    const sentinels = new Map<string, object>();
    const options: Record<string, object> = {};
    for (const [, option] of TEXTURE_UNIFORMS) {
      const sentinel = { sentinelFor: option };
      sentinels.set(option, sentinel);
      options[option] = sentinel;
    }

    const eye = makeEyeUniforms(options) as UniformSet;

    for (const [, option] of TEXTURE_UNIFORMS) {
      const carried = Object.values(eye).some(
        (uniform) => uniform?.value === sentinels.get(option)
      );
      expect(
        carried,
        `makeEyeUniforms ignored the "${option}" option, so that texture would ` +
          `never reach the shader`
      ).toBe(true);
    }
  });

  it('names the uniforms the shader samples', () => {
    // The other half of the same join. The GLSL declares `sbeIrisMap` and
    // `sbeScleraMap`; if the module ever renamed them, passing the right
    // options would still leave the shader reading nothing.
    const eye = makeEyeUniforms({}) as UniformSet;
    expect(eye.sbeIrisMap).toBeDefined();
    expect(eye.sbeScleraMap).toBeDefined();
  });

  it('puts the iris option on the iris uniform, not merely on some uniform', () => {
    const iris = { which: 'iris' };
    const sclera = { which: 'sclera' };
    const eye = makeEyeUniforms({ irisMap: iris, scleraMap: sclera }) as UniformSet;

    expect(eye.sbeIrisMap?.value).toBe(iris);
    expect(eye.sbeScleraMap?.value).toBe(sclera);
  });
});

describe('look parameters', () => {
  it('are read from `params`, and ignored anywhere else', () => {
    // The whole look was being spread at the top level, where
    // `makeEyeUniforms` does not look for it: it merges `opts.params` over its
    // defaults and drops the rest. So all 56 authored values were discarded
    // and every character rendered with the widget's defaults, which is what
    // "the pupil and iris are huge" was.
    const nested = makeEyeUniforms({ params: { limbusRadius: 0.4059 } }) as UniformSet;
    expect(nested.sbeLimbusRadius?.value).toBeCloseTo(0.4059, 6);

    const topLevel = makeEyeUniforms({ limbusRadius: 0.4059 }) as UniformSet;
    expect(
      topLevel.sbeLimbusRadius?.value,
      'a top level look value should NOT reach the shader, which is why it has to be nested'
    ).not.toBeCloseTo(0.4059, 6);
  });

  it('has no pupilRadius option, so it has to travel through updateProjector', () => {
    // `sbePupilRadius` is not derived from the param block at all. A look that
    // authored one had it silently replaced by the 0.1667 default.
    const eye = makeEyeUniforms({ params: { pupilRadius: 0.05 } }) as UniformSet;
    expect(eye.sbePupilRadius?.value).not.toBeCloseTo(0.05, 6);
  });
});
