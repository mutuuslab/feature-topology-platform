// 홈 미니 지도 윤곽 — world-land.geojson을 등장방형(경도+180, 80-위도)으로 줄인 SVG path 한 줄(frontend/src/screens/home/dashboard/overview-land.ts)
// 사용: node tools/home-land-outline.mjs frontend/public/map/world-land.geojson 1.5 8 > 윤곽.txt
import { readFileSync } from 'node:fs';
const [src, tolArg, minArg] = process.argv.slice(2);
const tol = Number(tolArg ?? 1.2), minArea = Number(minArg ?? 6);
const g = JSON.parse(readFileSync(src, 'utf8'));
const TOP = 80, BOTTOM = -58;
const proj = ([lng, lat]) => [lng + 180, TOP - Math.max(BOTTOM, Math.min(TOP, lat))];
function dp(pts, eps) {
  if (pts.length < 3) return pts;
  let max = 0, idx = 0;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const d = dx || dy ? Math.abs(dy * x - dx * y + b[0] * a[1] - b[1] * a[0]) / Math.hypot(dx, dy) : Math.hypot(x - a[0], y - a[1]);
    if (d > max) (max = d), (idx = i);
  }
  if (max <= eps) return [a, b];
  return [...dp(pts.slice(0, idx + 1), eps).slice(0, -1), ...dp(pts.slice(idx), eps)];
}
const area = (p) => Math.abs(p.reduce((s, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return s + x * y2 - x2 * y; }, 0) / 2);
const rings = [];
for (const f of g.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    const ring = poly[0];
    if (ring.every(([, lat]) => lat < BOTTOM)) continue;
    const p = ring.map(proj);
    if (area(p) < minArea) continue;
    const s = dp(p, tol).map(([x, y]) => [Math.round(x), Math.round(y)]);
    const u = s.filter((q, i) => i === 0 || q[0] !== s[i - 1][0] || q[1] !== s[i - 1][1]);
    if (u.length >= 4) rings.push(u);
  }
}
const d = rings.map((r) => 'M' + r.slice(0, -1).map(([x, y]) => `${x} ${y}`).join('L') + 'Z').join('');
process.stdout.write(d);
console.error(`\nrings ${rings.length}, bytes ${d.length}`);
