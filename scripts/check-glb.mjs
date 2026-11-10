#!/usr/bin/env node
/**
 * Validate a GLB against the scene contract (src/contract.json) without any dependencies.
 *   node scripts/check-glb.mjs [path/to/scene.glb]
 * Exit code 0 = all checks passed, 1 = something is missing/wrong.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] ?? join(root, 'public/crt_vhs_scene.glb');
const contract = JSON.parse(readFileSync(join(root, 'src/contract.json'), 'utf8'));

// ---- parse GLB container ----
const buf = readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546c67) { console.error(`${file}: not a GLB`); process.exit(1); }
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const nodes = gltf.nodes ?? [];
const byName = new Map(nodes.map((n, i) => [n.name, i]));

// ---- tiny math (column-major 4x4, like glTF) ----
const quatToMat = (t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) => {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
};
const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const parent = new Map();
nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
const world = (i) => {
  const n = nodes[i];
  const local = n.matrix ?? quatToMat(n.translation, n.rotation, n.scale);
  return parent.has(i) ? mul(world(parent.get(i)), local) : local;
};
const pos = (m) => [m[12], m[13], m[14]];
const dir = (m, v) => { // rotate local vector v by m (ignoring translation), normalized
  const o = [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2]);
  const l = Math.hypot(...o) || 1; return o.map((x) => x / l);
};
const sub = (a, b) => a.map((x, i) => x - b[i]);
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const fmt = (v) => `(${v.map((x) => x.toFixed(3)).join(', ')})`;

// ---- checks ----
const lines = [];
let failed = 0;
const check = (ok, label, detail = '') => { lines.push(`${ok ? '[x]' : '[ ]'} ${label}${detail ? '  ' + detail : ''}`); if (!ok) failed++; };

lines.push(`# ${file}`);
lines.push('## Nodes');
for (const n of contract.nodes) check(byName.has(n), n);
for (let i = 1; i <= 5; i++) for (const c of contract.tapeChildren) check(byName.has(`VHS_Tape_0${i}_${c}`), `VHS_Tape_0${i}_${c}`);

lines.push('## Extras (custom properties)');
for (const [node, keys] of Object.entries(contract.extras)) {
  const n = nodes[byName.get(node)];
  for (const k of keys) check(n?.extras?.[k] !== undefined, `${node}.${k}`, n?.extras?.[k] !== undefined ? `= ${n.extras[k]}` : '');
}

lines.push('## Materials');
const mats = new Set((gltf.materials ?? []).map((m) => m.name));
for (const m of contract.materials) check(mats.has(m), m);

lines.push('## Textures');
const used = gltf.extensionsUsed ?? [];
check(used.includes('EXT_texture_webp'), 'EXT_texture_webp declared');
const webp = (gltf.images ?? []).filter((im) => im.mimeType === 'image/webp').length;
check((gltf.images ?? []).length > 0 && webp === gltf.images.length, 'all images are WebP', `${webp}/${(gltf.images ?? []).length}`);

lines.push('## Geometry / orientation (numeric)');
const has = (...n) => n.every((x) => byName.has(x));
if (has('VHS_Slot_Anchor', 'VHS_Slot_Inside_Anchor')) {
  const ws = world(byName.get('VHS_Slot_Anchor')), wi = world(byName.get('VHS_Slot_Inside_Anchor'));
  const ins = norm(sub(pos(wi), pos(ws)));
  const negZ = dir(ws, [0, 0, -1]);
  check(dot(ins, negZ) > 0.95, 'insertion axis = VHS_Slot_Anchor local -Z', `slot→inside ${fmt(ins)}, local -Z → ${fmt(negZ)}, dot ${dot(ins, negZ).toFixed(3)}`);
}
if (has('ScreenAnchor', 'Cam_Hero')) {
  const wa = world(byName.get('ScreenAnchor')), wc = world(byName.get('Cam_Hero'));
  const toCam = norm(sub(pos(wc), pos(wa)));
  const axes = { '+X': [1, 0, 0], '-X': [-1, 0, 0], '+Y': [0, 1, 0], '-Y': [0, -1, 0], '+Z': [0, 0, 1], '-Z': [0, 0, -1] };
  const best = Object.entries(axes).map(([k, v]) => [k, dot(dir(wa, v), toCam)]).sort((a, b) => b[1] - a[1])[0];
  check(best[1] > 0.9, 'ScreenAnchor has an axis facing Cam_Hero', `local ${best[0]} (dot ${best[1].toFixed(3)})`);
}
if (has('Screen')) {
  const e = nodes[byName.get('Screen')].extras ?? {};
  const ratio = e.screen_width_m / e.screen_height_m;
  check(Math.abs(ratio - 4 / 3) < 0.02, 'Screen is 4:3', `${e.screen_width_m} × ${e.screen_height_m} m`);
}
if (has('Cam_Hero')) {
  const n = nodes[byName.get('Cam_Hero')];
  const camIdx = n.camera ?? (n.children ?? []).map((c) => nodes[c].camera).find((c) => c !== undefined);
  check(camIdx !== undefined, 'Cam_Hero carries a camera', camIdx !== undefined ? `yfov ${(gltf.cameras[camIdx].perspective?.yfov * 180 / Math.PI).toFixed(1)}°` : '');
}

console.log(lines.join('\n'));
console.log(failed ? `\n✗ ${failed} check(s) failed` : `\n✓ all ${lines.filter((l) => l.startsWith('[')).length} checks passed`);
process.exit(failed ? 1 : 0);
