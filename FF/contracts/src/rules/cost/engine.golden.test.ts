// 개발비 산정 엔진 기준값 시험(20-94 §10, D-COST-3) — 엑셀 산정 도구 v1.3을 다시 계산한 시나리오 4개(data/golden/cost)와 맞춘다.
// 금액은 |차이| < 1원, 공수·계수는 상대 오차 1e-9 이하. 줄별로 대조해 어느 계수에서 어긋나는지 바로 보이게 한다.
// 기준값을 다시 뽑는 법: tools/cost/excel-golden.ps1 (Windows + Excel, 시나리오는 tools/cost/golden-scenarios.json).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CostBasis } from './basis';
import { anchorSuggestion, estimate, type CostLineInput, type CostRefFacts, type CostSettings, type RateBasis } from './engine';

const FF = join(__dirname, '..', '..', '..', '..');
const read = (...p: string[]) => JSON.parse(readFileSync(join(FF, ...p), 'utf8'));
const BASIS = CostBasis.parse(read('data', 'reference', 'cost-basis', 'v1.3.json'));
const REFS: CostRefFacts[] = (read('data', 'reference', 'feature-db', 'v1.3', 'refs.json') as any[]).map((r, ord) => ({
  refId: r.refId,
  ord,
  tshirt: r.tshirt,
  asilRep: r.asilRep,
  lifecycle: r.lifecycle,
  autoQuality: r.autoQuality,
  benchmarkEur: r.benchmarkEur ?? null,
  bundleId: r.bundleId || null,
  bundleRep: !!r.bundleRep,
  sizeEvidenceGrade: r.sizeEvidenceGrade || null,
  duplicateOf: r.duplicateOf || null,
  requires: r.requires ?? [],
}));
const REF_MAP = new Map(REFS.map((r) => [r.refId, r]));
const GOLDEN_DIR = join(FF, 'data', 'golden', 'cost');
const SCENARIOS = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json')).sort();

const MONEY = 1; // 원
const REL = 1e-9;
const near = (actual: number, expected: number, what: string, money = false) => {
  const diff = Math.abs(actual - expected);
  const ok = money ? diff < MONEY : diff <= REL * Math.max(1, Math.abs(expected));
  expect(ok, `${what}: 엔진 ${actual} ≠ 엑셀 ${expected} (차이 ${diff})`).toBe(true);
};
const s = (v: unknown) => (v == null ? '' : String(v));

/** 기준값 JSON(엑셀 칸 값) → 엔진 입력 */
function inputOf(g: any) {
  const st = g.settings;
  const basis: CostBasis = {
    ...BASIS,
    // 시나리오가 바꾼 조직 기준값(사내 단가·MBD 기준 y)은 계수 표에 반영한다
    rates: { ...BASIS.rates, roles: BASIS.rates.roles.map((r) => ({ ...r, inhouseMonthly: st.inhouseRates[r.role] ?? null })) },
    mbd: { ...BASIS.mbd, baseY: st.mbdBaseY ?? null, tasks: BASIS.mbd.tasks.map((t, i) => ({ ...t, y: st.mbdTaskY[i] ?? null })) },
  };
  const com = st.common as { input: unknown }[];
  const settings: CostSettings = {
    aace: st.aace,
    confidence: st.confidence,
    preset: st.preset,
    drivers: Object.fromEntries(Object.entries(st.drivers as Record<string, { direct: string | null }>).map(([k, v]) => [k, v.direct])),
    rateBasis: st.rateBasis as RateBasis,
    method: st.method,
    ohOverride: st.ohOverride,
    feeOverride: st.feeOverride,
    common: { pm: com[0].input === 'Y', scm: com[1].input === 'Y', pi: com[2].input === 'Y', qa: com[3].input as number | null, fs: com[4].input as number | null, cs: com[5].input as number | null, hil: com[6].input as number | null },
    directExpenses: (st.directExpenses as { qty: number | null; unitPrice: number | null }[]).map((d) => ({ qty: d.qty, unitPrice: d.unitPrice })),
  };
  const lines: CostLineInput[] = g.lines.map((l: any) => ({ refId: l.refId, ...l.inputs }));
  return { basis, settings, lines, mbd: g.mbd.map((m: any) => ({ refId: m.refId, counts: m.counts })), refs: REF_MAP };
}

