import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import { CharacterModel } from '../../io/CharacterModel';
import { buildProfile, findLandmarks } from './profile';
import { sampleSurfacePoints } from './sampleSurface';
import type { Vec3 } from '../../doc/types';

/**
 * Two kinds of test here, and both are needed.
 *
 * Synthetic figures have landmarks known EXACTLY by construction, so they can
 * assert real numbers rather than ranges. The real assets prove the method
 * survives contact with a mesh nobody designed for it - which is where all
 * three bugs in this module came from.
 */

// -------------------------------------------------------------------------
// Synthetic bodies
// -------------------------------------------------------------------------

/** Fill an axis-aligned box with a grid of points. */
function box(
  cx: number,
  cy: number,
  cz: number,
  w: number,
  h: number,
  d: number,
  step = 0.02
): Vec3[] {
  const points: Vec3[] = [];
  for (let x = cx - w / 2; x <= cx + w / 2; x += step) {
    for (let y = cy - h / 2; y <= cy + h / 2; y += step) {
      for (let z = cz - d / 2; z <= cz + d / 2; z += step) {
        points.push([x, y, z]);
      }
    }
  }
  return points;
}

/**
 * A crude 2m figure with landmarks placed on purpose:
 *   legs   0.00 - 0.90   two masses at x = +/- 0.15
 *   torso  0.90 - 1.60   one mass, waist narrow at 1.10
 *   arms   1.00 - 1.55   held clear at x = +/- 0.45
 *   head   1.70 - 2.00
 */
function syntheticBiped(): Vec3[] {
  return [
    ...box(-0.15, 0.45, 0, 0.16, 0.9, 0.16),
    ...box(0.15, 0.45, 0, 0.16, 0.9, 0.16),
    ...box(0, 1.0, 0, 0.4, 0.2, 0.2), // hips
    ...box(0, 1.15, 0, 0.26, 0.14, 0.18), // waist, deliberately narrow
    ...box(0, 1.42, 0, 0.44, 0.42, 0.22), // chest
    ...box(-0.45, 1.28, 0, 0.12, 0.5, 0.12), // arms, clear of the body
    ...box(0.45, 1.28, 0, 0.12, 0.5, 0.12),
    ...box(0, 1.65, 0, 0.14, 0.14, 0.14), // neck
    ...box(0, 1.85, 0, 0.24, 0.3, 0.24) // head
  ];
}

function fraction(y: number, lm: { groundY: number; height: number }): number {
  return (y - lm.groundY) / lm.height;
}

// -------------------------------------------------------------------------

describe('buildProfile', () => {
  it('returns nothing usable for an empty or flat input', () => {
    expect(buildProfile([]).slabs).toEqual([]);
    expect(buildProfile([[0, 1, 0]]).slabs).toEqual([]);
  });

  it('spans exactly the input height', () => {
    const profile = buildProfile(syntheticBiped());
    expect(profile.minY).toBeCloseTo(0, 2);
    expect(profile.maxY).toBeCloseTo(2, 1);
    expect(profile.height).toBeCloseTo(profile.maxY - profile.minY, 9);
  });

  it('keeps the topmost points rather than dropping them off the end', () => {
    // The highest point lands one band past the end without a clamp, which
    // would quietly lose the crown of the head and shorten every character.
    const profile = buildProfile(syntheticBiped());
    const top = profile.slabs[profile.slabs.length - 1];
    expect(top!.count).toBeGreaterThan(0);
  });

  it('sees two masses through the legs and one through the torso', () => {
    const profile = buildProfile(syntheticBiped());
    const at = (y: number) =>
      profile.slabs.reduce((best, s) =>
        Math.abs(s.y - y) < Math.abs(best.y - y) ? s : best
      );

    expect(at(0.45).clusters).toBe(2);
    expect(at(1.0).clusters).toBe(1);
    // Where the arms are held clear it is arm, torso, arm.
    expect(at(1.3).clusters).toBe(3);
  });

  it('knows whether the midline is inside the body', () => {
    // The signal crotch detection rests on: between the legs the centre line
    // is in open air, and arms held out to the side cannot change that.
    const profile = buildProfile(syntheticBiped());
    const at = (y: number) =>
      profile.slabs.reduce((best, s) =>
        Math.abs(s.y - y) < Math.abs(best.y - y) ? s : best
      );

    expect(at(0.45).centerOccupied).toBe(false);
    expect(at(1.0).centerOccupied).toBe(true);
    expect(at(1.3).centerOccupied).toBe(true);
  });

  it('measures the torso without counting the arms', () => {
    const profile = buildProfile(syntheticBiped());
    const armBand = profile.slabs.reduce((best, s) =>
      Math.abs(s.y - 1.3) < Math.abs(best.y - 1.3) ? s : best
    );

    // Full span reaches the arms at +/-0.45; the torso itself is 0.44 wide.
    expect(armBand.width).toBeGreaterThan(0.9);
    expect(armBand.centralWidth).toBeLessThan(0.55);
    expect(armBand.centralWidth).toBeGreaterThan(0.35);
  });
});

