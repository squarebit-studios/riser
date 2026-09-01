import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';
import { fromBufferGeometry, meshCounts, recoverQuads } from '@squarebit/subdivs-three';
import { CharacterModel } from '../io/CharacterModel';
import { SubdivSet, SubdivSurface, clampLevel, MAX_SUBDIV_LEVEL } from './SubdivSurface';
import { LAYER_CAGE, LAYER_SCENE } from './Viewport';
import { SurfacePicker, resolveBindingWorld, triangleCount } from './Picker';
import { bindingFromPick } from './Picker';

function loadBiped(): CharacterModel {
  const text = readFileSync(
    join(process.cwd(), 'public', 'assets', 'biped-blockout.usda'),
    'utf8'
  );
  return new CharacterModel(new USDLoader().parse(text), {
    ref: 'biped-blockout.usda',
    format: 'usd',
    metersPerUnit: 1,
    upAxis: 'Y'
  });
}

describe('clampLevel', () => {
  it('keeps levels in range', () => {
    expect(clampLevel(-3)).toBe(0);
    expect(clampLevel(99)).toBe(MAX_SUBDIV_LEVEL);
    expect(clampLevel(1.4)).toBe(1);
  });

  it('falls back to no subdivision on non-finite input', () => {
    // Deliberately the minimum rather than the maximum - garbage input should
    // not be a route to the most expensive setting.
    expect(clampLevel(NaN)).toBe(0);
    expect(clampLevel(Infinity)).toBe(0);
  });
});

describe('quad recovery on our own assets', () => {
  it('turns the generated triangles back into quads', () => {
    // The stock generator emits pure triangles. Subdividing those directly
    // puts an extraordinary vertex in the middle of every one, so recovery is
    // what makes the limit surface look like the DCC's preview rather than a
    // lumpy approximation of it.
    const model = loadBiped();
    const cage = model.primaryMesh!;
    const extracted = fromBufferGeometry(cage.geometry);

    const before = meshCounts(extracted.mesh);
    const after = meshCounts(recoverQuads(extracted.mesh));

    expect(before.faces).toBeGreaterThan(100);
    // Pairing triangles into quads can only reduce the face count.
    expect(after.faces).toBeLessThan(before.faces);
  });
});

describe('SubdivSurface layers', () => {
  it('leaves the cage rendered and pickable at level 0', () => {
    const model = loadBiped();
    const surface = new SubdivSurface(model.primaryMesh!);
    surface.setLevel(0);

    expect(surface.isSubdivided).toBe(false);
    expect(surface.displayed).toBe(surface.cage);
    // Both layers, so the displayed pick and the cage pick find the same mesh
    // and the offset comes out zero with no special case.
    expect(surface.cage.layers.test(layerMask(LAYER_SCENE))).toBe(true);
    expect(surface.cage.layers.test(layerMask(LAYER_CAGE))).toBe(true);
    surface.dispose();
  });

  it('moves the cage off the rendered layer when subdivided', () => {
    const model = loadBiped();
    const surface = new SubdivSurface(model.primaryMesh!);
    surface.setLevel(2);

    expect(surface.isSubdivided).toBe(true);
    expect(surface.displayed).not.toBe(surface.cage);

    // Invisible to the camera, still visible to the binding raycaster. This is
    // the property the whole approach rests on.
    expect(surface.cage.layers.test(layerMask(LAYER_SCENE))).toBe(false);
    expect(surface.cage.layers.test(layerMask(LAYER_CAGE))).toBe(true);
    expect(surface.displayed.layers.test(layerMask(LAYER_SCENE))).toBe(true);
    surface.dispose();
  });

  it('refines into many more faces than the cage', () => {
    const model = loadBiped();
    const surface = new SubdivSurface(model.primaryMesh!);
    surface.setLevel(2);
    const stats = surface.stats;
    expect(stats.limitFaces).toBeGreaterThan(stats.cageFaces * 4);
    surface.dispose();
  });

  it('returns to the cage when set back to level 0', () => {
    const model = loadBiped();
    const surface = new SubdivSurface(model.primaryMesh!);
    surface.setLevel(2);
    surface.setLevel(0);
    expect(surface.isSubdivided).toBe(false);
    expect(surface.cage.children).toHaveLength(0);
    surface.dispose();
  });

  it('restores the cage layer on dispose', () => {
    const model = loadBiped();
    const surface = new SubdivSurface(model.primaryMesh!);
    surface.setLevel(2);
    surface.dispose();
    expect(surface.cage.layers.test(layerMask(LAYER_SCENE))).toBe(true);
  });
});

