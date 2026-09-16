// UI16 품질 기준과 검증 증적 — 정본 상세 영역 7개 본문.
//
// 이 화면이 지키는 구분:
//  · 결과(PASS/FAIL/SKIP)와 유효성(PENDING/VALID/INVALID/EXPIRED/UNKNOWN)은 다른 축이다
//  · 시험 종류 이름이 아니라 동일 대상 hash 의 유효 결과만 승인 입력으로 쓴다
//  · 미실행·참조 모의는 PASS 로 계상하지 않고, UNKNOWN 은 사유 없이 확정하지 않는다
//  · 품질 평가(품질 역할)와 운영 승인(승인 역할)은 같은 사람이 할 수 없다
import { useState, type ReactNode } from 'react';
import { CanonicalScreen, FIELD, Gated, Reasons, StageRail, Table, type Kpi } from '../../components/AreaScreen';
import { UlBadge, UlRules, ulBlocks, ulWarns, type UlRule } from '../../components/ulRules';
import { useApp, useToast } from '../../store';
import { features } from '../../data/model';
import { BOM_BASELINES } from '../../data/featureBom';
import { fleetStats, sampleVehicles } from '../../data/fleet';

// ── 증적 상태 (정본 5개) ────────────────────────────────────────────────
type EvState = 'PENDING' | 'VALID' | 'INVALID' | 'EXPIRED' | 'UNKNOWN';
type EvResult = 'PASS' | 'FAIL' | 'SKIP' | '미실행';
type EvArea = 'S01' | 'S02' | 'S04' | 'S05' | 'S06';
type SrcKind = 'RAW_LOG' | 'REPORT' | 'SIGNED_PKG';

const EV_STATES: EvState[] = ['PENDING', 'VALID', 'INVALID', 'EXPIRED', 'UNKNOWN'];
const EV_KO: Record<EvState, string> = {
  PENDING: '등록·검토 대기', VALID: '유효', INVALID: '무효', EXPIRED: '기간 만료', UNKNOWN: '미확인',
};
const EV_TONE: Record<EvState, string> = {
  PENDING: 'var(--pending)', VALID: 'var(--pass)', INVALID: 'var(--fail)', EXPIRED: 'var(--fail)', UNKNOWN: 'var(--pending)',
};
const RESULTS: EvResult[] = ['PASS', 'FAIL', 'SKIP', '미실행'];
const SRC_KINDS: SrcKind[] = ['RAW_LOG', 'REPORT', 'SIGNED_PKG'];
const SRC_LABEL: Record<SrcKind, string> = { RAW_LOG: 'RAW_LOG', REPORT: '리포트', SIGNED_PKG: '서명 package' };

/** 증적 한 건 — 표시 열은 정본 열(증적 ID · 대상 및 hash · 시험 버전 · 실행 환경 · 결과 · 유효성 · 원천). */
interface EvRow {
  id: string;
  area: EvArea;
  feature: string;
  /** 위험도 Profile — 검증 대상의 위험 등급 */
  profile: string;
  /** 정확 대상과 그 hash */
  target: string;
  hash: string;
  tver: string;
  tool: string;
  env: string;
  result: EvResult;
  validity: EvState;
  source: string;
  srcKind: SrcKind;
  at: string;
  /** 실행 방식 — 참조 모의는 실제 실행 증적으로 세지 않는다 */
  mode: '실제 실행' | '참조 모의';
  /** 유효성이 VALID 가 아닌 이유 — UNKNOWN 은 사유 없이 남길 수 없다 */
  reason?: string;
}

const stamp = (d: string, t: string) => `${d} ${t}`;
const num = (n: number) => n.toLocaleString('ko-KR');

// 결정적 해시 — 화면 안에서 대상 hash 를 재현 가능하게 만든다.
function h32(s: string) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = (x * 16777619) >>> 0; }
  return x;
}
function hexOf(s: string, n = 64) {
  let x = h32(s);
  let out = '';
  while (out.length < n) { x = (x * 1664525 + 1013904223) >>> 0; out += x.toString(16).padStart(8, '0'); }
  return out.slice(0, n);
}
const sha = (s: string) => `sha256:${hexOf(s)}`;
const asHash = (h: string) => (h.startsWith('sha256:') ? h : `sha256:${h}`);

// ── 앱 데이터에서 정확 참조를 가져온다 ─────────────────────────────────
const BDC_BOM = BOM_BASELINES.find(b => b.id === 'BL-BDC-2027.1') || BOM_BASELINES[0];
const LIGHT_BOM = BOM_BASELINES.find(b => b.id === 'BL-LIGHT-ADAS-2027.1') || BDC_BOM;
const REVOKED_BOM = BOM_BASELINES.find(b => b.state === 'REVOKED') || BDC_BOM;
const BDC_HASH = asHash(BDC_BOM.contentHash);
const LIGHT_HASH = asHash(LIGHT_BOM.contentHash);
const DRIFT_HASH = sha(`${BDC_BOM.id}#drift`);

const bdcTarget = (ver = '1.1.0') => `FEAT-BDC-001@${ver} · ${BDC_BOM.id}@${BDC_BOM.version}`;
const lightTarget = `FEAT-LIGHT-001@2.0.0 · ${LIGHT_BOM.id}@${LIGHT_BOM.version}`;

/** 위험도 Profile — 어떤 대상에 어떤 필수 시험이 붙는지. */
const PROFILES = [
  { key: 'QM', risk: 'QM', profiles: 'PROFILE-QM@3.1', required: 'HIL 회귀 · 정책 판정 회귀', interval: '12개월', owner: 'Body Platform Team' },
  { key: 'ASIL-B', risk: 'ASIL-B', profiles: 'PROFILE-ASIL-B@2.0', required: 'HIL 인수 · 안전 전이 · readback', interval: '6개월', owner: 'ADAS Team' },
  { key: 'ASIL-D', risk: 'ASIL-D', profiles: 'PROFILE-ASIL-D@1.4', required: 'SIL · HIL · 실차 · 독립 검토', interval: '3개월', owner: 'ADAS Team' },
];