describe('개발비 산정 엔진 — 엑셀 산정 도구 v1.3 기준값', () => {
  it('기준값 시나리오가 4개 있다(예시 과제·계산 경로·과제 설정·사내 단가)', () => {
    expect(SCENARIOS).toEqual(['s0-bcm-example.json', 's1-paths.json', 's2-settings.json', 's3-inhouse.json']);
  });

  for (const file of SCENARIOS) {
    const g = JSON.parse(readFileSync(join(GOLDEN_DIR, file), 'utf8'));
    describe(`${g.scenario} — ${g.what}`, () => {
      const r = estimate(inputOf(g));
      const x = g.excel;
      const d = x.dashboard;

      it('계수: EAF·포인트당 공수·제경비·기술료·역할 단가·가중 평균 월단가·AAM·MBD 시간', () => {
        near(r.factors.eaf, x.eaf, 'EAF');
        near(r.factors.mmPerPt, x.mmPerPt, '포인트당 공수');
        near(r.factors.ohDefault, x.ohDefault, '제경비 기본');
        near(r.factors.feeDefault, x.feeDefault, '기술료 기본');
        near(r.factors.oh, x.oh, '제경비 적용');
        near(r.factors.fee, x.fee, '기술료 적용');
        for (const [role, rate] of Object.entries(x.roleRates as Record<string, number>)) near(r.factors.roleRates[role], rate, `단가 ${role}`, true);
        for (const [role, w] of Object.entries(x.roleWeights as Record<string, number>)) near(r.factors.roleWeights[role], w, `가중치 ${role}`);
        near(r.factors.blendedRate, x.blendedRate, '가중 평균 월단가', true);
        for (const dr of r.factors.drivers) near(dr.multiplier, g.settings.drivers[dr.driver].multiplier, `승수 ${dr.driver}`);
        x.mbdHours.forEach((h: number, i: number) => near(r.factors.mbdHours[i], h, `MBD 시간 ${i}`));
      });

      it('줄마다 Overall·포인트·ASIL·재사용·변형·경로·m·o·p·E·분산·인건비·벤치마크·점검·MRE가 엑셀과 같다', () => {
        expect(r.lines.map((l) => l.refId).sort()).toEqual(g.lines.map((l: any) => l.refId).sort());
        for (const gl of g.lines) {
          const l = r.lines.find((y) => y.refId === gl.refId)!;
          const e = gl.excel;
          const w = (k: string) => `${gl.refId} ${k}`;
          near(l.overall, e.overall, w('Overall'));
          near(l.points, e.points, w('포인트'));
          near(l.nominal, e.nominal, w('명목 포인트'));
          near(l.repAsilF, e.repAsilF, w('대표 ASIL 계수'));
          expect(l.bundleIncluded, w('번들 포함')).toBe(e.bundleIncluded);
          near(l.effQty, e.effQty, w('유효 수량'));
          near(l.asilF, e.asilF, w('ASIL 계수'));
          near(l.aam, e.aam, w('AAM'));
          near(l.variantF, e.variantF, w('변형 계수'));
          expect(s(l.path), w('산정 경로')).toBe(s(e.path));
          near(l.m, e.m, w('m'));
          near(l.o, e.o, w('o'));
          near(l.p, e.p, w('p'));
          near(l.e, e.e, w('E'));
          near(l.variance, e.variance, w('분산'));
          near(l.laborKrw, e.laborKrw, w('직접인건비'), true);
          near(l.benchEur, e.benchEur, w('벤치마크 €'), true);
          near(l.baseEffort, e.baseEffort, w('신규 개발 기준 공수'));
          expect(l.check, w('입력 점검')).toBe(s(e.check));
          expect(l.prereqCheck, w('선행 점검')).toBe(s(e.prereqCheck));
          if (e.mre == null) expect(l.mre, w('MRE')).toBeNull();
          else near(l.mre!, e.mre, w('MRE'));
        }
        for (const [i, it] of (g.mbd as any[]).entries()) near(r.mbdItems[i].mm, it.excelMm, `MBD 행 ${i + 1} ${it.refId}`);
      });

      it('원가 구성·총개발비·VAT — 01_대시보드 13~29행', () => {
        near(r.totals.eFeat, d.E13, 'Feature 공수');
        near(r.totals.totalMm, d.E21, '총 공수');
        near(r.totals.laborKrw, d.F21, '직접인건비 합계', true);
        near(r.totals.overheadKrw, d.F22, '제경비', true);
        near(r.totals.feeKrw, d.F23, '기술료', true);
        near(r.totals.directKrw, d.F24, '직접경비', true);
        near(r.totals.baseCost, d.F25, '기댓값 원가(P50)', true);
        near(r.totals.reserveKrw, d.F26, '예비비', true);
        near(r.totals.totalCost, d.F27, '총개발비', true);
        near(r.totals.vatKrw, d.F28, 'VAT', true);
        near(r.totals.totalWithVat, d.F29, 'VAT 포함', true);
        // 공통 인력 행: 설비(14)·개선(15)·QA(16)·기능안전(17)·사이버보안(18)·HIL(19)·PM(20)
        const order = ['scm', 'pi', 'qa', 'fs', 'cs', 'hil', 'pm'];
        order.forEach((item, i) => {
          const c = r.common.rows.find((y) => y.item === item)!;
          near(c.mm, d[`E${14 + i}`], `공통 ${item} 공수`);
          near(c.krw, d[`F${14 + i}`], `공통 ${item} 금액`, true);
        });
        near(r.common.mm, x.commonMm, '공통 인력 공수');
        near(r.common.krw, x.commonKrw, '공통 인력 금액', true);
      });

      it('신뢰수준표·AACE 범위·벤치마크 대비·집계 지표', () => {
        r.confidenceTable.forEach((c, i) => {
          expect(c.level).toBe(d[`B${34 + i}`]);
          near(c.amount, d[`D${34 + i}`], `${c.level} 금액`, true);
          near(c.vsBase, d[`E${34 + i}`], `${c.level} 기댓값 대비`);
        });
        r.aaceRange.forEach((a, i) => {
          near(a.ratio, d[`H${34 + i}`], `AACE 비율 ${i}`);
          near(a.amount, d[`I${34 + i}`], `AACE 금액 ${i}`, true);
        });
        near(r.benchmark.eur, d.E42, '벤치마크 €', true);
        near(r.benchmark.krw, d.E43, '벤치마크 원화', true);
        near(r.benchmark.compareKrw, d.E44, '비교 대상', true);
        near(r.benchmark.gap, d.E45, '벤치마크 대비');
        near(r.benchmark.rateRatio, d.L42, '단가 비율');
        near(r.effortRatio, d.L44, 'E/m');
        near(r.totals.sd, d.E88, 'σ');
        near(r.totals.cv, d.E89, 'σ/E');
        near(r.totals.z, d.E90, 'z');
        expect(r.counts.selected, '선택 수').toBe(d.E91);
        expect(r.counts.bundleIncluded, '번들 포함 수').toBe(d.E92);
        expect(r.counts.commonMissing, '공통 인력 미입력').toBe(d.E94);
        near(r.totals.mFeat, d.E97, 'Σ m');
        expect(r.counts.notOwned).toBe(d.E98);
        expect(r.counts.checks, '점검 메시지 수').toBe(d.E99);
        expect(r.counts.actuals).toBe(d.E100);
        near(r.counts.mreAvg, d.E101, 'MRE 평균');
        expect([r.counts.direct, r.counts.mbd, r.counts.tshirt], '경로별 수').toEqual([d.E102, d.E103, d.E104]);
        (['A', 'B', 'C', 'D'] as const).forEach((k, i) => near(r.sizeEvidenceShare[k], d[`E${106 + i}`], `규모 근거 ${k} 비중`));
      });

      it('06_교정 포인트당 € 제안값', () => {
        near(anchorSuggestion(BASIS, REFS), x.anchorSuggest, '제안값');
      });
    });
  }
});
