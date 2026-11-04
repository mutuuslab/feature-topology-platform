// 최소 xlsx 쓰기(kernel/xlsx-write, 30-95 §10·R-4) — 하네스 읽기(tools/xlsx readWorkbook)로 왕복, 결정적 바이트, zip CRC, 잘못된 입력 거부.
import { describe, expect, it } from 'vitest';
import { readWorkbook, readZip } from '../../../tools/xlsx';
import { colName, crc32, writeWorkbook, writeZip, XLSX_CELL_MAX } from '../../src/kernel/xlsx-write';

describe('xlsx 쓰기', () => {
  it('시트 이름·순서·셀 값이 읽기(readWorkbook)와 왕복한다 — 빈 셀은 비워 둔다', () => {
    const buf = writeWorkbook([
      { name: '03_FeatureDB', rows: [['ID', '도메인', '번호', '참'], ['CH-BRK-009', 'Chassis & Vehicle Dynamics', 3, true], ['BC-BCM-001', null, 1.5, false], [], ['<a href="x">&</a>', '', undefined, '줄\n바꿈']] },
      { name: '09_출처', rows: [['ID', '자료'], ['S01', 'Kearney "Features and costs"']] },
    ]);
    const wb = readWorkbook(buf);
    expect(wb.map((s) => s.name)).toEqual(['03_FeatureDB', '09_출처']);
    expect(wb[0].rows[0]).toEqual(['ID', '도메인', '번호', '참']);
    expect(wb[0].rows[1]).toEqual(['CH-BRK-009', 'Chassis & Vehicle Dynamics', '3', '1']);
    expect(wb[0].rows[2]).toEqual(['BC-BCM-001', '', '1.5', '0']);
    expect(wb[0].rows[3]).toEqual([]);
    expect(wb[0].rows[4]).toEqual(['<a href="x">&</a>', '', '', '줄\n바꿈']);
    expect(wb[1].rows[1]).toEqual(['S01', 'Kearney "Features and costs"']);
  });

  it('같은 입력이면 같은 바이트다(항목 시각 고정)', () => {
    const sheets = [{ name: 'A', rows: [['x', 1]] }];
    expect(writeWorkbook(sheets).equals(writeWorkbook(sheets))).toBe(true);
  });

  it('무압축 zip — CRC32와 크기가 맞고 압축 해제 없이 읽힌다', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926); // CRC-32 표준 점검 값
    const zip = writeZip([
      { name: 'a.txt', data: Buffer.from('hello') },
      { name: '한글/b.xml', data: Buffer.from('<x/>') },
    ]);
    const files = readZip(zip);
    expect(files.get('a.txt')?.toString()).toBe('hello');
    expect(files.get('한글/b.xml')?.toString()).toBe('<x/>');
    expect(zip.readUInt16LE(8)).toBe(0); // 첫 항목 압축 방식 = stored
  });

  it('머리글은 굵게(s="1")·틀 고정, 제어 문자는 뺀다', () => {
    const files = readZip(writeWorkbook([{ name: 'S', rows: [['머리'], ['값\u0001']] }]));
    const xml = files.get('xl/worksheets/sheet1.xml')!.toString('utf8');
    expect(xml).toContain('<c r="A1" s="1" t="inlineStr">');
    expect(xml).toContain('state="frozen"');
    expect(xml).not.toContain('\u0001');
    expect(files.get('xl/styles.xml')).toBeDefined();
  });

  it('열 이름 — A·Z·AA·AE·BV', () => {
    expect([0, 25, 26, 30, 73].map(colName)).toEqual(['A', 'Z', 'AA', 'AE', 'BV']);
  });

  it('잘못된 시트 이름·겹치는 이름·너무 긴 셀·빈 통합 문서는 거부한다', () => {
    expect(() => writeWorkbook([])).toThrow();
    expect(() => writeWorkbook([{ name: 'a/b', rows: [] }])).toThrow(/시트 이름/);
    expect(() => writeWorkbook([{ name: 'x'.repeat(32), rows: [] }])).toThrow(/시트 이름/);
    expect(() => writeWorkbook([{ name: 'A', rows: [] }, { name: 'a', rows: [] }])).toThrow(/겹칩니다/);
    expect(() => writeWorkbook([{ name: 'A', rows: [['x'.repeat(XLSX_CELL_MAX + 1)]] }])).toThrow(/32767/);
  });
});
