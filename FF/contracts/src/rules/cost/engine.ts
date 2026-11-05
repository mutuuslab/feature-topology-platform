// 개발비 산정 계산 엔진(20-94 §6) — 엑셀 산정 도구 v1.3의 수식을 같은 연산 순서로 옮긴 순수 함수.
// 줄 = Feature DB 기준 행 하나(03_FeatureDB 한 행). 과제 집계는 01_대시보드·02_프로젝트설정, MBD는 12, 교정은 06과 같다.
// 기준값 시험(engine.golden.test.ts)이 엑셀을 다시 계산한 시나리오 4개와 금액 1원·공수 상대 1e-9 안에서 맞춘다.
import type { CostBasis } from './basis';
import { asilFactor, nominalPoints, sizePoints } from '../refdb/size';

/** 계산에 쓰는 기준 행 사실(Feature DB) — ord는 엑셀 행 순서(합계 순서를 엑셀과 같게) */
export interface CostRefFacts {
  refId: string;
  ord: number;
  tshirt: string;
  asilRep: string;
  lifecycle: string;
  autoQuality: string;
  benchmarkEur: number | null;
  bundleId: string | null;
  bundleRep: boolean;
  sizeEvidenceGrade: string | null;
  duplicateOf: string | null;
  requires: string[];
}

/** 줄 입력 — 엑셀 03_FeatureDB AF~AO열 */
export interface CostLineInput {
  refId: string;
  qty?: number | null;
  changeType?: string | null;
  asil?: string | null;
  variants?: number | null;
  m?: number | null;
  o?: number | null;
  p?: number | null;
  owned?: string | null;
  actual?: number | null;
}

/** MBD 복잡도 작업 단위 — 엑셀 12_MBD복잡도 한 행(복잡도 5등급별 작업 수) */
export interface CostMbdItem {
  refId: string;
  counts: (number | null)[];
}

export const DIRECT_PRESET = '직접 설정';
export const RATE_BASES = ['KOSA SW기술자 평균임금', '엔지니어링 노임단가', '사내 단가'] as const;
export type RateBasis = (typeof RATE_BASES)[number];

/** 공통 인력(02 5절) — PM·설비·개선은 켜고 끄기, QA·기능안전·사이버보안·HIL은 M/M 직접 입력 */
export const COMMON_ROLES = { qa: '품질(QA) 엔지니어', fs: '기능안전 엔지니어', cs: '사이버보안 엔지니어', hil: '시험 엔지니어' } as const;

export interface CostSettings {
  aace: string;
  confidence: string;
  preset: string;
  /** 드라이버 → 직접 설정 등급 */
  drivers: Record<string, string | null>;
  rateBasis: RateBasis;
  method: string;
  ohOverride: number | null;
  feeOverride: number | null;
  common: { pm: boolean; scm: boolean; pi: boolean; qa: number | null; fs: number | null; cs: number | null; hil: number | null };
  directExpenses: { qty: number | null; unitPrice: number | null }[];
}

export type CostPath = '직접 입력' | 'MBD 복잡도' | 'T-shirt';

export interface CostLineResult {
  refId: string;
  overall: number;
  points: number;
  nominal: number;
  repAsilF: number;
  bundleIncluded: 0 | 1;
  effQty: number;
  asilF: number;
  aam: number;
  variantF: number;
  path: CostPath | null;
  m: number;
  o: number;
  p: number;
  e: number;
  variance: number;
  laborKrw: number;
  benchEur: number;
  check: string;
  mre: number | null;
  prereqCheck: string;
  baseEffort: number;
}

const N = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const blank = (x: unknown) => x == null || x === '';

// ── 계수 표에서 나오는 값 ─────────────────────────────────────────────

/** 규모 파생 값(T·BH·U)은 Feature DB와 같은 함수(rules/refdb/size.ts)로 — 표는 과제가 고정한 계수 표 */
const sizeTables = (basis: CostBasis) => ({ points: basis.sizePoints, asil: basis.asil });

export const costAsilFactor = (basis: CostBasis, asil: string): number => {
  const f = asilFactor(asil, sizeTables(basis));
  if (f == null) throw new Error(`계수 표에 ASIL '${asil}'이 없습니다`);
  return f;
};

const costPoints = (basis: CostBasis, tshirt: string): number => {
  const p = sizePoints(tshirt, sizeTables(basis));
  if (p == null) throw new Error(`계수 표에 T-shirt 등급 '${tshirt}'이 없습니다`);
  return p;
};

