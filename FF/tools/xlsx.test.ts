// 최소 xlsx 읽기 — 저장(store) zip을 직접 만들어 인라인·공유 문자열, 열 건너뜀, 엔티티를 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { colIndex, readWorkbook, readZip, unescapeXml } from './xlsx.ts';

/** 최소 zip — 항목마다 저장(0) 또는 deflate(8) */
function zip(files: Record<string, string>, method: 0 | 8 = 0): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8');
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const WB = `<workbook><sheets><sheet name="01_A &amp; B" sheetId="1" r:id="rId1"/><sheet name="빈 시트" sheetId="2" r:id="rId2"/></sheets></workbook>`;
const RELS = `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml" Type="x"/></Relationships>`;
const SHEET = `<worksheet><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>요구사항</t></is></c><c r="C1" t="s"><v>0</v></c><c r="D1"><v>3</v></c></row>
<row r="3"><c r="B3" t="inlineStr"><is><r><t xml:space="preserve">줄1&#10;</t></r><r><t>줄2 &lt;x&gt;</t></r></is></c><c r="E3"/></row>
</sheetData></worksheet>`;
const SHARED = `<sst><si><t>공유 &quot;문자열&quot;</t></si></sst>`;

test('열 문자 → 0부터의 열 번호, XML 엔티티 복원', () => {
  assert.equal(colIndex('A1'), 0);
  assert.equal(colIndex('AB12'), 27);
  assert.equal(unescapeXml('a &amp; &lt;b&gt; &#44032;&#x41;'), 'a & <b> 가A');
});

test('저장·deflate zip 모두 읽는다', () => {
  for (const m of [0, 8] as const) assert.equal(readZip(zip({ 'a.txt': '가나다' }, m)).get('a.txt')!.toString('utf8'), '가나다');
});

test('시트 이름·순서, 인라인·공유 문자열, 비어 있는 행·열은 빈 칸으로', () => {
  const sheets = readWorkbook(zip({ 'xl/workbook.xml': WB, 'xl/_rels/workbook.xml.rels': RELS, 'xl/worksheets/sheet1.xml': SHEET, 'xl/worksheets/sheet2.xml': '<worksheet><sheetData/></worksheet>', 'xl/sharedStrings.xml': SHARED }, 8));
  assert.deepEqual(sheets.map((s) => s.name), ['01_A & B', '빈 시트']);
  assert.deepEqual(sheets[0].rows, [['요구사항', '', '공유 "문자열"', '3'], [], ['', '줄1\n줄2 <x>', '', '', '']]);
  assert.deepEqual(sheets[1].rows, []);
});

test('xlsx가 아니면 알아들을 수 있는 오류', () => {
  assert.throws(() => readZip(Buffer.from('not a zip at all, definitely not')), /zip 끝 레코드/);
  assert.throws(() => readWorkbook(zip({ 'a.txt': 'x' })), /workbook\.xml/);
});
