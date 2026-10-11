// 결정적 적재: 같은 xlsx → 바이트 단위로 같은 JSON.
// 행은 버리지 않는다 — 스키마를 통과 못 한 행도 원형대로 싣고 warnings에 남긴다(사용자 결정: 원본 적재 + 경고).
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { FF } from '../lib.ts';
import { SHEETS, type Col } from './columns.ts';

const require = createRequire(import.meta.url);
const contracts = require(join(FF, 'contracts', 'dist', 'index.js')) as typeof import('../../contracts/src/index');
const { DATASET_FILES } = contracts;

export const IMPORTER_VERSION = '1.0.0';
const HEADER_ROW = 3; // 0-based — 엑셀 4행

const PLACEHOLDERS: Record<string, string> = {
  '미입력': '미입력',
  '미발급': '미발급',
  '해당 없음': '해당 없음',
  '의존 관계 없음.': '의존 관계 없음',
  '의존 관계 없음': '의존 관계 없음',
};

type Warning = { file: string; row: number; key: string; code: 'SCHEMA' | 'DATA_QUALITY'; message: string };

const isList = (k: Col['kind']) => k === 'lines' || k === 'comma' || k === 'funcs';

function excelDate(v: unknown): string | null {
  if (typeof v === 'number') {
    // 1900 날짜 체계: 일련번호 1 = 1900-01-01 (엑셀 윤년 버그 보정으로 기준 1899-12-30)
    const ms = Date.UTC(1899, 11, 30) + Math.round(v) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

function convert(col: Col, raw: unknown, missing: Record<string, string>): unknown {
  const text = raw == null ? '' : String(raw).replace(/\r\n/g, '\n').trim();
  if (text === '' || PLACEHOLDERS[text]) {
    if (PLACEHOLDERS[text]) missing[col.field] = PLACEHOLDERS[text];
    return isList(col.kind) ? [] : null;
  }
  switch (col.kind) {
    case 'str':
      return text;
    case 'int':
      return Number(text);
    case 'date':
      return excelDate(raw);
    case 'kst': {
      const m = text.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) KST$/);
      return m ? `${m[1]}T${m[2]}:00+09:00` : text;
    }
    case 'lines':
      return text.split('\n').map((s) => s.trim()).filter(Boolean);
    case 'comma':
      return text.split(',').map((s) => s.trim()).filter(Boolean);
    case 'funcs':
      return text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const [functionId, ...rest] = s.split('|').map((x) => x.trim());
          return { functionId, label: rest.join(' | ') };
        });
  }
}

export interface ImportResult {
  files: Record<string, unknown[]>;
  warnings: Warning[];
  sourceSha256: string;
}

export function importWorkbook(buf: Buffer): ImportResult {
  const wb = XLSX.read(buf, { cellDates: false });
  const files: Record<string, { key: string; row: unknown }[]> = {};
  const warnings: Warning[] = [];

  for (const spec of SHEETS) {
    const ws = wb.Sheets[spec.sheet];
    if (!ws) throw new Error(`시트 없음: ${spec.sheet}`);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true, blankrows: true });
    const header = (rows[HEADER_ROW] ?? []).map((h) => (h == null ? '' : String(h).replace(/\r\n/g, '\n').trim()));
    const idx = spec.cols.map((col) => {
      const i = header.indexOf(col.header);
      if (i < 0) throw new Error(`[${spec.sheet}] 헤더 없음: ${JSON.stringify(col.header)}`);
      return i;
    });
    const schema = (DATASET_FILES as any)[spec.file];
    const order: string[] = Object.keys(schema.shape);

    for (let r = HEADER_ROW + 1; r < rows.length; r++) {
      const cells = rows[r] ?? [];
      const firstCell = cells[idx[0]];
      if (firstCell == null || String(firstCell).trim() === '') continue; // 빈 행
      const missing: Record<string, string> = {};
      const draft: Record<string, unknown> = { ...(spec.extra ?? {}) };
      spec.cols.forEach((col, k) => (draft[col.field] = convert(col, cells[idx[k]], missing)));
      draft._missing = Object.fromEntries(Object.entries(missing).sort(([a], [b]) => a.localeCompare(b)));
      // 스키마 필드 순서로 키 고정 → 결정적 직렬화
      const row = Object.fromEntries(order.map((f) => [f, draft[f] === undefined ? null : draft[f]]));
      const key = spec.key(row);
      const parsed = schema.safeParse(row);
      if (!parsed.success) {
        for (const issue of parsed.error.issues)
          warnings.push({ file: spec.file, row: r + 1, key, code: 'SCHEMA', message: `${issue.path.join('.')}: ${issue.message}` });
      }
      (files[spec.file] ??= []).push({ key, row });
    }
  }

  const out: Record<string, unknown[]> = {};
  for (const [file, list] of Object.entries(files)) {
    const keys = new Set<string>();
    for (const { key } of list) {
      if (keys.has(key)) warnings.push({ file, row: 0, key, code: 'SCHEMA', message: '중복 키' });
      keys.add(key);
    }
    out[file] = list.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map((x) => x.row);
  }
  warnings.sort((a, b) => a.file.localeCompare(b.file) || a.row - b.row || a.message.localeCompare(b.message));
  return { files: out, warnings, sourceSha256: createHash('sha256').update(buf).digest('hex') };
}

export const serialize = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
