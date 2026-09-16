/** 정본 그룹·화면 순서 vs 앱 메뉴 순서 대조. */
import { readFileSync } from 'node:fs';

const CANON = 'C:/project/2026-07-12_FF_Requirement분석/_scratch/2026-09-13_산출물/FP_UI_Menu_Map_v1_3.html';
const html = readFileSync(CANON, 'utf8');
const grab = (name) => {
  const i = html.indexOf(`window.${name}`);
  if (i < 0) return null;
  const j = html.indexOf('{', i);
  let depth = 0, k = j, inStr = null;
  for (; k < html.length; k++) {
    const c = html[k];
    if (inStr) { if (c === '\\') k++; else if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { k++; break; } }
  }
  return JSON.parse(html.slice(j, k));
};
const d = grab('FP_SCREEN_DESIGN');

const app = readFileSync(new URL('../src/data/specMenu.ts', import.meta.url), 'utf8');
const appOrder = [...app.matchAll(/id: '(UI\d{2})', ko: '([^']*)'/g)].map(m => `${m[1]} ${m[2]}`);

console.log('=== canon groups ===');
(d.groups || []).forEach((g, i) => console.log(`${i + 1}. ${JSON.stringify(g)}`));

console.log('\n=== canon screens in order ===');
(d.screens || []).forEach((s, i) => console.log(`${String(i + 1).padStart(2)}. ${s.id} | ${s.group} | ${s.name}`));

console.log('\n=== app screen order ===');
appOrder.forEach((s, i) => console.log(`${String(i + 1).padStart(2)}. ${s}`));