/** COCOMO 재사용 모델 — AAF = 0.4·DM + 0.3·CM + 0.3·IM, AAM = AAF ≤ 50이면 (AA + AAF(1 + 0.02·SU·UNFM))/100, 아니면 (AA + AAF + SU·UNFM)/100 */
export function aamOf(basis: CostBasis, changeType: string): number {
  const r = basis.reuse.find((x) => x.changeType === changeType);
  if (!r) throw new Error(`계수 표에 변경 유형 '${changeType}'이 없습니다`);
  const aaf = 0.4 * r.dm + 0.3 * r.cm + 0.3 * r.im;
  return aaf <= 50 ? (r.aa + aaf * (1 + 0.02 * r.su * r.unfm)) / 100 : (r.aa + aaf + r.su * r.unfm) / 100;
}

export const mmPerPoint = (basis: CostBasis): number => basis.benchmark.anchorEur / (basis.benchmark.euRate * basis.benchmark.hoursPerPm);

/** 드라이버별 적용 등급·승수와 EAF(곱) — 정의 없는 등급은 1.00 */
export function projectFactors(basis: CostBasis, s: Pick<CostSettings, 'preset' | 'drivers'>) {
  const drivers = Object.entries(basis.cocomo).map(([driver, row]) => {
    const direct = s.drivers[driver] ?? null;
    const applied = s.preset === DIRECT_PRESET ? direct : basis.presets[s.preset]?.[driver] ?? direct;
    const x = applied ? (row as unknown as Record<string, number | null>)[applied] : null;
    return { driver, applied, multiplier: typeof x === 'number' && x !== 0 ? x : 1 };
  });
  let eaf = 1;
  for (const d of drivers) eaf *= d.multiplier;
  return { drivers, eaf };
}

/** 역할별 적용 월단가(05 G절 I열) */
export function roleRates(basis: CostBasis, rateBasis: RateBasis): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of basis.rates.roles) {
    const eng = basis.rates.engineeringDaily[r.engineeringGrade] * basis.rates.daysPerMonth;
    const kosa = basis.rates.kosa[r.kosaJob]?.monthly;
    if (kosa === undefined) throw new Error(`계수 표에 KOSA 직무 '${r.kosaJob}'이 없습니다`);
    out[r.role] = rateBasis === '엔지니어링 노임단가' ? eng : rateBasis === '사내 단가' && N(r.inhouseMonthly) > 0 ? r.inhouseMonthly! : kosa;
  }
  return out;
}

/** 공정 비중 × 역할 구성비 → 역할 가중치, Σ 가중치 × 단가 → 가중 평균 월단가(05 I절) */
export function blendedRate(basis: CostBasis, rates: Record<string, number>) {
  const weights: Record<string, number> = {};
  let sum = 0;
  for (const r of basis.rates.roles) {
    const comp = basis.roleComposition[r.role] ?? [];
    let w = 0;
    basis.phases.forEach((ph, i) => (w = i === 0 ? ph.share * N(comp[i]) : w + ph.share * N(comp[i])));
    weights[r.role] = w;
    sum += w * rates[r.role];
  }
  return { weights, blended: sum };
}

/** 12_MBD복잡도 등급별 합계 시간 — 작업별 y가 없으면 공통 기준값 y */
export function mbdHours(basis: CostBasis): number[] {
  const y = N(basis.mbd.baseY);
  const ys = basis.mbd.tasks.map((t) => (N(t.y) > 0 ? t.y! : y));
  const given = basis.mbd.tasks.filter((t) => N(t.y) > 0);
  const vs = given.reduce((s, t) => s + t.y!, 0) + (basis.mbd.tasks.length - given.length) * y;
  return [vs, ...basis.mbd.multipliers.slice(1).map((mult) => ys.reduce((s, yi) => s + yi * mult, 0))];
}

export const mbdItemMm = (basis: CostBasis, hours: number[], item: CostMbdItem): number => {
  if (hours[0] === 0) return 0;
  let h = 0;
  item.counts.forEach((c, i) => (h += N(c) * hours[i]));
  return h / basis.benchmark.hoursPerPm;
};

// ── 줄 계산 (03_FeatureDB) ─────────────────────────────────────────

export interface CostEstimateInput {
  basis: CostBasis;
  settings: CostSettings;
  lines: CostLineInput[];
  mbd: CostMbdItem[];
  refs: Map<string, CostRefFacts>;
}