describe('SubdivSet', () => {
  it('drives every mesh of the character', () => {
    const model = loadBiped();
    const set = new SubdivSet(model.meshes);
    set.setLevel(2);

    expect(set.isSubdivided).toBe(true);
    expect(set.currentLevel).toBe(2);
    const totals = set.totals;
    expect(totals.cageFaces).toBeGreaterThan(0);
    expect(totals.limitFaces).toBeGreaterThan(totals.cageFaces);
    set.dispose();
  });

  it('leaves nothing behind on dispose', () => {
    const model = loadBiped();
    const set = new SubdivSet(model.meshes);
    set.setLevel(2);
    set.dispose();
    for (const mesh of model.meshes) expect(mesh.children).toHaveLength(0);
  });
});

/**
 * The property the whole Subdivs design rests on.
 *
 * The user clicks the smooth limit surface. The binding names a CAGE triangle.
 * Resolving that binding - the same arithmetic the Python worker runs - must
 * land back on the point the user actually clicked, or every marker moves the
 * moment it leaves the browser.
 */
describe('cage binding recovers the clicked limit-surface point', () => {
  function setupScene(level: number) {
    const model = loadBiped();
    const root = new THREE.Group();
    root.add(model.root);
    root.updateMatrixWorld(true);

    const set = new SubdivSet(model.meshes);
    set.setLevel(level);
    root.updateMatrixWorld(true);

    // Look at the character from the front, framed on the chest.
    const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.01, 100);
    camera.position.set(0, 1.2, 3);
    camera.lookAt(0, 1.2, 0);
    camera.updateMatrixWorld(true);

    return { model, set, camera, root };
  }

  it('is exact at level 0, where cage and display are the same mesh', () => {
    const { model, set, camera } = setupScene(0);
    const picker = new SurfacePicker(camera);

    const hit = picker.pick(640, 360, 1280, 720, model.meshes);
    expect(hit, 'the ray should hit the character').not.toBeNull();

    // No subdivision means no gap to carry.
    expect(hit!.offset[0]).toBeCloseTo(0, 9);
    expect(hit!.offset[1]).toBeCloseTo(0, 9);
    expect(hit!.offset[2]).toBeCloseTo(0, 9);

    const resolved = resolveBindingWorld(
      hit!.pick.object,
      bindingFromPick(hit!.pick, hit!.offset)
    );
    expect(resolved!.distanceTo(hit!.worldPoint)).toBeLessThan(1e-6);
    set.dispose();
  });

  it('recovers the limit point through a cage binding when subdivided', () => {
    const { model, set, camera } = setupScene(2);
    const picker = new SurfacePicker(camera);

    // Sample across the character rather than trusting one lucky ray.
    const samples: [number, number][] = [
      [640, 360],
      [600, 300],
      [680, 420],
      [640, 260],
      [660, 480]
    ];

    let hits = 0;
    for (const [x, y] of samples) {
      const hit = picker.pick(x, y, 1280, 720, model.meshes);
      if (!hit) continue;
      hits++;

      // The binding must name the CAGE, never the displayed limit mesh.
      expect(model.meshes).toContain(hit.pick.object);
      expect(hit.pick.primPath).toMatch(/^\/Riser\/Character\/Geom\//);

      // The limit surface sits inside the cage, so there is a real gap.
      const gap = Math.hypot(...hit.offset);
      expect(gap).toBeGreaterThan(0);

      // And resolving the binding lands back on the clicked point.
      const resolved = resolveBindingWorld(
        hit.pick.object,
        bindingFromPick(hit.pick, hit.offset)
      );
      expect(resolved, 'binding failed to resolve').not.toBeNull();
      expect(
        resolved!.distanceTo(hit.worldPoint),
        `resolved ${resolved!.toArray()} vs clicked ${hit.worldPoint.toArray()}`
      ).toBeLessThan(1e-5);
    }

    expect(hits, 'no sample ray hit the character').toBeGreaterThan(2);
    set.dispose();
  });

  it('binds to a triangle that actually exists on the cage', () => {
    const { model, set, camera } = setupScene(2);
    const picker = new SurfacePicker(camera);

    const hit = picker.pick(640, 360, 1280, 720, model.meshes);
    expect(hit).not.toBeNull();

    // An out-of-range face index is the failure mode that would make the
    // worker reject the document.
    const tris = triangleCount(hit!.pick.object.geometry);
    expect(hit!.pick.faceIndex).toBeGreaterThanOrEqual(0);
    expect(hit!.pick.faceIndex).toBeLessThan(tris);

    const sum =
      hit!.pick.barycentric[0] + hit!.pick.barycentric[1] + hit!.pick.barycentric[2];
    expect(sum).toBeCloseTo(1, 5);
    set.dispose();
  });
});

