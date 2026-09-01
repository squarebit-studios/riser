// ==========================================================================
// Riser - Copyright (c) 2026 Squarebit LLC. All rights reserved.
//
// Blend shapes evaluated in the vertex shader, so scrubbing one is free.
//
// The CPU path recomputes the moved vertices on every weight change and costs
// about 27ms on a production body. That is invisible when a shape is clicked
// to audition it, and it is 27ms a frame the moment anything drives a weight
// continuously. This does the same arithmetic on the GPU, where changing a
// weight costs one upload of a few kilobytes and no vertex work at all.
//
// KEYED BY POINT, NOT BY RENDER VERTEX. The obvious layout stores a delta per
// affected render vertex, and a renderer splits a point into several vertices
// at every UV and normal seam: on this character that is 4.2M entries, about
// 67MB of texture. The file's own deltas are per POINT - roughly 700 of 25,490
// for a cheek shape - so storing them that way and letting each vertex look up
// its own point is 6.8 times smaller, around 10MB, and is also simply what the
// file says.
//
// WHAT IT CANNOT DO, and why the CPU path is still here rather than replaced:
//
//   NORMALS. Displacing a position in the vertex shader does not update the
//   normal that lights it, so a strong shape would move the silhouette and
//   leave the shading behind. The CPU pass recomputes them, and runs once the
//   value settles.
//
//   SUBDIVISION. A smoothed surface is evaluated from the cage through a
//   stencil table on the CPU. A vertex shader displacing the cage cannot feed
//   that, so with smoothing on the CPU path does the work and this stays out
//   of the way.
//
// So this is an accelerator for the case it fits: the unsmoothed character,
// while a weight is moving.
// ==========================================================================

import * as THREE from 'three';
import type { BlendShapeDelta } from '../io/blendShapeData';

/**
 * Most shapes any one point may belong to.
 *
 * A fixed bound because the loop has to be bounded at compile time, and a
 * generous one because exceeding it silently drops a shape from a point. The
 * real figure on a production face is around 24; this is the ceiling, not the
 * expectation, and `attach` refuses rather than truncates when it is passed.
 */
const MAX_SHAPES_PER_POINT = 96;

/** Texture width for the entry table. Height follows from the entry count. */
const ENTRY_TEXTURE_WIDTH = 1024;

interface Attached {
  mesh: THREE.Mesh;
  material: THREE.Material;
  weights: THREE.DataTexture;
  entries: THREE.DataTexture;
  ranges: THREE.DataTexture;
  /** The material's own onBeforeCompile, restored on detach. */
  previousCompile: THREE.Material['onBeforeCompile'];
  previousKey: string;
}

/**
 * Vertex-shader blend shapes for one character.
 *
 * `null` from `attach` means this mesh cannot be accelerated, for any reason:
 * the caller keeps doing it on the CPU rather than getting a broken surface.
 */
export class BlendShapeGpu {
  private readonly attached: Attached[] = [];
  private shapeIndex = new Map<string, number>();
  private weightData: Float32Array = new Float32Array(0);

  /**
   * WebGL2, needed for the float textures this reads per vertex.
   *
   * Checked against the renderer actually in use rather than by creating a
   * probe context, because the answer that matters is what THIS renderer can
   * do.
   */
  static supported(renderer: THREE.WebGLRenderer | null): boolean {
    if (!renderer) return false;
    const context = renderer.getContext();
    return (
      typeof WebGL2RenderingContext !== 'undefined' &&
      context instanceof WebGL2RenderingContext
    );
  }

  /** Names in the order their weights are packed. */
  setShapeOrder(names: readonly string[]): void {
    this.shapeIndex = new Map(names.map((name, i) => [name, i]));
    this.weightData = new Float32Array(Math.max(1, names.length) * 4);
  }

  /**
   * Put a mesh's shapes on the GPU.
   *
   * Returns false when it cannot be done, which the caller must treat as "use
   * the CPU for this mesh" rather than as an error.
   */
  attach(
    mesh: THREE.Mesh,
    pointOfVertex: Uint32Array,
    pointCount: number,
    shapes: ReadonlyMap<string, BlendShapeDelta>
  ): boolean {
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!material) return false;

    const table = buildEntries(shapes, this.shapeIndex, pointCount);
    if (!table) return false;

    const entries = dataTexture(table.entries, ENTRY_TEXTURE_WIDTH);
    const ranges = dataTexture(table.ranges, rangeWidth(pointCount));
    const weights = dataTexture(this.weightData, Math.max(1, this.shapeIndex.size));

    // Which point each render vertex came from, so a vertex can find its own
    // deltas. One float per vertex.
    const points = new Float32Array(pointOfVertex.length);
    for (let i = 0; i < pointOfVertex.length; i++) points[i] = pointOfVertex[i]!;
    mesh.geometry.setAttribute(
      'riserBlendPoint',
      new THREE.BufferAttribute(points, 1)
    );

    const previousCompile = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey?.() ?? '';