export function estimate(input: CostEstimateInput) {
  const { basis, settings, refs } = input;
  const fact = (id: string) => {
    const f = refs.get(id);
    if (!f) throw new Error(`Feature DB에 ${id}이(가) 없습니다`);
    return f;
  };
  const lines = [...input.lines].sort((a, b) => fact(a.refId).ord - fact(b.refId).ord);
  const { drivers, eaf } = projectFactors(basis, settings);
  const mmPt = mmPerPoint(basis);
  const rates = roleRates(basis, settings.rateBasis);
  const { weights, blended } = blendedRate(basis, rates);
  const hours = mbdHours(basis);
  const mbdOf = new Map<string, number>();
  const mbdItems = input.mbd.map((it) => ({ refId: it.refId, mm: mbdItemMm(basis, hours, it) }));
  for (const it of mbdItems) mbdOf.set(it.refId, (mbdOf.get(it.refId) ?? 0) + it.mm);
  const anchor = basis.benchmark.anchorEur;
  // 같은 기준 행을 서로 다른 FF Feature가 참조하면 줄이 둘 — 선택 수량은 합친다
  const selectedQty = new Map<string, number>();
  for (const l of lines) selectedQty.set(l.refId, (selectedQty.get(l.refId) ?? 0) + N(l.qty));

  const rows: CostLineResult[] = lines.map((l) => {
    const r = fact(l.refId);
    const overall = basis.overall.base + basis.overall.lifecycle[r.lifecycle] + basis.overall.quality[r.autoQuality];
    const points = costPoints(basis, r.tshirt);
    const repAsilF = costAsilFactor(basis, r.asilRep);
    const nominal = nominalPoints(r, anchor, sizeTables(basis))!;
    const included = r.bundleId && !r.bundleRep && lines.some((x) => fact(x.refId).bundleId === r.bundleId && fact(x.refId).bundleRep && N(x.qty) > 0) ? 1 : 0;
    const effQty = included === 1 ? 0 : N(l.qty);
    const asilF = costAsilFactor(basis, blank(l.asil) ? r.asilRep : l.asil!);
    const aam = aamOf(basis, blank(l.changeType) ? '신규 개발' : l.changeType!);
    const variantF = 1 + basis.variantCoef * (Math.max(1, N(l.variants)) - 1);
    const mbdMm = mbdOf.get(l.refId) ?? 0;
    const path: CostPath | null = effQty === 0 ? null : N(l.m) > 0 ? '직접 입력' : mbdMm > 0 ? 'MBD 복잡도' : 'T-shirt';
    const m =
      effQty === 0 ? 0 : path === '직접 입력' ? l.m! * effQty : path === 'MBD 복잡도' ? mbdMm * asilF * variantF * eaf * effQty : nominal * mmPt * asilF * aam * variantF * eaf * effQty;
    const o = N(l.m) > 0 && N(l.o) > 0 ? l.o! * effQty : m * basis.pert.optimistic;
    const p = N(l.m) > 0 && N(l.p) > 0 ? l.p! * effQty : m * (1 + basis.pert.pessimisticSlope * (overall - 1));
    const e = (o + 4 * m + p) / 6;
    const variance = ((p - o) / 6) ** 2;
    const benchEur = effQty === 0 ? 0 : nominal * asilF * aam * variantF * effQty * anchor;
    return {
      refId: l.refId,
      overall,
      points,
      nominal,
      repAsilF,
      bundleIncluded: included,
      effQty,
      asilF,
      aam,
      variantF,
      path,
      m,
      o,
      p,
      e,
      variance,
      laborKrw: e * blended,
      benchEur,
      check: '',
      mre: N(l.actual) > 0 ? Math.abs(e - l.actual!) / l.actual! : null,
      prereqCheck: '',
      baseEffort: nominal * mmPt * repAsilF,
    };
  });

  // 입력 점검(BF)·선행 점검(BM) — 다른 줄의 선택 여부를 본다
  const counted = (id: string) => rows.some((x) => x.refId === id && (x.effQty > 0 || x.bundleIncluded === 1));
  lines.forEach((l, i) => {
    const row = rows[i];
    if (row.effQty === 0) return;
    const r = fact(l.refId);
    row.check =
      N(l.o) > 0 && N(l.m) === 0
        ? 'o·p는 m 직접 입력과 함께 사용'
        : N(l.o) > 0 && l.o! > N(l.m)
          ? '낙관 o가 최빈 m보다 큼'
          : N(l.p) > 0 && l.p! < N(l.m)
            ? '비관 p가 최빈 m보다 작음'
            : l.owned === '보유' && l.changeType === '신규 개발'
              ? '보유 기능인데 신규 개발로 지정'
              : r.duplicateOf && (N(selectedQty.get(r.duplicateOf)) > 0 || dupBundleSelected(r.duplicateOf))
                ? `중복 가능: ${r.duplicateOf} 범위와 겹침(P열 메모)`
                : '';
    if (r.requires.length) {
      const missing = r.requires.filter((id) => !counted(id)).length;
      if (missing > 0) row.prereqCheck = `선행 누락 ${missing}건: ${r.requires.join(';')} 확인`;
    }
  });
  function dupBundleSelected(dupId: string) {
    const b = refs.get(dupId)?.bundleId;
    return !!b && lines.some((x) => fact(x.refId).bundleId === b && fact(x.refId).bundleRep && N(x.qty) > 0);
  }

  // ── 과제 집계 (01_대시보드·02_프로젝트설정) ───────────────────────
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const eFeat = sum(rows.map((x) => x.e));
  const mFeat = sum(rows.map((x) => x.m));
  const sd = Math.sqrt(sum(rows.map((x) => x.variance)));
  const cv = eFeat > 0 ? sd / eFeat : 0;
  const z = basis.confidence[settings.confidence];
  if (z === undefined) throw new Error(`계수 표에 신뢰수준 '${settings.confidence}'이 없습니다`);
  const method = basis.methods[settings.method];
  if (!method) throw new Error(`계수 표에 대가 산정 방식 '${settings.method}'이 없습니다`);
  const oh = settings.ohOverride ?? method.oh;
  const fee = settings.feeOverride ?? method.fee;

  const c = settings.common;
  const scmMm = c.scm ? basis.commonPct.scm * eFeat : 0;
  const piMm = c.pi ? basis.commonPct.pi * eFeat : 0;
  const qa = N(c.qa), fs = N(c.fs), cs = N(c.cs), hil = N(c.hil);
  const pmPct = basis.commonPct.pm;
  const pmMm = c.pm ? (pmPct / (1 - pmPct)) * (eFeat + (scmMm + piMm) + (qa + fs + cs + hil)) : 0;
  const pmRole = basis.rates.roles[0].role;
  const common = [
    { item: 'pm', mm: pmMm, rate: rates[pmRole] },
    { item: 'scm', mm: scmMm, rate: blended },
    { item: 'pi', mm: piMm, rate: blended },
    { item: 'qa', mm: qa, rate: rates[COMMON_ROLES.qa] },
    { item: 'fs', mm: fs, rate: rates[COMMON_ROLES.fs] },
    { item: 'cs', mm: cs, rate: rates[COMMON_ROLES.cs] },
    { item: 'hil', mm: hil, rate: rates[COMMON_ROLES.hil] },
  ].map((x) => ({ ...x, krw: x.mm * x.rate }));
  const commonMm = sum(common.map((x) => x.mm));
  const commonKrw = sum(common.map((x) => x.krw));
  const directKrw = sum(settings.directExpenses.map((d) => N(d.qty) * N(d.unitPrice)));

  // 원가 구성표(01 13~29행): Feature → 설비 → 개선 → QA → 기능안전 → 사이버보안 → HIL → PM 순
  const labor = sum(rows.map((x) => x.laborKrw));
  const order = [common[1], common[2], common[3], common[4], common[5], common[6], common[0]];
  const totalMm = sum([eFeat, ...order.map((x) => x.mm)]);
  const laborKrw = sum([labor, ...order.map((x) => x.krw)]);
  const overheadKrw = laborKrw * oh;
  const feeKrw = (laborKrw + overheadKrw) * fee;
  const baseCost = sum([laborKrw, overheadKrw, feeKrw, directKrw]);
  const reserveKrw = (laborKrw + overheadKrw + feeKrw) * z * cv;
  const totalCost = baseCost + reserveKrw;
  const vatKrw = totalCost * basis.vat;

  const confidenceTable = Object.entries(basis.confidence).map(([level, zz]) => {
    const amount = baseCost + (laborKrw + overheadKrw + feeKrw) * zz * cv;
    return { level, z: zz, amount, vsBase: baseCost > 0 ? amount / baseCost - 1 : 0 };
  });
  const range = basis.aace[settings.aace];
  if (!range) throw new Error(`계수 표에 AACE 등급 '${settings.aace}'이 없습니다`);
  const aaceRange = range.map((r) => ({ ratio: r, amount: totalCost * (1 + r) }));

  const benchEur = sum(rows.map((x) => x.benchEur));
  const benchKrw = benchEur * basis.benchmark.fx;
  const compareKrw = laborKrw + overheadKrw + feeKrw;

  const sel = rows.filter((x) => x.effQty > 0);
  const mres = sel.filter((x) => x.mre != null && x.mre >= 0);
  const share = (g: string) => (eFeat > 0 ? sum(rows.filter((x) => fact(x.refId).sizeEvidenceGrade?.startsWith(g)).map((x) => x.e)) / eFeat : 0);

  return {
    lines: rows,
    mbdItems,
    factors: { drivers, eaf, mmPerPt: mmPt, oh, fee, ohDefault: method.oh, feeDefault: method.fee, roleRates: rates, roleWeights: weights, blendedRate: blended, mbdHours: hours },
    common: { rows: common, mm: commonMm, krw: commonKrw },
    totals: { eFeat, mFeat, sd, cv, z, totalMm, laborKrw, overheadKrw, feeKrw, directKrw, baseCost, reserveKrw, totalCost, vatKrw, totalWithVat: totalCost + vatKrw },
    confidenceTable,
    aaceRange,
    benchmark: {
      eur: benchEur,
      krw: benchKrw,
      compareKrw,
      gap: benchKrw > 0 ? compareKrw / benchKrw - 1 : 0,
      rateRatio: (blended * (1 + oh) * (1 + fee)) / (basis.benchmark.euRate * basis.benchmark.hoursPerPm * basis.benchmark.fx),
    },
    counts: {
      selected: sel.length,
      bundleIncluded: rows.filter((x) => x.bundleIncluded === 1 && N(selectedQty.get(x.refId)) > 0).length,
      commonMissing: [c.qa, c.fs, c.cs, c.hil].filter((x) => x === 0).length,
      notOwned: lines.filter((l, i) => l.owned === '미보유' && rows[i].effQty > 0).length,
      checks: rows.filter((x) => x.check !== '' || x.prereqCheck !== '').length,
      actuals: mres.length,
      mreAvg: mres.length ? sum(mres.map((x) => x.mre!)) / mres.length : 0,
      direct: rows.filter((x) => x.path === '직접 입력').length,
      mbd: rows.filter((x) => x.path === 'MBD 복잡도').length,
      tshirt: rows.filter((x) => x.path === 'T-shirt').length,
    },
    sizeEvidenceShare: { A: share('A'), B: share('B'), C: share('C'), D: share('D') },
    effortRatio: mFeat > 0 ? eFeat / mFeat : 1,
  };
}