const SEED_S01_S02: EvRow[] = [
  // ── S01 품질 Profile과 검증 대상 ────────────────────────────────────
  {
    id: 'EV-BDC-PROF-01', area: 'S01', feature: 'FEAT-BDC-001', profile: 'QM',
    target: bdcTarget(), hash: BDC_HASH, tver: 'PROFILE-QM@3.1 · HIL-BDC-42', tool: 'HIL-BDC-42',
    env: 'Body HIL 벤치 KR-02 · ECU-BDC-B Gen3', result: 'PASS', validity: 'VALID',
    source: `RAW_LOG bdc-hil-42.ndjson · 기준선 ${BDC_BOM.id}`, srcKind: 'RAW_LOG',
    at: stamp('2026-09-13', '09:12'), mode: '실제 실행',
  },
  {
    id: 'EV-ADAS-PROF-02', area: 'S01', feature: 'FEAT-ADAS-001', profile: 'ASIL-D',
    target: `FEAT-ADAS-001@2.4.0 · ${REVOKED_BOM.id}@${REVOKED_BOM.version}`, hash: sha('adas-profile-02'),
    tver: 'PROFILE-ASIL-D@1.4 · HIL-ADAS-07', tool: 'HIL-ADAS-07',
    env: 'ADAS HIL AD-07 · MY2026.4 구성', result: 'PASS', validity: 'EXPIRED',
    source: 'REPORT asil-d-0702.pdf', srcKind: 'REPORT',
    at: stamp('2026-08-30', '18:40'), mode: '실제 실행',
    reason: '유효기간 2026-08-31 종료 — 대상 기준선도 철회됨, 재실행 필요',
  },
  {
    id: 'EV-SEAT-PROF-03', area: 'S01', feature: 'FEAT-SEAT-001', profile: 'QM',
    target: 'FEAT-SEAT-001@0.9.0 (버전 미확정)', hash: '—',
    tver: 'PROFILE-QM@3.1 (대상 미연결)', tool: '—',
    env: '벤치 미지정', result: '미실행', validity: 'UNKNOWN',
    source: '원천 미제출', srcKind: 'REPORT',
    at: '—', mode: '실제 실행',
    reason: '대상 정확 버전과 Profile 미확정 — 임의 확정하지 않는다',
  },
  // ── S02 시험과 증적 등록 ───────────────────────────────────────────
  {
    id: 'EV-BDC-OTA-04', area: 'S02', feature: 'FEAT-BDC-001', profile: 'QM',
    target: bdcTarget(), hash: DRIFT_HASH, tver: 'OTA-RB-002@1.3.0', tool: 'OTA-RB-002',
    env: 'OTA Cloud dry-run EU', result: 'FAIL', validity: 'INVALID',
    source: 'RAW_LOG ota-rb-002.log', srcKind: 'RAW_LOG',
    at: stamp('2026-09-13', '10:04'), mode: '실제 실행',
    reason: `대상 hash 불일치 — 현재 내용 hash ${BDC_HASH.slice(7, 19)} 와 다름`,
  },
  {
    id: 'EV-LIGHT-HIL-05', area: 'S02', feature: 'FEAT-LIGHT-001', profile: 'QM',
    target: lightTarget, hash: LIGHT_HASH, tver: 'HIL-LIGHT-03@2.1', tool: 'HIL-LIGHT-03',
    env: 'Light HIL LT-03 · ECU-BCM', result: 'PASS', validity: 'PENDING',
    source: 'REPORT light-hil-03.html · JSON', srcKind: 'REPORT',
    at: stamp('2026-09-12', '16:22'), mode: '실제 실행',
    reason: '검토자 배정 대기 — 검토 전에는 승인 입력으로 쓰지 않는다',
  },
  {
    id: 'EV-CONN-TEL-06', area: 'S02', feature: 'FEAT-CONN-001', profile: 'QM',
    target: 'FEAT-CONN-001@0.7.0 · 기준선 미연결', hash: sha('conn-tel-06'),
    tver: 'TEL-BDC-001@1.0', tool: '외부 시험기관',
    env: '외부 원천 · 재현 불가', result: 'PASS', validity: 'UNKNOWN',
    source: '외부 첨부 (원천 링크 없음)', srcKind: 'REPORT',
    at: stamp('2026-09-11', '11:30'), mode: '참조 모의',
    reason: '결과·원천·유효기간 미확인 · 판정 책임자 미기재',
  },
];
const SEED_S04_S06: EvRow[] = [
  // ── S04 SDK와 호환성 시험 ──────────────────────────────────────────
  {
    id: 'EV-SDK-NODE-07', area: 'S04', feature: 'FEAT-RUNTIME-001', profile: 'QM',
    target: 'Provider 8.2.0 · golden vector 128건', hash: sha('provider-8.2.0'),
    tver: 'SDK Node 8.2.0 · GV-2026.09', tool: 'GV-2026.09',
    env: 'CI runner node-20 · 컨테이너 없음', result: 'PASS', validity: 'VALID',
    source: 'SIGNED_PKG fp-sdk-node-8.2.0.tgz', srcKind: 'SIGNED_PKG',
    at: stamp('2026-09-13', '08:40'), mode: '실제 실행',
  },
  {
    id: 'EV-SDK-AND-08', area: 'S04', feature: 'FEAT-RUNTIME-001', profile: 'QM',
    target: 'Provider 8.2.0 · golden vector 128건', hash: sha('provider-8.2.0'),
    tver: 'SDK Android 8.2.0 · GV-2026.09', tool: 'GV-2026.09',
    env: 'AAOS 이미지 · 엔진 Android 34', result: 'PASS', validity: 'VALID',
    source: 'SIGNED_PKG fp-sdk-android-8.2.0.aar', srcKind: 'SIGNED_PKG',
    at: stamp('2026-09-13', '08:52'), mode: '실제 실행',
  },
  {
    id: 'EV-SDK-LEGACY-09', area: 'S04', feature: 'FEAT-RUNTIME-001', profile: 'QM',
    target: 'legacy v8 API · userWithId / gradualRollout*', hash: sha('legacy-v8-api'),
    tver: 'SDK Node 8.2.0 (호환 Shim 미배포)', tool: 'Legacy compat runner',
    env: 'CI runner node-20', result: 'FAIL', validity: 'INVALID',
    source: 'RAW_LOG legacy-v8-compat.log', srcKind: 'RAW_LOG',
    at: stamp('2026-09-12', '19:05'), mode: '실제 실행',
    reason: '미지원 전략 — legacy 후보 전체 거부 (부분 지원으로 계상하지 않음)',
  },
  {
    id: 'EV-SNAP-LEASE-10', area: 'S04', feature: 'FEAT-RUNTIME-001', profile: 'QM',
    target: 'SnapshotLease 4 · 오프라인 복구', hash: sha('snapshot-lease-4'),
    tver: 'Provider 8.2.0 · lease 시험 3/4', tool: 'EnginePool harness',
    env: '차량 Agent AAOS · 캐시 만료 상태', result: 'PASS', validity: 'PENDING',
    source: 'REPORT lease-2026-09.json', srcKind: 'REPORT',
    at: stamp('2026-09-12', '20:10'), mode: '실제 실행',
    reason: '동시 교체 시험 1건 미실행 — 완료 전에는 호환성 승인 입력으로 쓰지 않는다',
  },
  // ── S05 차량 및 안전 검증 ──────────────────────────────────────────
  {
    id: 'EV-HIL-ECU-11', area: 'S05', feature: 'FEAT-BDC-001', profile: 'QM',
    target: bdcTarget(), hash: BDC_HASH, tver: 'HIL-ECU-GUARD@1.2', tool: 'HIL-ECU-GUARD',
    env: '차량 HIL · ECU-BDC-B Gen3 3대', result: 'PASS', validity: 'VALID',
    source: 'RAW_LOG ecu-guard-transition.log', srcKind: 'RAW_LOG',
    at: stamp('2026-09-13', '07:55'), mode: '실제 실행',
  },
  {
    id: 'EV-READBACK-12', area: 'S05', feature: 'FEAT-BDC-001', profile: 'QM',
    target: `${bdcTarget()} · 다중 ECU readback`, hash: BDC_HASH, tver: 'Readback-Agent@0.9', tool: 'Readback-Agent',
    env: '실차 12대 · ECU 4종', result: 'PASS', validity: 'PENDING',
    source: 'RAW_LOG readback-2026-09-13.ndjson', srcKind: 'RAW_LOG',
    at: stamp('2026-09-13', '08:20'), mode: '실제 실행',
    reason: 'readback 미보고 3대 — 보고된 대수만 성공으로 계산한다',
  },
  {
    id: 'EV-SIL-BDC-13', area: 'S05', feature: 'FEAT-BDC-001', profile: 'QM',
    target: bdcTarget(), hash: sha('sil-harness-bdc'), tver: 'SIL-BDC-11@3.0', tool: 'SIL-BDC-11',
    env: 'SIL 하니스 · 시뮬레이터 8.2', result: 'PASS', validity: 'VALID',
    source: 'REPORT sil-bdc-11-junit.xml', srcKind: 'REPORT',
    at: stamp('2026-09-11', '14:05'), mode: '실제 실행',
  },
  {
    id: 'EV-VEH-ENV-14', area: 'S05', feature: 'FEAT-ADAS-001', profile: 'ASIL-B',
    target: 'FEAT-ADAS-001@2.4.0 · 안전 허용 envelope', hash: sha('adas-envelope'),
    tver: 'VEH-ENV@1.1', tool: '실차 시험팀',
    env: '주행 시험장 KR · 3대', result: 'PASS', validity: 'UNKNOWN',
    source: 'REPORT envelope-summary.pdf', srcKind: 'REPORT',
    at: stamp('2026-09-10', '17:40'), mode: '실제 실행',
    reason: '유효기간 미기재 — 기간 확인 전에는 안전 검증 통과로 쓰지 않는다',
  },
  // ── S06 Docker 실행 결과 ───────────────────────────────────────────
  {
    id: 'EV-DOCKER-SRV-15', area: 'S06', feature: 'FEAT-BDC-001', profile: 'QM',
    target: `FP 서버 8.2.0 · ${BDC_BOM.id}@${BDC_BOM.version}`, hash: BDC_HASH,
    tver: 'fp-server 8.2.0 · suite 214', tool: 'docker compose · fp-stack',
    env: 'image sha256:9f2c41ab… · postgres 16 · node 20', result: 'PASS', validity: 'VALID',
    source: 'REPORT index.html · result.json · junit.xml', srcKind: 'REPORT',
    at: stamp('2026-09-13', '06:30'), mode: '실제 실행',
  },
  {
    id: 'EV-DOCKER-REF-16', area: 'S06', feature: 'FEAT-BDC-001', profile: 'QM',
    target: `${bdcTarget()} · 참조 모의`, hash: BDC_HASH,
    tver: 'fp-gate 참조 모의 1.0', tool: '설계 참조 모의',
    env: '로컬 정적 화면 · 서버 미기동', result: 'SKIP', validity: 'INVALID',
    source: 'REPORT design-reference.html', srcKind: 'REPORT',
    at: stamp('2026-09-12', '15:00'), mode: '참조 모의',
    reason: '참조 모의 — 실제 서버 시험 결과가 아니므로 서버 시험 증적으로 계상할 수 없다',
  },
  {
    id: 'EV-DOCKER-NORUN-17', area: 'S06', feature: 'FEAT-LIGHT-001', profile: 'QM',
    target: `${lightTarget} · fp-stack suite`, hash: LIGHT_HASH,
    tver: 'fp-server 8.2.0 · suite 214', tool: 'docker compose · fp-stack',
    env: 'image sha256:9f2c41ab… (예정)', result: '미실행', validity: 'PENDING',
    source: '실행 로그 없음', srcKind: 'RAW_LOG',
    at: '—', mode: '실제 실행',
    reason: '미실행 — 실행 전에는 PASS 로 표시하지 않는다',
  },
];

const EVIDENCE_SEED: EvRow[] = [...SEED_S01_S02, ...SEED_S04_S06];
// ── S03 정책과 조건 검증 — 정책 규칙 ───────────────────────────────────
interface PolicyRule {
  id: string;
  rule: string;
  ctx: string;
  op: string;
  value: string;
  resultType: string;
  profile: string;
  kind: '전략(OR)' | '제약(AND)' | '필수 자격(AND)';
  inverted?: boolean;
  ctxRequired: boolean;
  schema?: string;
}
const SUPPORTED_OPS = [
  'IN', 'NOT_IN', 'STR_STARTS_WITH', 'STR_ENDS_WITH', 'STR_CONTAINS', 'NUM_EQ', 'NUM_GT', 'NUM_GTE', 'NUM_LT',
  'NUM_LTE', 'DATE_AFTER', 'DATE_BEFORE', 'SEMVER_EQ', 'SEMVER_GT', 'SEMVER_LT', 'FLEXIBLE_ROLLOUT', 'CUSTOM_STRATEGY',
];
const POLICY_RULES: PolicyRule[] = [
  { id: 'R01', rule: '국가 포함', ctx: 'region', op: 'IN', value: 'KR, EU', resultType: 'Constraint', profile: 'FP 평가기 v1', kind: '제약(AND)', ctxRequired: true, schema: 'RSV-2.4' },
  { id: 'R02', rule: '차종 포함', ctx: 'vehicleModel', op: 'IN', value: 'IONIQ5, IONIQ6, GV80', resultType: 'Constraint', profile: 'FP 평가기 v1', kind: '제약(AND)', ctxRequired: true, schema: 'RSV-2.4' },
  { id: 'R03', rule: 'HW 세대 포함', ctx: 'hardwareCapability', op: 'STR_CONTAINS', value: 'GEN3', resultType: 'Constraint', profile: 'AAOS 차량 Agent', kind: '제약(AND)', ctxRequired: true, schema: 'RSV-2.3' },
  { id: 'R04', rule: '권리 보유', ctx: 'entitlementId', op: 'IN', value: 'BAT_PRECOND_PLUS', resultType: 'Entitlement', profile: 'FP 평가기 v1', kind: '필수 자격(AND)', ctxRequired: true, schema: 'RSV-2.4' },
  { id: 'R05', rule: '점진 확대', ctx: 'targetingKey', op: 'FLEXIBLE_ROLLOUT', value: '20% · groupId bdc-kr-2027', resultType: 'Variant', profile: 'flexibleRollout v1', kind: '전략(OR)', ctxRequired: true },
  { id: 'R06', rule: '최소 SW 버전', ctx: 'bmsSoftwareVersion', op: 'SEMVER_GTE', value: '2.7.0', resultType: 'Constraint', profile: 'SDK Android 8.2', kind: '제약(AND)', ctxRequired: true, schema: 'RSV-2.4' },
  { id: 'R07', rule: '예외 시장 제외 (inverted)', ctx: 'market', op: 'NOT_IN', value: 'JP', resultType: 'Constraint', profile: 'FP 평가기 v1', kind: '제약(AND)', inverted: true, ctxRequired: false, schema: 'RSV-2.4' },
  { id: 'R08', rule: '게시 시작 시각', ctx: 'currentTime', op: 'DATE_AFTER', value: '2026-10-01T00:00Z', resultType: 'Constraint', profile: 'FP 평가기 v1', kind: '제약(AND)', ctxRequired: true, schema: 'RSV-2.4' },
  { id: 'R09', rule: '옵션 미지정 제외 (inverted)', ctx: 'optionCode', op: 'NOT_IN', value: 'NOT_APPLICABLE', resultType: 'Constraint', profile: 'AAOS 차량 Agent', kind: '제약(AND)', inverted: true, ctxRequired: false, schema: 'RSV-2.3' },
];

