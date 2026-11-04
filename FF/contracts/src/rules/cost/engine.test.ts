// 개발비 산정 엔진 — 기준값 시나리오에 없는 규칙(선행 누락·중복 가능 점검, 정의 없는 COCOMO 등급, 프리셋, 계수 표에 없는 값).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CostBasis } from './basis';
import { DIRECT_PRESET, estimate, projectFactors, type CostRefFacts, type CostSettings } from './engine';
import { ASIL_FACTOR, asilFactor, nominalPoints, SIZE_POINTS } from '../refdb/size';

const FF = join(__dirname, '..', '..', '..', '..');
const BASIS = CostBasis.parse(JSON.parse(readFileSync(join(FF, 'data', 'reference', 'cost-basis', 'v1.3.json'), 'utf8')));

const ref = (refId: string, over: Partial<CostRefFacts> = {}): CostRefFacts => ({
  refId,
  ord: 0,
  tshirt: 'S',
  asilRep: 'QM',
  lifecycle: 'Commodity',
  autoQuality: 'High',
  benchmarkEur: null,
  bundleId: null,
  bundleRep: false,
  sizeEvidenceGrade: 'D',
  duplicateOf: null,
  requires: [],
  ...over,
});
const SETTINGS: CostSettings = {
  aace: 'Class 4',
  confidence: 'P80',
  preset: DIRECT_PRESET,
  drivers: Object.fromEntries(Object.keys(BASIS.cocomo).map((k) => [k, 'N'])),
  rateBasis: 'KOSA SW기술자 평균임금',
  method: '사용자 정의',
  ohOverride: null,
  feeOverride: null,
  common: { pm: true, scm: true, pi: true, qa: 0, fs: 0, cs: 0, hil: 0 },
  directExpenses: [],
};

describe('개발비 산정 엔진 — 점검·계수 규칙', () => {
  it('선행 기준 행이 과제에 없으면 "선행 누락 n건", 담으면 사라진다(번들 포함 행도 담긴 것으로 본다)', () => {
    const refs = new Map([ref('X-A-001', { ord: 1, requires: ['X-B-001', 'X-C-001'] }), ref('X-B-001', { ord: 2 }), ref('X-C-001', { ord: 3, bundleId: 'B1' }), ref('X-D-001', { ord: 4, bundleId: 'B1', bundleRep: true })].map((r) => [r.refId, r]));
    const one = estimate({ basis: BASIS, settings: SETTINGS, refs, mbd: [], lines: [{ refId: 'X-A-001', qty: 1 }] });
    expect(one.lines[0].prereqCheck).toBe('선행 누락 2건: X-B-001;X-C-001 확인');
    // X-C-001은 대표 X-D-001이 담겨 번들 포함(0) — 그래도 선행은 채워진 것
    const all = estimate({ basis: BASIS, settings: SETTINGS, refs, mbd: [], lines: [{ refId: 'X-A-001', qty: 1 }, { refId: 'X-B-001', qty: 1 }, { refId: 'X-C-001', qty: 1 }, { refId: 'X-D-001', qty: 1 }] });
    expect(all.lines.find((l) => l.refId === 'X-C-001')!.bundleIncluded).toBe(1);
    expect(all.lines[0].prereqCheck).toBe('');
    expect(all.counts.checks).toBe(0);
  });

  it('중복 점검 기준 행이 함께 담기면 "중복 가능"', () => {
    const refs = new Map([ref('X-A-001', { ord: 1, duplicateOf: 'X-B-001' }), ref('X-B-001', { ord: 2 })].map((r) => [r.refId, r]));
    const r = estimate({ basis: BASIS, settings: SETTINGS, refs, mbd: [], lines: [{ refId: 'X-A-001', qty: 1 }, { refId: 'X-B-001', qty: 1 }] });
    expect(r.lines[0].check).toBe('중복 가능: X-B-001 범위와 겹침(P열 메모)');
  });

  it('정의 없는 COCOMO 등급은 1.00, 프리셋을 고르면 직접 설정 등급 대신 프리셋 등급', () => {
    const undefinedRating = projectFactors(BASIS, { preset: DIRECT_PRESET, drivers: { ...SETTINGS.drivers, TIME: 'VL' } });
    expect(BASIS.cocomo.TIME.VL).toBeNull();
    expect(undefinedRating.drivers.find((d) => d.driver === 'TIME')!.multiplier).toBe(1);
    const name = Object.keys(BASIS.presets)[0];
    const preset = projectFactors(BASIS, { preset: name, drivers: SETTINGS.drivers });
    for (const d of preset.drivers) expect(d.applied).toBe(BASIS.presets[name][d.driver] ?? 'N');
  });

  it('계수 표에 없는 ASIL·변경 유형·신뢰수준·방식은 조용히 넘기지 않는다', () => {
    const refs = new Map([ref('X-A-001')].map((r) => [r.refId, r]));
    const run = (line: object, s: Partial<CostSettings> = {}) => () => estimate({ basis: BASIS, settings: { ...SETTINGS, ...s }, refs, mbd: [], lines: [{ refId: 'X-A-001', qty: 1, ...line }] });
    expect(run({ asil: 'E' })).toThrow(/ASIL 'E'/);
    expect(run({ changeType: '전면 재작성' })).toThrow(/변경 유형/);
    expect(run({}, { confidence: 'P95' })).toThrow(/신뢰수준/);
    expect(run({}, { method: '모름' })).toThrow(/대가 산정 방식/);
    expect(() => estimate({ basis: BASIS, settings: SETTINGS, refs, mbd: [], lines: [{ refId: 'NOPE-X-001', qty: 1 }] })).toThrow(/Feature DB/);
  });

  it('규모 파생 값은 Feature DB와 같은 함수 — 기본 표(SIZE_POINTS·ASIL_FACTOR)가 계수 표 v1.3과 같다', () => {
    expect(SIZE_POINTS).toEqual(BASIS.sizePoints);
    const tables = { points: BASIS.sizePoints, asil: BASIS.asil };
    for (const a of Object.keys(BASIS.asil)) expect(asilFactor(a, tables)).toBe(ASIL_FACTOR[a as keyof typeof ASIL_FACTOR]);
    // 계수 표를 바꾸면 산정은 그 표를 쓴다(Feature DB 화면의 기본 표와 무관)
    const doubled = { points: { ...BASIS.sizePoints, S: 6 }, asil: BASIS.asil };
    expect(nominalPoints({ tshirt: 'S', asilRep: 'QM', benchmarkEur: null }, 10_000, doubled)).toBe(6);
    const r = estimate({ basis: { ...BASIS, sizePoints: doubled.points }, settings: SETTINGS, refs: new Map([['X-1', ref('X-1')]]), lines: [{ refId: 'X-1', qty: 1, changeType: '신규 개발' }], mbd: [] });
    expect(r.lines[0].points).toBe(6);
  });
});