export type CostEstimate = ReturnType<typeof estimate>;

/** 06_교정 — 포인트당 € 제안값 = exp(평균 ln(€ ÷ Σ(등급 포인트 × 대표 ASIL 계수))), 단일 표본 + 번들 */
export interface CostAnchorSample { kind: 'single' | 'bundle'; id: string; eur: number; ptsAsil: number; eurPerPt: number }

/** 06_교정 표본. 잘못된 표본으로 NaN 제안을 만들지 않는다. */
export function anchorSamples(basis: CostBasis, refs: Iterable<CostRefFacts>): CostAnchorSample[] {
  const all = [...refs];
  const ptsAsil = (r: CostRefFacts) => costPoints(basis, r.tshirt) * costAsilFactor(basis, r.asilRep);
  const samples: CostAnchorSample[] = [];
  const add = (kind: CostAnchorSample['kind'], id: string, eur: number, pts: number) => {
    const eurPerPt = eur / pts;
    if (!(eur > 0) || !(pts > 0) || !(eurPerPt > 0) || !Number.isFinite(eur) || !Number.isFinite(pts) || !Number.isFinite(eurPerPt)) throw new Error(`교정 표본 ${id}의 금액·포인트는 양수여야 합니다`);
    samples.push({ kind, id, eur, ptsAsil: pts, eurPerPt });
  };
  for (const id of basis.calibration.singles) {
    const r = all.find((x) => x.refId === id);
    if (!r || !N(r.benchmarkEur)) throw new Error(`교정 표본 ${id}에 벤치마크 €가 없습니다`);
    add('single', id, r.benchmarkEur!, ptsAsil(r));
  }
  for (const b of basis.calibration.bundles) {
    const members = all.filter((x) => x.bundleId === b);
    const eur = members.filter((x) => x.bundleRep).reduce((s, x) => s + N(x.benchmarkEur), 0);
    const pts = members.reduce((s, x) => s + ptsAsil(x), 0);
    add('bundle', b, eur, pts);
  }
  if (!samples.length) throw new Error('교정 표본이 없습니다');
  return samples;
}

export function anchorSuggestion(basis: CostBasis, refs: Iterable<CostRefFacts>): number {
  const logs = anchorSamples(basis, refs).map((sample) => Math.log(sample.eurPerPt));
  return Math.exp(logs.reduce((s, x) => s + x, 0) / logs.length);
}