/** 검증 실행 결과 — 실행 전에는 비어 있고, 실행하면 findings 가 쌓인다. */
const CHECK_FINDINGS: Record<string, string[]> = {
  'UI16-S03-A01': [
    `전략(OR) ${POLICY_RULES.filter(r => r.kind === '전략(OR)').length}건 — 제약(AND)과 다른 진리표로 평가 (strategyVersionRef v4.1)`,
    `필수 자격(AND) ${POLICY_RULES.filter(r => r.kind === '필수 자격(AND)').length}건 — vendor 판정과 별도 검사`,
    `진리표 대조 ${POLICY_RULES.length}건 중 불일치 0건`,
  ],
  'UI16-S03-A02': [
    'R07 NOT_IN — context key market 누락 시 UNKNOWN 유지 (단순 false 반전 금지)',
    'R09 NOT_IN — optionCode 출처 freshness 미확인 1건 → UNKNOWN',
    'N/A · ANY · null · UNKNOWN 구분 확인 3건',
  ],
  'UI16-S03-A03': [
    'R05 ResultSchema 미결속 1건 — Variant payload 타입 확정 불가',
    '결정 이유 미기재 0건 · errorCode 구분 6종',
  ],
};

// ── S04 호환성 표 ─────────────────────────────────────────────────────
const SDK_COMPAT = [
  { sdk: 'SDK Node 8.2.0', cap: 'flexibleRollout · typed constraints', legacy: 'legacy v8 API 미지원', golden: '128/128 일치', verdict: '지원' },
  { sdk: 'SDK Android 8.2.0', cap: 'flexibleRollout · typed constraints', legacy: 'legacy v8 API 미지원', golden: '128/128 일치', verdict: '지원' },
  { sdk: 'AAOS 차량 Agent 8.2.0', cap: 'flexibleRollout · typed constraints', legacy: 'legacy override 읽기만', golden: '124/128 일치', verdict: '조건부' },
  { sdk: 'SDK iOS 8.1.0', cap: 'flexibleRollout 만 지원', legacy: '미지원', golden: '골든 입력 없음', verdict: '미지원' },
];

// ── S07 승인 검토 항목 (정본 열: 검토 항목 · 내용 및 정확 참조 · 담당 역할 · 충족 여부 · 차단 사유) ──
interface ApItem { item: string; ref: string; role: string; ok: boolean; block: string }
interface ApRec { by: string; role: string; reason: string; at: string; hash: string }

const AP_STEPS = [
  { key: 'GATHERED', ko: '증적 수집' }, { key: 'QUALITY', ko: '품질 평가' },
  { key: 'OPS', ko: '운영 승인' }, { key: 'READY', ko: '승인 연결' },
];
const AP_TERMINAL = [{ ko: '반려(REJECTED)' }, { ko: '보류(HOLD)' }];
const EV_STEPS = [{ key: 'PENDING', ko: '등록 대기' }, { key: 'REVIEW', ko: '검증 중' }, { key: 'VALID', ko: '유효' }];
const EV_TERMINAL = [{ ko: '무효(INVALID)' }, { ko: '기간 만료(EXPIRED)' }, { ko: '미확인(UNKNOWN)' }];
const GUARD_STEPS = [
  { key: 'IDLE', ko: '주행 상태' }, { key: 'REQUESTED', ko: '전이 요청' }, { key: 'GUARDED', ko: 'ECU Guard 확인' },
  { key: 'READBACK', ko: 'readback 일치' }, { key: 'RESTORED', ko: '복귀 완료' },
];

// ── Unleash/OSS 검토 항목 — 이 화면이 담당하는 항목 ─────────────────────
const s01Rules: UlRule[] = [
  {
    ul: 'UL-003', rule: '증적은 version·build digest·시험/SDK 버전·관찰 시각·원천 종류를 함께 남긴다', verdict: 'PASS',
    evidence: `증적 ${EVIDENCE_SEED.length}건 전부 시각·원천 기재 · 원천 ${SRC_KINDS.map(k => SRC_LABEL[k]).join('/')} 3종 구분`,
  },
  {
    ul: 'UL-015', rule: 'Parent·Topology 관계는 축소하지 않는다 — 도구의 1부모 제한으로 필요한 관계를 지우지 않는다', verdict: 'WARN',
    evidence: `${BDC_BOM.id}@${BDC_BOM.version} 구성원 ${BDC_BOM.members.length}건·관계 ${BDC_BOM.topologyNodes.length}건 유지 · 미변환 다단계 의존 2건`,
  },
];
const s02Rules: UlRule[] = [
  {
    ul: 'UL-080', rule: '등록 입력은 라벨·오류 요약·미저장 보존·412 삼자비교를 지킨다', verdict: 'WARN',
    evidence: '필수 입력 6개 라벨 연결 · 미저장 초안 보존 1건 · 412 삼자비교 미적용 1건 (권한 검사는 서버 몫)',
  },
];
const s03Rules: UlRule[] = [
  { ul: 'UL-019', rule: '전략 OR·제약 AND·필수 자격을 같은 진리표로 평가한다', verdict: 'PASS', evidence: `규칙 ${POLICY_RULES.length}건 · 전략 1 / 제약 7 / 필수 자격 1 · 진리표 v4.1` },
  { ul: 'UL-023', rule: '연산자는 지원표에 있는 것만 쓴다 — 구현에만 있는 연산자를 정식 지원으로 올리지 않는다', verdict: 'PASS', evidence: `공개 연산자 17종 중 사용 ${new Set(POLICY_RULES.map(r => r.op)).size}종 · 미지원 0건 · REGEX 미사용` },
  { ul: 'UL-024', rule: 'NOT_IN·inverted 에서 context key 가 없으면 단순 반전으로 true 를 만들지 않는다', verdict: 'FAIL', evidence: 'R07 NOT_IN · context key market 누락 1건 · UNKNOWN 유지 규칙 미구현' },
  { ul: 'UL-032', rule: 'Date 조건은 timezone·경계 포함·시계 오차·신선도를 함께 본다', verdict: 'WARN', evidence: 'R08 currentTime 2026-10-01T00:00Z (UTC) · 시계 오차 허용 90초 미기재 1건' },
  { ul: 'UL-033', rule: 'Variant 가중치는 총합·0가중치·잔여 분배 규칙 안에서만 배분한다', verdict: 'PASS', evidence: 'Variant 3종 · 가중치 합 100.0 · 0가중치 1종 · UI 20% → wire 20000' },
  { ul: 'UL-034', rule: 'payload 타입과 단위를 ResultSchemaVersion 에 결속한다', verdict: 'PASS', evidence: 'RSV-2.4 · string/json/number 3종 · 단위 미표기 0건 · 자유 JSON 변경 0건' },
  { ul: 'UL-036', rule: 'off·variant 없음·type mismatch 를 유효한 비즈니스 값과 섞지 않는다', verdict: 'PASS', evidence: 'errorCode 6종 분리 · default 반환 2건 모두 reason 기재 · valid decision 아님' },
  { ul: 'UL-058', rule: 'Preview 는 capture·기준선·context schema 를 고정한 비작동 평가로만 한다', verdict: 'WARN', evidence: 'Preview 12회 · 고정 capture 11회 · 조합 확장 차단 1건' },
];
const s04Rules: UlRule[] = [
  { ul: 'UL-020', rule: '미지원 전략은 후보 전체를 거부하고 차량 profile 은 whitelist 로 제한한다', verdict: 'PASS', evidence: `전략 7종 · SDK 4종 지원표 · legacy API 미지원 2종 거부 확인 (${SDK_COMPAT.length}행)` },
  { ul: 'UL-030', rule: 'hash 알고리즘·normalization·groupId 를 고정하고 SDK 언어별 골든 벡터로 확인한다', verdict: 'PASS', evidence: 'golden vector 128건 · 4개 언어 동일 결과 · groupId bdc-kr-2027' },
  { ul: 'UL-031', rule: 'signed artifact·capability·시험 증거가 없는 custom strategy 는 차량 publication 을 거절한다', verdict: 'FAIL', evidence: 'custom strategy 1건 — 서명 없음 · 시험 증거 없음 · publication 후보 등록 차단' },
  { ul: 'UL-035', rule: 'legacy 환경 Variant 는 lossless 로 보존하고 지원하지 못하면 명시 거부한다', verdict: 'WARN', evidence: 'legacy Variant 5종 보존 · override 우선순위 비교 4/5 완료 · 자동 변환 0건' },
  { ul: 'UL-061', rule: 'Provider 초기화·Context 우선순위·STALE/NOT_READY/FATAL 을 계약으로 고정한다', verdict: 'PASS', evidence: 'provider event 6종 · STALE 1건 / FATAL 0건 · facade provenance 반환' },
];
const s05Rules: UlRule[] = [
  { ul: 'UL-037', rule: '실험 차량 허용 범위는 안전 envelope·중단 조건·승인 참조 안에서만 연다', verdict: 'WARN', evidence: `cohort ${new Set(sampleVehicles.map(v => v.cohort)).size}개 · 배정 단위 차량 · 중단 조건 2건 · 안전 허용 envelope 미기재 1건` },
  { ul: 'UL-065', rule: '오프라인·부팅·만료 시 기본 안전 동작과 재동기화 절차를 기능별로 승인한다', verdict: 'PASS', evidence: '오프라인 복구 4회 · last-known-good 3회 · 만료 시 신규 활성 HOLD 1회' },
  { ul: 'UL-081', rule: '골든 입력과 실제 통합·차량 시험을 단계별로 기록한다 (로그에 버전·digest·입력 hash·환경)', verdict: 'PASS', evidence: '단계 6/6 기록 · 미실행 사유 기재 2건 · readback 미보고 3대 별도 표기' },
];
const s06Rules: UlRule[] = [
  { ul: 'UL-062', rule: '검증된 서명 package 만 저장소에 넣고 일반 polling 이 bootstrap 결과를 덮지 않게 한다', verdict: 'PASS', evidence: '서명 검증 6/6 · live fetch 0건 · sink 비활성 시험 2건' },
  { ul: 'UL-063', rule: 'publication lease·snapshot 동시 교체 한계와 준비 전 교체 금지를 지킨다', verdict: 'PASS', evidence: 'lease 4 · 최대 동시 2 · 준비 전 교체 0건 · 예외 시 finally 반환 4/4' },
  { ul: 'UL-069', rule: 'code deploy 와 기능 release 를 분리하고 artifact·소비자 버전·계약시험을 연결한다', verdict: 'WARN', evidence: 'artifact 3종 연결 · 소비자 버전 4종 · 자동 코드 삭제 후보 1건 미검토' },
];
const s07Rules: UlRule[] = [
  { ul: 'UL-071', rule: '제출·승인 명령은 commandId·expectedRevision·오류 코드(409·412)를 계승한다', verdict: 'PASS', evidence: 'commandId 41 → 42 · expectedRevision 일치 · 412 재시도 1건 · 오류 계약 6종' },
  { ul: 'UL-078', rule: '초안 저장 → 검증 → 검토 요청과 운영 발행을 분리하고 비활성 사유를 표기한다', verdict: 'WARN', evidence: '상태 4단계 분리 · 비활성 사유 표기 6/7 · 변경 전후 비교 미적용 1건' },
];