describe('findLandmarks on a synthetic figure', () => {
  const lm = findLandmarks(buildProfile(syntheticBiped()))!;

  it('finds landmarks at all', () => {
    expect(lm).not.toBeNull();
  });

  it('puts the crotch where the legs actually stop', () => {
    // Constructed at 0.90. Band resolution is 2m/64 = 3cm, so a few cm either
    // way is the measurement, not an error.
    expect(lm.crotchY).toBeGreaterThan(0.82);
    expect(lm.crotchY).toBeLessThan(0.98);
  });

  it('is not fooled by the arms merging higher up', () => {
    // The arms rejoin the torso at 1.55. A mass-counting crotch test picks
    // that instead, which is precisely the bug this guards.
    expect(lm.crotchY).toBeLessThan(1.2);
  });

  it('finds the waist at the narrow section', () => {
    expect(lm.waistY).toBeGreaterThan(1.05);
    expect(lm.waistY).toBeLessThan(1.28);
  });

  it('orders the landmarks up the body', () => {
    expect(lm.crotchY).toBeLessThan(lm.waistY);
    expect(lm.waistY).toBeLessThan(lm.shoulderY);
    expect(lm.shoulderY).toBeLessThan(lm.neckY);
    expect(lm.neckY).toBeLessThan(lm.topY);
  });

  it('measures the hips from the gap between the legs', () => {
    // Legs are centred at +/-0.15, so half the hip width is about 0.15.
    expect(lm.hipHalfWidth).toBeGreaterThan(0.08);
    expect(lm.hipHalfWidth).toBeLessThan(0.24);
  });

  it('reaches out to the arms', () => {
    expect(lm.armReachX).toBeGreaterThan(0.4);
  });

  it('is confident about something built like a person', () => {
    expect(lm.confidence).toBeGreaterThan(0.9);
  });
});

describe('findLandmarks refuses nonsense', () => {
  it('returns null for too little data', () => {
    expect(findLandmarks(buildProfile([]))).toBeNull();
    expect(findLandmarks(buildProfile(box(0, 1, 0, 0.1, 0.1, 0.1, 0.05)))).toBeNull();
  });

  it('is unconfident about a shape with no legs', () => {
    // A single column has no crotch to find, so the answer is a guess and the
    // confidence has to say so rather than presenting a fallback as a fact.
    const column = box(0, 1, 0, 0.3, 2, 0.3, 0.03);
    const lm = findLandmarks(buildProfile(column));
    expect(lm).not.toBeNull();
    expect(lm!.confidence).toBeLessThan(0.7);
  });
});

// -------------------------------------------------------------------------
// Real assets
// -------------------------------------------------------------------------

function loadAsset(name: string): CharacterModel {
  const text = readFileSync(join(process.cwd(), 'public', 'assets', name), 'utf8');
  return new CharacterModel(new USDLoader().parse(text), {
    ref: name,
    format: 'usd',
    metersPerUnit: 1,
    upAxis: 'Y'
  });
}

