// 시트별 헤더 행 확인용 (개발 보조): node tools/dataset/peek.ts <xlsx> [헤더행]
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
const wb = XLSX.read(readFileSync(process.argv[2]), { cellDates: true });
const r = Number(process.argv[3] ?? 4) - 1;
for (const name of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, defval: null, blankrows: true });
  console.log(`[${name}] rows=${rows.length} :: ${(rows[r] ?? []).map((v) => JSON.stringify(v)).join(' | ')}`);
}
