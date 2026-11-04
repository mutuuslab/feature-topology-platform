// 최소 xlsx 쓰기(Feature DB 내보내기, 30-95 §10·R-4) — 새 런타임 의존성 없이 SpreadsheetML + 무압축(stored) zip.
//   writeWorkbook([{ name, rows }]) → Buffer. 읽기 짝은 tools/xlsx.ts readWorkbook(하네스) — 시험이 왕복으로 확인한다.
// 셀: 문자열은 인라인 문자열(inlineStr, 공유 문자열 표 없음), 숫자는 <v>, 불리언은 t="b", null·undefined·''는 셀을 쓰지 않는다.
// 결정적 출력: 같은 입력 → 같은 바이트(zip 항목 시각은 1980-01-01 고정, 항목 순서 고정). 서식은 머리글 굵게·틀 고정만 둔다.
// 한계: 셀 글자 32,767자(Excel 상한)를 넘으면 거부한다 — 잘라서 조용히 다른 값을 내보내지 않는다. 날짜는 글자(ISO) 그대로.

export type XlsxCell = string | number | boolean | null | undefined;

export interface XlsxSheet {
  /** 시트 이름 — 1~31자, []:*?/\ 없음, 통합 문서 안에서 유일 */
  name: string;
  rows: XlsxCell[][];
  /** 첫 행을 머리글로 — 굵게, 틀 고정(기본 true) */
  header?: boolean;
}

/** Excel 셀 한 칸의 글자 상한 */
export const XLSX_CELL_MAX = 32_767;

// ── zip(stored) ────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS 날짜 1980-01-01 00:00 — 출력이 시각에 따라 바뀌지 않게 */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** 범용 비트 11 — 항목 이름이 UTF-8 */
const UTF8_FLAG = 0x0800;

/** 무압축 zip — 항목 순서는 넣은 순서 그대로 */
export function writeZip(entries: readonly { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // 필요한 버전 2.0
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(0, 8); // 방식 0 = stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // 만든 버전
    central.writeUInt16LE(20, 6); // 필요한 버전
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(e.data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    // 30 extra · 32 comment · 34 disk · 36 내부 속성 · 38 외부 속성 = 0
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, e.data);
    centrals.push(central, name);
    offset += local.length + name.length + e.data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ── SpreadsheetML ──────────────────────────────────────────────

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** XML 1.0에 쓸 수 없는 제어 문자는 뺀다(탭·줄바꿈·CR은 둔다) */
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g;
export const escapeXml = (s: string) => s.replace(INVALID_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 0 → 'A', 27 → 'AB' */
export function colName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const SHEET_NAME_BAD = /[[\]:*?/\\]/;

function cellXml(v: XlsxCell, ref: string, style: string): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"${style}><v>${v}</v></c>` : '';
  if (typeof v === 'boolean') return `<c r="${ref}"${style} t="b"><v>${v ? 1 : 0}</v></c>`;
  if (v.length > XLSX_CELL_MAX) throw new Error(`셀 ${ref} 글자가 ${XLSX_CELL_MAX}자를 넘습니다(${v.length}자)`);
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`;
}

function sheetXml(s: XlsxSheet): string {
  const header = s.header !== false;
  const rows = s.rows
    .map((row, ri) => {
      const style = header && ri === 0 ? ' s="1"' : '';
      const cells = row.map((v, ci) => cellXml(v, `${colName(ci)}${ri + 1}`, style)).join('');
      return cells ? `<row r="${ri + 1}">${cells}</row>` : '';
    })
    .join('');
  const view = header && s.rows.length > 1 ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
  return `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">${view}<sheetData>${rows}</sheetData></worksheet>`;
}

const STYLES = `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** 시트 목록 → xlsx 바이트 */
export function writeWorkbook(sheets: readonly XlsxSheet[]): Buffer {
  if (!sheets.length) throw new Error('xlsx에는 시트가 하나 이상 있어야 합니다');
  const seen = new Set<string>();
  for (const s of sheets) {
    if (!s.name || s.name.length > 31 || SHEET_NAME_BAD.test(s.name)) throw new Error(`시트 이름 '${s.name}'은(는) 1~31자이고 []:*?/\\를 쓸 수 없습니다`);
    const key = s.name.toLowerCase();
    if (seen.has(key)) throw new Error(`시트 이름 '${s.name}'이(가) 겹칩니다`);
    seen.add(key);
  }
  const n = sheets.length;
  const sheetEntries = sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(sheetXml(s), 'utf8') }));
  const contentTypes =
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';
  const rootRels = `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>${sheets.map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
  const workbookRels =
    `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${n + 1}" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`;
  return writeZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rootRels, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbook, 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(workbookRels, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(STYLES, 'utf8') },
    ...sheetEntries,
  ]);
}