/** three stores layers as a bitmask; `test` wants another mask, not an index. */
/**
 * A plane cut into an n x n grid of quads.
 *
 * Synthetic rather than the stock biped, because these tests are about face
 * COUNTS - the density budget and what gets cached - and a helper that lets a
 * test say exactly how heavy its character is beats one that makes it depend
 * on whatever the generator happens to emit.
 */
function gridMesh(n: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(1, 1, n, n);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = `grid${n}`;
  return mesh;
}

function layerMask(layer: number): THREE.Layers {
  const layers = new THREE.Layers();
  layers.set(layer);
  return layers;
}

describe('caching built levels', () => {
  it('returns to a level it has already built without rebuilding', () => {
    // A slider is a control people sweep. Refining on every movement is what
    // makes one stutter; refining once per level is what makes it respond.
    const set = new SubdivSet([gridMesh(8)]);
    set.setLevel(1);
    const first = set.displayedMeshes()[0];

    set.setLevel(0);
    set.setLevel(1);
    // The same mesh object, not an equivalent one - proof it was not rebuilt.
    expect(set.displayedMeshes()[0]).toBe(first);
  });

  it('knows which levels are already built', () => {
    const set = new SubdivSet([gridMesh(8)]);
    expect(set.hasCached(0)).toBe(true);
    expect(set.hasCached(2)).toBe(false);

    set.setLevel(2);
    expect(set.hasCached(2)).toBe(true);
  });

  it('keeps every level it has visited', () => {
    const set = new SubdivSet([gridMesh(8)]);
    set.setLevel(1);
    set.setLevel(2);
    expect(set.hasCached(1)).toBe(true);
    expect(set.hasCached(2)).toBe(true);
  });

  it('only ever has one level attached to the cage', () => {
    // Every cached level is a child of the cage. Leaving more than one
    // attached would draw two surfaces on top of each other.
    const set = new SubdivSet([gridMesh(8)]);
    set.setLevel(1);
    set.setLevel(2);
    set.setLevel(1);

    const cage = set.cages[0]!;
    const limits = cage.children.filter((c) => c.name.includes('limit'));
    expect(limits).toHaveLength(1);
  });
});

describe('budgeting subdivision across the whole character', () => {
  it('counts every mesh, not each one on its own', () => {
    // The bug this covers: a production character arrives as thirty-odd
    // pieces. Each passes the density test alone while the character as a
    // whole is far too heavy, and the tab locks up.
    const many = Array.from({ length: 30 }, () => gridMesh(40));
    const set = new SubdivSet(many);
    expect(set.totalCageFaces()).toBeGreaterThan(50_000);

    set.setLevel(2);
    expect(set.clamped).toBe(true);
    expect(set.effectiveLevel).toBeLessThan(2);
  });

  it('reports a reduction even when nothing had to be rebuilt', () => {
    // Asking for 3 on a character already pinned at 1 rebuilds nothing, but
    // it is still a request that was reduced - and if that is not reported the
    // slider moves, the surface does not, and nothing explains why.
    const many = Array.from({ length: 30 }, () => gridMesh(40));
    const set = new SubdivSet(many);
    set.setLevel(2);
    set.setLevel(3);
    expect(set.clamped).toBe(true);
  });

  it('leaves a light character alone', () => {
    const set = new SubdivSet([gridMesh(8)]);
    set.setLevel(2);
    expect(set.clamped).toBe(false);
    expect(set.effectiveLevel).toBe(2);
  });
});

