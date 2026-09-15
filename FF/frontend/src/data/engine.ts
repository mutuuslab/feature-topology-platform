// 클라이언트 엔진 (4 Decision Engine + Readiness + Consistency + topology).
// 라이브 DB(store가 주입) 기반 — setDB로 갱신하면 추가/변경된 Feature·Edge가 즉시 반영.
import * as M from './model';

export interface DB {
  features: M.Feature[];
  edges: M.Edge[];
  relations: M.Relation[];
  artifacts: M.ArtifactNode[];
  evidence: typeof M.evidence;
  telemetry: Record<string, any>;
  changeSets: Record<string, any[]>;
  healthByFeature: Record<string, number>;
}

// 초기 DB = 시드(스토어 마운트 전에도 동작)
let db: DB = {
  features: M.features, edges: M.edges, relations: M.relations, artifacts: M.artifacts,
  evidence: M.evidence, telemetry: M.telemetry, changeSets: M.changeSets, healthByFeature: M.healthByFeature,
};
export function setDB(next: Partial<DB>) { db = { ...db, ...next }; }
export function getDB() { return db; }

export const getFeature = (id: string) => db.features.find(f => f.id === id);
export const edgesOf = (id: string) => db.edges.filter(e => e.source === id || e.target === id);
export const relationsOf = (id: string) => db.relations.filter(r => r.source === id || r.target === id);
/**
 * 관계는 구현 참조를 `ID@version` 형태로 적는다(BOM 멤버의 정확 버전).
 * 영향 분석·그래프는 버전 노드를 만들지 않으므로 참조는 객체 ID 로 정규화해 해석한다.
 */
export const refId = (ref: string) => ref.split('@')[0];
export const artifact = (id: string) => {
  const direct = db.artifacts.find(a => a.id === id);
  return direct || db.artifacts.find(a => a.id === refId(id));
};
export const health = (id: string) => db.healthByFeature[id] ?? 0;

export function catalogStats() {
  const by = (s: string) => db.features.filter(f => f.lifecycle === s).length;
  return { total: db.features.length, approved: by('Approved'), developing: by('Developing'),
    released: by('Released'), missingTrace: db.features.filter(f => health(f.id) < 6).length };
}

// EQ1 — parent_of/requires 순환 검사 (엣지 추가 전 검증)
export function wouldCycle(source: string, target: string, type: string): boolean {
  if (type !== 'parent_of' && type !== 'requires') return false;
  const adj = new Map<string, string[]>();
  [...db.edges, { source, target, type } as any]
    .filter(e => e.type === 'parent_of' || e.type === 'requires')
    .forEach(e => { if (!adj.has(e.source)) adj.set(e.source, []); adj.get(e.source)!.push(e.target); });
  const seen = new Set<string>(), stack = new Set<string>();
  const dfs = (n: string): boolean => {
    if (stack.has(n)) return true; if (seen.has(n)) return false;
    seen.add(n); stack.add(n);
    for (const m of adj.get(n) || []) if (dfs(m)) return true;
    stack.delete(n); return false;
  };
  return [...adj.keys()].some(dfs);
}

export interface ImpactResult {
  features: string[]; requirements: string[]; swcs: string[]; ecus: string[]; apis: string[];
  variants: string[]; tests: string[]; suppliers: string[]; deploymentImpact: string; safetySecurity: string; confidence: string;
}