describe('the real blockout biped', () => {
  const model = loadAsset('biped-blockout.usda');
  const points = sampleSurfacePoints(model.meshes);
  const profile = buildProfile(points);
  const lm = findLandmarks(profile)!;

  it('samples the surface densely enough to leave no empty bands', () => {
    // Raw vertices leave ten consecutive bands empty on this mesh, because a
    // capsule's vertices sit in rings. Every band must see the character.
    const empty = profile.slabs.filter((s) => s.count < 6).length;
    expect(empty, `${empty} bands had no samples`).toBe(0);
  });

  it('lands every landmark in human proportion', () => {
    expect(fraction(lm.crotchY, lm)).toBeGreaterThan(0.35);
    expect(fraction(lm.crotchY, lm)).toBeLessThan(0.55);

    expect(fraction(lm.waistY, lm)).toBeGreaterThan(0.5);
    expect(fraction(lm.waistY, lm)).toBeLessThan(0.68);

    expect(fraction(lm.shoulderY, lm)).toBeGreaterThan(0.75);
    expect(fraction(lm.shoulderY, lm)).toBeLessThan(0.9);

    expect(fraction(lm.neckY, lm)).toBeGreaterThan(0.8);
    expect(fraction(lm.neckY, lm)).toBeLessThan(0.95);
  });

  it('measures the hips against where the legs really are', () => {
    // The generator puts the leg capsules at x = +/-0.1.
    expect(lm.hipHalfWidth).toBeGreaterThan(0.05);
    expect(lm.hipHalfWidth).toBeLessThan(0.18);
  });

  it('reaches to the hands, not just the shoulders', () => {
    // Hands sit at x = +/-0.45.
    expect(lm.armReachX).toBeGreaterThan(0.35);
  });

  it('is confident', () => {
    expect(lm.confidence).toBeGreaterThan(0.9);
  });
});

describe('the real quadruped', () => {
  const model = loadAsset('quadruped-blockout.usda');
  const lm = findLandmarks(buildProfile(sampleSurfacePoints(model.meshes)))!;

  it('says it is not confident, rather than inventing biped anatomy', () => {
    // Its landmarks come out ordered but meaningless as human proportions -
    // the "shoulders" sit at about half its height. Reporting that honestly is
    // what lets the caller fall back instead of placing markers on a horse as
    // though it were a person.
    expect(lm.confidence).toBeLessThan(0.7);
  });
});

describe('sampleSurfacePoints', () => {
  const model = loadAsset('biped-blockout.usda');

  it('produces roughly the requested number of points', () => {
    const points = sampleSurfacePoints(model.meshes, 5000);
    expect(points.length).toBeGreaterThan(3000);
    expect(points.length).toBeLessThan(12000);
  });

  it('is deterministic', () => {
    // Automatic placement must give the same answer every run, so the sampler
    // uses a Halton sequence rather than Math.random.
    const a = sampleSurfacePoints(model.meshes, 2000);
    const b = sampleSurfacePoints(model.meshes, 2000);
    expect(a.length).toBe(b.length);
    expect(a[0]).toEqual(b[0]);
    expect(a[a.length - 1]).toEqual(b[b.length - 1]);
  });

  it('stays inside the character bounds', () => {
    const box3 = model.bounds;
    for (const p of sampleSurfacePoints(model.meshes, 2000)) {
      expect(p[1]).toBeGreaterThanOrEqual(box3.min.y - 1e-4);
      expect(p[1]).toBeLessThanOrEqual(box3.max.y + 1e-4);
    }
  });

  it('handles a character with no meshes', () => {
    expect(sampleSurfacePoints([], 1000)).toEqual([]);
  });

  it('gives every triangle at least one sample', () => {
    // A thin limb is made of small triangles, and that is exactly the region
    // the analysis cares about, so pure area weighting must not starve it.
    const mesh = model.primaryMesh!;
    const single = sampleSurfacePoints([mesh], 1);
    const geometry = mesh.geometry;
    const triangles = geometry.getIndex()
      ? geometry.getIndex()!.count / 3
      : geometry.getAttribute('position').count / 3;
    expect(single.length).toBeGreaterThanOrEqual(triangles);
  });
});

void THREE;