describe('wireframe that follows the quads', () => {
  it('draws the cage as quads at level 0', () => {
    // Level 0 is a real choice now, not the off switch. The cage arrives
    // triangulated from USD, so three's own wireframe shows the triangulation
    // rather than the modelled edge flow, and the quads are recoverable from
    // exactly the mesh subdivision would refine.
    const set = new SubdivSet([gridMesh(8)]);
    set.setLevel(0);

    const displayed = set.displayedMeshes()[0]!;
    const quads = set.quadWireframe(displayed);
    expect(quads).not.toBeNull();

    // Compared against the triangle wireframe of the same mesh rather than
    // against a number worked out by hand. Fewer edges is the property worth
    // having, and it holds without anyone having to be right about how the
    // grid was tessellated.
    const triangles = new THREE.WireframeGeometry(displayed.geometry);
    expect(quads!.getAttribute('position').count).toBeLessThan(
      triangles.getAttribute('position').count
    );
  });

  it('draws fewer edges than the triangulation would', () => {
    // The whole point. Every quad of a Catmull-Clark surface is drawn as two
    // triangles, so a triangle wireframe adds the diagonal that split it -
    // doubling the lines and burying the edge flow the wireframe is being
    // looked at for.
    const set = new SubdivSet([gridMesh(8)]);
    set.setLevel(1);

    const displayed = set.displayedMeshes()[0]!;
    const quads = set.quadWireframe(displayed);
    expect(quads).not.toBeNull();

    const triangles = new THREE.WireframeGeometry(displayed.geometry);
    const quadCount = quads!.getAttribute('position').count;
    const triangleCount = triangles.getAttribute('position').count;
    expect(quadCount).toBeLessThan(triangleCount);
  });

  it('returns nothing for a mesh it does not own', () => {
    const set = new SubdivSet([gridMesh(4)]);
    set.setLevel(1);
    expect(set.quadWireframe(gridMesh(4))).toBeNull();
  });
});

describe('replacing the cage', () => {
  it('rebuilds at the level that was showing, rather than going quiet', () => {
    // The bug this exists for. `setLevel` returns early when asked for the
    // level it already holds, so tearing the surface down without forgetting
    // that level left the object claiming to be subdivided with nothing built.
    // The rebuild afterwards was a no-op, the cage stayed on screen, and the
    // interface reported a level the surface did not have.
    //
    // A character loaded with smoothing already on did exactly this: it came
    // up unsmoothed and stayed that way until the control was toggled off and
    // on, which forced a real transition.
    const set = new SubdivSet([gridMesh(8)]);
    set.setLevel(1);
    const subdivided = set.displayedMeshes()[0]!;
    expect(subdivided.name).toContain('limit');

    // What happens when the file's own topology arrives after the character.
    set.resetCages();
    set.setLevel(1);

    const after = set.displayedMeshes()[0]!;
    expect(after.name, 'the surface should be rebuilt, not left as the cage').toContain(
      'limit'
    );
    expect(set.currentLevel).toBe(1);
  });

  it('leaves the cage showing when the level really is 0', () => {
    const set = new SubdivSet([gridMesh(8)]);
    set.setLevel(1);
    set.resetCages();
    set.setLevel(0);
    expect(set.displayedMeshes()[0]!.name).not.toContain('limit');
    expect(set.currentLevel).toBe(0);
  });
});

describe('moving the cage under a wireframe', () => {
  it('updates the quads at level 0, where they are what is drawn', () => {
    // The bug this exists for. Above level 0 a wireframe follows a deforming
    // cage because the refined surface is re-evaluated from it by the stencil
    // product. At level 0 there is no refined surface: the quads come from the
    // cage's own mesh, cached from the points at rest, and nothing was moving
    // them. So a blend shape moved the character and left its wireframe behind
    // at level 0 only, which is a strange enough symptom to be worth pinning.
    const set = new SubdivSet([gridMesh(4)]);
    set.setLevel(0);

    const before = set.quadWireframe(set.displayedMeshes()[0]!);
    expect(before).not.toBeNull();
    const first = before!.getAttribute('position').array as Float32Array;
    const sample = [...first.slice(0, 9)];

    // Move every control point, the way a shape does.
    const surface = set.surfacesForTest?.()[0];
    const cage = set.displayedMeshes()[0]!;
    const moved = Float32Array.from(
      cage.geometry.getAttribute('position').array as Float32Array
    );
    for (let i = 1; i < moved.length; i += 3) moved[i] = (moved[i] ?? 0) + 5;
    set.refreshFrom(cage, moved);

    const after = set.quadWireframe(cage);
    const second = after!.getAttribute('position').array as Float32Array;
    expect([...second.slice(0, 9)]).not.toEqual(sample);
    void surface;
  });
});
