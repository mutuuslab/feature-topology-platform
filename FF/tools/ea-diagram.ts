// EA 원본 다이어그램 → 화면용 SVG (npm run ea:render · verify `ea:check`).
//   node tools/ea-diagram.ts          docs/20-architecture/ea/*.qea의 'Layered Architecture'를 저장된 위치·색 그대로 그려
//                                     frontend/public/arch/ea-layered-architecture.svg + frontend/src/screens/home/ea-diagram.meta.json
//   node tools/ea-diagram.ts --check  다시 그린 결과가 커밋된 파일과 같은지(원본 .qea를 바꾸고 다시 그리지 않으면 실패)
// .qea는 SQLite — t_diagramobjects(위치·순서·BCol) + t_object(이름·종류·스테레오타입). EA 그림 파일이 아니라 저장된 좌표로 그린 개략도다.
// 원본 이름은 고치지 않는다(오탈자 포함). 포함 관계(Nesting 연결선)는 상자 겹침으로 이미 보이므로 선은 그리지 않는다.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { basename, dirname, join } from 'node:path';
import { FF } from './lib.ts';

export const EA_DIR = join(FF, '..', 'docs', '20-architecture', 'ea');
export const SVG_OUT = join(FF, 'frontend', 'public', 'arch', 'ea-layered-architecture.svg');
export const META_OUT = join(FF, 'frontend', 'src', 'screens', 'home', 'ea-diagram.meta.json');
export const DIAGRAM = 'Layered Architecture';

export interface Shape {
  id: number;
  name: string;
  type: string;
  stereotype: string;
  x: number;
  y: number;
  w: number;
  h: number;
  seq: number;
  fill: string | null;
}