const EV_COLS: string[] = ['증적 ID', '대상 및 hash', '시험 버전', '실행 환경', '결과', '유효성', '원천'];
const POLICY_COLS: string[] = ['규칙', 'Context 속성', '연산자', '비교 값', '결과 유형', '지원 Profile'];
const AP_COLS: string[] = ['검토 항목', '내용 및 정확 참조', '담당 역할', '충족 여부', '차단 사유'];

const Result = ({ r }: { r: EvResult }) => (
  <span className="mono small" style={{ color: r === 'PASS' ? 'var(--pass)' : r === 'FAIL' ? 'var(--fail)' : 'var(--pending)' }}>{r}</span>
);
const State = ({ s }: { s: EvState }) => (
  <span className="pill" style={{ background: EV_TONE[s], color: '#fff', borderColor: 'transparent' }}>{s}</span>
);

/** 이 영역에 걸린 검토 항목 — 판정 색 배지로 먼저 훑고 규칙 행으로 내려간다. */
function UlTitle({ items }: { items: UlRule[] }) {
  return (
    <span className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
      <span>이 영역에 걸린 검토 항목</span>
      {items.map(i => <UlBadge key={i.ul} ul={i.ul} verdict={i.verdict} />)}
    </span>
  );
}

/** 선택 증적의 상세 — 표의 열을 그대로 편다. */
function EvidenceDetail({ r }: { r: EvRow }) {
  return (
    <div className="card mt" style={{ background: 'var(--surface-2)' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <b className="mono">{r.id}</b>
        <span className="row small" style={{ gap: 8 }}>
          <Result r={r.result} /><State s={r.validity} /><span className="muted">{r.mode}</span>
        </span>
      </div>
      <div className="kv mt">
        <div>대상 및 hash</div><div className="mono small">{r.target}<br />{r.hash}</div>
        <div>시험 버전</div><div className="mono small">{r.tver} · 도구 {r.tool}</div>
        <div>실행 환경</div><div className="mono small">{r.env}</div>
        <div>원천</div><div className="mono small">{r.source} · {SRC_LABEL[r.srcKind]}</div>
        <div>실행 시각</div><div className="mono small">{r.at}</div>
        <div>대상 Feature</div><div className="mono small">{r.feature} · 위험도 Profile {r.profile}</div>
        <div>검토 상태</div><div>{EV_KO[r.validity]}{r.reason ? ` · ${r.reason}` : ''}</div>
      </div>
      {r.validity !== 'VALID' && (
        <Reasons title="승인 입력으로 쓸 수 없는 이유" list={[r.reason || '사유 미기재 — UNKNOWN 은 사유 없이 확정하지 않는다']} />
      )}
    </div>
  );
}
export function QualityEvidence() {
  const { state, dispatch, can } = useApp();
  const toast = useToast();

  const [extra, setExtra] = useState<EvRow[]>([]);
  const [pick, setPick] = useState<string>(EVIDENCE_SEED[0].id);
  const [flt, setFlt] = useState({ profile: 'ALL', validity: 'ALL', result: 'ALL', feature: 'ALL' });
  const [reason, setReason] = useState('');
  const [form, setForm] = useState({
    id: '', target: bdcTarget(), hash: BDC_HASH, tver: '', env: '', source: '',
    validity: 'PENDING' as EvState, result: 'PASS' as EvResult, reason: '', refOnly: false,
  });
  const [runs, setRuns] = useState<Record<string, { at: string; findings: string[] }>>({});
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [probe, setProbe] = useState({ rule: 'R07', ctxGiven: false });
  const [lease, setLease] = useState({ prepared: true, leases: 3 });
  const [guard, setGuard] = useState({ step: 'IDLE', refused: '' });
  const [rb, setRb] = useState({ reported: 9, unreported: 3 });
  const [acc, setAcc] = useState({ harness: '', ref: '', note: '' });
  const [ap, setAp] = useState<{ quality?: ApRec; ops?: ApRec; rejected?: ApRec }>({});
  const [pack, setPack] = useState({ digest: 'sha256:9f2c41ab', junit: true, html: true });

  const rows = [...extra, ...EVIDENCE_SEED];
  const audited = (action: string, target: string, detail: string) =>
    dispatch({ t: 'AUDIT', entry: { ts: '2026-09-13 11:05', actor: state.role, action, target, detail } });

  const passFlt = (r: EvRow) =>
    (flt.profile === 'ALL' || r.profile === flt.profile) &&
    (flt.validity === 'ALL' || r.validity === flt.validity) &&
    (flt.result === 'ALL' || r.result === flt.result) &&
    (flt.feature === 'ALL' || r.feature === flt.feature);
  const byArea = (a: EvArea, applyFilter: boolean) => rows.filter(r => r.area === a && (!applyFilter || passFlt(r)));
  const pickFrom = (list: EvRow[], fallback: EvRow[]) => list.find(r => r.id === pick) || list[0] || fallback[0];

  const countState = (s: EvState) => rows.filter(r => r.validity === s).length;
  const blockedEv = rows.filter(r => r.validity === 'INVALID' || r.validity === 'EXPIRED');
  const unknownEv = rows.filter(r => r.validity === 'UNKNOWN');
  const allRules = [...s01Rules, ...s02Rules, ...s03Rules, ...s04Rules, ...s05Rules, ...s06Rules, ...s07Rules];
  const failRules = allRules.filter(r => r.verdict === 'FAIL');
  const apCurrent = ap.rejected ? '반려(REJECTED)' : ap.ops ? 'READY' : ap.quality ? 'OPS' : 'GATHERED';

  const apItems: ApItem[] = [
    {
      item: '검토 대상 확정', ref: `${BDC_BOM.id}@${BDC_BOM.version} · 구성원 ${BDC_BOM.members.length}건 · 내용 hash ${BDC_HASH.slice(7, 19)}`,
      role: '작성자', ok: true, block: '',
    },
    {
      item: '증적 유효성', ref: `증적 ${rows.length}건 · 유효 ${countState('VALID')} / 미확인 ${countState('UNKNOWN')} / 무효·만료 ${blockedEv.length}`,
      role: '품질', ok: unknownEv.length === 0, block: unknownEv.length ? `${unknownEv[0].id} 유효성 UNKNOWN — 결과·원천·기간 미확인` : '',
    },
    {
      item: '정책·조건 검증', ref: `규칙 ${POLICY_RULES.length}건 · findings ${Object.values(runs).reduce((n, r) => n + r.findings.length, 0)}건`,
      role: '품질', ok: !!runs['UI16-S03-A01'] && !!done.pass, block: 'UL-024 NOT_IN — context key 누락 시 UNKNOWN 유지 규칙 미구현',
    },
    {
      item: 'SDK 호환성', ref: `골든 벡터 128건 · 언어 4종 · SnapshotLease lease ${lease.leases}`,
      role: '품질', ok: !!runs['UI16-S04-A02'] && runs['UI16-S04-A02'].findings.length === 0,
      block: '골든 벡터 회귀 결과 없음 — 시험 종류 이름만으로 호환성 통과를 만들지 않는다',
    },
    {
      item: '차량·안전 검증', ref: `ECU Guard ${guard.refused || guard.step} · readback 보고 ${rb.reported}대 / 미보고 ${rb.unreported}대`,
      role: '품질', ok: guard.step === 'RESTORED' && !guard.refused && rb.unreported === 0,
      block: guard.refused || guard.step !== 'RESTORED'
        ? `안전 전이 시퀀스 ${guard.refused || guard.step} — 복귀 확인 전`
        : 'readback 미보고 3대 — 성공으로 합산하지 않는다',
    },
    {
      item: '직무 분리', ref: `작성자 kim.taeho@body · 품질 평가자 ${ap.quality?.by || '—'} · 운영 승인자 ${ap.ops?.by || '—'}`,
      role: '승인', ok: !!ap.quality && (!ap.ops || ap.ops.role !== ap.quality.role),
      block: ap.quality && ap.ops && ap.ops.role === ap.quality.role ? '품질 평가와 운영 승인이 같은 역할' : '승인 기록 없음',
    },
    {
      item: '유효기간', ref: '증적 유효기간 최대 2026-12-31 · 만료 1건 · 미기재 2건',
      role: '승인', ok: false, block: 'EV-ADAS-PROF-02 유효기간 2026-08-31 종료 · EV-VEH-ENV-14 기간 미기재',
    },
    {
      item: '승인 hash 결속', ref: `내용 hash ${BDC_HASH.slice(7, 19)} · commandId 42 · expectedRevision 일치`,
      role: '승인', ok: !!ap.ops, block: ap.ops ? '' : '운영 승인 없음 — 승인은 내용 hash 에 결속되어야 한다',
    },
  ];
  const apBlocks = apItems.filter(i => !i.ok).map(i => `${i.item} — ${i.block}`);

  const areas: Record<string, () => ReactNode> = {
    // ── S01 품질 Profile과 검증 대상 ──────────────────────────────────
    'UI16-S01': () => {
      const list = byArea('S01', true);
      const sel = pickFrom(list, byArea('S01', false));
      return (
        <div>
          <div className="row small" style={{ gap: 14, flexWrap: 'wrap' }}>
            <span>정확 기준선 <b className="mono">{BDC_BOM.id}@{BDC_BOM.version}</b></span>
            <span>내용 hash <b className="mono">{BDC_HASH.slice(7, 23)}</b></span>
            <span>대상 규모 <b>{num(fleetStats.total)}대</b></span>
            <span>위험도 Profile <b>{PROFILES.length}종</b></span>
            <span>안전 등급 대상 <b>{features.filter(f => (f.safety || '').trim() !== '').length}건</b></span>
          </div>

          <div className="mt" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(130px, 1fr))', gap: 8, alignItems: 'end' }}>
            <label className="small muted">위험도 Profile
              <select style={{ ...FIELD, marginTop: 4 }} value={flt.profile} onChange={e => setFlt({ ...flt, profile: e.target.value })}>
                <option value="ALL">전체</option>
                {PROFILES.map(p => <option key={p.key} value={p.key}>{p.risk} · {p.profiles}</option>)}
              </select>
            </label>
            <label className="small muted">유효성
              <select style={{ ...FIELD, marginTop: 4 }} value={flt.validity} onChange={e => setFlt({ ...flt, validity: e.target.value })}>
                <option value="ALL">전체</option>
                {EV_STATES.map(s => <option key={s} value={s}>{s} · {EV_KO[s]}</option>)}
              </select>
            </label>
            <label className="small muted">결과
              <select style={{ ...FIELD, marginTop: 4 }} value={flt.result} onChange={e => setFlt({ ...flt, result: e.target.value })}>
                <option value="ALL">전체</option>
                {RESULTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="small muted">대상 Feature
              <select style={{ ...FIELD, marginTop: 4 }} value={flt.feature} onChange={e => setFlt({ ...flt, feature: e.target.value })}>
                <option value="ALL">전체</option>
                {Array.from(new Set(rows.map(r => r.feature))).map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
          </div>

          <div className="row mt" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Gated label="위험도별 Profile 조회" reasons={flt.profile === 'ALL' ? ['위험도 Profile 을 고르지 않았다'] : []}
              onClick={() => { const p = PROFILES.find(x => x.key === flt.profile); audited('EVID_PROFILE_VIEW', flt.profile, `${p?.profiles || ''} · 필수 시험 ${p?.required || ''} · 주기 ${p?.interval || ''}`); toast(`${flt.profile} Profile 조회 — ${p?.required || ''}`); }} />
            <Gated label="정확 Feature BOM 정책 버전 연결" reasons={BDC_BOM.state === 'IN_REVIEW' ? [] : [`기준선 ${BDC_BOM.id} 상태 ${BDC_BOM.state}`]}
              onClick={() => { audited('EVID_BASELINE_BIND', BDC_BOM.id, `${BDC_HASH.slice(7, 23)} · 구성원 ${BDC_BOM.members.length}건`); toast(`${BDC_BOM.id}@${BDC_BOM.version} 연결 — 내용 hash 결속`); }} />
            <Gated label="필수 시험과 완료 기준 확인" reasons={flt.profile === 'ALL' ? ['Profile 미선택'] : []}
              onClick={() => { const p = PROFILES.find(x => x.key === flt.profile); audited('EVID_REQUIRED_TESTS', flt.profile, `${p?.required || ''} · 주기 ${p?.interval || ''} · 담당 ${p?.owner || ''}`); toast(`필수 시험 확인 — ${p?.required || ''}`); }} />
          </div>

          <div className="mt"><Table head={EV_COLS}>
            {list.length === 0 && <tr><td colSpan={EV_COLS.length} className="small muted">조건에 맞는 검증 대상이 없다 — 필터를 넓혀 확인한다.</td></tr>}
            {list.map(r => (
              <tr key={r.id} onClick={() => setPick(r.id)} style={{ cursor: 'pointer', background: r.id === pick ? 'var(--surface-2)' : undefined }}>
                <td className="mono small">{r.id}<br /><span className="muted">{r.profile}</span></td>
                <td className="mono small">{r.target}<br /><span className="muted">{r.hash.slice(0, 20)}</span></td>
                <td className="mono small">{r.tver}</td>
                <td className="small">{r.env}</td>
                <td><Result r={r.result} /></td>
                <td><State s={r.validity} /></td>
                <td className="small muted">{SRC_LABEL[r.srcKind]}<br />{r.source}</td>
              </tr>
            ))}
          </Table></div>

          {sel && <EvidenceDetail r={sel} />}

          <div className="kv mt">
            <div>검증 대상</div><div className="mono small">{BDC_BOM.members.map(m => m.featureVersionRef).join(', ')}</div>
            <div>필수 시험</div><div className="small">{PROFILES.map(p => `${p.risk}: ${p.required}`).join(' · ')}</div>
            <div>검증 주기</div><div className="small">{PROFILES.map(p => `${p.risk} ${p.interval} · ${p.owner}`).join(' · ')}</div>
          </div>

          <p className="small muted mt">주의 {ulWarns(s01Rules).length}건은 진행을 막지 않는다.</p>
          <div className="mt"><UlRules items={s01Rules} title={<UlTitle items={s01Rules} />} /></div>
        </div>
      );
    },

    // ── S02 시험과 증적 등록 ─────────────────────────────────────────
    'UI16-S02': () => {
      const list = byArea('S02', false);
      const sel = pickFrom(list, list);
      const regReasons = [
        !form.id.trim() && '증적 ID 없음',
        !form.target.trim() && '대상 없음',
        !/^sha256:[0-9a-f]{8,}$/i.test(form.hash.trim()) && '대상 hash 가 없거나 형식이 아니다 (sha256:…)',
        !form.tver.trim() && '시험과 버전 없음',
        !form.env.trim() && '실행 환경 없음',
        !form.source.trim() && '원천 링크 없음',
        form.refOnly && '참조 모의는 실제 증적으로 등록할 수 없다',
        form.validity === 'UNKNOWN' && !form.reason.trim() && 'UNKNOWN 은 사유 없이 저장할 수 없다',
        (form.validity === 'INVALID' || form.validity === 'EXPIRED') && !form.reason.trim() && '무효·만료는 사유가 있어야 한다',
        !can('edit') && `역할 ${state.role} 에게 편집 권한이 없다`,
      ].filter(Boolean) as string[];

      return (
        <div>
          <StageRail steps={EV_STEPS} current={sel.validity === 'VALID' ? 'VALID' : sel.validity === 'PENDING' ? 'PENDING' : sel.validity}
            terminal={EV_TERMINAL}
            note="등록과 유효성 판정은 다른 단계다 — 검토 전 PENDING 은 승인 입력이 아니고, 미확인(UNKNOWN)은 사유와 함께 남는다." />

          <div className="row mt" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Gated label="증적 hash 버전 유효기간 확인" reasons={sel ? [] : ['확인할 증적을 고르지 않았다']}
              onClick={() => { audited('EVID_HASH_CHECK', sel.id, `${sel.hash.slice(0, 20)} · ${sel.tver} · ${sel.validity} · ${sel.at}`); toast(`${sel.id} hash·버전 확인 — ${sel.validity}`); }} />
            <Gated label="외부 시험의 판정 책임 표시" reasons={sel && sel.srcKind === 'REPORT' ? [] : ['외부 원천(리포트) 증적이 아니다']}
              onClick={() => { audited('EVID_OWNER', sel.id, '판정 책임 = 품질 (외부 기관은 실행만 수행)'); toast(`${sel.id} 판정 책임을 품질로 표시`); }} />
            <span className="small muted">첨부가 있다는 사실과 검증을 통과했다는 사실은 다르다.</span>
          </div>

          <div className="card mt" style={{ background: 'var(--surface-2)' }}>
            <b className="small">시험 결과와 원천 등록</b>
            <div className="mt" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(160px, 1fr))', gap: 8 }}>
              <label className="small muted">증적 ID
                <input style={{ ...FIELD, marginTop: 4 }} value={form.id} onChange={e => setForm({ ...form, id: e.target.value })} placeholder="EV-BDC-…" />
              </label>
              <label className="small muted">대상
                <input style={{ ...FIELD, marginTop: 4 }} value={form.target} onChange={e => setForm({ ...form, target: e.target.value })} />
              </label>
              <label className="small muted">대상 hash
                <input className="mono" style={{ ...FIELD, marginTop: 4 }} value={form.hash} onChange={e => setForm({ ...form, hash: e.target.value })} />
              </label>
              <label className="small muted">시험과 버전
                <input style={{ ...FIELD, marginTop: 4 }} value={form.tver} onChange={e => setForm({ ...form, tver: e.target.value })} placeholder="HIL-BDC-42@1.1" />
              </label>
              <label className="small muted">실행 환경
                <input style={{ ...FIELD, marginTop: 4 }} value={form.env} onChange={e => setForm({ ...form, env: e.target.value })} placeholder="HIL 벤치 · bench id" />
              </label>
              <label className="small muted">원천 링크
                <input style={{ ...FIELD, marginTop: 4 }} value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} placeholder="RAW_LOG … / REPORT …" />
              </label>
              <label className="small muted">결과
                <select style={{ ...FIELD, marginTop: 4 }} value={form.result} onChange={e => setForm({ ...form, result: e.target.value as EvResult })}>
                  {RESULTS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label className="small muted">유효성
                <select style={{ ...FIELD, marginTop: 4 }} value={form.validity} onChange={e => setForm({ ...form, validity: e.target.value as EvState })}>
                  {EV_STATES.map(s => <option key={s} value={s}>{s} · {EV_KO[s]}</option>)}
                </select>
              </label>
              <label className="small muted">사유 (무효·만료·미확인)
                <input style={{ ...FIELD, marginTop: 4 }} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} />
              </label>
            </div>
            <label className="row small muted mt" style={{ gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={form.refOnly} onChange={e => setForm({ ...form, refOnly: e.target.checked })} />
              참조 모의로 등록 (실제 실행 증적으로 세지 않는다)
            </label>
            <div className="row mt" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Gated label="시험 결과와 원천 링크 등록" kind="primary" reasons={regReasons}
                onClick={() => {
                  const row: EvRow = {
                    id: form.id.trim(), area: 'S02', feature: form.target.split('@')[0] || 'FEAT-미지정',
                    profile: 'QM', target: form.target.trim(), hash: form.hash.trim(), tver: form.tver.trim(),
                    tool: form.tver.split('@')[0] || '—', env: form.env.trim(), result: form.result, validity: form.validity,
                    source: form.source.trim(), srcKind: form.source.toUpperCase().includes('RAW_LOG') ? 'RAW_LOG' : 'REPORT',
                    at: stamp('2026-09-13', '11:05'), mode: form.refOnly ? '참조 모의' : '실제 실행',
                    reason: form.reason.trim() || (form.validity === 'VALID' ? undefined : '사유 미기재'),
                  };
                  setExtra([row, ...extra]);
                  setPick(row.id);
                  audited('EVID_REGISTER', row.id, `${row.tver} · ${row.result} · ${row.validity} · ${row.hash.slice(0, 18)}`);
                  toast(`${row.id} 등록 — ${row.validity}`);
                  setForm({ ...form, id: '', tver: '', env: '', source: '', reason: '' });
                }} />
              <span className="small muted">승인된 원본은 덮어쓰지 않는다 — 다시 실행하면 새 증적 건으로 남는다.</span>
            </div>
            <div className="mt"><Reasons title="등록 차단 사유" list={regReasons} ok={regReasons.length === 0} /></div>
          </div>

          <div className="mt"><Table head={EV_COLS}>
            {list.map(r => (
              <tr key={r.id} onClick={() => setPick(r.id)} style={{ cursor: 'pointer', background: r.id === pick ? 'var(--surface-2)' : undefined }}>
                <td className="mono small">{r.id}</td>
                <td className="mono small">{r.target}<br /><span className="muted">{r.hash.slice(0, 20)}</span></td>
                <td className="mono small">{r.tver}</td>
                <td className="small">{r.env}</td>
                <td><Result r={r.result} /></td>
                <td><State s={r.validity} /></td>
                <td className="small muted">{SRC_LABEL[r.srcKind]}<br />{r.source}</td>
              </tr>
            ))}
          </Table></div>

          {sel && <EvidenceDetail r={sel} />}
          <div className="mt"><UlRules items={s02Rules} title={<UlTitle items={s02Rules} />} /></div>
        </div>
      );
    },
    // ── S03 정책과 조건 검증 ─────────────────────────────────────────
    'UI16-S03': () => {
      const rule = POLICY_RULES.find(r => r.id === probe.rule) || POLICY_RULES[0];
      const preview = probe.ctxGiven
        ? (rule.inverted ? 'false — 제외 조건 미해당' : 'true — 포함 조건 해당')
        : (rule.inverted ? 'UNKNOWN — 반전으로 true 를 만들지 않는다' : 'UNKNOWN — context key 누락');
      const passReasons = [
        ...ulBlocks(s03Rules),
        !runs['UI16-S03-A01'] && 'Constraint·CanonicalPolicy 검증을 아직 실행하지 않았다',
        !runs['UI16-S03-A02'] && 'UNKNOWN·부정 조건 검사를 아직 실행하지 않았다',
        !can('approve') && `역할 ${state.role} 에게 판정 권한이 없다`,
        !reason.trim() && '판정 사유가 없다',
      ].filter(Boolean) as string[];
      const runnable = !can('run-engine') ? [`역할 ${state.role} 에게 검증 실행 권한이 없다`] : [];

      return (
        <div>
          <div className="row small" style={{ gap: 14, flexWrap: 'wrap' }}>
            <span>정책 <b className="mono">POLICY-BDC-ENABLE</b></span>
            <span>진리표 <b className="mono">v4.1</b></span>
            <span>규칙 <b>{POLICY_RULES.length}건</b></span>
            <span>공개 연산자 <b>{SUPPORTED_OPS.length}종</b></span>
            <span>검증 실행 <b>{Object.keys(runs).length}/3</b></span>
          </div>

          <div className="row mt" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Gated label="Constraint와 CanonicalPolicy 검증" reasons={runnable}
              onClick={() => { setRuns({ ...runs, 'UI16-S03-A01': { at: stamp('2026-09-13', '11:20'), findings: CHECK_FINDINGS['UI16-S03-A01'] } }); audited('QUALITY_VALIDATE', 'POLICY-BDC-ENABLE', 'A01 · 진리표 대조 · 전략/제약/자격 분리'); toast('정책 검증 실행 — findings 3건'); }} />
            <Gated label="UNKNOWN 및 부정 조건 검사" reasons={runnable}
              onClick={() => { setRuns({ ...runs, 'UI16-S03-A02': { at: stamp('2026-09-13', '11:22'), findings: CHECK_FINDINGS['UI16-S03-A02'] } }); audited('QUALITY_VALIDATE', 'POLICY-BDC-ENABLE', 'A02 · NOT_IN·inverted UNKNOWN 처리'); toast('부정 조건 검사 — findings 3건'); }} />
            <Gated label="ResultSchema와 결정 이유 검증" reasons={runnable}
              onClick={() => { setRuns({ ...runs, 'UI16-S03-A03': { at: stamp('2026-09-13', '11:24'), findings: CHECK_FINDINGS['UI16-S03-A03'] } }); audited('QUALITY_VALIDATE', 'POLICY-BDC-ENABLE', 'A03 · ResultSchema·errorCode 결속'); toast('ResultSchema 검증 — findings 2건'); }} />
          </div>

          <div className="mt"><Table head={POLICY_COLS}>
            {POLICY_RULES.map(r => (
              <tr key={r.id} style={{ background: r.id === probe.rule ? 'var(--surface-2)' : undefined }}>
                <td>{r.id} {r.rule}<br /><span className="small muted">{r.kind}</span></td>
                <td className="mono small">{r.ctx}{r.ctxRequired ? ' · 필수' : ' · 선택'}</td>
                <td className="mono small">{r.op}{SUPPORTED_OPS.includes(r.op) ? '' : ' (미지원)'}</td>
                <td className="mono small">{r.value}</td>
                <td className="small">{r.resultType}{r.schema ? ` · ${r.schema}` : ' · 스키마 없음'}</td>
                <td className="small">{r.profile}</td>
              </tr>
            ))}
          </Table></div>

          <div className="card mt" style={{ background: 'var(--surface-2)' }}>
            <b className="small">조건 판정 미리보기 (비작동)</b>
            <div className="mt" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(160px, 1fr))', gap: 8, alignItems: 'end' }}>
              <label className="small muted">규칙
                <select style={{ ...FIELD, marginTop: 4 }} value={probe.rule} onChange={e => setProbe({ ...probe, rule: e.target.value })}>
                  {POLICY_RULES.map(r => <option key={r.id} value={r.id}>{r.id} · {r.rule}</option>)}
                </select>
              </label>
              <label className="small muted">Context 값 제공
                <select style={{ ...FIELD, marginTop: 4 }} value={probe.ctxGiven ? 'YES' : 'NO'} onChange={e => setProbe({ ...probe, ctxGiven: e.target.value === 'YES' })}>
                  <option value="YES">제공</option>
                  <option value="NO">미제공 (key 누락)</option>
                </select>
              </label>
            </div>
            <div className="kv mt">
              <div>Context 속성</div><div className="mono small">{rule.ctx} · {probe.ctxGiven ? '제공' : '미제공'}</div>
              <div>미리보기 판정</div><div className="small">{preview}</div>
              <div>실제 실행 결과</div><div className="small muted">미리보기는 비작동 평가다 — 실제 결과는 실행 증적으로만 확인한다.</div>
            </div>
          </div>

          <div className="row mt" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="small muted">판정 사유
              <input style={{ ...FIELD, marginTop: 4, minWidth: 260 }} value={reason} onChange={e => setReason(e.target.value)} />
            </label>
            <Gated label="조건 검증 통과(VALID) 로 전환" kind="primary" reasons={passReasons}
              onClick={() => { setDone({ ...done, pass: true }); audited('QUALITY_VALIDATE_PASS', 'POLICY-BDC-ENABLE', `진리표 v4.1 · 사유 ${reason}`); toast('조건 검증 통과 표시'); }} />
          </div>
          {done.pass && <p className="small mt" style={{ color: 'var(--pass)' }}>조건 검증 통과 — 차단 항목이 해소된 뒤에만 남는다.</p>}
          <div className="mt"><Reasons title="통과 전환 차단 사유" list={passReasons} ok={passReasons.length === 0} /></div>

          {Object.keys(runs).length > 0 && (
            <div className="mt">
              {Object.entries(runs).map(([k, v]) => (
                <div key={k} className="card" style={{ background: 'var(--surface-2)' }}>
                  <b className="small mono">{k}</b> <span className="small muted">{v.at} · findings {v.findings.length}건</span>
                  <ul className="small" style={{ margin: '6px 0 0 16px' }}>
                    {v.findings.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <div className="mt"><UlRules items={s03Rules} title={<UlTitle items={s03Rules} />} /></div>
        </div>
      );
    },

    // ── S04 SDK와 호환성 시험 ────────────────────────────────────────
    'UI16-S04': () => {
      const list = byArea('S04', false);
      const sel = pickFrom(list, list);
      const golden = runs['UI16-S04-A02'];
      const invalid = list.find(r => r.validity === 'INVALID');
      const pubReasons = [
        ...ulBlocks(s04Rules),
        !golden && '골든 벡터 회귀를 아직 실행하지 않았다',
        invalid ? `${invalid.id} 무효 — 미지원 전략 후보는 전체 거부` : '',
        !can('approve') && `역할 ${state.role} 에게 승인 권한이 없다`,
      ].filter(Boolean) as string[];

      return (
        <div>
          <div className="row small" style={{ gap: 14, flexWrap: 'wrap' }}>
            <span>Provider <b className="mono">8.2.0</b></span>
            <span>골든 벡터 <b>128건</b></span>
            <span>지원 언어 <b>4종</b></span>
            <span>SnapshotLease 최대 동시 <b>2</b> · 현재 <b>{lease.leases}</b></span>
          </div>

          <div className="row mt" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Gated label="CompatibilityProfile과 실제 버전 확인" reasons={sel ? [] : ['확인할 증적을 고르지 않았다']}
              onClick={() => { audited('EVID_COMPAT_VIEW', sel.id, `${sel.tver} · ${sel.env} · ${sel.hash.slice(0, 18)}`); toast(`${sel.id} 실제 버전 확인 — ${sel.tver}`); }} />
            <Gated label="Provider golden vector 회귀" reasons={!can('run-engine') ? [`역할 ${state.role} 에게 실행 권한이 없다`] : []}
              onClick={() => { setRuns({ ...runs, 'UI16-S04-A02': { at: stamp('2026-09-13', '11:30'), findings: [] } }); audited('QUALITY_VALIDATE', 'Provider 8.2.0', 'A02 · golden vector 128건 · 언어 4종 · 실패 0'); toast('골든 벡터 회귀 — 128/128 일치'); }} />
            <Gated label="SnapshotLease 및 오프라인 복구 검증" reasons={[lease.prepared ? '' : 'snapshot 준비 완료 전 — 교체 금지', !can('run-engine') ? '실행 권한 없음' : ''].filter(Boolean) as string[]}
              onClick={() => { setLease({ ...lease, leases: Math.min(2, lease.leases) }); audited('QUALITY_VALIDATE', 'EnginePool', `A03 · lease ${lease.leases} → 2 · 오프라인 복구 4회 · 준비 전 교체 0건`); toast('SnapshotLease 검증 — 준비 완료 후 교체 확인'); }} />
            <Gated label="호환성 승인 후보 등록" kind="primary" reasons={pubReasons}
              onClick={() => { audited('EVID_COMPAT_PUBLISH', 'Provider 8.2.0', `golden 128건 · lease ${lease.leases} · SDK 4종`); toast('호환성 승인 후보 등록'); }} />
          </div>

          <div className="mt"><Table head={EV_COLS}>
            {list.map(r => (
              <tr key={r.id} onClick={() => setPick(r.id)} style={{ cursor: 'pointer', background: r.id === pick ? 'var(--surface-2)' : undefined }}>
                <td className="mono small">{r.id}</td>
                <td className="mono small">{r.target}<br /><span className="muted">{r.hash.slice(0, 20)}</span></td>
                <td className="mono small">{r.tver}</td>
                <td className="small">{r.env}</td>
                <td><Result r={r.result} /></td>
                <td><State s={r.validity} /></td>
                <td className="small muted">{SRC_LABEL[r.srcKind]}<br />{r.source}</td>
              </tr>
            ))}
          </Table></div>

          {sel && <EvidenceDetail r={sel} />}

          <div className="kv mt">
            <div>호환성 Profile</div><div className="small">SDK 4종 대조 · 실제 배포 버전 기준</div>
            {SDK_COMPAT.map(c => (
              <div key={c.sdk} style={{ display: 'contents' }}>
                <div className="mono small">{c.sdk}</div>
                <div className="small">{c.cap} · {c.legacy} · 골든 {c.golden} ·{' '}
                  <b style={{ color: c.verdict === '지원' ? 'var(--pass)' : c.verdict === '미지원' ? 'var(--fail)' : 'var(--pending)' }}>{c.verdict}</b>
                </div>
              </div>
            ))}
            <div>회귀 결과</div><div className="small">{golden ? `${golden.at} · 128/128 일치 (실패 0)` : '미실행 — 시험 이름만으로 호환성을 통과시키지 않는다'}</div>
          </div>

          <div className="mt"><Reasons title="승인 후보 등록 차단 사유" list={pubReasons} ok={pubReasons.length === 0} /></div>
          <div className="mt"><UlRules items={s04Rules} title={<UlTitle items={s04Rules} />} /></div>
        </div>
      );
    },

    // ── S05 차량 및 안전 검증 ────────────────────────────────────────
    'UI16-S05': () => {
      const list = byArea('S05', false);
      const sel = pickFrom(list, list);
      const runReasons = [
        !can('run-engine') ? `역할 ${state.role} 에게 실행 권한이 없다` : '',
        sel.validity !== 'VALID' ? `${sel.id} 유효성 ${sel.validity} — 유효 증적 없이 안전 전이 시험을 열지 않는다` : '',
      ].filter(Boolean) as string[];
      const accReasons = [
        !acc.harness.trim() && '시험 하니스 없음',
        !acc.ref.trim() && '인수 근거 참조 없음',
        !can('edit') && '편집 권한 없음',
        guard.step !== 'RESTORED' && `안전 전이 시퀀스 ${guard.step} — 복귀 확인 전에는 인수 근거를 확정하지 않는다`,
      ].filter(Boolean) as string[];

      return (
        <div>
          <StageRail steps={GUARD_STEPS} current={guard.refused || guard.step}
            terminal={[{ ko: '전이 거부(REFUSED)' }, { ko: '부분 적용(PARTIAL)' }]}
            note="안전 전이는 실제 ECU 에서만 확인한다 — 미실행과 참조 모의는 전이 증적으로 세지 않는다." />

          <div className="row mt" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Gated label="실제 ECU Guard와 안전 전이 검증" reasons={runReasons}
              onClick={() => {
                const next = guard.step === 'IDLE' ? 'REQUESTED' : guard.step === 'REQUESTED' ? 'GUARDED' : guard.step === 'GUARDED' ? 'READBACK' : 'RESTORED';
                setGuard({ step: next, refused: '' });
                setRb({ reported: next === 'RESTORED' ? 12 : 9, unreported: next === 'RESTORED' ? 0 : 3 });
                audited('QUALITY_VALIDATE', 'ECU-BDC-B', `안전 전이 ${guard.step} → ${next} · readback 보고 ${next === 'RESTORED' ? 12 : 9}대`);
                toast(`안전 전이 검증 — ${next}`);
              }} />
            <Gated label="전이 거부 시험 (Guard 차단)" reasons={[!can('run-engine') ? '실행 권한 없음' : '', guard.step === 'IDLE' ? '전이 요청 상태가 아니다' : ''].filter(Boolean) as string[]}
              onClick={() => { setGuard({ step: 'GUARDED', refused: '전이 거부(REFUSED)' }); audited('QUALITY_VALIDATE', 'ECU-BDC-B', '전이 거부 — Guard 차단 확인 · 안전 기본값 유지'); toast('전이 거부 확인 — 안전 기본값 유지', 'err'); }} />
            <Gated label="다중 ECU와 readback 증적 연결" reasons={rb.unreported === 0 ? ['미보고 대수 없음 — 확인할 것이 남지 않았다'] : []}
              onClick={() => { audited('EVID_READBACK', 'ECU 4종', `보고 ${rb.reported}대 · 미보고 ${rb.unreported}대 (성공 합산 제외)`); toast(`readback 보고 ${rb.reported}대 · 미보고 ${rb.unreported}대`); }} />
            <span className="small muted">readback 미보고는 성공으로 계산하지 않는다.</span>
          </div>

          <div className="mt"><Table head={EV_COLS}>
            {list.map(r => (
              <tr key={r.id} onClick={() => setPick(r.id)} style={{ cursor: 'pointer', background: r.id === pick ? 'var(--surface-2)' : undefined }}>
                <td className="mono small">{r.id}</td>
                <td className="mono small">{r.target}<br /><span className="muted">{r.hash.slice(0, 20)}</span></td>
                <td className="mono small">{r.tver}</td>
                <td className="small">{r.env}</td>
                <td><Result r={r.result} /></td>
                <td><State s={r.validity} /></td>
                <td className="small muted">{SRC_LABEL[r.srcKind]}<br />{r.source}</td>
              </tr>
            ))}
          </Table></div>

          {sel && <EvidenceDetail r={sel} />}

          <div className="kv mt">
            <div>readback</div><div className="small">보고 {rb.reported}대 · 미보고 {rb.unreported}대 · 표본 {sampleVehicles.length}대 · cohort {new Set(sampleVehicles.map(v => v.cohort)).size}개</div>
            <div>ECU</div><div className="mono small">ECU-BDC-B Gen3 · ECU-BCM · ECU-ADAS-A Gen3 · ECU-RUNTIME</div>
            <div>안전 허용 envelope</div><div className="small">최대 종가속 0.3 g · 최대 속도 60 km/h · 중단 조건 2건 · envelope 미기재 1건</div>
          </div>

          <div className="card mt" style={{ background: 'var(--surface-2)' }}>
            <b className="small">SIL·HIL 인수 근거 등록</b>
            <div className="mt" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(150px, 1fr))', gap: 8 }}>
              <label className="small muted">시험 하니스
                <input style={{ ...FIELD, marginTop: 4 }} value={acc.harness} onChange={e => setAcc({ ...acc, harness: e.target.value })} placeholder="HIL-ADAS-07 / SIL-BDC-11" />
              </label>
              <label className="small muted">인수 근거 참조
                <input style={{ ...FIELD, marginTop: 4 }} value={acc.ref} onChange={e => setAcc({ ...acc, ref: e.target.value })} placeholder="RAW_LOG / REPORT …" />
              </label>
              <label className="small muted">비고
                <input style={{ ...FIELD, marginTop: 4 }} value={acc.note} onChange={e => setAcc({ ...acc, note: e.target.value })} />
              </label>
            </div>
            <div className="row mt" style={{ gap: 8, alignItems: 'center' }}>
              <Gated label="SIL HIL 인수 근거 관리" kind="primary" reasons={accReasons}
                onClick={() => { audited('EVID_ACCEPTANCE', acc.harness, `${acc.ref} · ${acc.note || '비고 없음'} · 전이 ${guard.step}`); toast(`인수 근거 등록 — ${acc.harness}`); setAcc({ harness: '', ref: '', note: '' }); }} />
            </div>
            <div className="mt"><Reasons title="인수 근거 등록 차단 사유" list={accReasons} ok={accReasons.length === 0} /></div>
          </div>

          <div className="mt"><UlRules items={s05Rules} title={<UlTitle items={s05Rules} />} /></div>
        </div>
      );
    },
    // ── S06 Docker 실행 결과 ─────────────────────────────────────────
    'UI16-S06': () => {
      const list = byArea('S06', false);
      const sel = pickFrom(list, list);
      const real = list.filter(r => r.mode === '실제 실행');
      const notRun = real.filter(r => r.result === '미실행');
      const refOnlyList = list.filter(r => r.mode === '참조 모의');
      const envReasons = [
        !/^sha256:[0-9a-f]{8}/i.test(pack.digest) && 'image digest 없음 — 환경을 특정할 수 없다',
        list.some(r => r.mode === '실제 실행' && !r.env.includes('image')) && '환경 기재 없는 실행 1건',
      ].filter(Boolean) as string[];
      const creditReasons = [
        notRun.length > 0 && `미실행 ${notRun.length}건 (${notRun.map(r => r.id).join(', ')}) — 실행 전에는 PASS 로 세지 않는다`,
        refOnlyList.length > 0 && `참조 모의 ${refOnlyList.length}건 (${refOnlyList.map(r => r.id).join(', ')}) — 실제 서버 시험 결과가 아니다`,
        !pack.junit && 'JUnit 리포트 미연결',
        !pack.html && 'HTML 리포트 미연결',
        !can('approve') && '판정 권한 없음',
      ].filter(Boolean) as string[];

      return (
        <div>
          <div className="row small" style={{ gap: 14, flexWrap: 'wrap' }}>
            <span>스택 <b className="mono">fp-server 8.2.0</b></span>
            <span>image digest <b className="mono">{pack.digest}</b></span>
            <span>suite <b>214</b></span>
            <span>실제 서버 시험 <b>{real.length}</b> · 참조 모의 <b>{refOnlyList.length}</b></span>
          </div>

          <div className="row mt" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="small muted">image digest
              <input className="mono" style={{ ...FIELD, marginTop: 4, minWidth: 200 }} value={pack.digest} onChange={e => setPack({ ...pack, digest: e.target.value })} />
            </label>
            <label className="row small muted" style={{ gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={pack.html} onChange={e => setPack({ ...pack, html: e.target.checked })} /> HTML 리포트
            </label>
            <label className="row small muted" style={{ gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={pack.junit} onChange={e => setPack({ ...pack, junit: e.target.checked })} /> JUnit 리포트
            </label>
            <Gated label="환경과 image digest 확인" reasons={envReasons}
              onClick={() => { audited('EVID_ENV_CHECK', 'fp-stack', `${pack.digest} · postgres 16 · node 20 · suite 214`); toast('환경·digest 확인'); }} />
            <Gated label="실제 서버 시험과 참조 시험 분리" reasons={refOnlyList.length === 0 ? ['분리할 참조 시험이 없다'] : []}
              onClick={() => { audited('EVID_SPLIT', 'fp-stack', `실제 서버 시험 ${real.length - notRun.length}건 / 미실행 ${notRun.length}건 / 참조 모의 ${refOnlyList.length}건`); toast(`서버 시험 ${real.length - notRun.length}건 · 참조 모의 ${refOnlyList.length}건 분리`); }} />
            <Gated label="HTML JSON JUnit 보고서 연결" reasons={!pack.html && !pack.junit ? ['연결된 보고서가 없다'] : []}
              onClick={() => { audited('EVID_REPORT_LINK', 'fp-stack', `${pack.html ? 'HTML' : 'HTML 미연결'} · JSON result.json · ${pack.junit ? 'JUnit' : 'JUnit 미연결'}`); toast(`보고서 연결 — ${[pack.html && 'HTML', 'JSON', pack.junit && 'JUnit'].filter(Boolean).join('/')}`); }} />
            <Gated label="미실행을 PASS로 표시하지 않기" reasons={notRun.length === 0 ? ['미실행 건이 없다'] : []}
              onClick={() => { audited('EVID_NORUN_AUDIT', 'fp-stack', `미실행 ${notRun.length}건 (${notRun.map(r => r.id).join(', ')}) · PASS 계상 제외`); toast(`미실행 ${notRun.length}건 — PASS 로 세지 않음`, 'err'); }} />
            <Gated label="서버 시험 PASS 계상 승인" kind="primary" reasons={creditReasons}
              onClick={() => { audited('EVID_CREDIT', 'fp-stack', `실제 서버 시험 ${real.length - notRun.length}건만 계상 · 참조 모의 ${refOnlyList.length}건 제외`); toast(`PASS 계상 — 실제 서버 시험 ${real.length - notRun.length}건`); }} />
          </div>

          <div className="mt"><Table head={EV_COLS}>
            {list.map(r => (
              <tr key={r.id} onClick={() => setPick(r.id)} style={{ cursor: 'pointer', background: r.id === pick ? 'var(--surface-2)' : undefined }}>
                <td className="mono small">{r.id}<br /><span className="muted">{r.mode}</span></td>
                <td className="mono small">{r.target}<br /><span className="muted">{r.hash.slice(0, 20)}</span></td>
                <td className="mono small">{r.tver}</td>
                <td className="small">{r.env}</td>
                <td><Result r={r.result} /></td>
                <td><State s={r.validity} /></td>
                <td className="small muted">{SRC_LABEL[r.srcKind]}<br />{r.source}</td>
              </tr>
            ))}
          </Table></div>

          {sel && <EvidenceDetail r={sel} />}

          <div className="kv mt">
            <div>실행 결과 계상</div><div className="small">실제 서버 시험 {real.length - notRun.length}건 계상 · 미실행 {notRun.length}건 제외 · 참조 모의 {refOnlyList.length}건 제외</div>
            <div>보고서 연결</div><div className="small">{pack.html ? 'HTML index.html 연결' : 'HTML 미연결'} · {pack.junit ? 'JUnit junit.xml 연결' : 'JUnit 미연결'} · result.json 연결</div>
            <div>환경</div><div className="mono small">{pack.digest} · postgres 16 · node 20 · 실행 시각 {stamp('2026-09-13', '06:30')}</div>
          </div>

          <div className="mt"><Reasons title="PASS 계상 차단 사유" list={creditReasons} ok={creditReasons.length === 0} /></div>
          <div className="mt"><UlRules items={s06Rules} title={<UlTitle items={s06Rules} />} /></div>
        </div>
      );
    },

    // ── S07 품질 판정과 승인 연결 ────────────────────────────────────
    'UI16-S07': () => {
      const ruleBlocks = ulBlocks([...s03Rules, ...s04Rules]);
      const qualityReasons = [
        ...ruleBlocks,
        apItems.some(i => !i.ok && i.item === '증적 유효성') ? '미확인 증적 1건 — 증적 유효성이 확정되지 않았다' : '',
        apBlocks.length > 0 && `미충족 검토 항목 ${apBlocks.length}건 — ${apBlocks[0]}`,
        !reason.trim() && '사유가 없다',
        !can('approve') && `역할 ${state.role} 에게 승인 권한이 없다`,
      ].filter(Boolean) as string[];
      const opsReasons = [
        !ap.quality ? '품질 평가 기록이 없다 (운영 승인 먼저 불가)' : '',
        ap.quality && ap.quality.role === state.role ? '품질 평가자와 같은 역할 — 직무 분리 위반' : '',
        ...ruleBlocks,
        !reason.trim() && '사유가 없다',
        !can('approve') && '승인 권한 없음',
      ].filter(Boolean) as string[];
      const audits = state.audit.filter(a => a.action.startsWith('EVID') || a.action.startsWith('QUALITY')).slice(0, 10);

      return (
        <div>
          <StageRail steps={AP_STEPS} current={apCurrent} terminal={AP_TERMINAL}
            note="증적 수집 → 품질 평가 → 운영 승인 순서로만 간다 — 품질 평가 없이 운영 승인을 만들지 않는다." />

          <div className="mt"><Table head={AP_COLS}>
            {apItems.map(i => (
              <tr key={i.item}>
                <td>{i.item}</td>
                <td className="small mono">{i.ref}</td>
                <td className="small">{i.role}</td>
                <td style={{ color: i.ok ? 'var(--pass)' : 'var(--fail)', fontWeight: 600 }}>{i.ok ? '충족' : '미충족'}</td>
                <td className="small muted">{i.block || '—'}</td>
              </tr>
            ))}
          </Table></div>

          <div className="row mt" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Gated label="필수 증적 누락 시 승인 차단" reasons={apBlocks.length === 0 ? ['누락된 필수 증적이 없다 — 차단할 것이 남지 않았다'] : []}
              onClick={() => { audited('QUALITY_BLOCK_CHECK', BDC_BOM.id, `미충족 검토 항목 ${apBlocks.length}건 — ${apBlocks[0] || ''} · 승인 입력 차단`); toast(`승인 입력 차단 — 미충족 ${apBlocks.length}건`, 'err'); }} />
            <Gated label="품질평가와 운영 승인 분리" reasons={ap.quality ? [] : ['품질 평가 기록이 없다']}
              onClick={() => { audited('QUALITY_SEGREGATION', BDC_BOM.id, `품질 ${ap.quality?.role || '—'} / 운영 ${ap.ops?.role || '미승인'} · 직무 분리 확인`); toast('품질 평가와 운영 승인을 분리해 확인'); }} />
            <Gated label="실패 보완 재검증 이력 확인" reasons={Object.keys(runs).length === 0 ? ['검증 실행 이력이 없다'] : []}
              onClick={() => { audited('QUALITY_REVERIFY_HISTORY', 'POLICY-BDC-ENABLE', `검증 실행 ${Object.keys(runs).length}회 · 실패 보완 재검증 ${done.pass ? '1건 완료' : '0건'}`); toast(`재검증 이력 — 실행 ${Object.keys(runs).length}회`); }} />
          </div>

          <div className="row mt" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label className="small muted">판정·승인 사유
              <input style={{ ...FIELD, marginTop: 4, minWidth: 300 }} value={reason} onChange={e => setReason(e.target.value)} />
            </label>
            <Gated label="품질 평가 승인" kind="primary" reasons={qualityReasons}
              onClick={() => {
                const rec: ApRec = { by: `role:${state.role}`, role: state.role, reason: reason.trim(), at: stamp('2026-09-13', '11:40'), hash: BDC_HASH };
                setAp({ ...ap, quality: rec, rejected: undefined });
                audited('QUALITY_APPROVE', BDC_BOM.id, `품질 평가 승인 · hash ${BDC_HASH.slice(7, 19)} · ${reason.trim()}`);
                toast('품질 평가 승인 기록 — 운영 승인은 다른 역할이 한다');
              }} />
            <Gated label="운영 승인" kind="primary" reasons={opsReasons}
              onClick={() => {
                const rec: ApRec = { by: `role:${state.role}`, role: state.role, reason: reason.trim(), at: stamp('2026-09-13', '11:45'), hash: BDC_HASH };
                setAp({ ...ap, ops: rec, rejected: undefined });
                audited('QUALITY_OPS_APPROVE', BDC_BOM.id, `운영 승인 연결 · hash ${BDC_HASH.slice(7, 19)} · commandId 42`);
                toast('운영 승인 연결 — 승인은 내용 hash 에 결속됨');
              }} />
            <Gated label="반려" kind="danger" reasons={[!reason.trim() ? '반려 사유가 없다' : '', !can('approve') ? '권한 없음' : ''].filter(Boolean) as string[]}
              onClick={() => { setAp({ rejected: { by: `role:${state.role}`, role: state.role, reason: reason.trim(), at: stamp('2026-09-13', '11:42'), hash: BDC_HASH } }); audited('QUALITY_REJECT', BDC_BOM.id, `반려 · ${reason.trim()}`); toast('반려 기록 — 보완 후 새 증적으로 다시 검증한다', 'err'); }} />
          </div>

          <div className="mt"><Reasons title="승인 차단 사유" list={qualityReasons} ok={qualityReasons.length === 0} /></div>

          <div className="kv mt">
            <div>품질 평가</div><div className="small">{ap.quality ? `${ap.quality.by} · ${ap.quality.at} · hash ${ap.quality.hash.slice(7, 19)} · ${ap.quality.reason}` : '기록 없음'}</div>
            <div>운영 승인</div><div className="small">{ap.ops ? `${ap.ops.by} · ${ap.ops.at} · hash ${ap.ops.hash.slice(7, 19)}` : '기록 없음'}</div>
            <div>반려</div><div className="small">{ap.rejected ? `${ap.rejected.by} · ${ap.rejected.at} · ${ap.rejected.reason}` : '없음'}</div>
            <div>차단 검토 항목</div><div className="small">{apBlocks.length ? apBlocks.join(' / ') : '없음'}</div>
            <div>검토 항목 차단</div><div className="small">{failRules.length ? failRules.map(r => `${r.ul} ${r.rule}`).join(' / ') : '없음'}</div>
            <div>실패 보완 재검증</div><div className="small">검증 실행 {Object.keys(runs).length}회 · 보완 재검증 {done.pass ? '1건 완료' : '0건'}</div>
          </div>

          <div className="mt">
            <div className="small muted" style={{ marginBottom: 6 }}>판정·승인 이력</div>
            {audits.length === 0 && <p className="small muted">기록 없음 — 판정과 승인은 감사 기록과 함께만 남는다.</p>}
            {audits.map((a, i) => (
              <div key={i} className="evt">
                <span className="mono small">{a.ts}</span><span className="small">{a.actor}</span>
                <span className="small">{a.action}</span><span className="small muted">{a.target} · {a.detail}</span>
              </div>
            ))}
          </div>

          <div className="mt"><UlRules items={s07Rules} title={<UlTitle items={s07Rules} />} /></div>
        </div>
      );
    },
  };

  const kpis: Kpi[] = [
    { v: rows.length, l: '증적' },
    { v: countState('VALID'), l: '유효(VALID)' },
    { v: blockedEv.length, l: '무효·만료' },
    { v: unknownEv.length, l: '미확인(UNKNOWN)' },
    { v: failRules.length, l: '차단 검토 항목' },
    { v: ap.ops ? '승인 연결' : ap.quality ? '운영 승인 대기' : '품질 평가 대기', l: '판정 상태' },
  ];

  return <CanonicalScreen screenId="UI16" core="C30 품질 기준 검증" kpis={kpis} areas={areas} />;
}





