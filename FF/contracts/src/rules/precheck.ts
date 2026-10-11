// DATA-PRECHECK-1.0 (16 규칙) + 데이터 품질 점검(DQ) — 데이터셋 전체에 대한 순수 함수.
// 규칙 정의 원문은 DATASET v0.81 'DATA-PRECHECK' 시트. 프론트(사전점검 화면)·백엔드(GET /api/precheck)·골든 테스트가 공용.
import type { Lifecycle } from '../enums';
import type { Dataset, DependencyRow, FeatureVersionRow } from '../schemas/dataset';

export type CheckResult = 'PASS' | 'CONDITIONAL' | 'FAIL';
export interface Finding {
  key: string;
  result: Exclude<CheckResult, 'PASS'>;
  message: string;
}
export interface RuleOutcome {
  ruleId: string;
  title: string;
  result: CheckResult;
  summary: string;
  /** PASS 외 판정 대상 — 화면에서 행 단위로 보여 준다 */
  findings: Finding[];
}

const RANK: Record<Lifecycle, number> = { PROPOSED: 0, APPROVED: 1, DEVELOPING: 2, VERIFIED: 3, RELEASED: 4, DEPRECATED: 4, RETIRED: 4 };
const fv = (id: string, v: string | null) => `${id}@${v ?? '?'}`;

function worst(findings: Finding[]): CheckResult {
  if (findings.some((f) => f.result === 'FAIL')) return 'FAIL';
  return findings.length ? 'CONDITIONAL' : 'PASS';
}

function outcome(ruleId: string, title: string, findings: Finding[], summary: string): RuleOutcome {
  return { ruleId, title, result: worst(findings), summary, findings };
}

/** 각 Lifecycle에서 PASS여야 하는 Gate 수와, 검토 중일 수 있는 Gate 범위 */
const GATE_EXPECT: Record<Lifecycle, { pass: number; inReview: number }> = {
  PROPOSED: { pass: 0, inReview: 0 },
  APPROVED: { pass: 3, inReview: 0 },
  DEVELOPING: { pass: 3, inReview: 4 },
  VERIFIED: { pass: 7, inReview: 2 },
  RELEASED: { pass: 9, inReview: 0 },
  DEPRECATED: { pass: 9, inReview: 0 },
  RETIRED: { pass: 9, inReview: 0 },
};

