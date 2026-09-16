/**
 * UL-0xx 커버리지 감사 (일회성).
 * 정본 FP_UI_Menu_Map_v1_3.html 의 window.FP_SCREEN_DESIGN 에서 화면별 unleashItems 를 읽어,
 * 각 UL 항목이 어느 화면 소관인지와 앱 소스에서 실제로 언급되는지를 대조한다.
 *
 *   node scripts/audit_ul_coverage.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CANON = 'C:/project/2026-07-12_FF_Requirement분석/_scratch/2026-09-13_산출물/FP_UI_Menu_Map_v1_3.html';

const html = readFileSync(CANON, 'utf8');
const m = html.match(/window\.FP_SCREEN_DESIGN\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/)
  || html.match(/window\.FP_SCREEN_DESIGN\s*=\s*(\{[\s\S]*?\})\s*;?\s*\n/);
if (!m) { console.error('FP_SCREEN_DESIGN not found'); process.exit(1); }
const design = JSON.parse(m[1]);

const screens = design.screens || design;
const owner = new Map();
for (const s of screens) {
  for (const it of s.unleashItems || []) {
    const id = typeof it === 'string' ? it : it.id;
    if (!/^UL-\d{3}$/.test(id)) continue;
    if (!owner.has(id)) owner.set(id, []);
    owner.get(id).push(s.id);
  }
}

const srcText = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (['.ts', '.tsx'].includes(extname(p))) srcText.push([p, readFileSync(p, 'utf8')]);
  }
})(join(here, '..', 'src'));
const blob = srcText.map(([p, t]) => `${p}\n${t}`).join('\n');

const all = [...owner.keys()].sort();
const used = all.filter(id => blob.includes(id));
const unused = all.filter(id => !blob.includes(id));
console.log(`UL items in canon: ${all.length}`);
console.log(`used in src: ${used.length}`);
console.log(`UNUSED: ${unused.length}`);
for (const id of unused) console.log(`  ${id}  owner=${owner.get(id).join(',')}`);