export function impact(changeTarget: string): ImpactResult {
  const target = refId(changeTarget);
  const seeds: string[] = [];
  if (getFeature(target)) seeds.push(target);
  else db.features.forEach(f => { if (relationsOf(f.id).some(r => refId(r.target) === target || refId(r.source) === target)) seeds.push(f.id); });
  const frontier = new Set(seeds);
  seeds.forEach(s => edgesOf(s).forEach(e => { if (e.type === 'parent_of' || e.type === 'requires') { frontier.add(e.source); frontier.add(e.target); } }));
  const F = new Set<string>(), reqs = new Set<string>(), swcs = new Set<string>(), ecus = new Set<string>(),
    apis = new Set<string>(), vars = new Set<string>(), tests = new Set<string>(), sups = new Set<string>();
  [...frontier].forEach(fid => {
    if (!getFeature(fid)) return; F.add(fid);
    relationsOf(fid).forEach(r => {
      const n = artifact(r.target) || artifact(r.source); if (!n) return;
      ({ Requirement: reqs, SWComponent: swcs, ECU: ecus, APIService: apis, VariantRule: vars, TestCase: tests, SupplierFunction: sups } as any)[n.kind]?.add(n.id);
    });
  });
  if (swcs.size && !ecus.size) ecus.add('ECU-BDC');
  return {
    features:[...F], requirements:[...reqs], swcs:[...swcs], ecus:[...ecus], apis:[...apis],
    variants: vars.size ? ['KR/EU','MY2027+','Premium','Gen3'] : [],
    tests:[...tests], suppliers:[...sups],
    deploymentImpact:'Policy-only 가능 (구조 변경 아님)', safetySecurity:'QM 영향 없음 / Sec Medium 재검토', confidence:'High',
  };
}

export function verification(_featureId: string) {
  const mandatory = ['HIL-BDC-001','OTA-RB-002','TEL-BDC-001'];
  const missing = mandatory.filter(m => { const e = db.evidence.find(x => x.testCaseId === m); return !e || e.result !== 'pass'; });
  return { mandatoryTests: mandatory, missingEvidence: missing, coverageGap: missing, gateResult: (missing.length ? 'PENDING' : 'PASS') as 'PENDING'|'PASS' };
}

// 신규 PPT(S16): Decision Output Contract — deployType/confidence/reasonCodes/blockingIssues/rollbackPlan
export function deploy(changeTypes: string[]) {
  const has = (k: string) => changeTypes.some(c => c.toLowerCase().includes(k));
  let type: M.DeployType = 'Manual';
  if (has('swc')||has('ecu')) type = 'Binary';
  else if (has('api')||has('signal')||has('dtc')) type = 'Binary';
  else if (has('policy')||has('targeting')) type = 'Policy-only';
  else if (has('variant')||has('capability')) type = 'Config';
  else if (has('calibration')||has('parameter')) type = 'Calibration';
  else if (has('emergency')||has('disable')) type = 'Policy-only';
  const policyish = type === 'Policy-only' || type === 'Config';
  return {
    deployType: type,
    requiredGates: policyish ? ['Policy Approval','Variant Review','Rollback Test','Telemetry Validation'] : ['Integration','OTA','Rollback Test'],
    confidence: (type==='Manual'?'Low':policyish?'High':'Medium') as 'High'|'Medium'|'Low',
    reasonCodes: policyish ? ['NO_SWC_CHANGE','API_COMPATIBLE','ROLLBACK_DEFINED'] : ['STRUCTURAL_CHANGE'],
    blockingIssues: [] as string[],
    rollbackPlan: 'RB-BDC-001 → previous stable policy',
    rationale: policyish ? ['SWC 코드 변경 없음','API Contract 변경 없음','기존 Adapter가 Policy Apply 지원','Rollback Plan 정의됨'] : ['구조/바이너리 변경 포함'],
  };
}

// ── SW 개발비(Cost) 엔진 — 공수(M/M)→금액(₩) ──
const won = (mm: number) => Math.round(mm * M.rateCard.wonPerMM);
export const fmtWon = (w: number) => '₩' + (w / 1e8 >= 1 ? (w / 1e8).toFixed(2) + '억' : Math.round(w / 1e4).toLocaleString() + '만');

export function featureCost(featureId: string) {
  const seed = M.featureCostSeed[featureId];
  let estMM = seed?.estMM;
  if (estMM == null) // 미입력 시 연결 아티팩트 unitMM 합으로 추정
    estMM = relationsOf(featureId).reduce((s, r) => {
      const n = artifact(r.target) || artifact(r.source);
      return s + (n ? (M.rateCard.unitMM[n.kind] || 0) : 0);
    }, 0);
  const actualMM = seed?.actualMM ?? 0;
  return { estMM, actualMM, estWon: won(estMM), actualWon: won(actualMM), varianceWon: won(actualMM - estMM) };
}

