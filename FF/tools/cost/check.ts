// data:check의 개발비 산정 부분(20-94 §10) — 계수 표 스키마, 기준값 시나리오 4개가 계수 표와 같은 원본 엑셀에서 나왔는지,
// 원본 엑셀(data/source/feature_db_v1.3.xlsx)이 있으면 다시 가져온 계수 표가 저장본과 같은지, 그 파일이 계수 표의 원본(SHA-256)인지(엑셀 내보내기 양식),
// 데모 시드 픽스처(data/fixtures/demo/cost-demo.json)가 tools/cost/demo-seed.ts로 다시 만든 것과 같은지 본다.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { FF } from '../lib.ts';
import { buildDemo, DEMO_FILE } from './demo-seed.ts';
import { importCostBasis } from './import-basis.ts';

const require = createRequire(import.meta.url);
const { CostBasis } = require(join(FF, 'contracts', 'dist', 'index.js')) as typeof import('../../contracts/src/index');

export function checkCost(): { errors: string[]; summary: string } {
  const errors: string[] = [];
  const basisPath = join(FF, 'data', 'reference', 'cost-basis', 'v1.3.json');
  if (!existsSync(basisPath)) return { errors: ['data/reference/cost-basis/v1.3.json 없음 — npm run cost:basis -- <엑셀>'], summary: '' };
  const text = readFileSync(basisPath, 'utf8').replace(/\r\n/g, '\n');
  const parsed = CostBasis.safeParse(JSON.parse(text));
  if (!parsed.success) errors.push(`계수 표 스키마 위반: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`);
  const sha = parsed.success ? parsed.data.source?.sha256 : undefined;
  const dir = join(FF, 'data', 'golden', 'cost');
  const golden = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  if (golden.length !== 4) errors.push(`개발비 기준값 시나리오가 ${golden.length}개 — 4개(s0~s3)여야 한다(tools/cost/excel-golden.ps1)`);
  for (const f of golden) {
    const g = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (g.source?.sha256 !== sha) errors.push(`기준값 ${f}의 원본 엑셀이 계수 표와 다름 — 같은 엑셀로 cost:basis와 excel-golden.ps1을 다시`);
  }
  const src = join(FF, 'data', 'source', 'feature_db_v1.3.xlsx');
  let reimport = '원본 엑셀 없음(재가져오기 대조 생략)';
  if (existsSync(src)) {
    const buf = readFileSync(src);
    if (createHash('sha256').update(buf).digest('hex') !== sha) errors.push('data/source/feature_db_v1.3.xlsx가 계수 표 v1.3의 원본(SHA-256)이 아님 — 엑셀 내보내기 양식이 계수 표와 어긋난다');
    const again = JSON.stringify(importCostBasis(buf), null, 2) + '\n';
    if (again !== text) errors.push('계수 표가 원본 엑셀을 다시 가져온 결과와 다름 — 손으로 고쳤다면 원가 기준 관리자 발행으로(D-COST-8)');
    reimport = '재가져오기 일치';
  }
  const demo = existsSync(DEMO_FILE) && readFileSync(DEMO_FILE, 'utf8').replace(/\r\n/g, '\n') === JSON.stringify(buildDemo(), null, 2) + '\n';
  if (!demo) errors.push('데모 시드 data/fixtures/demo/cost-demo.json이 최신이 아님 — npm run cost:demo-seed');
  return { errors, summary: `개발비 계수 표 v1.3 · 기준값 ${golden.length}개 같은 원본 · ${reimport} · 데모 시드 최신` };
}
