// 최소 xlsx 읽기 — 외부 의존성 없이(zip 중앙 디렉터리 + inflateRaw + 셀 XML). 하네스 공용.
//   readWorkbook(buf) → [{ name, rows: string[][] }] — 시트 순서는 workbook.xml 순서, 빈 셀은 ''.
// 지원: 인라인 문자열(inlineStr)·공유 문자열(s)·숫자/불리언/수식 결과(<v>). 서식·병합·날짜 변환은 하지 않는다(원문 그대로).
import { inflateRawSync } from 'node:zlib';

/** zip 항목 이름 → 내용 */
export function readZip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip 끝 레코드가 없습니다 — xlsx가 아닙니다');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 중앙 디렉터리가 손상되었습니다');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`zip 항목 머리가 손상되었습니다: ${name}`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    if (method === 0) out.set(name, Buffer.from(data));
    else if (method === 8) out.set(name, inflateRawSync(data));
    else throw new Error(`지원하지 않는 zip 압축 방식 ${method}: ${name}`);
  }
  return out;
}

export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e === 'amp' ? '&' : e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : e === 'apos' ? "'" : String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)),
  );
}

/** <t> 조각을 이어 붙인다(서식 run 포함) */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');

/** 'AB' → 27 (0부터) */
export function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? '';
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

export function parseSheet(xml: string, shared: string[] = []): string[][] {
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNo = Number(/\br="(\d+)"/.exec(rm[1])?.[1] ?? rows.length + 1);
    const cells: string[] = [];
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const idx = ref ? colIndex(ref) : cells.length;
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const body = cm[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let val = '';
      if (type === 'inlineStr') val = textOf(body);
      else if (type === 's') val = v != null ? (shared[Number(v)] ?? '') : '';
      else if (v != null) val = unescapeXml(v);
      while (cells.length < idx) cells.push('');
      cells[idx] = val;
    }
    while (rows.length < rowNo - 1) rows.push([]);
    rows[rowNo - 1] = cells;
  }
  return rows;
}

export interface Sheet {
  name: string;
  rows: string[][];
}

export function readWorkbook(buf: Buffer): Sheet[] {
  const zip = readZip(buf);
  const text = (n: string) => zip.get(n)?.toString('utf8');
  const wb = text('xl/workbook.xml');
  if (!wb) throw new Error('xl/workbook.xml이 없습니다 — xlsx가 아닙니다');
  const rels = new Map<string, string>();
  for (const m of (text('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) rels.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
  }
  const sharedXml = text('xl/sharedStrings.xml') ?? '';
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  return [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => {
    const name = unescapeXml(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? '');
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1] ?? '';
    const target = rels.get(rid);
    const xml = target ? text(`xl/${target}`) : undefined;
    if (!xml) throw new Error(`시트 '${name}'의 XML이 없습니다(${rid})`);
    return { name, rows: parseSheet(xml, shared) };
  });
}
