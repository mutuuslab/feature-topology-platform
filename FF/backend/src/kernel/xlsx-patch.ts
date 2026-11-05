// 양식 xlsx에 셀 값만 바꿔 넣기(SW 개발비 산정 내보내기, 20-94 D-COST-13·C3) — 새 런타임 의존성 없이.
//   patchWorkbook(양식, 셀 목록) → Buffer. 바꾸지 않는 zip 항목(서식·차트·유효성 검사·다른 시트)은 압축된 바이트를 그대로 옮긴다.
//   바꾼 시트만 다시 압축(deflate)한다. 셀은 스타일(s)을 그대로 두고 값만 교체 — 문자열은 인라인 문자열(공유 문자열 표는 건드리지 않는다).
// 수식 칸은 쓰지 않는다(양식의 계산을 깨지 않게 — 쓰려 하면 오류). 열면 엑셀이 다시 계산하도록 calcPr fullCalcOnLoad="1"을 켠다.
// clearCachedResults: 수식 칸의 저장된 계산값을 지운다 — 다시 계산하지 않는 뷰어가 양식의 예시 숫자를 이 과제 값으로 오해하지 않게.
// 한계: ZIP64·암호화 양식은 받지 않는다. 행(row)이 없으면 순서에 맞춰 새로 만든다.
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { crc32, escapeXml } from './xlsx-write';

export type PatchValue = string | number | null;
export interface PatchCell {
  sheet: string;
  /** A1 주소 */
  ref: string;
  /** null = 값 지우기(스타일은 남긴다) */
  value: PatchValue;
}

interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  compressed: Buffer;
  size: number;
  flags: number;
  time: number;
  date: number;
}

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;

export function readZip(buf: Buffer): ZipEntry[] {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('xlsx 양식이 zip이 아닙니다(끝 레코드 없음)');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  if (count === 0xffff || p === 0xffffffff) throw new Error('ZIP64 양식은 지원하지 않습니다');
  const out: ZipEntry[] = [];
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== CEN) throw new Error('zip 중앙 디렉터리가 깨졌습니다');
    const flags = buf.readUInt16LE(p + 8);
    if (flags & 1) throw new Error('암호화된 양식은 지원하지 않습니다');
    const method = buf.readUInt16LE(p + 10);
    const time = buf.readUInt16LE(p + 12);
    const date = buf.readUInt16LE(p + 14);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    if (buf.readUInt32LE(off) !== LOC) throw new Error(`zip 항목 ${name}의 머리가 깨졌습니다`);
    const data = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    out.push({ name, method, crc, compressed: buf.subarray(data, data + csize), size, flags: flags & 0x0800, time, date });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

export function entryData(e: ZipEntry): Buffer {
  if (e.method === 0) return Buffer.from(e.compressed);
  if (e.method === 8) return inflateRawSync(e.compressed);
  throw new Error(`zip 압축 방식 ${e.method}은(는) 지원하지 않습니다(${e.name})`);
}

