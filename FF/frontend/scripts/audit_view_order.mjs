/**
 * 화면별 구현 뷰의 선언 순서가 정본 상세 영역 순서(S01→S08)와 맞는지 감사한다.
 *   node scripts/audit_view_order.mjs
 */
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../src/data/uiLinks.ts', import.meta.url), 'utf8');
const areas = readFileSync(new URL('../src/data/screenAreas.ts', import.meta.url), 'utf8');

const areaOrder = new Map();
for (const m of areas.matchAll(/'(UI\d{2}-S\d{2})'/g)) {
  const sid = m[1].slice(0, 4);
  if (!areaOrder.has(sid)) areaOrder.set(sid, []);
  if (!areaOrder.get(sid).includes(m[1])) areaOrder.get(sid).push(m[1]);
}

const screens = [];
let cur = null;
for (const line of ui.split(/\r?\n/)) {
  const head = line.match(/^ {2}(UI\d{2}): \{/);
  if (head) { cur = { id: head[1], links: [] }; screens.push(cur); continue; }
  if (!cur) continue;
  if (/^ {2}\},/.test(line)) { cur = null; continue; }
  const p = line.match(/path: '([^']+)'/);
  if (p) {
    cur.links.push({
      path: p[1],
      areaId: (line.match(/areaId: '(UI\d{2}-S\d{2})'/) || [])[1],
      entry: /entry: true/.test(line),
    });
  }
}

let bad = 0;
for (const s of screens) {
  const order = areaOrder.get(s.id) || [];
  const inversions = [];
  let last = -1;
  s.links.forEach((l, i) => {
    const v = l.areaId ? order.indexOf(l.areaId) : -1;
    if (v < 0) return;
    if (v < last) inversions.push(`${l.path}(${l.areaId})`);
    last = Math.max(last, v);
  });
  if (inversions.length) bad++;
  const noArea = s.links.filter(l => !l.areaId).map(l => l.path);
  console.log(`${inversions.length ? 'ORDER' : 'ok   '} ${s.id} n=${s.links.length}`
    + ` entry=${s.links.filter(l => l.entry).length}`
    + ` areas=[${s.links.map(l => (l.areaId ? l.areaId.slice(-3) : '---')).join(' ')}]`
    + (inversions.length ? `  INVERSIONS: ${inversions.join(' ')}` : '')
    + (noArea.length ? `  noArea: ${noArea.join(' ')}` : ''));
}
console.log(`\nscreens=${screens.length} out-of-order=${bad}`);
