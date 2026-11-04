// 양식 xlsx 셀 값 바꿔 넣기(kernel/xlsx-patch) — 값·스타일·행 순서, 수식 칸 거부, 바꾸지 않은 항목은 바이트 그대로, 다시 계산 켜기.
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { clearCachedResults, entryData, patchSheetXml, patchWorkbook, readCell, readZip, sheetPaths } from '../../src/kernel/xlsx-patch';
import { writeWorkbook } from '../../src/kernel/xlsx-write';

const SHEET = `<worksheet><sheetData><row r="2" spans="1:3"><c r="A2" s="4"><v>1</v></c><c r="C2" s="5"><f>A2*2</f><v>2</v></c></row><row r="5"><c r="B5" s="6" t="s"><v>0</v></c></row></sheetData></worksheet>`;

describe('xlsx 양식 채우기', () => {
  it('있는 칸은 스타일을 두고 값만, 없는 칸·행은 열·행 순서에 맞춰 넣는다', () => {
    const out = patchSheetXml(SHEET, [
      { ref: 'A2', value: '가나' },
      { ref: 'B2', value: 7 },
      { ref: 'B5', value: null },
      { ref: 'D3', value: 3.5 },
    ]);
    expect(out).toContain('<c r="A2" s="4" t="inlineStr"><is><t xml:space="preserve">가나</t></is></c><c r="B2"><v>7</v></c><c r="C2" s="5"><f>A2*2</f>');
    expect(out).toContain('<c r="B5" s="6"/>');
    expect(out.indexOf('<row r="3">')).toBeGreaterThan(out.indexOf('<row r="2"'));
    expect(out.indexOf('<row r="3">')).toBeLessThan(out.indexOf('<row r="5"'));
    expect(out).not.toContain('spans=');
    expect(readCell(out, 'D3', [])).toBe(3.5);
    expect(readCell(out, 'A2', [])).toBe('가나');
  });

  it('수식 칸에는 쓰지 않는다 — 양식 계산을 깨지 않게', () => {
    expect(() => patchSheetXml(SHEET, [{ ref: 'C2', value: 9 }], '시험')).toThrow(/시험!C2은\(는\) 수식 칸/);
  });

  it('저장된 계산값만 지우고 수식·스타일은 남긴다', () => {
    const out = clearCachedResults(SHEET);
    expect(out).toContain('<c r="C2" s="5"><f>A2*2</f></c>');
    expect(out).toContain('<c r="A2" s="4"><v>1</v></c>');
  });

  it('통합 문서 — 바꾼 시트만 다시 압축하고 나머지 항목은 바이트 그대로, 열 때 다시 계산', () => {
    const tpl = writeWorkbook([
      { name: '입력', rows: [['이름', '값'], ['a', 1]] },
      { name: '다른 시트', rows: [['그대로']] },
    ]);
    const out = patchWorkbook(tpl, [
      { sheet: '입력', ref: 'B2', value: 42 },
      { sheet: '입력', ref: 'A3', value: '새 행' },
    ]);
    const before = readZip(tpl);
    const after = readZip(out);
    expect(after.map((e) => e.name)).toEqual(before.map((e) => e.name));
    const paths = sheetPaths(after);
    for (const e of after) {
      const old = before.find((b) => b.name === e.name)!;
      if (e.name === paths.get('입력') || e.name === 'xl/workbook.xml') expect(e.method).toBe(8);
      else expect(Buffer.compare(e.compressed, old.compressed), e.name).toBe(0);
    }
    expect(entryData(after.find((e) => e.name === 'xl/workbook.xml')!).toString()).toContain('fullCalcOnLoad="1"');
    const wb = XLSX.read(out, { type: 'buffer' });
    expect(wb.Sheets['입력'].B2.v).toBe(42);
    expect(wb.Sheets['입력'].A3.v).toBe('새 행');
    expect(wb.Sheets['다른 시트'].A1.v).toBe('그대로');
  });

  it('없는 시트·잘못된 주소는 거부', () => {
    const tpl = writeWorkbook([{ name: '입력', rows: [['a']] }]);
    expect(() => patchWorkbook(tpl, [{ sheet: '없음', ref: 'A1', value: 1 }])).toThrow(/시트 '없음'/);
    expect(() => patchWorkbook(tpl, [{ sheet: '입력', ref: 'a1', value: 1 }])).toThrow(/셀 주소/);
  });
});