/** EA 색 정수는 BGR — 12903679(0xC4E4FF) → #ffe4c4. 음수는 기본색 */
export function bgr(n: number | null | undefined): string | null {
  if (n == null || n < 0) return null;
  const r = n & 0xff;
  const g = (n >> 8) & 0xff;
  const b = (n >> 16) & 0xff;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DEFAULT_FILL: Record<string, string> = { Package: '#fffbeb', Component: '#f3f3f3', Text: 'none' };

/** 글 폭 어림 — 한글·전각 1em, 그 밖 0.55em */
export const textWidth = (s: string, size: number) => [...s].reduce((w, ch) => w + (/[ᄀ-ᇿ　-鿿가-힯＀-￯①-⑳]/.test(ch) ? size : size * 0.55), 0);

/** 상자 폭을 넘는 이름은 두 줄로(EA처럼) — 가운데에 가장 가까운 공백·가운뎃점에서 나눈다. 나눌 곳이 없으면 한 줄 */
export function wrapName(name: string, maxWidth: number, size: number): string[] {
  if (textWidth(name, size) <= maxWidth) return [name];
  const cuts = [...name].flatMap((ch, i) => (ch === ' ' ? [[i, i + 1]] : ch === '·' ? [[i + 1, i + 1]] : []));
  if (!cuts.length) return [name];
  const mid = [...name].length / 2;
  const [a, b] = cuts.sort((x, y) => Math.abs(x[0] - mid) - Math.abs(y[0] - mid))[0];
  const chars = [...name];
  return [chars.slice(0, a).join(''), chars.slice(b).join('')];
}

const visible = (s: Shape) => !(s.type === 'Text' && !s.name); // 빈 글 상자 — EA에서도 보이지 않는다

/** 그릴 영역 — 보이는 상자 기준 여백 10 */
export function bounds(shapes: Shape[]) {
  const v = shapes.filter(visible);
  const x = Math.min(...v.map((s) => s.x)) - 10;
  const y = Math.min(...v.map((s) => s.y)) - 10;
  return { x, y, w: Math.max(...v.map((s) => s.x + s.w)) - x + 10, h: Math.max(...v.map((s) => s.y + s.h)) - y + 10 };
}

/** EA는 Sequence가 큰 것을 뒤에 그린다(도메인 상자가 가장 큼) — 큰 것부터 그려 작은 것이 위에 온다 */
export function renderSvg(shapes: Shape[], title: string): string {
  const { x: minX, y: minY, w: W, h: H } = bounds(shapes);
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${W} ${H}" width="${W}" height="${H}" font-family="Malgun Gothic, 'Apple SD Gothic Neo', 'Noto Sans KR', Arial, sans-serif" font-size="12" role="img" aria-label="${esc(title)}">`,
    `<title>${esc(title)} — EA 원본(저장된 위치·색)</title>`,
    `<rect x="${minX}" y="${minY}" width="${W}" height="${H}" fill="#ffffff"/>`,
  ];
  for (const s of [...shapes].sort((a, b) => b.seq - a.seq || a.id - b.id)) {
    if (!visible(s)) continue;
    const fill = s.fill ?? DEFAULT_FILL[s.type] ?? '#ffffff';
    const pkg = s.type === 'Package';
    const cx = s.x + s.w / 2;
    const size = pkg ? 13 : 12;
    const lines = wrapName(s.name, s.w - 10, size);
    const fs = lines.length > 1 ? size - 1 : size;
    const top = s.y + (s.stereotype ? (lines.length > 1 ? 26 : 31) : 18);
    out.push(`<g data-ea-id="${s.id}" data-type="${s.type}">`);
    out.push(`<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${pkg ? 2 : 4}" fill="${fill}" stroke="#8a7f7f" stroke-width="1"/>`);
    if (s.stereotype) out.push(`<text x="${cx}" y="${s.y + (lines.length > 1 ? 12 : 16)}" text-anchor="middle" fill="#5f5b56" font-size="${lines.length > 1 ? 10 : 11}">«${esc(s.stereotype)}»</text>`);
    lines.forEach((l, i) => out.push(`<text x="${cx}" y="${top + i * (fs + 2)}" text-anchor="middle" fill="#2b2b2b" font-weight="700" font-size="${fs}">${esc(l)}</text>`));
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('\n') + '\n';
}

export function sourceFile(): string {
  const files = existsSync(EA_DIR) ? readdirSync(EA_DIR).filter((f) => f.endsWith('.qea')) : [];
  if (files.length !== 1) throw new Error(`${EA_DIR}에 .qea가 정확히 하나 있어야 합니다 (${files.length}개)`);
  return join(EA_DIR, files[0]);
}

export function build(qea: string) {
  const bytes = readFileSync(qea);
  const db = new DatabaseSync(qea, { readOnly: true });
  try {
    const d = db.prepare('select Diagram_ID as id, Name as name from t_diagram where Name = ?').get(DIAGRAM) as { id: number; name: string } | undefined;
    if (!d) throw new Error(`다이어그램 '${DIAGRAM}'이 없습니다`);
    const rows = db
      .prepare(
        `select o.Object_ID as id, o.Name as name, o.Object_Type as type, o.Stereotype as stereotype, o.Backcolor as back,
                d.RectLeft as l, d.RectTop as t, d.RectRight as r, d.RectBottom as b, d.Sequence as seq, d.ObjectStyle as style
           from t_diagramobjects d join t_object o on o.Object_ID = d.Object_ID where d.Diagram_ID = ? order by d.Sequence desc, o.Object_ID`,
      )
      .all(d.id) as { id: number; name: string | null; type: string; stereotype: string | null; back: number; l: number; t: number; r: number; b: number; seq: number; style: string | null }[];
    const shapes: Shape[] = rows.map((x) => {
      const bcol = /(?:^|;)BCol=(-?\d+)/.exec(x.style ?? '')?.[1];
      return { id: x.id, name: x.name ?? '', type: x.type, stereotype: x.stereotype ?? '', x: x.l, y: -x.t, w: x.r - x.l, h: x.t - x.b, seq: x.seq, fill: bgr(bcol != null ? Number(bcol) : x.back) };
    });
    const links = (db.prepare('select count(*) as n from t_diagramlinks where DiagramID = ?').get(d.id) as { n: number }).n;
    const count = (st: string) => shapes.filter((s) => s.stereotype === st).length;
    const box = bounds(shapes);
    const meta = {
      source: `docs/20-architecture/ea/${basename(qea)}`,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      diagram: d.name,
      domains: shapes.filter((s) => s.stereotype === 'domain').map((s) => s.name),
      counts: { domains: count('domain'), layers: count('layer'), components: shapes.filter((s) => s.type === 'Component').length, nesting: links },
      svg: '/arch/ea-layered-architecture.svg',
      width: box.w,
      height: box.h,
      generatedBy: 'tools/ea-diagram.ts',
    };
    return { svg: renderSvg(shapes, d.name), meta: JSON.stringify(meta, null, 2) + '\n', shapes };
  } finally {
    db.close();
  }
}

if (import.meta.main ?? process.argv[1]?.endsWith('ea-diagram.ts')) {
  const { svg, meta } = build(sourceFile());
  if (process.argv.includes('--check')) {
    const same = (p: string, s: string) => existsSync(p) && readFileSync(p, 'utf8').replace(/\r\n/g, '\n') === s;
    const bad = [[SVG_OUT, svg], [META_OUT, meta]].filter(([p, s]) => !same(p, s)).map(([p]) => p);
    if (bad.length) {
      console.error(`ea:check ✕ EA 원본과 다릅니다 — npm run ea:render 후 커밋: ${bad.join(', ')}`);
      process.exit(1);
    }
    console.log('ea:check ✓ EA 원본 다이어그램 = 화면 SVG·메타');
  } else {
    for (const [p, s] of [[SVG_OUT, svg], [META_OUT, meta]]) {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, s);
    }
    console.log(`ea:render → ${SVG_OUT}\n           ${META_OUT}`);
  }
}