// 변경(impact)·배포방식별 개발비 + Binary 대비 Policy-only 절감액
export function changeCost(imp: ImpactResult, deployType: string) {
  const u = M.rateCard.unitMM;
  const baseMM =
    imp.swcs.length * u.SWComponent + imp.ecus.length * u.ECU + imp.apis.length * u.APIService +
    imp.tests.length * u.TestCase + imp.suppliers.length * u.SupplierFunction +
    imp.requirements.length * u.Requirement + imp.variants.length * u.VariantRule;
  const mult = (dt: string) => M.rateCard.deployMultiplier[dt] ?? 1;
  const changeWon = won(baseMM * mult(deployType));
  const binaryWon = won(baseMM * mult('Binary'));
  return { baseMM, changeWon, binaryWon, savingsWon: Math.max(0, binaryWon - changeWon) };
}

export function supplierCost(supplierId: string) {
  const s = M.supplierCostSeed[supplierId];
  return s ? { contractMM: s.contractMM, contractWon: won(s.contractMM), note: s.note } : null;
}

// 신규 PPT(S18/S20): Decision Package 패키징 (재현 가능 — graph snapshot + reason codes + 비용)
export function buildDecisionPackage(featureId: string, changeTarget: string, changeTypes: string[]): M.DecisionPackage {
  const d = deploy(changeTypes); const v = verification(featureId);
  const cc = changeCost(impact(changeTarget), d.deployType);
  return {
    decisionId: 'DEC-BDC-0618', graphSnapshotId: 'GPH-BDC-v1.4',
    changeTarget, deployType: d.deployType, confidence: d.confidence,
    requiredGates: d.requiredGates, requiredTests: v.mandatoryTests,
    evidenceLinks: v.mandatoryTests.filter(t => !v.missingEvidence.includes(t)),
    reasonCodes: d.reasonCodes,
    costImpact: { changeWon: cc.changeWon, binaryWon: cc.binaryWon, savingsWon: cc.savingsWon },
  };
}

// Cost Dashboard 집계
export function costSummary() {
  const rows = M.features.map(f => ({ id: f.id, name: f.displayName, domain: f.domain, deploy: f.deployType, ...featureCost(f.id) }));
  const totalEst = rows.reduce((s, r) => s + r.estWon, 0);
  const totalActual = rows.reduce((s, r) => s + r.actualWon, 0);
  const byDomain: Record<string, number> = {};
  const byDeploy: Record<string, number> = {};
  rows.forEach(r => { byDomain[r.domain] = (byDomain[r.domain] || 0) + r.estWon; byDeploy[r.deploy] = (byDeploy[r.deploy] || 0) + r.estWon; });
  return { rows, totalEst, totalActual, byDomain, byDeploy };
}

export function supplier(featureId: string) {
  const sup = relationsOf(featureId).find(r => r.type === 'realized_by');
  return { supplierScope: sup ? [artifact(sup.target)?.displayName || sup.target] : [],
    acceptanceCriteria:'API Contract v1.5 준수', contractGap:'none', evidenceStatus:'2/2' };
}

export interface Gate { id: string; name: string; status: M.GateStatus; detail: string; }
export function readiness(featureId: string) {
  const f = getFeature(featureId); const rels = relationsOf(featureId);
  const v = verification(featureId); const has = (t: string) => rels.some(r => r.type === t);
  const gates: Gate[] = [
    { id:'G1', name:'Feature', status: f?.ownerOrg?'PASS':'FAIL', detail:`Owner: ${f?.ownerOrg} / ${f?.lifecycle}` },
    { id:'G2', name:'Requirement', status: has('derives')?'PASS':'FAIL', detail:'요구사항 Trace' },
    { id:'G3', name:'Variant', status: has('applies_to')?'PASS':'PENDING', detail:'Applicability Rule' },
    { id:'G4', name:'Control', status: edgesOf(featureId).some(e=>e.type==='fallback_to')?'PASS':'PENDING', detail:'Safe Default·Rollback·Kill' },
    { id:'G5', name:'Verification', status: v.gateResult, detail: v.missingEvidence.length?`미완: ${v.missingEvidence.join(', ')}`:'완료' },
    { id:'G6', name:'Supplier', status: has('realized_by')?'PASS':'PENDING', detail:'Supplier 매핑' },
    { id:'G7', name:'Safety/Security', status:'PASS', detail:`Safety ${f?.safety} / Sec ${f?.security}` },
    { id:'G8', name:'OTA', status: f?.deployType && f.deployType!=='TBD'?'PASS':'PENDING', detail:`${f?.deployType}` },
    { id:'G9', name:'Operations', status: db.telemetry[featureId]?'PASS':'PENDING', detail:'Telemetry·Audit·Alert' },
  ];
  const passCount = gates.filter(g=>g.status==='PASS').length;
  return { featureId, gates, passCount, decision: (gates.every(g=>g.status==='PASS')?'RELEASE':'HOLD') as 'RELEASE'|'HOLD' };
}