    material.onBeforeCompile = (shader, renderer) => {
      previousCompile?.call(material, shader, renderer);

      shader.uniforms.riserBlendEntries = { value: entries };
      shader.uniforms.riserBlendRanges = { value: ranges };
      shader.uniforms.riserBlendWeights = { value: weights };
      shader.uniforms.riserBlendEntrySize = {
        value: new THREE.Vector2(entries.image.width, entries.image.height)
      };
      shader.uniforms.riserBlendRangeSize = {
        value: new THREE.Vector2(ranges.image.width, ranges.image.height)
      };
      shader.uniforms.riserBlendWeightSize = {
        value: new THREE.Vector2(weights.image.width, weights.image.height)
      };

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float riserBlendPoint;
uniform sampler2D riserBlendEntries;
uniform sampler2D riserBlendRanges;
uniform sampler2D riserBlendWeights;
uniform vec2 riserBlendEntrySize;
uniform vec2 riserBlendRangeSize;
uniform vec2 riserBlendWeightSize;

// Texel centres, so nearest sampling lands on the value meant rather than on
// whichever neighbour the edge rounds towards.
vec4 riserTexel(sampler2D map, vec2 size, float index) {
  float x = mod(index, size.x);
  float y = floor(index / size.x);
  return texture2D(map, vec2((x + 0.5) / size.x, (y + 0.5) / size.y));
}`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
{
  vec4 range = riserTexel(riserBlendRanges, riserBlendRangeSize, riserBlendPoint);
  int count = int(range.y + 0.5);
  float start = range.x;
  for (int i = 0; i < ${MAX_SHAPES_PER_POINT}; i++) {
    if (i >= count) break;
    vec4 entry = riserTexel(riserBlendEntries, riserBlendEntrySize, start + float(i));
    float weight = riserTexel(riserBlendWeights, riserBlendWeightSize, entry.w).x;
    transformed += entry.xyz * weight;
  }
}`
        );
    };

    // Without this three reuses the program it already compiled for this
    // material and none of the above is ever in the shader that runs.
    material.customProgramCacheKey = () => `${previousKey}|riserBlend`;
    material.needsUpdate = true;

    this.attached.push({
      mesh,
      material,
      weights,
      entries,
      ranges,
      previousCompile,
      previousKey
    });
    return true;
  }

  get meshCount(): number {
    return this.attached.length;
  }

  /** Push new weights. The only per-change cost, and it is a few kilobytes. */
  setWeights(byName: ReadonlyMap<string, number>): void {
    this.weightData.fill(0);
    for (const [name, weight] of byName) {
      const index = this.shapeIndex.get(name);
      if (index !== undefined) this.weightData[index * 4] = weight;
    }
    for (const entry of this.attached) entry.weights.needsUpdate = true;
  }

  dispose(): void {
    for (const entry of this.attached) {
      entry.material.onBeforeCompile = entry.previousCompile;
      entry.material.customProgramCacheKey = () => entry.previousKey;
      entry.material.needsUpdate = true;
      entry.mesh.geometry.deleteAttribute('riserBlendPoint');
      entry.entries.dispose();
      entry.ranges.dispose();
      entry.weights.dispose();
    }
    this.attached.length = 0;
  }
}

/**
 * Deltas gathered per point, as a flat entry table plus a range per point.
 *
 * Null when a point belongs to more shapes than the shader's loop can read,
 * because silently dropping the rest would move a face by an arithmetic
 * nobody could see was incomplete.
 */
function buildEntries(
  shapes: ReadonlyMap<string, BlendShapeDelta>,
  shapeIndex: ReadonlyMap<string, number>,
  pointCount: number
): { entries: Float32Array; ranges: Float32Array } | null {
  const counts = new Uint32Array(pointCount);
  let total = 0;

  for (const shape of shapes.values()) {
    for (const point of shape.pointIndices) {
      if (point >= pointCount) return null;
      counts[point] = (counts[point] ?? 0) + 1;
      if (counts[point]! > MAX_SHAPES_PER_POINT) return null;
      total++;
    }
  }
  if (total === 0) return null;

  const starts = new Uint32Array(pointCount);
  let running = 0;
  for (let p = 0; p < pointCount; p++) {
    starts[p] = running;
    running += counts[p] ?? 0;
  }

  const entries = new Float32Array(total * 4);
  const cursor = new Uint32Array(pointCount);

  for (const [name, shape] of shapes) {
    const index = shapeIndex.get(name);
    if (index === undefined) continue;
    for (let i = 0; i < shape.pointIndices.length; i++) {
      const point = shape.pointIndices[i]!;
      const at = (starts[point] ?? 0) + (cursor[point] ?? 0);
      cursor[point] = (cursor[point] ?? 0) + 1;
      entries[at * 4] = shape.offsets[i * 3] ?? 0;
      entries[at * 4 + 1] = shape.offsets[i * 3 + 1] ?? 0;
      entries[at * 4 + 2] = shape.offsets[i * 3 + 2] ?? 0;
      entries[at * 4 + 3] = index;
    }
  }

  const ranges = new Float32Array(pointCount * 4);
  for (let p = 0; p < pointCount; p++) {
    ranges[p * 4] = starts[p] ?? 0;
    ranges[p * 4 + 1] = counts[p] ?? 0;
  }

  return { entries, ranges };
}

function rangeWidth(pointCount: number): number {
  return Math.min(2048, Math.max(1, Math.ceil(Math.sqrt(pointCount))));
}

/** RGBA float texture, sampled by index rather than by uv. */
function dataTexture(data: Float32Array, width: number): THREE.DataTexture {
  const texels = Math.max(1, Math.ceil(data.length / 4));
  const w = Math.max(1, Math.min(width, texels));
  const h = Math.max(1, Math.ceil(texels / w));

  const padded = new Float32Array(w * h * 4);
  padded.set(data.subarray(0, Math.min(data.length, padded.length)));

  const texture = new THREE.DataTexture(
    padded,
    w,
    h,
    THREE.RGBAFormat,
    THREE.FloatType
  );
  // Nearest and no mipmaps: these are numbers, not pictures, and any filtering
  // between them is a delta nobody authored.
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
