// Generates public/demo.ply — a synthetic 3D Gaussian Splat "room" in the
// standard INRIA 3DGS PLY format, so the viewer and drone-path editor can be
// exercised without training a real scene.
//
// Usage: node scripts/generate-demo-splat.mjs

import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const SH_C0 = 0.28209479177387814;
const splats = [];

function logit(a) {
  return Math.log(a / (1 - a));
}

// color: [r,g,b] in 0..1; sigma: gaussian radius in meters
function addSplat(x, y, z, [r, g, b], sigma, alpha = 0.95) {
  const jitter = () => (Math.random() - 0.5) * 0.08;
  splats.push({
    x, y, z,
    fdc: [(r + jitter() - 0.5) / SH_C0, (g + jitter() - 0.5) / SH_C0, (b + jitter() - 0.5) / SH_C0],
    opacity: logit(Math.min(alpha, 0.999)),
    scale: [Math.log(sigma), Math.log(sigma), Math.log(sigma)],
    rot: [1, 0, 0, 0],
  });
}

// Filled axis-aligned rectangle in a plane. axis: which coord is fixed.
function addRect(axis, fixed, u0, u1, v0, v1, color, step = 0.09, sigma = 0.075) {
  for (let u = u0; u <= u1; u += step) {
    for (let v = v0; v <= v1; v += step) {
      const uu = u + (Math.random() - 0.5) * step * 0.5;
      const vv = v + (Math.random() - 0.5) * step * 0.5;
      if (axis === "y") addSplat(uu, fixed, vv, color, sigma);
      else if (axis === "x") addSplat(fixed, uu, vv, color, sigma);
      else addSplat(uu, vv, fixed, color, sigma);
    }
  }
}

// Solid box sampled on its surface.
function addBox(cx, cy, cz, sx, sy, sz, color, step = 0.06) {
  const s = 0.05;
  addRect("y", cy + sy / 2, cx - sx / 2, cx + sx / 2, cz - sz / 2, cz + sz / 2, color, step, s); // top
  addRect("y", cy - sy / 2, cx - sx / 2, cx + sx / 2, cz - sz / 2, cz + sz / 2, color, step, s); // bottom
  addRect("z", cz + sz / 2, cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, color, step, s);
  addRect("z", cz - sz / 2, cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, color, step, s);
  addRect("x", cx + sx / 2, cy - sy / 2, cy + sy / 2, cz - sz / 2, cz + sz / 2, color, step, s);
  addRect("x", cx - sx / 2, cy - sy / 2, cy + sy / 2, cz - sz / 2, cz + sz / 2, color, step, s);
}

const W = 6, D = 6, H = 2.6; // room dimensions
const wood = [0.55, 0.42, 0.3];
const wall = [0.86, 0.83, 0.76];
const ceil = [0.93, 0.93, 0.9];

// floor + ceiling
addRect("y", 0, -W / 2, W / 2, -D / 2, D / 2, wood, 0.08);
addRect("y", H, -W / 2, W / 2, -D / 2, D / 2, ceil, 0.12);

// walls (z = -D/2 wall gets a "window": skip a rectangle, fill with sky)
for (let u = -W / 2; u <= W / 2; u += 0.09) {
  for (let v = 0; v <= H; v += 0.09) {
    const inWindow = u > -1.2 && u < 1.2 && v > 0.9 && v < 2.1;
    addSplat(u, v, -D / 2, inWindow ? [0.55, 0.75, 0.95] : wall, 0.075);
  }
}
addRect("z", D / 2, -W / 2, W / 2, 0, H, wall);
addRect("x", -W / 2, 0, H, -D / 2, D / 2, wall);
addRect("x", W / 2, 0, H, -D / 2, D / 2, wall);

// window frame
for (let u = -1.2; u <= 1.2; u += 0.05) {
  addSplat(u, 0.9, -D / 2 + 0.02, [0.95, 0.95, 0.95], 0.04);
  addSplat(u, 2.1, -D / 2 + 0.02, [0.95, 0.95, 0.95], 0.04);
}
for (let v = 0.9; v <= 2.1; v += 0.05) {
  addSplat(-1.2, v, -D / 2 + 0.02, [0.95, 0.95, 0.95], 0.04);
  addSplat(1.2, v, -D / 2 + 0.02, [0.95, 0.95, 0.95], 0.04);
  addSplat(0, v, -D / 2 + 0.02, [0.95, 0.95, 0.95], 0.04);
}

// furniture
addBox(-1.6, 0.35, 1.6, 2.0, 0.7, 0.9, [0.25, 0.35, 0.55]); // sofa base
addBox(-1.6, 0.85, 2.0, 2.0, 0.5, 0.25, [0.3, 0.4, 0.6]); // sofa back
addBox(0.8, 0.25, 0.2, 1.2, 0.5, 0.7, [0.45, 0.3, 0.2]); // coffee table
addBox(1.9, 0.5, -2.2, 1.4, 1.0, 0.5, [0.5, 0.36, 0.25]); // sideboard
addBox(-2.4, 1.0, -1.0, 0.4, 2.0, 0.8, [0.42, 0.3, 0.22]); // bookshelf

// rug
for (let i = 0; i < 2500; i++) {
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * 1.3;
  addSplat(-0.2 + Math.cos(a) * r, 0.02, 0.9 + Math.sin(a) * r, [0.6, 0.2, 0.2], 0.05);
}

// lamp: pole + glowing shade
for (let v = 0; v <= 1.6; v += 0.04) addSplat(2.4, v, 2.4, [0.2, 0.2, 0.2], 0.025);
for (let i = 0; i < 400; i++) {
  const a = Math.random() * Math.PI * 2;
  const b = Math.random() * Math.PI;
  addSplat(
    2.4 + 0.22 * Math.sin(b) * Math.cos(a),
    1.75 + 0.22 * Math.cos(b),
    2.4 + 0.22 * Math.sin(b) * Math.sin(a),
    [1.0, 0.9, 0.6],
    0.05
  );
}

// ---- write PLY ----
const props = [
  "x", "y", "z", "nx", "ny", "nz",
  "f_dc_0", "f_dc_1", "f_dc_2",
  "opacity", "scale_0", "scale_1", "scale_2",
  "rot_0", "rot_1", "rot_2", "rot_3",
];
const header =
  `ply\nformat binary_little_endian 1.0\nelement vertex ${splats.length}\n` +
  props.map((p) => `property float ${p}`).join("\n") +
  "\nend_header\n";

const buf = Buffer.alloc(Buffer.byteLength(header) + splats.length * props.length * 4);
buf.write(header, 0, "ascii");
let off = Buffer.byteLength(header);
for (const s of splats) {
  for (const val of [
    s.x, s.y, s.z, 0, 0, 0,
    s.fdc[0], s.fdc[1], s.fdc[2],
    s.opacity, s.scale[0], s.scale[1], s.scale[2],
    s.rot[0], s.rot[1], s.rot[2], s.rot[3],
  ]) {
    buf.writeFloatLE(val, off);
    off += 4;
  }
}

const outPath = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "demo.ply");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, buf);
console.log(`wrote ${outPath}: ${splats.length} splats, ${(buf.length / 1e6).toFixed(1)} MB`);