function writeEntries(entries: readonly ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOC, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.flags, 6);
    local.writeUInt16LE(e.method, 8);
    local.writeUInt16LE(e.time, 10);
    local.writeUInt16LE(e.date, 12);
    local.writeUInt32LE(e.crc, 14);
    local.writeUInt32LE(e.compressed.length, 18);
    local.writeUInt32LE(e.size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CEN, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.flags, 8);
    central.writeUInt16LE(e.method, 10);
    central.writeUInt16LE(e.time, 12);
    central.writeUInt16LE(e.date, 14);
    central.writeUInt32LE(e.crc, 16);
    central.writeUInt32LE(e.compressed.length, 20);
    central.writeUInt32LE(e.size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    parts.push(local, name, e.compressed);
    centrals.push(central, name);
    offset += 30 + name.length + e.compressed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

const unescapeXml = (s: string) => s.replace(/&(lt|gt|quot|apos|amp);/g, (_, k) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[k as 'lt']);

/** 시트 이름 → zip 항목 이름(xl/worksheets/sheetN.xml) */
export function sheetPaths(entries: readonly ZipEntry[]): Map<string, string> {
  const get = (n: string) => {
    const e = entries.find((x) => x.name === n);
    if (!e) throw new Error(`xlsx 양식에 ${n}이(가) 없습니다`);
    return entryData(e).toString('utf8');
  };
  const rels = new Map<string, string>();
  for (const m of get('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  }
  const out = new Map<string, string>();
  for (const m of get('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = /\bname="([^"]*)"/.exec(m[0])?.[1];
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    if (name != null && rid && rels.has(rid)) out.set(unescapeXml(name), rels.get(rid)!);
  }
  return out;
}

/** 공유 문자열 표(읽기 전용) — 셀 값 조회용 */
export function sharedStrings(entries: readonly ZipEntry[]): string[] {
  const e = entries.find((x) => x.name === 'xl/sharedStrings.xml');
  if (!e) return [];
  const xml = entryData(e).toString('utf8');
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unescapeXml(t[1])).join(''));
}

export const colIndexOf = (col: string) => [...col].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
const splitRef = (ref: string) => {
  const m = /^([A-Z]{1,3})([1-9]\d*)$/.exec(ref);
  if (!m) throw new Error(`셀 주소 ${ref}이(가) 올바르지 않습니다`);
  return { col: m[1], row: Number(m[2]) };
};

const ROW_RE = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
const CELL_RE = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
const attr = (attrs: string, k: string) => new RegExp(`\\b${k}="([^"]*)"`).exec(attrs)?.[1];

/** 셀 값을 읽는다(시험·대조용) — 공유 문자열·인라인 문자열·숫자. 수식 칸은 저장된 값 */
export function readCell(xml: string, ref: string, shared: readonly string[]): string | number | null {
  const { row } = splitRef(ref);
  for (const r of xml.matchAll(ROW_RE)) {
    if (Number(attr(r[1], 'r')) !== row) continue;
    for (const c of (r[2] ?? '').matchAll(CELL_RE)) {
      if (attr(c[1], 'r') !== ref) continue;
      const body = c[2] ?? '';
      const t = attr(c[1], 't');
      if (t === 'inlineStr') return [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => unescapeXml(x[1])).join('');
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      if (v == null) return null;
      if (t === 's') return shared[Number(v)] ?? null;
      if (t === 'str' || t === 'e') return unescapeXml(v);
      return Number(v);
    }
  }
  return null;
}

/** 한 열의 값을 행 번호와 함께(양식에서 기준 ID·드라이버 이름의 행을 찾을 때) — 한 번만 훑는다 */
export function columnValues(xml: string, col: string, shared: readonly string[]): Map<number, string | number> {
  const out = new Map<number, string | number>();
  const re = new RegExp(`^${col}(\\d+)$`);
  for (const c of xml.matchAll(CELL_RE)) {
    const m = re.exec(attr(c[1], 'r') ?? '');
    if (!m) continue;
    const v = readCell(`<row r="${m[1]}">${c[0]}</row>`, `${col}${m[1]}`, shared);
    if (v != null && v !== '') out.set(Number(m[1]), v);
  }
  return out;
}

function cellXml(ref: string, attrs: string, value: PatchValue): string {
  // 기존 속성 중 스타일 등은 두고, 형식(t)·r은 새로 쓴다
  const keep = attrs.replace(/\s*\br="[^"]*"/, '').replace(/\s*\bt="[^"]*"/, '');
  if (value == null) return `<c r="${ref}"${keep}/>`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${ref}: 숫자가 아닙니다`);
    return `<c r="${ref}"${keep}><v>${value}</v></c>`;
  }
  return `<c r="${ref}"${keep} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

/** 한 시트 XML에 셀들을 쓴다 — 수식 칸이면 오류 */
export function patchSheetXml(xml: string, cells: readonly { ref: string; value: PatchValue }[], sheet = ''): string {
  const byRow = new Map<number, Map<string, PatchValue>>();
  for (const c of cells) {
    const { row } = splitRef(c.ref);
    if (!byRow.has(row)) byRow.set(row, new Map());
    byRow.get(row)!.set(c.ref, c.value);
  }
  if (!byRow.size) return xml;
  const sdStart = xml.indexOf('<sheetData');
  if (sdStart < 0) throw new Error(`${sheet}: sheetData가 없습니다`);
  const selfClosed = /<sheetData\s*\/>/.exec(xml.slice(sdStart));
  if (selfClosed && selfClosed.index === 0) xml = xml.slice(0, sdStart) + '<sheetData></sheetData>' + xml.slice(sdStart + selfClosed[0].length);
  const open = xml.indexOf('>', sdStart) + 1;
  const close = xml.indexOf('</sheetData>', open);
  const data = xml.slice(open, close);
  const done = new Set<number>();
  const patchRow = (rowNo: number, attrs: string, body: string) => {
    const want = byRow.get(rowNo)!;
    const cellsOut: { col: number; xml: string }[] = [];
    const seen = new Set<string>();
    for (const c of body.matchAll(CELL_RE)) {
      const ref = attr(c[1], 'r');
      if (!ref) throw new Error(`${sheet}: 주소 없는 셀(r 생략)은 지원하지 않습니다 — ${rowNo}행`);
      if (want.has(ref)) {
        if (/<f\b/.test(c[2] ?? '')) throw new Error(`${sheet}!${ref}은(는) 수식 칸이라 값을 쓸 수 없습니다`);
        seen.add(ref);
        cellsOut.push({ col: colIndexOf(splitRef(ref).col), xml: cellXml(ref, c[1], want.get(ref)!) });
      } else cellsOut.push({ col: colIndexOf(splitRef(ref).col), xml: c[0] });
    }
    for (const [ref, value] of want) if (!seen.has(ref) && value != null) cellsOut.push({ col: colIndexOf(splitRef(ref).col), xml: cellXml(ref, '', value) });
    cellsOut.sort((a, b) => a.col - b.col);
    // spans는 열 범위 힌트 — 새 칸이 범위를 넘을 수 있어 지운다(엑셀이 다시 만든다)
    return `<row${attrs.replace(/\s*\bspans="[^"]*"/, '')}>${cellsOut.map((c) => c.xml).join('')}</row>`;
  };
  let out = data.replace(ROW_RE, (whole, attrs: string, body: string | undefined) => {
    const r = Number(attr(attrs, 'r'));
    if (!byRow.has(r)) return whole;
    done.add(r);
    return patchRow(r, attrs, body ?? '');
  });
  // 없는 행 — 번호 순서 자리에 넣는다
  for (const r of [...byRow.keys()].filter((x) => !done.has(x) && [...byRow.get(x)!.values()].some((v) => v != null)).sort((a, b) => a - b)) {
    const row = patchRow(r, ` r="${r}"`, '');
    let at = out.length;
    for (const m of out.matchAll(ROW_RE)) {
      if (Number(attr(m[1], 'r')) > r) {
        at = m.index!;
        break;
      }
    }
    out = out.slice(0, at) + row + out.slice(at);
  }
  return xml.slice(0, open) + out + xml.slice(close);
}

/** 수식 칸의 저장된 계산값을 지운다(수식·스타일은 그대로) */
export function clearCachedResults(xml: string): string {
  return xml.replace(CELL_RE, (whole, attrs: string, body: string | undefined) => {
    if (!body || !/<f\b/.test(body)) return whole;
    return `<c${attrs.replace(/\s*\bt="[^"]*"/, '')}>${body.replace(/<v>[\s\S]*?<\/v>/, '')}</c>`;
  });
}

function setFullCalcOnLoad(xml: string): string {
  if (/<calcPr\b/.test(xml)) return xml.replace(/<calcPr\b([^>]*?)(\/?)>/, (_, a: string, sl: string) => `<calcPr${a.replace(/\s*\bfullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"${sl}>`);
  return xml.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
}

export interface PatchOptions {
  /** 수식 칸의 저장된 계산값을 지울 시트(기본: 셀을 바꾼 시트가 아니라 수식이 있는 모든 시트) */
  clearCachedResults?: boolean;
}

/** 양식에 셀 값을 쓴 새 통합 문서 — 바꾸지 않은 항목은 바이트 그대로 */
export function patchWorkbook(template: Buffer, cells: readonly PatchCell[], opts: PatchOptions = {}): Buffer {
  const entries = readZip(template);
  const paths = sheetPaths(entries);
  const bySheet = new Map<string, { ref: string; value: PatchValue }[]>();
  for (const c of cells) {
    const path = paths.get(c.sheet);
    if (!path) throw new Error(`양식에 시트 '${c.sheet}'이(가) 없습니다`);
    if (!bySheet.has(path)) bySheet.set(path, []);
    bySheet.get(path)!.push({ ref: c.ref, value: c.value });
  }
  const sheetNames = new Map([...paths].map(([n, p]) => [p, n]));
  const out = entries.map((e) => {
    let xml: string | null = null;
    if (bySheet.has(e.name)) xml = patchSheetXml(entryData(e).toString('utf8'), bySheet.get(e.name)!, sheetNames.get(e.name));
    if (opts.clearCachedResults && sheetNames.has(e.name)) xml = clearCachedResults(xml ?? entryData(e).toString('utf8'));
    if (e.name === 'xl/workbook.xml') xml = setFullCalcOnLoad(entryData(e).toString('utf8'));
    if (xml == null) return e;
    const data = Buffer.from(xml, 'utf8');
    return { ...e, method: 8, crc: crc32(data), size: data.length, compressed: deflateRawSync(data) };
  });
  return writeEntries(out);
}
