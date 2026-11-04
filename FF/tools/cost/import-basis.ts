// npm run cost:basis -- <엑셀 경로> — 엑셀 산정 도구 v1.3의 계수·단가 표 → data/reference/cost-basis/v1.3.json (20-94 §5 cost_basis 첫 판).
// 05_기준값 A~N절, 02_프로젝트설정 3절(벤치마크 환산·부가세), 12_MBD복잡도 승수·작업 표, 06_교정 표본 목록을 옮긴다.
// 저장된 계산값을 읽기만 한다(엑셀을 다시 계산하지 않음). 이후 원천은 FF — 원가 기준 관리자가 새 버전을 발행한다(D-COST-8).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import * as XLSX from 'xlsx';
import { FF } from '../lib.ts';

const require = createRequire(import.meta.url);
const { CostBasis } = require(join(FF, 'contracts', 'dist', 'index.js')) as typeof import('../../contracts/src/index');

export const COST_BASIS_VERSION = 'v1.3';

export function importCostBasis(buf: Buffer, file = 'Automotive_SW_개발비_산정도구_FeatureDB_v1.3.xlsx') {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = (n: string) => {
    const ws = wb.Sheets[n];
    if (!ws) throw new Error(`시트 '${n}'이 없습니다`);
    return ws;
  };
  const v = (ws: XLSX.WorkSheet, a: string) => {
    const c = ws[a];
    return c == null || c.v === '' ? null : c.v;
  };
  const num = (ws: XLSX.WorkSheet, a: string) => {
    const x = v(ws, a);
    return typeof x === 'number' ? x : null;
  };
  const str = (ws: XLSX.WorkSheet, a: string) => {
    const x = v(ws, a);
    return x == null ? null : String(x).trim();
  };
  const b = sheet('05_기준값');
  const p = sheet('02_프로젝트설정');
  const m = sheet('12_MBD복잡도');
  const k = sheet('06_교정');
  const c = sheet('07_검토체크리스트');
  const rows = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  const sizePoints = Object.fromEntries(rows(6, 12).map((r) => [str(b, `B${r}`)!, num(b, `C${r}`)!]));
  const asil = Object.fromEntries(rows(17, 21).map((r) => [str(b, `B${r}`)!, { rely: num(b, `D${r}`)!, docu: num(b, `F${r}`)! }]));
  const reuse = rows(26, 31).map((r) => ({ changeType: str(b, `B${r}`)!, dm: num(b, `C${r}`)!, cm: num(b, `D${r}`)!, im: num(b, `E${r}`)!, aa: num(b, `F${r}`)!, su: num(b, `G${r}`)!, unfm: num(b, `H${r}`)! }));
  const overall = {
    base: num(b, 'C39')!,
    lifecycle: Object.fromEntries(rows(36, 38).map((r) => [str(b, `B${r}`)!, num(b, `C${r}`)!])),
    quality: Object.fromEntries(rows(36, 38).map((r) => [str(b, `E${r}`)!, num(b, `F${r}`)!])),
  };
  const ratings = ['VL', 'L', 'N', 'H', 'VH', 'XH'] as const;
  const cols = ['D', 'E', 'F', 'G', 'H', 'I'];
  const cocomo = Object.fromEntries(rows(56, 68).map((r) => [str(b, `B${r}`)!, { label: str(b, `C${r}`)!, ...Object.fromEntries(ratings.map((rt, i) => [rt, num(b, `${cols[i]}${r}`)])) }]));
  const presetNames = ['C', 'D', 'E'].map((c) => str(b, `${c}143`)!);
  const presets = Object.fromEntries(presetNames.map((name, i) => [name, Object.fromEntries(rows(144, 156).map((r) => [str(b, `B${r}`)!, str(b, `${['C', 'D', 'E'][i]}${r}`)]))]));
  const roles = rows(73, 81).map((r) => ({ role: str(b, `B${r}`)!, kosaJob: str(b, `C${r}`)!, engineeringGrade: str(b, `E${r}`)!, inhouseMonthly: num(b, `H${r}`) }));
  const kosa = Object.fromEntries(rows(73, 80).filter((r) => str(b, `K${r}`)).map((r) => [str(b, `K${r}`)!, { daily: num(b, `L${r}`)!, monthly: num(b, `M${r}`)! }]));
  const engineeringDaily = Object.fromEntries(rows(73, 77).filter((r) => str(b, `O${r}`)).map((r) => [str(b, `O${r}`)!, num(b, `P${r}`)!]));
  const phases = rows(89, 92).map((r) => ({ phase: str(b, `B${r}`)!, share: num(b, `C${r}`)! }));
  const roleComposition = Object.fromEntries(rows(98, 106).map((r) => [str(b, `B${r}`)!, ['C', 'D', 'E', 'F'].map((c) => num(b, `${c}${r}`) ?? 0)]));
  const methods = Object.fromEntries(rows(113, 115).map((r) => [str(b, `B${r}`)!, { ohMin: num(b, `C${r}`), ohMax: num(b, `D${r}`), oh: num(b, `E${r}`)!, feeMin: num(b, `F${r}`), feeMax: num(b, `G${r}`), fee: num(b, `H${r}`)! }]));
  const aace = Object.fromEntries(rows(120, 124).map((r) => [str(b, `B${r}`)!, ['F', 'G', 'H', 'I'].map((c) => num(b, `${c}${r}`)!)]));
  const confidence = Object.fromEntries(rows(49, 51).map((r) => [str(b, `B${r}`)!, num(b, `C${r}`)!]));

  const basis = {
    version: COST_BASIS_VERSION,
    source: { file, sha256: createHash('sha256').update(buf).digest('hex') },
    priceYear: num(p, 'C29')!,
    currency: str(p, 'D29')!,
    sizePoints,
    asil,
    reuse,
    overall,
    pert: { optimistic: num(b, 'C44')!, pessimisticSlope: num(b, 'C45')! },
    variantCoef: num(b, 'C46')!,
    confidence,
    cocomo,
    presets,
    rates: { roles, kosa, engineeringDaily, daysPerMonth: num(b, 'C83')! },
    phases,
    roleComposition,
    methods,
    aace,
    commonPct: { pm: num(b, 'C129')!, scm: num(b, 'C130')!, pi: num(b, 'C131')! },
    benchmark: { anchorEur: num(p, 'C23')!, euRate: num(p, 'C24')!, hoursPerPm: num(p, 'C25')!, fx: num(p, 'C26')! },
    currencies: { KRW: 1, EUR: num(p, 'C26')! },
    vat: num(p, 'C19')!,
    mbd: {
      multipliers: rows(7, 11).map((r) => num(m, `Q${r}`)!),
      baseY: num(m, 'Q13'),
      tasks: rows(17, 35).map((r) => ({ phase: str(m, `P${r}`)!, task: str(m, `Q${r}`)!, y: num(m, `S${r}`) })),
    },
    calibration: { singles: rows(7, 23).map((r) => str(k, `B${r}`)).filter((x): x is string => !!x), bundles: rows(27, 30).map((r) => str(k, `B${r}`)).filter((x): x is string => !!x) },
    directExpenseItems: rows(62, 69).map((r) => ({ item: str(p, `B${r}`)!, unit: str(p, `D${r}`) ?? '' })),
    checklist: rows(7, 44)
      .filter((r) => num(c, `B${r}`) != null)
      .map((r) => ({ no: num(c, `B${r}`)!, category: str(c, `C${r}`)!, item: str(c, `D${r}`)!, method: str(c, `E${r}`) ?? '', source: str(c, `F${r}`) ?? '', purchaseKey: str(c, `I${r}`) === '●' })),
  };
  return CostBasis.parse(basis);
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!);
if (isMain) {
  const src = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!src) {
    console.error('사용법: npm run cost:basis -- <Automotive_SW_개발비_산정도구_FeatureDB_v1.3.xlsx>');
    process.exit(2);
  }
  const out = join(FF, 'data', 'reference', 'cost-basis');
  mkdirSync(out, { recursive: true });
  const basis = importCostBasis(readFileSync(src), basename(src));
  writeFileSync(join(out, `${COST_BASIS_VERSION}.json`), JSON.stringify(basis, null, 2) + '\n');
  console.log(`cost:basis ${COST_BASIS_VERSION} → data/reference/cost-basis/${COST_BASIS_VERSION}.json · 역할 ${basis.rates.roles.length} · 드라이버 ${Object.keys(basis.cocomo).length} · 프리셋 ${Object.keys(basis.presets).length} · 교정 표본 ${basis.calibration.singles.length}+${basis.calibration.bundles.length}`);
}