// 신규 PPT(S14): Consistency Rule R01–R08 + Severity(B=blocking/W=warning/I=info)
export function consistency() {
  const out: { rule: string; severity: string; featureId: string; message: string }[] = [];
  for (const f of db.features) {
    const rels = relationsOf(f.id);
    const has = (t: string) => rels.some(r => r.type === t);
    if (f.level==='L2' && !has('derives'))
      out.push({ rule:'R01', severity:'B', featureId:f.id, message:'Required Link — L2 Feature는 ≥1 Requirement(derives) 필요' });
    if (f.lifecycle==='Released' && !has('verified_by'))
      out.push({ rule:'R02', severity:'B', featureId:f.id, message:'Evidence — Released는 ≥1 Test Evidence 필요' });
    if (f.deployType==='Policy-only' && !edgesOf(f.id).some(e=>e.type==='fallback_to'))
      out.push({ rule:'R03', severity:'B', featureId:f.id, message:'Runtime Control — Safe Default/Rollback 필요' });
    if (f.level==='L2' && f.lifecycle!=='Proposed' && !has('applies_to'))
      out.push({ rule:'R04', severity:'B', featureId:f.id, message:'Variant — Variant Rule 없으면 Production 활성화 불가' });
    if ((f.safety?.startsWith('ASIL') || f.security==='High') && f.lifecycle==='Released' && !has('verified_by'))
      out.push({ rule:'R05', severity:'B', featureId:f.id, message:'Safety/Security — Safety/Security Gate 통과 필요' });
    if (has('realized_by') && !has('verified_by'))
      out.push({ rule:'R06', severity:'W', featureId:f.id, message:'Supplier — Supplier 구현은 검증 증적 권장' });
    if (f.lifecycle==='Released' && !f.baselineVer)
      out.push({ rule:'R07', severity:'B', featureId:f.id, message:'Lifecycle — Released는 Baseline 기록 필요' });
    if (has('uses_api'))
      out.push({ rule:'R08', severity:'I', featureId:f.id, message:'Change Impact — API 변경 시 영향 Feature 자동 산출 대상' });
  }
  return out;
}

export function topology(featureId: string) {
  const nodes: any[] = []; const seen = new Set<string>(); const edgeSeen = new Set<string>();
  const add = (id: string, label: string, type: string) => { if (!seen.has(id)) { seen.add(id); nodes.push({ data:{ id, label, type } }); } };
  const f = getFeature(featureId); if (f) add(f.id, f.displayName, 'feature-center');
  const cyEdges: any[] = [];
  /** 양 끝점을 노드로 먼저 세운 뒤 간선을 붙인다 — 없는 노드를 가리키는 간선은 그래프를 깨뜨린다. */
  const link = (id: string, source: string, target: string, label: string) => {
    if (edgeSeen.has(id)) return;
    edgeSeen.add(id); cyEdges.push({ data:{ id, source, target, label } });
  };
  edgesOf(featureId).forEach(e => {
    add(e.source, getFeature(e.source)?.displayName||e.source, 'feature');
    add(e.target, getFeature(e.target)?.displayName||e.target, e.target.startsWith('FEAT')?'feature':'artifact');
    link(e.id, e.source, e.target, e.type);
  });
  relationsOf(featureId).forEach(r => {
    const src = refId(r.source), tgt = refId(r.target);
    [src, tgt].forEach(ref => {
      if (ref === featureId) return;
      const n = artifact(ref);
      add(ref, n?.displayName || ref, n ? n.kind.toLowerCase() : 'artifact');
    });
    link(r.id, src, tgt, r.type);
  });
  return { nodes, edges: cyEdges };
}