export function runPrecheck(ds: Dataset): RuleOutcome[] {
  const reg = new Map<string, FeatureVersionRow>(ds.features.map((f) => [fv(f.featureId, f.version), f]));
  const deps = ds.dependencies;
  const req = deps.filter((d) => d.type === 'REQUIRES');
  const exc = deps.filter((d) => d.type === 'EXCLUDES');
  const out: RuleOutcome[] = [];
  const P = (n: number) => `DATA-PRECHECK-1.0-${String(n).padStart(2, '0')}`;

  // 01 원천·대상 참조
  {
    const f: Finding[] = [];
    for (const d of deps) {
      if (!reg.has(fv(d.sourceFeatureId, d.sourceVersion))) f.push({ key: d.dependencyId, result: 'FAIL', message: `원천 ${fv(d.sourceFeatureId, d.sourceVersion)} 없음` });
      if (d.targetVersion && !reg.has(fv(d.targetFeatureId, d.targetVersion))) f.push({ key: d.dependencyId, result: 'FAIL', message: `대상 ${fv(d.targetFeatureId, d.targetVersion)} 없음` });
    }
    out.push(outcome(P(1), '원천·대상 Feature/Version 참조', f, `의존관계 ${deps.length}건 참조 확인`));
  }
  // 02 적용 범위
  {
    const f: Finding[] = [];
    const scope = (x: { country: string; vehicleModel: string; trim: string }) => `${x.country}/${x.vehicleModel}/${x.trim}`;
    for (const d of deps) {
      const s = reg.get(fv(d.sourceFeatureId, d.sourceVersion));
      const t = d.targetVersion ? reg.get(fv(d.targetFeatureId, d.targetVersion)) : undefined;
      if (s && scope(s) !== scope(d)) f.push({ key: d.dependencyId, result: 'FAIL', message: `원천 범위 ${scope(s)} ≠ 관계 ${scope(d)}` });
      if (t && scope(t) !== scope(d)) f.push({ key: d.dependencyId, result: 'FAIL', message: `대상 범위 ${scope(t)} ≠ 관계 ${scope(d)}` });
    }
    out.push(outcome(P(2), '적용 범위', f, `${deps.length}건 범위 대조`));
  }
  // 03 대상 Version 확정
  {
    const f: Finding[] = [];
    for (const d of deps) {
      if (!d.targetVersion) f.push({ key: d.dependencyId, result: 'CONDITIONAL', message: '대상 Version 미기재' });
      else if (!reg.has(fv(d.targetFeatureId, d.targetVersion))) f.push({ key: d.dependencyId, result: 'FAIL', message: `대상 Version ${d.targetVersion} 없음` });
    }
    out.push(outcome(P(3), '대상 Version 확정', f, `${deps.length}건 대상 Version 확인`));
  }
  // 04 REQUIRES Lifecycle
  {
    const f: Finding[] = [];
    for (const d of req) {
      const s = reg.get(fv(d.sourceFeatureId, d.sourceVersion));
      const t = d.targetVersion ? reg.get(fv(d.targetFeatureId, d.targetVersion)) : undefined;
      if (!s || !t) continue;
      if (s.lifecycle === 'PROPOSED') f.push({ key: d.dependencyId, result: 'CONDITIONAL', message: '원천 PROPOSED — 승인 전 관계 판정 대기' });
      else if (RANK[t.lifecycle] < RANK[s.lifecycle]) f.push({ key: d.dependencyId, result: 'FAIL', message: `대상 ${t.lifecycle}가 원천 ${s.lifecycle}의 선행 단계 미달` });
    }
    const pass = req.length - f.length;
    out.push(outcome(P(4), 'REQUIRES Lifecycle', f, `REQUIRES ${req.length}건 중 ${pass}건 PASS`));
  }
  // 05 EXCLUDES 구성 충돌
  {
    const f: Finding[] = [];
    const blFeature = new Map(ds.bomItems.map((b) => [b.baselineId, b.featureId]));
    for (const p of ds.products) {
      const feats = new Set(p.baselineIds.map((b) => blFeature.get(b)).filter(Boolean));
      for (const d of exc)
        if (feats.has(d.sourceFeatureId) && feats.has(d.targetFeatureId))
          f.push({ key: `${p.catalogId}@${p.version}`, result: 'FAIL', message: `${d.dependencyId}: ${d.sourceFeatureId}·${d.targetFeatureId} 공존` });
    }
    out.push(outcome(P(5), 'EXCLUDES 구성 충돌', f, `EXCLUDES ${exc.length}건 × Catalog ${ds.products.length}건 대조`));
  }
  // 09~12 (06 종합 판정이 참조하므로 먼저 계산)
  const r09: Finding[] = [];
  {
    const seen = new Set<string>();
    for (const d of deps) {
      if (!/^DEP-\d{5}$/.test(d.dependencyId)) r09.push({ key: d.dependencyId, result: 'FAIL', message: '형식 위반' });
      if (seen.has(d.dependencyId)) r09.push({ key: d.dependencyId, result: 'FAIL', message: '중복 ID' });
      seen.add(d.dependencyId);
    }
  }
  const r10: Finding[] = [];
  {
    const seen = new Map<string, string>();
    for (const d of deps) {
      const k = `${d.type}|${fv(d.sourceFeatureId, d.sourceVersion)}|${fv(d.targetFeatureId, d.targetVersion)}`;
      if (seen.has(k)) r10.push({ key: d.dependencyId, result: 'FAIL', message: `${seen.get(k)}와 업무 키 중복` });
      else seen.set(k, d.dependencyId);
    }
  }
  const r11: Finding[] = deps
    .filter((d) => d.sourceFeatureId === d.targetFeatureId)
    .map((d) => ({ key: d.dependencyId, result: 'FAIL' as const, message: '자기 참조' }));
  const r12: Finding[] = findRequiresCycles(req).map((cycle) => ({ key: cycle[0], result: 'FAIL' as const, message: `순환: ${cycle.join(' → ')}` }));

  // 06 의존관계 종합 판정
  {
    const f: Finding[] = [];
    const hard = [...out.slice(0, 5).flatMap((o) => o.findings), ...r09, ...r10, ...r11, ...r12].filter((x) => x.result === 'FAIL');
    f.push(...hard);
    for (const d of deps) if (d.verdict === '미판정') f.push({ key: d.dependencyId, result: 'CONDITIONAL', message: '미판정 관계' });
    const pass = deps.filter((d) => d.verdict === 'PASS').length;
    out.push(outcome(P(6), '의존관계 종합 판정', f, `전체 ${deps.length}건 중 PASS ${pass}건, 미판정 ${deps.length - pass}건`));
  }
  // 07 Lifecycle별 Gate 진행
  {
    const f: Finding[] = [];
    const byFv = new Map<string, typeof ds.gateRecords>();
    for (const g of ds.gateRecords) (byFv.get(fv(g.featureId, g.featureVersion)) ?? byFv.set(fv(g.featureId, g.featureVersion), []).get(fv(g.featureId, g.featureVersion))!).push(g);
    for (const feat of ds.features) {
      const k = fv(feat.featureId, feat.version);
      const gates = byFv.get(k) ?? [];
      const exp = GATE_EXPECT[feat.lifecycle];
      const passN = gates.filter((g) => g.status === 'PASS').length;
      const reviewN = gates.filter((g) => g.status === '검토 중').length;
      const failN = gates.filter((g) => g.status === 'FAIL').length;
      const order = gates.map((g) => Number(g.gate.slice(1))).sort((a, b) => a - b);
      const contiguous = order.every((n, i) => n === i + 1);
      if (failN || passN < exp.pass || reviewN > exp.inReview || !contiguous || gates.length > exp.pass + exp.inReview)
        f.push({ key: k, result: 'FAIL', message: `${feat.lifecycle}: PASS ${passN}/${exp.pass}, 검토 중 ${reviewN}, FAIL ${failN}` });
      else if (reviewN) f.push({ key: k, result: 'CONDITIONAL', message: `${feat.lifecycle}: Gate ${reviewN}건 검토 중` });
    }
    const passAll = ds.gateRecords.filter((g) => g.status === 'PASS').length;
    out.push(outcome(P(7), 'Lifecycle별 Gate 진행', f, `Gate ${ds.gateRecords.length}건 중 PASS ${passAll}건, 검토 중 ${ds.gateRecords.length - passAll}건`));
  }
  // 08 원천 승인·시험 증빙 — 데이터셋에는 서명된 원문이 없다
  {
    const f: Finding[] = ds.gateRecords.some((g) => g.status === 'PASS')
      ? [{ key: 'dataset', result: 'CONDITIONAL', message: '서명된 승인·시험 원문 미첨부 — 원천 시스템(IF-09 등) 대사 필요' }]
      : [];
    out.push(outcome(P(8), '원천 승인·시험 증빙', f, 'Gate PASS의 승인·시험 원문 대조'));
  }
  out.push(outcome(P(9), '의존관계 ID 형식·유일성', r09, `${deps.length}건 형식·중복 확인`));
  out.push(outcome(P(10), '관계 키 중복', r10, `${deps.length}건 업무 키 확인`));
  out.push(outcome(P(11), '자기 참조 방지', r11, `${deps.length}건 원천·대상 비교`));
  out.push(outcome(P(12), 'REQUIRES 순환', r12, `REQUIRES ${req.length}건 방향 그래프`));
  // 13 Registry·BOM Version 대조
  {
    const f: Finding[] = [];
    const bomBy = new Map<string, number>();
    for (const b of ds.bomItems) bomBy.set(b.baselineId, (bomBy.get(b.baselineId) ?? 0) + 1);
    const bomByKey = new Map(ds.bomItems.map((b) => [b.baselineId, fv(b.featureId, b.version)]));
    for (const r of ds.features) {
      const k = fv(r.featureId, r.version);
      if (r.lifecycle === 'PROPOSED') {
        if (r.baselineId) f.push({ key: k, result: 'FAIL', message: 'PROPOSED인데 Baseline 발급' });
        if (ds.bomItems.some((b) => fv(b.featureId, b.version) === k)) f.push({ key: k, result: 'FAIL', message: 'PROPOSED인데 BOM 반영' });
      } else if (r.baselineId) {
        if ((bomBy.get(r.baselineId) ?? 0) !== 1) f.push({ key: k, result: 'FAIL', message: `${r.baselineId} BOM 행 ${bomBy.get(r.baselineId) ?? 0}건` });
        else if (bomByKey.get(r.baselineId) !== k) f.push({ key: k, result: 'FAIL', message: `${r.baselineId} 키 불일치 (${bomByKey.get(r.baselineId)})` });
      }
    }
    const issued = ds.features.filter((x) => x.baselineId).length;
    out.push(outcome(P(13), 'Registry·BOM Version 대조', f, `Feature 버전 ${ds.features.length}건 중 Baseline 발급 ${issued}건 ↔ BOM Item ${ds.bomItems.length}건`));
  }
  // 14 Gate·Evidence 추적
  {
    const f: Finding[] = [];
    const ev = new Map(ds.evidence.map((e) => [e.gateRecordId, e]));
    for (const g of ds.gateRecords) {
      const e = ev.get(g.gateRecordId);
      if (!e) f.push({ key: g.gateRecordId, result: 'FAIL', message: 'Evidence 없음' });
      else if (e.evidenceRef !== g.evidenceRef || e.inputResult !== g.inputResult) f.push({ key: g.gateRecordId, result: 'FAIL', message: 'Evidence Ref·판정 불일치' });
    }
    if (ds.evidence.length !== ds.gateRecords.length) f.push({ key: 'dataset', result: 'FAIL', message: `Gate ${ds.gateRecords.length} ≠ Evidence ${ds.evidence.length}` });
    out.push(outcome(P(14), 'Gate·Evidence 추적', f, `Gate ${ds.gateRecords.length}건 ↔ Evidence ${ds.evidence.length}건`));
  }
  // 15 Rule Version
  out.push(
    outcome(
      P(15),
      'Rule Version 적용',
      deps.filter((d) => !d.ruleVersion?.startsWith('DATA-PRECHECK-1.0')).map((d) => ({ key: d.dependencyId, result: 'FAIL' as const, message: 'Rule Version 누락' })),
      `의존관계 ${deps.length}건 규칙 참조`,
    ),
  );
  // 16 의존관계 표시 완전성
  {
    const f: Finding[] = [];
    const bomBy = new Map(ds.bomItems.map((b) => [b.baselineId, b]));
    for (const r of ds.features) {
      const k = fv(r.featureId, r.version);
      if (!r.dependencyIds.length && r._missing.dependencyIds !== '의존 관계 없음') f.push({ key: k, result: 'FAIL', message: "관계 없음 표시('의존 관계 없음.') 누락" });
      const b = r.baselineId ? bomBy.get(r.baselineId) : undefined;
      if (b && b.dependencyIds.join(',') !== r.dependencyIds.join(',')) f.push({ key: k, result: 'FAIL', message: 'Registry·BOM 관계 목록 불일치' });
    }
    const withDeps = ds.features.filter((x) => x.dependencyIds.length).length;
    out.push(outcome(P(16), '의존관계 표시 완전성', f, `Feature 버전 ${ds.features.length}건 중 관계 있음 ${withDeps}건`));
  }

  return out.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

/** REQUIRES 방향 그래프(Feature@Version 노드)의 순환 — 각 순환을 노드 목록으로 */
export function findRequiresCycles(req: Pick<DependencyRow, 'sourceFeatureId' | 'sourceVersion' | 'targetFeatureId' | 'targetVersion'>[]): string[][] {
  const adj = new Map<string, string[]>();
  for (const d of req) {
    const s = fv(d.sourceFeatureId, d.sourceVersion);
    (adj.get(s) ?? adj.set(s, []).get(s)!).push(fv(d.targetFeatureId, d.targetVersion));
  }
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const dfs = (n: string) => {
    color.set(n, 1);
    stack.push(n);
    for (const m of adj.get(n) ?? []) {
      if (color.get(m) === 1) cycles.push([...stack.slice(stack.indexOf(m)), m]);
      else if (!color.get(m)) dfs(m);
    }
    stack.pop();
    color.set(n, 2);
  };
  for (const n of [...adj.keys()].sort()) if (!color.get(n)) dfs(n);
  return cycles;
}

/** 데이터 품질 점검 — PRECHECK 밖의 알려진 원본 오류를 경고로 노출 (사용자 결정: 원본 적재 + 경고) */
export function runDataQuality(ds: Dataset): RuleOutcome[] {
  const reg = new Map(ds.features.map((f) => [fv(f.featureId, f.version), f]));
  // DQ-01: SW_Master 상세 설명의 FEAT 참조가 Registry와 맞지 않음
  const f1: Finding[] = [];
  for (const s of ds.swMaster) {
    for (const m of s.description.matchAll(/(FEAT-\d{5})@(\d+\.\d+\.\d+)/g)) {
      const feat = reg.get(fv(m[1], m[2]));
      if (!feat) f1.push({ key: `${s.swId}@${s.version}`, result: 'CONDITIONAL', message: `설명의 ${m[0]}가 Registry에 없음` });
      else if (!feat.swIds.includes(s.swId)) f1.push({ key: `${s.swId}@${s.version}`, result: 'CONDITIONAL', message: `${m[0]}(${feat.name})의 SW 구성에 ${s.swId} 없음` });
    }
  }
  // DQ-02: Function 설명이 소속 Feature가 아닌 다른 Feature 명칭으로 시작
  const f2: Finding[] = [];
  const names = [...new Set(ds.features.map((f) => f.name))];
  for (const fn of ds.featureFunctions) {
    const own = reg.get(fv(fn.featureId, fn.featureVersion));
    if (!own || fn.description.includes(own.name)) continue;
    const other = names.find((n) => n !== own.name && fn.description.startsWith(n));
    if (other) f2.push({ key: `${fn.featureId}@${fn.featureVersion}#${fn.functionId}`, result: 'CONDITIONAL', message: `설명이 '${other}' 명칭 사용 (소속: '${own.name}')` });
  }
  return [
    outcome('DQ-01', 'SW_Master 설명의 Feature 참조', f1, `SW ${ds.swMaster.length}건 설명 대조`),
    outcome('DQ-02', 'Function 설명의 Feature 명칭', f2, `Function ${ds.featureFunctions.length}건 설명 대조`),
  ];
}
