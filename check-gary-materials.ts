// Throwaway acceptance check: does three.js actually read the materials and
// the rig back out of the converted Gary?
//
//   npx vite-node check-gary-materials.ts [public/assets/gary.usdz ...]
//
// Node has no Image, so USDComposer's texture decode would throw. The shim
// below stands in for it and records every texture the loader tried to load,
// which is exactly the "texture load failures" line the check has to report.

import * as THREE from 'three';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';

interface Attempt {
  bytes: number;
  ok: boolean;
}

const attempts: Attempt[] = [];

// Minimal Image stand-in. USDComposer builds a Blob URL from the packed bytes
// and assigns it to image.src; resolving that back to the byte length is
// enough to say whether the pixels made it out of the archive.
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  width = 0;
  height = 0;
  set src(value: string) {
    const record: Attempt = { bytes: 0, ok: false };
    attempts.push(record);
    const blob = (globalThis as any).__blobs?.get(value);
    if (blob) {
      record.bytes = blob;
      record.ok = blob > 0;
      this.width = this.height = 1;
      queueMicrotask(() => this.onload?.());
    } else {
      queueMicrotask(() => this.onerror?.());
    }
  }
}
(globalThis as any).Image = FakeImage;

// Track Blob -> size so the shim can tell a real payload from an empty one.
const blobs = new Map<string, number>();
(globalThis as any).__blobs = blobs;
const realCreate = URL.createObjectURL?.bind(URL);
URL.createObjectURL = (obj: any) => {
  const url = realCreate ? realCreate(obj) : `blob:${Math.random()}`;
  blobs.set(url, obj?.size ?? 0);
  return url;
};
URL.revokeObjectURL = () => {};

// Catch the loader's own "Texture not found" warnings.
const warnings: string[] = [];
const realWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  warnings.push(args.map(String).join(' '));
};

function load(path: string): THREE.Group {
  const buffer = readFileSync(path);
  const view = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  );
  return new USDLoader().parse(view);
}

function hex(color: THREE.Color | undefined): string {
  if (!color) return '--------';
  return '#' + color.getHexString();
}

function report(path: string) {
  console.log('\n' + '='.repeat(96));
  console.log(path, `(${(statSync(path).size / 1e6).toFixed(2)} MB)`);
  console.log('='.repeat(96));

  attempts.length = 0;
  warnings.length = 0;

  const group = load(path);

  const meshes: THREE.Mesh[] = [];
  let skinned = 0;
  let skeleton: THREE.Skeleton | null = null;
  let morphMeshes = 0;
  let morphTargets = 0;

  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes.push(mesh);
    const asSkinned = mesh as THREE.SkinnedMesh;
    if (asSkinned.isSkinnedMesh) {
      skinned++;
      if (asSkinned.skeleton) skeleton = asSkinned.skeleton;
    }
    const morphs = mesh.geometry.morphAttributes?.position;
    if (morphs?.length) {
      morphMeshes++;
      morphTargets += morphs.length;
    }
  });

  console.log(
    `\nmeshes ${meshes.length} | skinned ${skinned} | ` +
      `morph meshes ${morphMeshes} (${morphTargets} targets)`
  );

  if (skeleton) {
    const bones = (skeleton as THREE.Skeleton).bones;
    console.log(`skeleton bones: ${bones.length}`);
    console.log('  first 12: ' + bones.slice(0, 12).map((b) => b.name).join(', '));
  } else {
    console.log('skeleton: NONE');
  }

  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  console.log(
    `bounds: ${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)} ` +
      `(min.y ${box.min.y.toFixed(3)})`
  );

  console.log(
    '\n' +
      'mesh'.padEnd(26) +
      'material'.padEnd(22) +
      'type'.padEnd(22) +
      'color'.padEnd(10) +
      'maps'
  );
  console.log('-'.repeat(96));

  let black = 0;
  let withMap = 0;
  for (const mesh of meshes) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const raw of materials) {
      const m = raw as THREE.MeshPhysicalMaterial;
      const maps: string[] = [];
      if (m.map) maps.push('map');
      if (m.normalMap) maps.push('normalMap');
      if (m.roughnessMap) maps.push('roughnessMap');
      if (m.metalnessMap) maps.push('metalnessMap');
      if (m.emissiveMap) maps.push('emissiveMap');
      if (m.specularColorMap) maps.push('specularColorMap');
      if (m.map) withMap++;
      const c = m.color;
      const isBlack = c && c.r <= 1e-4 && c.g <= 1e-4 && c.b <= 1e-4;
      if (isBlack) black++;
      console.log(
        mesh.name.padEnd(26) +
          (m.name || '(unnamed)').padEnd(22) +
          (m.type || '?').padEnd(22) +
          hex(c).padEnd(10) +
          (maps.join(',') || '-') +
          (isBlack ? '   <-- BLACK' : '')
      );
    }
  }

  console.log('-'.repeat(96));
  console.log(`materials with a base-colour map: ${withMap}`);
  console.log(`materials whose base colour is pure black: ${black}`);

  const failed = attempts.filter((a) => !a.ok).length;
  console.log(
    `texture decode attempts: ${attempts.length}, ` +
      `payload delivered: ${attempts.length - failed}, failed: ${failed}`
  );
  const notFound = warnings.filter((w) => w.includes('Texture not found'));
  if (notFound.length) {
    console.log(`loader "Texture not found" warnings: ${notFound.length}`);
    for (const w of new Set(notFound)) console.log('   ' + w);
  } else {
    console.log('loader "Texture not found" warnings: 0');
  }

  // The eye look rides as squarebitEye:* custom attributes; three drops
  // unknown prim attributes, so read them straight out of the layer text to
  // confirm they were written.
  const raw = readFileSync(path);
  const text = raw.toString('latin1');
  const eyeKeys = new Set(
    [...text.matchAll(/squarebitEye:([A-Za-z]+)/g)].map((m) => m[1])
  );
  console.log(
    `squarebitEye:* attributes present in the file: ${eyeKeys.size}` +
      (eyeKeys.size ? ' (' + [...eyeKeys].slice(0, 8).join(', ') + ', ...)' : '')
  );
}

const targets = process.argv.slice(2);
if (!targets.length) {
  targets.push('public/assets/gary.usdc', 'public/assets/gary.usdz');
}
for (const t of targets) {
  if (existsSync(t)) report(t);
  else console.log('missing: ' + t);
}
console.log();
