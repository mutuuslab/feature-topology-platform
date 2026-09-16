/** 지정한 UL 항목의 정본 문구와 소관 화면을 출력한다. */
import { readFileSync } from 'node:fs';

const CANON = 'C:/project/2026-07-12_FF_Requirement분석/_scratch/2026-09-13_산출물/FP_UI_Menu_Map_v1_3.html';
const html = readFileSync(CANON, 'utf8');
const i = html.indexOf('window.FP_SCREEN_DESIGN');
const j = html.indexOf('{', i);
let depth = 0, k = j, inStr = null;
for (; k < html.length; k++) {
  const c = html[k];
  if (inStr) { if (c === '\\') k++; else if (c === inStr) inStr = null; continue; }
  if (c === '"' || c === "'") { inStr = c; continue; }
  if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { k++; break; } }
}
const d = JSON.parse(html.slice(j, k));
const want = process.argv.slice(2);
for (const s of d.screens) {
  for (const it of s.unleashItems || []) {
    const id = typeof it === 'string' ? it : it.id;
    if (!want.includes(id)) continue;
    const body = typeof it === 'string' ? '' : JSON.stringify(it);
    console.log(`### ${id} @ ${s.id} ${s.name}\n${body.slice(0, 1500)}\n`);
  }
}
