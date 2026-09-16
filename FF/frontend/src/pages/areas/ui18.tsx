// UI18 외부 시스템 연계 — 정본 상세 영역 9개 본문.
//
// 이 화면은 원천 시스템과 도구를 **수집·비교·관측**만 한다.
//  · 도구(Unleash 등) UI·표시값은 판정 근거가 아니고, 도구에서 승인·발행·Flag 전환을 수행하지 않는다.
//  · 미연결(NOT_CONNECTED)을 정상으로 표시하지 않는다.
//  · 원천 데이터를 이 화면에서 임의 승인 상태로 덮어쓰지 않는다.
//  · 전달(도구가 보냈다) ≠ 적용(차량이 받아 실행했다) ≠ 관측(실제로 그렇게 동작한다)
import { useMemo, useState, type ReactNode } from 'react';
import { CanonicalScreen, FIELD, Gated, Reasons, Table, type Kpi } from '../../components/AreaScreen';
import { UlBadge, UlRules, ulBlocks, type UlRule } from '../../components/ulRules';
import { useApp, useToast, type Connector } from '../../store';
import { CONTROL_POINTS, FLAG_BINDINGS, RUNTIME_BINDINGS, SOURCE_SYNC } from '../../data/implementation';
import { UL_FORBIDDEN_IN_UI, UL_LIMITS, UL_SCREEN_BOUNDARIES, UL_USAGE } from '../../data/unleashOss';

// ════════════════════════════════════ 공통 ════════════════════════════════════

/** 화면이 쓰는 기준 시각 — 정본 상태 창 밖 값은 판정에 쓰지 않는다. */
const TODAY = '2026-09-16';
const STAMP = '2026-09-16 20:12';

/** 시드 내용에서 계산하는 결정적 digest — 화면에 보이는 해시는 전부 값에서 계산한다. */
function digest(seed: string, len = 16): string {
  let a = 2166136261 >>> 0;
  let b = 0x9e3779b9 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b ^ (c + i + 1), 2246822519) >>> 0;
  }
  let out = '';
  while (out.length < len) {
    a = Math.imul(a ^ (b >>> 11), 16777619) >>> 0;
    b = Math.imul(b ^ (a >>> 7), 2246822519) >>> 0;
    out += a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  }
  return out.slice(0, len);
}

type ConnState = 'NOT_CONNECTED' | 'HEALTHY' | 'DEGRADED' | 'AUTH_EXPIRED';
const CONN_STATES: ConnState[] = ['NOT_CONNECTED', 'HEALTHY', 'DEGRADED', 'AUTH_EXPIRED'];
const STATE_KO: Record<ConnState, string> = {
  NOT_CONNECTED: '미연결', HEALTHY: '정상', DEGRADED: '저하', AUTH_EXPIRED: '자격 만료',
};
const STATE_TONE: Record<ConnState, string> = {
  NOT_CONNECTED: '#9CA3AF', HEALTHY: '#1F9D55', DEGRADED: '#D9822B', AUTH_EXPIRED: '#D64545',
};
/** 정본 상태 8개 중 이 화면이 쓰는 값 — 도구 판정이 아니라 FP 수집 상태다. */
const VALID_TONE: Record<string, string> = {
  VALID: '#1F9D55', REVIEW: '#D9822B', INVALID: '#D64545', DEPRECATED: '#D9822B', UNSUPPORTED: '#D64545',
};

const Pill = ({ s, tone }: { s: string; tone?: string }) => (
  <span className="pill" style={{ background: tone || 'var(--surface-2)', color: tone ? '#fff' : 'var(--muted)', borderColor: 'transparent' }}>{s}</span>
);
const Note = ({ children }: { children: ReactNode }) => <p className="small muted" style={{ marginTop: 8 }}>{children}</p>;
const State = ({ s }: { s: ConnState }) => <Pill s={STATE_KO[s]} tone={STATE_TONE[s]} />;
const Verified = ({ ok, ko }: { ok: boolean; ko: string }) => <Pill s={ko} tone={ok ? '#1F9D55' : '#9CA3AF'} />;

// ═════════════════════════════ 연계 시스템 정본 값 ═════════════════════════════
// 시스템마다 소유 데이터·완료 이벤트·계약·자격을 따로 둔다. 도구 상태값과 FP 수집 상태는 별개다.
interface LinkMeta {
  owned: string; event: string; contract: string; pending: string[]; health: 'OK' | 'DEGRADED';
  authRef: string; authExpiry: string; automation: string;
}
const EMPTY_META: LinkMeta = {
  owned: '—', event: '—', contract: '—', pending: [], health: 'OK',
  authRef: '—', authExpiry: '9999-12-31', automation: '미정',
};
const LINK_META: Record<string, LinkMeta> = {
  'INT-PLM': {
    owned: 'BOM 부품·ECU 구성 / 구조 변경', event: 'ECR 승인 완료 이벤트(SW EO 발행 시)', contract: 'PLM 구성 조회 API v2.3 · 부품·ECU',
    pending: [], health: 'OK', authRef: 'secretRef kv/fp-plm-ro@r4', authExpiry: '2027-01-31',
    automation: '수집 자동 · 구성 확정은 FP 승인 절차',
  },
  'INT-CODEBEAMER': {
    owned: '요구사항·시험 항목·결함', event: 'SYS 요구 Baseline 확정 이벤트', contract: 'ReqIF 1.2 교환 프로파일 · ALM 조회 API',
    pending: ['시험 항목 3건 Baseline 미확정', 'SYS-BODY-001 v3.2 변경 미반영 1건', '결함 412-1 미해결'], health: 'OK',
    authRef: 'secretRef kv/fp-alm-ro@r2', authExpiry: '2026-09-14',
    automation: '수집 자동 · 미반영 변경은 재검토 큐',
  },
  'INT-UNLEASH': {
    owned: '도구 Flag 정의(수집 원천)', event: '없음 — 폴링 수집(변경 통보 미사용)', contract: 'IF-FF-01 Admin API 수집(5분)',
    pending: ['미매핑 정의 1건(격리 큐)'], health: 'OK', authRef: 'secretRef kv/fp-ul-admin@r7', authExpiry: '2026-12-31',
    automation: '수집 자동 · 발행 정본은 FP(C08·C46)',
  },
  'INT-OTA': {
    owned: '차량 캠페인·적용 결과 보고', event: '캠페인 완료 report 이벤트', contract: 'REST 조회 + report webhook',
    pending: ['완료 report 미수신 2대', '폴링 timeout 1회 — 같은 commandId 재조회'], health: 'DEGRADED',
    authRef: 'secretRef kv/fp-ota-rw@r3', authExpiry: '2026-11-15',
    automation: '전달 자동 · 적용 결과는 report 기준',
  },
  'INT-MQTT': {
    owned: '차량 텔레메트리·상태 신호', event: '없음 — 구독 스트림', contract: 'MQTT 5.0 토픽·QoS1 스키마 v4',
    pending: [], health: 'OK', authRef: 'secretRef kv/fp-mqtt@r9', authExpiry: '2027-02-28',
    automation: '수신 전용 · 발행 경로 없음',
  },
};
const metaOf = (id: string): LinkMeta => LINK_META[id] || EMPTY_META;

/** 정본 완료 기준이 지목한 나머지 원천 — 커넥터가 없으므로 미연결로 남긴다. */
interface Unregistered { id: string; name: string; owned: string; dir: string; contract: string; last: string; pending: string[]; event: string }
const UNREGISTERED: Unregistered[] = [
  { id: 'SYS-CCS', name: 'CCS 상거래·권리', owned: '상품 권리·Entitlement', dir: '수신', contract: '미체결 — 권리 정본은 C21', last: '—', pending: ['권리 원천 미연결 2건 — 수동 대조 중'], event: '구매·해지 이벤트(수신 경로 없음)' },
  { id: 'SYS-TMS', name: 'TMS 운송·출고', owned: '출고·이관 일정', dir: '수신', contract: '미체결', last: '—', pending: ['출고 일정 원천 미연결 1건'], event: '—' },
  { id: 'SYS-IAM', name: 'IAM 계정·세션', owned: '사용자·세션', dir: '수신', contract: '미체결 — 계정 정본은 C11·C47', last: '—', pending: ['퇴사자 세션 종료 확인 1건'], event: '—' },
];

interface SystemRow {
  id: string; name: string; owned: string; dir: string; contract: string; last: string;
  pending: string[]; state: ConnState; event: string; authRef: string; authExpiry: string;
  automation: string; connector?: Connector;
}
const screenStateOf = (c: Connector, m: LinkMeta): ConnState => {
  if (!c.enabled) return 'NOT_CONNECTED';
  if (m.authExpiry < TODAY) return 'AUTH_EXPIRED';
  return m.health === 'DEGRADED' ? 'DEGRADED' : 'HEALTHY';
};

// ── 정본 열 — 각 영역의 첫 표는 이 열을 그대로, 정본 순서·문구로 쓴다 ──
const S01_COLS: string[] = ['시스템', '소유 데이터', '방향', '계약', '최근 성공', '상태', '미해결 수'];
const S02_COLS: string[] = ['인스턴스 ID', '선택 버전', '소스 commit', '환경', '자격 참조', '연결 상태'];
const S03_COLS: string[] = ['정확 참조', '객체·서비스', 'ECU 또는 원천', '책임 주체', 'SDK·계약 Profile', '버전', '유효성'];
const S04_COLS: string[] = ['항목', '기준 버전 값', '변경 값', '영향 및 재검토'];
const S05_COLS: string[] = ['조건행', '국가 의미 축', '국가 코드', '차종·연식', 'Trim 참조', 'Variant 조건', '구현 참조', '확인 상태'];
const S06_COLS: string[] = ['정확 참조', '객체·서비스', 'ECU 또는 원천', '책임 주체', 'SDK·계약 Profile', '버전', '유효성'];
const S07_COLS: string[] = ['발행 단계', '정확 참조', '상태', '근거 또는 미확인 사유'];
const S08_COLS: string[] = ['정확 참조', '객체·서비스', 'ECU 또는 원천', '책임 주체', 'SDK·계약 Profile', '버전', '유효성'];
const S09_COLS: string[] = ['시스템', '소유 데이터', '방향', '계약', '최근 성공', '상태', '미해결 수'];

// ═══════════════════════════ S02 Unleash 인스턴스 값 ═══════════════════════════

interface InstanceRow {
  id: string; version: string; commit: string; env: string; authRef: string; state: ConnState;
  endpoint: string; quota: string; rotationDue: string; lastUsed: string; note: string;
}
const INSTANCES: InstanceRow[] = [
  {
    id: 'UNL-OSS-PROD', version: '8.2.0', commit: digest('unleash-8.2.0-66d4a45c', 7), env: 'production(운영 슬롯 1)',
    authRef: 'secretRef kv/fp-ul-admin@r7', state: 'HEALTHY', endpoint: '관리 포트 비공개 경로(사내망) · 차량망 직접 노출 0건',
    quota: '전용 PostgreSQL 분리 배치 · 수집 API 12 req/min', rotationDue: '2026-12-31', lastUsed: '2026-09-16 09:12',
    note: '정의 수집 원천(수집 전용) — 발행 정본은 FP C08·C46',
  },
  {
    id: 'UNL-OSS-STAGE', version: '8.2.0', commit: digest('unleash-8.2.0-66d4a45c', 7), env: 'preproduction(스테이지 슬롯 2)',
    authRef: 'secretRef kv/fp-ul-admin@r6', state: 'HEALTHY', endpoint: '관리 포트 비공개 경로(사내망)',
    quota: '스테이지 정의 12건 · 수집 API 4 req/min', rotationDue: '2026-12-31', lastUsed: '2026-09-16 08:55',
    note: '초안 구성만 복사 — 운영 ON·토큰·승인은 승계하지 않는다',
  },
  {
    id: 'UNL-OSS-DEV', version: '8.1.4', commit: digest('unleash-8.1.4-8a1f0c2', 7), env: 'development(개발 슬롯)',
    authRef: 'secretRef kv/fp-ul-dev@r1', state: 'DEGRADED', endpoint: '개발망 전용',
    quota: '업그레이드 8.1.4 → 8.2.0 시험 미기록', rotationDue: '2027-01-31', lastUsed: '2026-09-15 18:20',
    note: '버전이 운영과 다름 — 호환 시험 기록 전에는 후보로 쓰지 않는다',
  },
  {
    id: 'UNL-OSS-EDGE-01', version: '8.2.0-edge', commit: digest('edge-2f1ba09', 7), env: '엣지 캐시 후보(미사용)',
    authRef: '—', state: 'NOT_CONNECTED', endpoint: '배치 없음',
    quota: '캐시 확장 후보 — C17 서명 캐시와 동일시하지 않는다', rotationDue: '—', lastUsed: '—',
    note: '미연결을 정상으로 표시하지 않는다 — 도입 결정 미기록',
  },
];

// ═══════════════════ S03 도구·Feature 바인딩 / S06 실행 배정 공통 값 ═══════════════════

interface BindRow {
  ref: string; obj: string; source: string; owner: string; profile: string; ver: string;
  valid: 'VALID' | 'REVIEW' | 'INVALID'; note: string; cpId: string; appl: string;
}
/** 같은 제어점·같은 적용 조건에 두 번째 매핑이 있으면 하나만 선택되어야 한다. */
const DUP_KEYS = (() => {
  const seen = new Map<string, number>();
  FLAG_BINDINGS.forEach(fb => {
    const k = `${fb.controlPointRef}|${fb.applicabilityRef}`;
    seen.set(k, (seen.get(k) || 0) + 1);
  });
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k));
})();
const cpOf = (id: string) => CONTROL_POINTS.find(c => c.id === id);

interface RuntimeMeta { node: string; service: string; iface: string; owner: string; profile: string; valid: 'VALID' | 'REVIEW' | 'INVALID'; note: string }
const RUNTIME_META: Record<string, RuntimeMeta> = {
  'RB-BDC-001': { node: 'BCM', service: 'DoorLockService', iface: 'IDoorLock@1.0', owner: 'OEM(차량 ECU)', profile: 'AAOS SDV Core · 차량 로컬 서명 평가', valid: 'VALID', note: 'Gateway 경유 없이 로컬 평가' },
  'RB-BDC-002': { node: 'DOMAIN-CTRL', service: 'DiagnosticReportService', iface: 'IDtcReport@1.2', owner: 'OEM Gateway', profile: 'AAOS SDV Core · report 계약', valid: 'VALID', note: 'DTC 보고 계약 v1.2 일치' },
  'RB-BDC-003': { node: 'HVAC-CTRL', service: 'CabinTempService', iface: 'ITempControl@2.0', owner: '3rd party(공급사)', profile: '3rd party payload — 권리·서명 검사 후 사용', valid: 'REVIEW', note: '공급사 payload capability 검사 대기 1건' },
  'RB-BDC-004': { node: 'IVI-HEAD', service: 'ApiVersionService', iface: 'IApiMeta@1.0', owner: 'OEM HMI', profile: 'Android SDK frontend(표시 전용)', valid: 'VALID', note: '표시값 — 차량 제어 판정에 쓰지 않는다' },
};

const BIND_ROWS: BindRow[] = FLAG_BINDINGS.map(fb => {
  const cp = cpOf(fb.controlPointRef);
  const rt = RUNTIME_BINDINGS.find(rb => rb.flagBindingRef === fb.id);
  const dup = DUP_KEYS.has(`${fb.controlPointRef}|${fb.applicabilityRef}`);
  const ver = fb.flagVersionRef.split('@')[1] || '—';
  return {
    ref: `${fb.id} · ${fb.flagVersionRef}`,
    obj: `${fb.controlPointRef} · ${cp?.kind || '—'} / ${cp?.role || '—'} / ${cp?.accessMode || '—'}`,
    source: rt ? `${RUNTIME_META[rt.id]?.node || rt.topologyRef} 경유 · ${rt.bomRef}` : '원천: Unleash 정의 수집(IF-FF-01)',
    owner: `${cp?.flagClass?.ownerRef || 'ROLE:integrator@body'} · 정본 FP C01`,
    profile: `${fb.toolBindingRef} · ${cp?.bindingRef || '—'}`,
    ver: `flag @${ver} · 적용 ${fb.applicabilityRef}`,
    valid: dup ? 'INVALID' : (rt ? 'VALID' : 'REVIEW'),
    note: dup ? 'BD-06 위반 — 같은 제어점·같은 적용 조건에 두 번째 매핑' : (rt ? 'RuntimeBinding까지 결속됨' : '실행 배정 없음 — 관측·표시 전용'),
    cpId: fb.controlPointRef, appl: fb.applicabilityRef,
  };
});

// ═══════════════════════════ S04 Capture·동기화 값 ═══════════════════════════

const CAP_PREV = { at: '2026-09-13 09:41', rev: 'r118', etag: digest('etag-r118', 12) };
const CAP_CUR = { at: '2026-09-16 09:12', rev: 'r121', etag: digest('etag-r121', 12) };
interface CaptureRow { item: string; before: string; after: string; impact: string }
const CAP_ROWS: CaptureRow[] = [
  { item: 'bindingSetHash', before: digest('binding-set-r118', 16), after: digest('binding-set-r121', 16), impact: '바인딩 집합 변경 2건 — 이전 승인 재사용 금지, 재검토 대상' },
  { item: 'source version', before: '8.2.0', after: '8.2.0', impact: '도구 버전 동일 — 정의 내용만 변경' },
  { item: 'sourceRevision', before: CAP_PREV.rev, after: CAP_CUR.rev, impact: '원천 revision 재확인 필요(3증분) — 재수집 조건' },
  { item: 'queryHash', before: digest('query-policy-v3', 16), after: digest('query-policy-v3', 16), impact: '조회 조건 동일 — 부분 수집 위험 없음' },
  { item: 'ETag', before: CAP_PREV.etag, after: CAP_CUR.etag, impact: 'ETag 는 승인 hash 가 아니다 — 변경 없음의 근거로만 쓴다' },
  { item: 'rawDigest', before: digest('raw-r118', 16), after: digest('raw-r121', 16), impact: '원문 보존 확인 — 재현 가능' },
  { item: 'normalizedHash', before: digest('norm-r118', 16), after: digest('norm-r121', 16), impact: '정규화 결과 변경 — mapping v1.7 적용' },
  { item: 'mappingVersion', before: 'v1.6', after: 'v1.7', impact: '매핑 규칙 1건 추가 — 미지원 구조 거절 규칙' },
  { item: '수집 정의 수(flags)', before: '42', after: '44', impact: '신규 2건 — 미승인 후보로만 둔다' },
  { item: '미매핑 정의', before: '0건', after: '1건', impact: '격리 큐 보존 — 정본으로 승격하지 않는다' },
  { item: '미지원 구조(parent)', before: '5건', after: '6건', impact: 'parent 는 도구 내부 표시 관계 — 보존 후 거절, Topology 관계로 승격 금지' },
];

// ═══════════════════════════ S05 Context schema 값 ═══════════════════════════

interface CondRow { row: string; axis: string; code: string; model: string; trim: string; variant: string; impl: string; known: boolean }
const COND_ROWS: CondRow[] = [
  { row: 'APL-KR-PREMIUM-GEN3', axis: '판매 국가(규제 축)', code: 'KR', model: 'IONIQ5 (2026~)', trim: 'TRIM-PREMIUM', variant: 'entitlementId IN BAT_PRECOND_PLUS', impl: 'CP-BDC-001-FLAG-ENABLE · FEAT-BDC-001@1.1.0', known: true },
  { row: 'APL-KR-PREMIUM-GEN3-HW', axis: 'HW 세대 축', code: 'KR', model: 'IONIQ5 (2026~)', trim: 'TRIM-PREMIUM', variant: 'hardwareCapability STR_CONTAINS GEN3', impl: 'CP-BDC-001-PARAM-TEMP · FEAT-BDC-001@1.1.0', known: true },
  { row: 'APL-EU-BASE', axis: '판매 국가(규제 축)', code: 'EU', model: 'GV80 (2026~)', trim: 'TRIM-BASE', variant: 'region IN EU', impl: 'CP-BDC-001-FLAG-KILL · FEAT-BDC-001@1.1.0', known: true },
  { row: 'APL-KR-EXPERIMENT', axis: '실험 코호트 축', code: 'KR', model: 'IONIQ6 (2027~)', trim: 'TRIM-미정', variant: 'cohort = COHORT_A (도구 전략 flexibleRollout)', impl: 'CP-BDC-001-FLAG-EXPERIMENT · FEAT-BDC-001@1.1.0', known: false },
  { row: 'APL-JP-UNKNOWN', axis: '판매 국가(규제 축)', code: 'JP', model: '미정', trim: 'TRIM-?', variant: 'region NOT_IN JP (도구 legalValue — 사실 검증 아님)', impl: 'CP-BDC-001-SUNSET · FEAT-BDC-001@1.1.0', known: false },
];

interface SchemaRow { key: string; type: string; unit: string; enumVals: string; authority: string; required: string; state: '확인' | '미정' }
const SCHEMA_SEED: SchemaRow[] = [
  { key: 'region', type: 'string', unit: '—', enumVals: 'KR, EU, US, JP', authority: 'PLM 판매 국가 코드(인증 원천)', required: '필수', state: '확인' },
  { key: 'vehicleModel', type: 'string', unit: '—', enumVals: 'IONIQ5, IONIQ6, GV80', authority: 'PLM 차종 마스터', required: '필수', state: '확인' },
  { key: 'hardwareCapability', type: 'string', unit: '—', enumVals: 'GEN2, GEN3', authority: 'MDM 기술정보(BOM C03)', required: '필수', state: '확인' },
  { key: 'entitlementId', type: 'string', unit: '—', enumVals: 'BAT_PRECOND_PLUS', authority: 'Commerce 권리(C21)', required: '필수', state: '확인' },
  { key: 'cohort', type: 'string', unit: '—', enumVals: 'COHORT_A, COHORT_B', authority: '미등록 — 원천 권위 없음', required: '선택', state: '미정' },
];
interface SourceRow { src: string; authority: string; revision: string; at: string; trust: string; ok: boolean }
const SOURCE_ROWS: SourceRow[] = [
  { src: 'PLM 기술정보(부품·ECU)', authority: 'C03 BOM·구성', revision: 'PLM-2026.09@r412', at: '2026-09-16 09:12', trust: '인증된 원천', ok: true },
  { src: 'Commerce 권리(Entitlement)', authority: 'C21 상품·권리', revision: 'COM-2026.09@r88', at: '2026-09-16 08:40', trust: '인증된 원천', ok: true },
  { src: 'OEM Vehicle identity', authority: 'C47 인증·키 관리', revision: 'VEH-ID@2026-09', at: '2026-09-16 07:55', trust: '인증된 원천', ok: true },
  { src: '차량 로컬 mode/speed', authority: 'C16 평가기(실행 직전 확인)', revision: 'local@boot-41', at: '2026-09-16 10:02', trust: '로컬 사실 — 서버 전달 최소화', ok: true },
  { src: '도구 표시값(Playground · legalValues)', authority: '없음 — 판정 근거 아님', revision: digest('display-values', 8), at: '2026-09-16 09:30', trust: '미신뢰 — 법규·권리 사실로 쓰지 않는다', ok: false },
];

// ═══════════════════════════ S07 발행·관측 단계 ═══════════════════════════

interface PubStage { stage: string; ref: string; state: string; reason: string; blocked: boolean }
const PUB_STAGES: PubStage[] = [
  { stage: '1. 정의 수집(Capture)', ref: `RAW-UL-${CAP_CUR.rev} · ${digest('raw-r121', 16)}`, state: '근거 있음', reason: `수집 ${CAP_CUR.at} · Admin API 5분 폴링 · revision ${CAP_CUR.rev}`, blocked: false },
  { stage: '2. 정규화(C08)', ref: `${digest('norm-r121', 16)} · mapping v1.7`, state: '근거 있음', reason: '미매핑 1건 격리 큐 · 미지원 구조 6건 보존 후 거절', blocked: false },
  { stage: '3. 품질·운영 승인', ref: 'approvalHash —', state: '미확인', reason: '승인 정본은 C01·C12 — 이 화면에는 승인 권한이 없다', blocked: true },
  { stage: '4. 발행 정본 서명', ref: 'SignedSnapshot —', state: '미생성', reason: '서명 없는 정의는 배포하지 않는다(C46 소유)', blocked: true },
  { stage: '5. 차량 전달', ref: `commandId CMD-${digest('cmd-bdc-016', 8)}`, state: '전달 접수', reason: '프로토콜 ACK 는 적용 결과가 아니다', blocked: false },
  { stage: '6. 적용 readback', ref: 'readback 39대 / 미보고 3대', state: '부분 완료', reason: '미보고 3대는 완료로 합산하지 않는다 — UNKNOWN 유지', blocked: false },
  { stage: '7. 관측(이벤트 이력)', ref: 'EVT-전달 412건 · 실패 1건', state: '관측', reason: '관측 창(5분/6시간/월) 밖 값은 판정에 쓰지 않는다', blocked: false },
  { stage: '8. 도구 표시값(Playground)', ref: '표시값 — 판정 근거 아님', state: '무효 근거', reason: '판정 정본은 차량 로컬 서명 스냅샷(C17)과 C16 평가 결과', blocked: true },
];

// ═══════════════════════════ S08 호환성·자원 Profile ═══════════════════════════

interface CompatRow { ref: string; obj: string; host: string; owner: string; profile: string; ver: string; valid: string; note: string }
const COMPAT_ROWS: CompatRow[] = [
  { ref: 'ADP-NODE@8.2.0', obj: 'Node SDK 어댑터(수집 전용)', host: 'FP 서버 C33', owner: 'FP 플랫폼', profile: 'server adapter · Admin API read-only', ver: '8.2.0', valid: 'VALID', note: '정의 수집 경로' },
  { ref: 'ADP-ANDROID@8.2.0', obj: 'Android SDK(frontend 표시 평가)', host: 'HMI·비안전 화면', owner: 'OEM HMI', profile: 'frontend profile — 차량 제어 아님', ver: '8.2.0', valid: 'VALID', note: '표시값 — 판정 근거 아님' },
  { ref: 'ADP-AAOS@1.4.0', obj: 'AAOS SDV Core 차량 로컬 평가', host: 'ECU BCM·DOMAIN-CTRL', owner: 'OEM 차량', profile: 'local signed evaluation · C16/C17', ver: '1.4.0', valid: 'VALID', note: '차량 실행 profile(서명 스냅샷)' },
  { ref: 'STRAT-FLEX@8.2.0', obj: 'flexibleRollout + typed constraints', host: '전 Profile', owner: 'FP 정본(C08)', profile: '검증 subset — 기본 전략', ver: '8.2.0', valid: 'VALID', note: '기본 사용 전략' },
  { ref: 'STRAT-GRADUAL@legacy', obj: 'gradualRollout* (userWithId·레거시)', host: '도구 정의 1건', owner: '도구(보관소)', profile: '지원표 별도 확인 — v8 전부 제거로 일반화하지 않는다', ver: 'legacy', valid: 'DEPRECATED', note: '신규 사용 금지 · 퇴역 확인 필요' },
  { ref: 'STRAT-REMOTE-ADDR@legacy', obj: 'remoteAddress · applicationHostname 기반 조건', host: '도구 정의 1건', owner: '도구(보관소)', profile: '차량 identity·자격으로 사용 금지', ver: 'legacy', valid: 'UNSUPPORTED', note: '미지원 전략 — 후보 전체 거부' },
  { ref: 'STRAT-CUSTOM@script', obj: 'Custom strategy 스크립트 평가', host: '도구 정의 1건', owner: '도구(보관소)', profile: 'signed artifact · 시험 증거 없음', ver: '—', valid: 'UNSUPPORTED', note: '차량 publication 거절' },
];
interface ResourceRow { item: string; limit: string; actual: string; verdict: string; ok: boolean }
const RESOURCE_ROWS: ResourceRow[] = [
  { item: 'flags 수', limit: '400', actual: '44', verdict: '여유', ok: true },
  { item: 'projects', limit: '1', actual: '1', verdict: '상한 — 파티션·정본 재사용으로 대응', ok: true },
  { item: 'environments', limit: '2', actual: '2', verdict: '상한 — 운영 슬롯 규칙으로 흡수', ok: true },
  { item: '수집 API rate', limit: '60/min', actual: '12/min', verdict: '여유', ok: true },
  { item: 'PostgreSQL 연결', limit: '20', actual: '6', verdict: '여유(전용 DB 분리)', ok: true },
  { item: 'metrics cardinality', limit: '미정', actual: '1,240', verdict: '상한 미정 — 승인 전 측정 필요', ok: false },
  { item: '차량 SDK 직접 연결', limit: '서버 1~4대 한계', actual: '로컬 캐시 경로 사용', verdict: '구조로 우회 — 팬아웃은 로컬 평가', ok: true },
];

// ═══════════════════════════ S09 연계 설정·자동화 ═══════════════════════════

interface AutomationRow { step: string; scope: string; gate: string; state: string; ok: boolean }
const AUTOMATION_ROWS: AutomationRow[] = [
  { step: '정의 수집', scope: '자동(5분 폴링)', gate: '없음 — 수집은 상태 변경이 아니다', state: 'ON', ok: true },
  { step: '정규화', scope: '자동', gate: '미매핑·미지원 구조는 격리·보존', state: 'ON', ok: true },
  { step: '품질·운영 승인', scope: '수동(FP Gate)', gate: 'C01 승인 소유 — 도구 권한으로 우회 불가', state: '수동', ok: false },
  { step: '발행 정본 서명', scope: '수동(C46)', gate: '서명 없는 정의 배포 금지', state: '차단', ok: false },
  { step: '전달·적용 대사', scope: '자동 전달 + readback 대사', gate: '미보고는 완료로 합산하지 않는다', state: 'ON', ok: true },
  { step: '차량 Flag 전환', scope: '금지', gate: '도구에서 전환하지 않는다 — 차량은 로컬 서명 스냅샷으로 평가', state: '차단', ok: false },
  { step: '알림(CI/CT · Webhook)', scope: 'CI/CT ON · Webhook 미사용', gate: '변경 통보는 수집 어댑터(C33)가 담당', state: '부분', ok: true },
  { step: 'Import · Export', scope: '부트스트랩 한정', gate: '승인·secret·runtime actual 은 반입하지 않는다', state: '제한', ok: false },
];
interface Channel { name: string; use: string; verdict: string; block: string[] }
const CHANNELS: Channel[] = [
  { name: 'CI/CT 결과 알림', use: '빌드·시험 결과를 연계 상태 줄로 받는다', verdict: '사용', block: [] },
  { name: 'Webhook(도구 변경 통보)', use: '—', verdict: '미사용', block: ['변경 통보는 수집 어댑터(C33) 폴링이 담당한다 — 도구 Webhook 경로를 열지 않는다'] },
  { name: '협업 도구(Slack/Teams/Jira)', use: '필요 OEM 시스템만 adapter 로 선정', verdict: '미도입', block: ['도입 전 지원 범위·권한·감사·데이터 송신 계약 확인 필요 — 선정 기록 없음'] },
  { name: 'Terraform Provider', use: '—', verdict: '미사용', block: ['정의 변경은 FP 승인 절차로만 한다 — IaC 가 발행 Gate 를 우회하지 않는다'] },
];

// ═══════════════════════════════ UL 검토 항목 ═══════════════════════════════

const s01Rules: UlRule[] = [
  {
    ul: 'UL-005', rule: '협업 가시성(Open/Protected/Private)은 도구 표시 방식일 뿐 — OEM·공급사·프로젝트별 조회·제안·편집·승인 권한을 서버에서 따로 검사한다', verdict: 'WARN',
    evidence: '연계 5건 + 미등록 3건 · scope 표기 4건 · 공급사(3rd party) 연계 1건은 권한 검사 대기',
  },
  {
    ul: 'UL-044', rule: 'trust boundary 를 경로별로 나눈다 — CORS 허용 목록은 인증 수단이 아니고 외부 frontend 평가로 차량 제어 API 를 직접 호출하지 않는다', verdict: 'PASS',
    evidence: '수집 경로 1(Admin API read-only) · 표시 경로 1(Frontend API) · 차량 전달 경로 1 · 직접 호출 0건',
  },
  {
    ul: 'UL-068', rule: '외부 사건 연계는 필요한 OEM 시스템만 adapter 로 선정하고 event 필터·서명·재전송·중복 제거를 정의한다', verdict: 'WARN',
    evidence: '연계 후보 8건 중 채택 4건 · CI/CT 알림 1건 event 필터 미정의 · 재전송 정책 미기록 1건',
  },
];
const s02Rules: UlRule[] = [
  {
    ul: 'UL-004', rule: 'Project·Environment·Instance 매핑을 FP Plane·차종·Tenant 와 동일시하지 않는다 — 배포 stage 와 판매 국가·Vehicle Mode 는 별개다', verdict: 'PASS',
    evidence: '인스턴스 4건 · stage 매핑 3건(dev/stage/prod) · 판매 국가 축과 분리 표기 3건',
  },
  {
    ul: 'UL-006', rule: '환경 복제는 초안 구성만 복사하고 운영 ON·토큰·권리·승인·실제 차량 대상을 승계하지 않는다', verdict: 'WARN',
    evidence: '환경 슬롯 2개 운용 · 복제 이력 1건(초안 구성만) · 자동 승계 0건 · 삭제 영향 분석 미기록 1건',
  },
  {
    ul: 'UL-043', rule: 'Backend·Admin·PAT 토큰을 브라우저·로그·차량 앱에 넣지 않고 최소 읽기 권한·회전·폐기를 자격 참조로 기록한다', verdict: 'FAIL',
    evidence: `자격 참조 4건 중 회전 기록 3건 · 만료 ${metaOf('INT-CODEBEAMER').authExpiry} 자격 1건 · 개인 토큰 0건`,
  },
  {
    ul: 'UL-042', rule: 'SSO·SCIM·계정 수명주기는 기존 OEM IAM 계약으로 선택하고 도구 기본 권한을 그대로 상속하지 않는다', verdict: 'WARN',
    evidence: '도구 계정 3건 · SSO 미연계 1건 · 퇴사자 세션 종료 대기 1건(SYS-IAM 미연결)',
  },
  {
    ul: 'UL-076', rule: '인스턴스 license·plan·billing 은 운영 metadata 이고 차량 상품 권리와 분리한다 — seat 청구를 Entitlement 로 매핑하지 않는다', verdict: 'PASS',
    evidence: 'license 표기 4건 · Catalog 상품 매핑 0건 · 만료 경고 1건은 운영 알림 경로로만 처리',
  },
  {
    ul: 'UL-074', rule: '도구 DB 와 FP DB·Outbox·승인 hash·publication sequence 복구 checkpoint 를 맞추고 업그레이드는 호환 시험을 통과한다', verdict: 'WARN',
    evidence: '전용 DB 분리 1건 · 복구 checkpoint 미기록 1건 · 업그레이드 8.1.4→8.2.0 시험 미기록 1건',
  },
];
const s03Rules: UlRule[] = [
  {
    ul: 'UL-066', rule: 'ToolBinding·FlagBinding → BOM·Topology → RuntimeBinding 배정을 ECU·서비스 단위로 끝까지 결속한다', verdict: 'FAIL',
    evidence: `FlagBinding ${FLAG_BINDINGS.length}건 중 RuntimeBinding 이 참조하는 FlagBinding ${new Set(RUNTIME_BINDINGS.map(rb => rb.flagBindingRef)).size}건(FB-BDC-001·002·006) · 미배정 ${FLAG_BINDINGS.filter(fb => !RUNTIME_BINDINGS.some(rb => rb.flagBindingRef === fb.id)).length}건(FB-BDC-003·004·005) — 실행 후보로 쓰지 않는다`,
  },
  {
    ul: 'UL-069', rule: 'flag 사용 코드 위치·commit·build artifact·소비자 버전을 연결하고 IaC 는 작성 configuration 일 뿐 발행 Gate 를 우회하지 않는다', verdict: 'PASS',
    evidence: `adapter @${digest('git-adapter-8f2c1a4', 7)} · build-2291 · flag 사용 코드 12곳 · Terraform 사용 0건(미도입)`,
  },
  {
    ul: 'UL-071', rule: '도구 curl 명령을 FP 실제 endpoint 로 복사하지 않고 조회·변경·비동기 receipt·오류 계약을 나눈다', verdict: 'PASS',
    evidence: 'FP 명령 4종(Capture·Validate·Preview·Submit) · commandId·revision 계승 · 403·409·412 구분 1건',
  },
];
const s04Rules: UlRule[] = [
  {
    ul: 'UL-064', rule: 'Capture 는 rawDigest·normalizedHash·mappingVersion 을 함께 보존하고 원천 revision 을 재확인한다 — ETag·304 는 승인 hash 가 아니다', verdict: 'PASS',
    evidence: `${CAP_PREV.at} ${CAP_PREV.rev} → ${CAP_CUR.at} ${CAP_CUR.rev} · raw ${digest('raw-r121', 12)} · norm ${digest('norm-r121', 12)} · mapping v1.7`,
  },
  {
    ul: 'UL-070', rule: 'Import·Export 는 dry-run hash·미리보기 만료·원자 commit 을 남기고 승인·secret·runtime actual 을 그대로 가져오지 않는다', verdict: 'FAIL',
    evidence: 'Export JSON 반입 1건 · dry-run hash 미기록 1건 · 미지원 구조(catalog·topology) 1건 · tombstone 미정의',
  },
];
const s05Rules: UlRule[] = [
  {
    ul: 'UL-025', rule: 'Context field 사전은 key·type·단위·범위·enum·원천 권위·필수·신선도를 함께 정의하고 도구 legalValues 를 사실 검증으로 쓰지 않는다', verdict: 'WARN',
    evidence: 'schema key 5건 · 원천 권위 미등록 1건(cohort) · 예약 키 충돌 0건 · 사용처 미기재 1건',
  },
  {
    ul: 'UL-026', rule: '브라우저·SDK 가 보낸 문자열을 법규·권리 사실로 신뢰하지 않고 trustedContextRef·source revision 을 기록한다', verdict: 'FAIL',
    evidence: '도구 표시값 기반 조건 1건(APL-JP-UNKNOWN) · trustedContextRef 미기록 1건 · 로컬 mode/speed 최소 전달 미확인',
  },
];
const s06Rules: UlRule[] = [
  {
    ul: 'UL-060', rule: '관리 포털·비안전 HMI 의 frontend remote evaluation 과 차량 local signed evaluation 을 별도 profile 로 두고 서로 승격하지 않는다', verdict: 'FAIL',
    evidence: 'frontend profile 1건(IVI-HEAD) 이 차량 실행 배정 후보로 잡힘 · AAOS suitability matrix 미기재 1건',
  },
  {
    ul: 'UL-062', rule: '검증된 서명 package 만 저장소에 공급하고 일반 polling 이 bootstrap 결과를 덮어쓰는 경로를 차단한다', verdict: 'WARN',
    evidence: 'bootstrap 1건 이후 polling 경로 1건 · disableAutoStart 를 보안 경계로 쓰는 설정 1건',
  },
  {
    ul: 'UL-067', rule: '도구 token 인증과 차량 publication 서명·identity 를 별도로 관리하고 sequence·만료·키 철회·anti-replay checkpoint 를 남긴다', verdict: 'WARN',
    evidence: `전달 commandId CMD-${digest('cmd-bdc-016', 8)} · anti-replay checkpoint 주기 미기재 1건 · 키 철회 절차 미기록`,
  },
  {
    ul: 'UL-056', rule: 'Applications·SDK 인벤토리는 appName·SDK version·lastSeen·지원 전략을 수집하고 미지원 전략·구형 SDK 를 문제로 연결한다', verdict: 'WARN',
    evidence: 'SDK 인스턴스 3건 · 구형 SDK 1건(8.1.4) · 미지원 전략 사용 1건 · 인벤토리를 readiness 로 대체하지 않음',
  },
];
const s07Rules: UlRule[] = [
  {
    ul: 'UL-052', rule: 'Signals·Actions 는 인증·replay 방지·rate limit·ordered action fail-stop 을 정의하고 운영 actuation 은 FP Gate 를 통과한다', verdict: 'WARN',
    evidence: `관측 이벤트 412건 · 실패 1건 · partial 결과 대사 미기록 1건 · FP Gate 경유 확인 1건`,
  },
  {
    ul: 'UL-057', rule: 'upstream·downstream·sync lag·용량을 source 별로 구분하고 네트워크 가용성·Edge connected 와 차량 effective state 를 나눈다', verdict: 'PASS',
    evidence: `수집 lag ${CAP_CUR.at} 기준 5분 이내 · 원천 ${SOURCE_SYNC.length}종 상태 구분 · readback 39/42대 분리 집계`,
  },
  {
    ul: 'UL-075', rule: 'AI·개발 도구에는 조회·초안 생성만 허용하고 승인·상품 권리·차량 발행·kill 을 포괄 위임하지 않는다', verdict: 'FAIL',
    evidence: '발행 후보 등록 경로 1건이 자동화 후보로 표시됨 · 도구 권한 제한 규칙 미기록 1건',
  },
];
const s08Rules: UlRule[] = [
  {
    ul: 'UL-020', rule: '지원 전략·레거시 API 호환표를 server·SDK 별로 구분하고 차량 profile 은 whitelist 로 제한한다 — 미지원 전략은 후보 전체 거부', verdict: 'FAIL',
    evidence: 'remoteAddress 기반 조건 1건 사용 중 · 호환표에 없음 · whitelist 미적용 1건',
  },
  {
    ul: 'UL-031', rule: 'Custom strategy 는 metadata 등록과 SDK 평가 코드 배포를 분리하고 signed artifact·시험 증거 없으면 차량 publication 을 거절한다', verdict: 'WARN',
    evidence: 'custom strategy 1건 · signed artifact 미제출 · 언어·버전별 구현 시험 증거 0건',
  },
  {
    ul: 'UL-073', rule: 'flags·projects·env·전략·payload·token·API rate·metrics cardinality 상한과 오류를 정의하고 OSS 상품 한도를 FP 도메인 제약으로 복사하지 않는다', verdict: 'WARN',
    evidence: '상한 정의 6/7 항목 · metrics cardinality 상한 미정(현재 1,240) · CPU·메모리·RPO/RTO 측정 전',
  },
];
const s09Rules: UlRule[] = [
  {
    ul: 'UL-013', rule: 'link 는 스킴·대상 allowlist 와 권한을 검사하고 관리용 태그를 국가·안전·승인·권리의 대신으로 쓰지 않는다', verdict: 'PASS',
    evidence: 'link 템플릿 2종 allowlist 일치 · 관리용 태그 4건은 표시 전용 · 검색 별칭 3건',
  },
  {
    ul: 'UL-059', rule: 'Edge 는 서버 측 캐시·평가 확장 후보로만 두고 C17 서명 캐시·OEM gateway·멀티 ECU coordinator 와 동일시하지 않는다', verdict: 'FAIL',
    evidence: 'Edge 무상 LTS 종료 2026-12-31 · 채택 0건 · 이관 비용·대체 캐싱 경로 검토 기록 없음',
  },
  {
    ul: 'UL-077', rule: '기존 화면 ID 와 작업 패턴을 탭·패널·필터로 매핑하고 환경 scope 를 항상 표시한다 — 도구 메뉴·영문 내비게이션을 복제하지 않는다', verdict: 'WARN',
    evidence: '탭 9개 = 정본 영역 9개 · 환경 scope 표시 4건 중 3건 · command palette 미적용 1건',
  },
];
const ALL_UL: UlRule[] = [...s01Rules, ...s02Rules, ...s03Rules, ...s04Rules, ...s05Rules, ...s06Rules, ...s07Rules, ...s08Rules, ...s09Rules];

/** 검토 항목 묶음 + 차단·주의 표식 — 화면마다 같은 모양으로 보여준다. */
function Rules({ items, title }: { items: UlRule[]; title: string }) {
  const fails = items.filter(i => i.verdict === 'FAIL');
  const warns = items.filter(i => i.verdict === 'WARN');
  return (
    <div className="mt">
      <UlRules items={items} title={title} />
      <div className="row small muted" style={{ gap: 10, flexWrap: 'wrap', marginTop: 6, alignItems: 'baseline' }}>
        <span>차단 {fails.length}건</span>
        {fails.map(i => <UlBadge key={i.ul} ul={i.ul} verdict={i.verdict} />)}
        <span>주의 {warns.length}건</span>
        {warns.map(i => <UlBadge key={i.ul} ul={i.ul} verdict={i.verdict} />)}
        <span>주의 항목은 진행을 막지 않는다 — 판정 근거는 근거 열의 값이다.</span>
      </div>
    </div>
  );
}

// ══════════════════════════════ 화면 ══════════════════════════════

export function ExternalSystems() {
  const { state, dispatch, can } = useApp();
  const toast = useToast();

  const [pick, setPick] = useState('INT-CODEBEAMER');
  const [flt, setFlt] = useState({ system: 'ALL', state: 'ALL' as 'ALL' | ConnState });
  const [selInst, setSelInst] = useState('UNL-OSS-PROD');
  const [extraMaps, setExtraMaps] = useState<BindRow[]>([]);
  const [mapForm, setMapForm] = useState({ cp: CONTROL_POINTS[0].id, flag: '', appl: 'APL-KR-PREMIUM-GEN3' });
  const [recaptured, setRecaptured] = useState(false);
  const [schema, setSchema] = useState<SchemaRow[]>(() => SCHEMA_SEED.map(r => ({ ...r })));
  const [schemaForm, setSchemaForm] = useState({ key: '', type: 'string', unit: '—', enumVals: '', authority: '' });
  const [rebinds, setRebinds] = useState(false);
  const [alerts, setAlerts] = useState<Record<string, boolean>>({ 'CI/CT 결과 알림': true });
  const [selSys, setSelSys] = useState('INT-UNLEASH');

  const audited = (action: string, target: string, detail: string) =>
    dispatch({ t: 'AUDIT', entry: { ts: STAMP, actor: state.role, action, target, detail } });

  /** 원천 시스템 한 줄 — 커넥터 상태와 FP 수집 상태를 함께 담는다. */
  const systems: SystemRow[] = useMemo(() => {
    const linked: SystemRow[] = state.connectors.map(c => {
      const m = metaOf(c.id);
      return {
        id: c.id, name: c.name, owned: m.owned, dir: c.dir === 'in' ? '수신' : c.dir === 'out' ? '송신' : '양방향',
        contract: m.contract, last: c.lastSync, pending: m.pending, state: screenStateOf(c, m),
        event: m.event, authRef: m.authRef, authExpiry: m.authExpiry, automation: m.automation, connector: c,
      };
    });
    const unlinked: SystemRow[] = UNREGISTERED.map(u => ({
      id: u.id, name: u.name, owned: u.owned, dir: u.dir, contract: u.contract, last: u.last,
      pending: u.pending, state: 'NOT_CONNECTED', event: u.event, authRef: '—', authExpiry: '—',
      automation: '미도입 — 연계 계약 없음',
    }));
    return [...linked, ...unlinked];
  }, [state.connectors]);

  const list = systems.filter(s => (flt.system === 'ALL' || s.id === flt.system) && (flt.state === 'ALL' || s.state === flt.state));
  const cur = systems.find(s => s.id === pick) || list[0] || systems[0];
  const inst = INSTANCES.find(i => i.id === selInst) || INSTANCES[0];
  const sysSel = systems.find(s => s.id === selSys) || systems[0];
  const bound = RUNTIME_BINDINGS.find(rb => rb.bomRef && rb.topologyRef);
  const pendingTotal = systems.reduce((n, s) => n + s.pending.length, 0);

  /** 연결·중지 사유 — 자격 만료·권한·미등록을 버튼 사유로 그대로 쓴다. */
  const toggleReasons = (row: SystemRow): string[] => {
    if (!row.connector) return ['커넥터 미등록 — 연계 계약과 자격 참조를 먼저 정한다'];
    const r: string[] = [];
    if (!can('edit')) r.push('편집 권한 없음');
    if (row.authExpiry !== '—' && row.authExpiry < TODAY) r.push(`자격 만료(${row.authExpiry}) — 토큰 회전 전에는 연결하지 않는다`);
    return r;
  };

  const boundary = UL_SCREEN_BOUNDARIES.find(b => b.screenId === 'UI18-S02');

  const areas: Record<string, () => ReactNode> = {
    // ── S01 연계 시스템 목록 ──────────────────────────────────────────
    'UI18-S01': () => (
      <div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="small">연계 <b>{state.connectors.length}</b>건</span>
          <span className="small">미등록 원천 <b>{UNREGISTERED.length}</b>건</span>
          <span className="small">미해결 작업 <b>{pendingTotal}</b>건</span>
          <span className="small">수집 기준 <b className="mono">{CAP_CUR.at}</b></span>
        </div>

        <div className="mt" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(140px, 220px))', gap: 8, alignItems: 'end' }}>
          <label className="small muted">시스템
            <select style={{ ...FIELD, marginTop: 4 }} value={flt.system} onChange={e => setFlt({ ...flt, system: e.target.value })}>
              <option value="ALL">전체</option>
              {systems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="small muted">상태
            <select style={{ ...FIELD, marginTop: 4 }} value={flt.state} onChange={e => setFlt({ ...flt, state: e.target.value as 'ALL' | ConnState })}>
              <option value="ALL">전체</option>
              {CONN_STATES.map(s => <option key={s} value={s}>{s} · {STATE_KO[s]}</option>)}
            </select>
          </label>
        </div>

        <div className="mt"><Table head={S01_COLS}>
          {list.length === 0 && <tr><td colSpan={S01_COLS.length} className="small muted">조건에 맞는 연계 시스템이 없다 — 필터를 넓혀 확인한다.</td></tr>}
          {list.map(s => (
            <tr key={s.id} onClick={() => setPick(s.id)} style={{ cursor: 'pointer', background: s.id === cur?.id ? 'var(--surface-2)' : undefined }}>
              <td>{s.name}<br /><span className="mono small muted">{s.id}</span></td>
              <td className="small">{s.owned}</td>
              <td className="small">{s.dir}</td>
              <td className="small">{s.contract}</td>
              <td className="mono small">{s.last}</td>
              <td><State s={s.state} /></td>
              <td>{s.pending.length === 0 ? <span className="muted small">0</span> : <b>{s.pending.length}</b>}</td>
            </tr>
          ))}
        </Table></div>

        {cur && (
          <div className="card mt" style={{ background: 'var(--surface-2)' }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <b className="small">{cur.id} · {cur.name}</b>
              <State s={cur.state} />
            </div>
            <div className="kv mt small">
              <div>소유 데이터</div><div>{cur.owned}</div>
              <div>완료 이벤트</div><div>{cur.event}</div>
              <div>계약</div><div>{cur.contract}</div>
              <div>자격 참조</div><div className="mono">{cur.authRef}</div>
              <div>자격 만료</div><div className="mono">{cur.authExpiry === '—' ? '—' : cur.authExpiry}</div>
              <div>자동화 범위</div><div>{cur.automation}</div>
              <div>미해결 작업</div><div className="small">{cur.pending.length === 0 ? '없음' : cur.pending.join(' · ')}</div>
            </div>

            <div className="row mt" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Gated label={cur.connector?.enabled ? '연결 중지' : '연결'} kind={cur.connector?.enabled ? undefined : 'primary'}
                reasons={toggleReasons(cur)}
                onClick={() => {
                  if (!cur.connector) return;
                  dispatch({ t: 'CONNECTOR_TOGGLE', id: cur.id });
                  audited('CONNECTOR_TOGGLE', cur.id, `${cur.connector.enabled ? '중지' : '연결'} · 상태 ${cur.state}`);
                  toast(`${cur.id} ${cur.connector.enabled ? '연결 중지' : '연결'} — 수집 ${CAP_CUR.at}`, cur.connector.enabled ? 'warn' : 'ok');
                }} />
              <Gated label="원천 책임과 동기화 상태 조회" reasons={[]}
                onClick={() => { audited('CONNECTION_INSPECT', cur.id, `${cur.owned} · ${cur.contract}`); toast(`${cur.name} 소유 데이터 ${cur.owned}`); }} />
              <Gated label="미해결 작업으로 이동" reasons={cur.pending.length === 0 ? ['미해결 작업 없음'] : []}
                onClick={() => { audited('PENDING_NAV', cur.id, cur.pending.join(' · ')); toast(`${cur.id} 미해결 ${cur.pending.length}건`); }} />
              <Gated label="연계 등록" reasons={cur.connector ? ['이미 등록된 커넥터다'] : ['연계 계약과 자격 참조가 먼저 필요하다 — 미연결로 남긴다']}
                onClick={() => toast('등록 경로 없음 — 미연결로 유지', 'warn')} />
              <Gated label="연계 조회(대상 화면 열기)" reasons={cur.state === 'NOT_CONNECTED' ? ['미연결 — 조회할 수집 결과가 없다'] : []}
                onClick={() => { audited('CROSS_VIEW', cur.id, `UI16 대상 조회 · ${CAP_CUR.rev}`); toast(`${cur.id} 연계 조회 — 수집 ${CAP_CUR.rev}`); }} />
            </div>

            {cur.pending.length > 0 && <Reasons list={cur.pending} title="미해결 작업" />}
            <Note>미연결을 정상으로 표시하지 않는다 — 원천 데이터를 이 화면에서 임의 승인 상태로 덮어쓰지도 않는다.</Note>
          </div>
        )}

        <div className="mt"><Table head={['원천', '구분', '수집 상태', '확인 시각']}>
          {SOURCE_SYNC.map(s => (
            <tr key={s.system}>
              <td className="mono small">{s.system}</td>
              <td className="small">{s.detail}</td>
              <td><Pill s={s.state === 'OK' ? '정상' : '지연'} tone={s.state === 'OK' ? '#1F9D55' : '#D9822B'} /></td>
              <td className="mono small">{s.at}</td>
            </tr>
          ))}
        </Table></div>

        <Rules items={s01Rules} title="S01 연계 경계 — 조직 범위·신뢰 경계·외부 사건 연계" />
      </div>
    ),

    // ── S02 Unleash 인스턴스 ──────────────────────────────────────────
    'UI18-S02': () => (
      <div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <span className="small">인스턴스 <b>{INSTANCES.length}</b>건</span>
          <span className="small">정상 <b>{INSTANCES.filter(i => i.state === 'HEALTHY').length}</b></span>
          <span className="small">미연결 <b>{INSTANCES.filter(i => i.state === 'NOT_CONNECTED').length}</b></span>
          {bound && <span className="small">BOM 연결 <b className="mono">{bound.bomRef}</b></span>}
        </div>

        <div className="mt"><Table head={S02_COLS}>
          {INSTANCES.map(i => (
            <tr key={i.id} onClick={() => setSelInst(i.id)} style={{ cursor: 'pointer', background: i.id === inst.id ? 'var(--surface-2)' : undefined }}>
              <td className="mono small">{i.id}</td>
              <td className="mono small">{i.version}</td>
              <td className="mono small">{i.commit}</td>
              <td className="small">{i.env}</td>
              <td className="mono small">{i.authRef}</td>
              <td><State s={i.state} /></td>
            </tr>
          ))}
        </Table></div>

        <div className="card mt" style={{ background: 'var(--surface-2)' }}>
          <b className="small">{inst.id} · 인스턴스 계약</b>
          <div className="kv mt small">
            <div>endpoint</div><div>{inst.endpoint}</div>
            <div>자원·한도</div><div>{inst.quota}</div>
            <div>자격 회전</div><div className="mono">{inst.rotationDue} · 마지막 사용 {inst.lastUsed}</div>
            <div>비고</div><div>{inst.note}</div>
          </div>
          <div className="row mt" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Gated label="ToolInstance 버전·commit 조회" reasons={[]}
              onClick={() => { audited('TOOLINSTANCE_VIEW', inst.id, `${inst.version} · ${inst.commit} · ${inst.env}`); toast(`${inst.id} ${inst.version} · ${inst.commit}`); }} />
            <Gated label="자격 참조·사용 범위 확인" reasons={inst.authRef === '—' ? ['자격 참조 없음 — 미연결 인스턴스'] : []}
              onClick={() => { audited('CREDENTIAL_VIEW', inst.id, `${inst.authRef} · 회전 ${inst.rotationDue}`); toast(`${inst.id} 자격 ${inst.authRef}`); }} />
            <Gated label="도구에서 승인·발행·Flag 전환" kind="danger" reasons={[...UL_FORBIDDEN_IN_UI, ...ulBlocks(s02Rules)]} />
          </div>
          {boundary && <Note>{boundary.screenId} 경계 — {boundary.scope}</Note>}
          <div className="mt"><Reasons list={UL_FORBIDDEN_IN_UI} title="도구 조작 차단 — 이 화면은 도구 관리자 UI 를 대신하지 않는다" /></div>
        </div>

        <div className="mt"><Table head={['인스턴스', '자격 회전', '마지막 사용', '판정']}>
          {INSTANCES.map(i => (
            <tr key={i.id}>
              <td className="mono small">{i.id}</td>
              <td className="mono small">{i.rotationDue}</td>
              <td className="mono small">{i.lastUsed}</td>
              <td>{i.authRef === '—' ? <Pill s="자격 없음" /> : i.rotationDue < TODAY ? <Pill s="회전 만료" tone="#D64545" /> : <Pill s="회전 유효" tone="#1F9D55" />}</td>
            </tr>
          ))}
        </Table></div>

        <Rules items={s02Rules} title="S02 인스턴스 경계 — 매핑·환경·자격·수명주기" />
      </div>
    ),

    // ── S03 도구와 Feature 바인딩 ──────────────────────────────────────
    'UI18-S03': () => {
      const rows = [...BIND_ROWS, ...extraMaps];
      const conflict = rows.some(r => r.cpId === mapForm.cp && r.appl === mapForm.appl);
      const invalid = rows.filter(r => r.valid === 'INVALID');
      const mapReasons = [
        !mapForm.flag.trim() ? '도구 Flag 이름 없음' : '',
        conflict ? `같은 제어점·같은 적용 조건에 이미 매핑이 있다 (${mapForm.cp} · ${mapForm.appl}) — 하나만 선택되어야 한다` : '',
        can('edit') ? '' : '편집 권한 없음',
      ].filter(Boolean);
      return (
        <div>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <span className="small">정확 참조 <b>{rows.length}</b>건</span>
            <span className="small">유효 <b>{rows.filter(r => r.valid === 'VALID').length}</b></span>
            <span className="small">검토 대기 <b>{rows.filter(r => r.valid === 'REVIEW').length}</b></span>
            <span className="small" style={{ color: invalid.length ? 'var(--fail)' : undefined }}>무효 <b>{invalid.length}</b></span>
          </div>

          <div className="mt"><Table head={S03_COLS}>
            {rows.map(r => (
              <tr key={r.ref}>
                <td className="mono small">{r.ref}<br /><span className="muted">{r.note}</span></td>
                <td className="small">{r.obj}</td>
                <td className="small">{r.source}</td>
                <td className="small">{r.owner}</td>
                <td className="mono small">{r.profile}</td>
                <td className="mono small">{r.ver}</td>
                <td><Pill s={r.valid} tone={VALID_TONE[r.valid]} /></td>
              </tr>
            ))}
          </Table></div>

          <div className="mt" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(160px, 1fr))', gap: 8, alignItems: 'end' }}>
            <label className="small muted">Feature ControlPoint
              <select style={{ ...FIELD, marginTop: 4 }} value={mapForm.cp} onChange={e => setMapForm({ ...mapForm, cp: e.target.value })}>
                {CONTROL_POINTS.map(cp => <option key={cp.id} value={cp.id}>{cp.id}</option>)}
              </select>
            </label>
            <label className="small muted">도구 Flag
              <input style={{ ...FIELD, marginTop: 4 }} value={mapForm.flag} placeholder="bdc.policy.enable" onChange={e => setMapForm({ ...mapForm, flag: e.target.value })} />
            </label>
            <label className="small muted">적용 조건
              <input style={{ ...FIELD, marginTop: 4 }} value={mapForm.appl} onChange={e => setMapForm({ ...mapForm, appl: e.target.value })} />
            </label>
          </div>
          <div className="row mt" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Gated label="제어점 ↔ 도구 Flag 매핑" kind="primary" reasons={mapReasons}
              onClick={() => {
                const cp = CONTROL_POINTS.find(c => c.id === mapForm.cp);
                setExtraMaps([...extraMaps, {
                  ref: `MAP-${digest(`${mapForm.cp}|${mapForm.flag}|${mapForm.appl}`, 6).toUpperCase()} · ${mapForm.flag}`,
                  obj: `${mapForm.cp} · ${cp?.kind || '—'} / ${cp?.role || '—'} / ${cp?.accessMode || '—'}`,
                  source: '원천: Unleash 정의 수집(IF-FF-01)', owner: 'ROLE:integrator@body · 정본 FP C01',
                  profile: 'FP 매핑 후보 — 도구 정의는 보관소', ver: `적용 ${mapForm.appl}`, valid: 'REVIEW',
                  note: '매핑 후보 — 승인 전에는 실행 배정으로 쓰지 않는다', cpId: mapForm.cp, appl: mapForm.appl,
                }]);
                audited('BINDING_MAP', mapForm.cp, `${mapForm.flag} · ${mapForm.appl}`);
                toast(`${mapForm.cp} ↔ ${mapForm.flag} 매핑 후보 등록(검토 대기)`);
                setMapForm({ ...mapForm, flag: '' });
              }} />
            <Gated label="Canonical 정의 vs 도구 소유권 확인" reasons={[]}
              onClick={() => { audited('OWNERSHIP_VIEW', 'C01', 'Canonical 정의는 FP 정본 · 도구 정의는 수집 원천'); toast('정본 정의권은 FP C01 — 도구 정의는 수집 원천'); }} />
            <span className="small muted">도구 표시값은 판정 근거가 아니다 — 매핑 후보도 승인 전에는 실행 배정이 아니다.</span>
          </div>

          <div className="mt"><Table head={['바인딩', '적용 조건', 'RuntimeBinding', '판정']}>
            {rows.map(r => {
              const rt = RUNTIME_BINDINGS.find(x => FLAG_BINDINGS.find(fb => fb.id === r.ref.split(' ')[0])?.id === x.flagBindingRef);
              return (
                <tr key={`rt-${r.ref}`}>
                  <td className="mono small">{r.ref.split(' ')[0]}</td>
                  <td className="mono small">{r.appl}</td>
                  <td className="mono small">{rt ? `${rt.id} · ${rt.topologyRef}` : '—'}</td>
                  <td>{rt ? <Pill s="결속" tone="#1F9D55" /> : <Pill s="미배정" tone="#D9822B" />}</td>
                </tr>
              );
            })}
          </Table></div>

          <Rules items={s03Rules} title="S03 바인딩 경계 — 실행 배정·코드 추적·명령 계약" />
        </div>
      );
    },

    // ── S04 Capture와 동기화 차이 ──────────────────────────────────────
    'UI18-S04': () => (
      <div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <span className="small">기준 Capture <b className="mono">{CAP_PREV.at} {CAP_PREV.rev}</b></span>
          <span className="small">현재 Capture <b className="mono">{CAP_CUR.at} {CAP_CUR.rev}</b></span>
          <span className="small">변경 항목 <b>{CAP_ROWS.filter(r => r.before !== r.after).length}</b></span>
          <span className="small">드리프트 <b>{'2'}</b>건</span>
        </div>

        <div className="mt"><Table head={S04_COLS}>
          {CAP_ROWS.map(r => (
            <tr key={r.item}>
              <td className="mono small">{r.item}</td>
              <td className="mono small">{r.before}</td>
              <td className="mono small" style={{ color: r.before !== r.after ? 'var(--pending)' : undefined }}>{r.after}</td>
              <td className="small">{r.impact}</td>
            </tr>
          ))}
        </Table></div>

        <div className="row mt" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Gated label="ToolCapture 재수집 요청" reasons={can('run-engine') ? (recaptured ? ['방금 재수집했다 — 원천 revision 재확인 대기'] : []) : ['재수집 권한 없음']}
            onClick={() => {
              setRecaptured(true);
              audited('RECAPTURE', 'INT-UNLEASH', `${CAP_CUR.rev} 기준 재수집 요청 · mapping v1.7`);
              toast(`재수집 요청 — 기준 ${CAP_CUR.rev}`);
            }} />
          <Gated label="drift·미지원 구조 확인" reasons={[]}
            onClick={() => { audited('DRIFT_VIEW', 'INT-UNLEASH', `미매핑 1건 · 미지원 parent 6건`); toast('미매핑 1건 · 미지원 parent 6건 — 보존 후 거절'); }} />
          <Gated label="승인 반영 작업 연결" reasons={[
            '승인 정본은 C01·C12 — 이 화면에서 원천 데이터를 승인 상태로 덮어쓰지 않는다',
            '새 버전에 이전 승인을 자동 재사용하지 않는다',
            ...ulBlocks(s04Rules),
          ]}
            onClick={() => toast('승인 반영은 FP Gate 경유', 'warn')} />
          <Gated label="ETag·304 로 변경 없음 처리" kind="danger" reasons={['ETag·HTTP 304 는 승인 hash 가 아니다 — 변경 없음의 근거로만 쓴다']} />
        </div>

        {recaptured && <Reasons title="재수집 후 확인 대기" list={[`원천 revision 재확인 필요 (${CAP_CUR.rev} 이후 증분)`, '미매핑 1건은 격리 큐에서 정본으로 승격하지 않는다']} />}

        <div className="mt"><Table head={['원천', '내용', '확인 시각', 'capture 조건']}>
          {SOURCE_SYNC.map(s => (
            <tr key={`cap-${s.system}`}>
              <td className="mono small">{s.system}</td>
              <td className="small">{s.detail}</td>
              <td className="mono small">{s.at}</td>
              <td className="small">{s.state === 'OK' ? `rawDigest · sourceRevision ${CAP_CUR.rev} 보존` : `revision 재확인 필요 · rawDigest ${digest('raw-ci-stale', 12)}`}</td>
            </tr>
          ))}
        </Table></div>

        <Rules items={s04Rules} title="S04 수집 경계 — 보존 항목·Import/Export 승인 경계" />
      </div>
    ),

    // ── S05 Context schema와 원천 ──────────────────────────────────────
    'UI18-S05': () => {
      const unknown = COND_ROWS.filter(c => !c.known);
      const schemaReasons = [
        !schemaForm.key.trim() ? 'key 없음' : '',
        !schemaForm.authority.trim() ? '원천 권위 없음 — legalValues 는 사실 검증이 아니다' : '',
        can('edit') ? '' : '편집 권한 없음',
      ].filter(Boolean);
      return (
        <div>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <span className="small">조건행 <b>{COND_ROWS.length}</b></span>
            <span className="small">확인 <b>{COND_ROWS.filter(c => c.known).length}</b></span>
            <span className="small" style={{ color: unknown.length ? 'var(--pending)' : undefined }}>미정 <b>{unknown.length}</b></span>
            <span className="small">schema key <b>{schema.length}</b></span>
            <span className="small">신뢰 원천 <b>{SOURCE_ROWS.filter(s => s.ok).length}/{SOURCE_ROWS.length}</b></span>
          </div>

          <div className="mt"><Table head={S05_COLS}>
            {COND_ROWS.map(c => (
              <tr key={c.row}>
                <td className="mono small">{c.row}</td>
                <td className="small">{c.axis}</td>
                <td className="mono small">{c.code}</td>
                <td className="small">{c.model}</td>
                <td className="mono small">{c.trim}</td>
                <td className="small">{c.variant}</td>
                <td className="mono small">{c.impl}</td>
                <td><Verified ok={c.known} ko={c.known ? '확인' : '미정'} /></td>
              </tr>
            ))}
          </Table></div>

          <div className="mt"><Table head={['key', '타입', '단위·범위', '허용값(enum)', '원천 권위', '필수', '확인 상태']}>
            {schema.map(r => (
              <tr key={r.key}>
                <td className="mono small">{r.key}</td>
                <td className="mono small">{r.type}</td>
                <td className="mono small">{r.unit}</td>
                <td className="mono small">{r.enumVals || '—'}</td>
                <td className="small">{r.authority}</td>
                <td className="small">{r.required}</td>
                <td><Verified ok={r.state === '확인'} ko={r.state} /></td>
              </tr>
            ))}
          </Table></div>

          <div className="mt" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(140px, 1fr)) 170px', gap: 8, alignItems: 'end' }}>
            <label className="small muted">key
              <input style={{ ...FIELD, marginTop: 4 }} value={schemaForm.key} placeholder="marketScope" onChange={e => setSchemaForm({ ...schemaForm, key: e.target.value })} />
            </label>
            <label className="small muted">타입
              <input style={{ ...FIELD, marginTop: 4 }} value={schemaForm.type} onChange={e => setSchemaForm({ ...schemaForm, type: e.target.value })} />
            </label>
            <label className="small muted">허용값(enum)
              <input style={{ ...FIELD, marginTop: 4 }} value={schemaForm.enumVals} placeholder="KR, EU" onChange={e => setSchemaForm({ ...schemaForm, enumVals: e.target.value })} />
            </label>
            <label className="small muted">원천 권위
              <input style={{ ...FIELD, marginTop: 4 }} value={schemaForm.authority} placeholder="C03 BOM·구성" onChange={e => setSchemaForm({ ...schemaForm, authority: e.target.value })} />
            </label>
            <Gated label="속성 타입과 허용값 원천 등록" kind="primary" reasons={schemaReasons}
              onClick={() => {
                setSchema([...schema, { key: schemaForm.key, type: schemaForm.type, unit: schemaForm.unit, enumVals: schemaForm.enumVals, authority: schemaForm.authority, required: '선택', state: '미정' }]);
                audited('SCHEMA_REGISTER', schemaForm.key, `${schemaForm.type} · ${schemaForm.authority}`);
                toast(`${schemaForm.key} 등록 — 확인 상태 미정`);
                setSchemaForm({ key: '', type: 'string', unit: '—', enumVals: '', authority: '' });
              }} />
          </div>

          <div className="row mt" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Gated label="조건행 확정(확인)" reasons={[
              unknown.length ? `미정 조건행 ${unknown.length}건 — 임의 확정하지 않는다` : '',
              ...ulBlocks(s05Rules),
            ].filter(Boolean)}
              onClick={() => toast('조건행 확정은 원천 권위 등록 후')} />
            <Gated label="국가 의미 축·Trim·Variant 참조 조회" reasons={[]}
              onClick={() => { audited('CONDITION_VIEW', 'APL-KR-PREMIUM-GEN3', '국가 축 KR · TRIM-PREMIUM · entitlement 조건'); toast('조건행 참조 — 판매 국가 축과 Trim·Variant 는 별개다'); }} />
            <Gated label="신뢰된 관측 · 사용자 입력 경계 확인" reasons={[]}
              onClick={() => { audited('TRUST_BOUNDARY', 'C47', '인증 원천 4종 · 표시값 1건 미신뢰'); toast('신뢰 원천 4종 — 도구 표시값은 판정 근거가 아니다'); }} />
          </div>

          <div className="mt"><Table head={['원천', '권위(소유 Core)', 'revision', '확인 시각', '신뢰 판정']}>
            {SOURCE_ROWS.map(s => (
              <tr key={s.src}>
                <td className="small">{s.src}</td>
                <td className="small">{s.authority}</td>
                <td className="mono small">{s.revision}</td>
                <td className="mono small">{s.at}</td>
                <td><Verified ok={s.ok} ko={s.trust} /></td>
              </tr>
            ))}
          </Table></div>

          <Rules items={s05Rules} title="S05 Context 경계 — 사전·사용처·신뢰 원천" />
        </div>
      );
    },

    // ── S06 AAOS와 차량 연결 ──────────────────────────────────────────
    'UI18-S06': () => {
      const rows = RUNTIME_BINDINGS.map(rb => {
        const m = RUNTIME_META[rb.id];
        const cp = cpOf(rb.controlPointRef);
        return {
          ref: `${rb.id} · ${rb.controlPointRef}`,
          obj: `${m?.node || '—'} · ${m?.service || '—'} · ${m?.iface || '—'} · ${cp?.role || '—'}`,
          source: `${m?.node || '—'} (차량 내부) · FlagBinding ${rb.flagBindingRef}`,
          owner: m?.owner || '—',
          profile: m?.profile || '—',
          ver: `${rb.topologyRef} · ${rb.bomRef}`,
          valid: m?.valid || 'REVIEW',
          note: m?.note || '',
        };
      });
      return (
        <div>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <span className="small">실행 배정 <b>{rows.length}</b>건</span>
            <span className="small">OEM <b>{rows.filter(r => r.owner.startsWith('OEM')).length}</b></span>
            <span className="small">3rd party <b>{rows.filter(r => r.owner.includes('3rd party')).length}</b></span>
            <span className="small">readback <b>39/42</b>대</span>
          </div>

          <div className="mt"><Table head={S06_COLS}>
            {rows.map(r => (
              <tr key={r.ref}>
                <td className="mono small">{r.ref}<br /><span className="muted">{r.note}</span></td>
                <td className="small">{r.obj}</td>
                <td className="small">{r.source}</td>
                <td className="small">{r.owner}</td>
                <td className="small">{r.profile}</td>
                <td className="mono small">{r.ver}</td>
                <td><Pill s={r.valid} tone={VALID_TONE[r.valid]} /></td>
              </tr>
            ))}
            <tr>
              <td className="mono small">GW-BDC-REPORT · report 계약<div className="muted">타 제어기 Gateway</div></td>
              <td className="small">OEM Gateway · 명령 상관관계(commandId)와 적용 결과 보고</td>
              <td className="small">Gateway (차량 외부 경계)</td>
              <td className="small">OEM Gateway</td>
              <td className="small">report 계약 — 프로토콜 ACK 와 별개</td>
              <td className="mono small">report v1.2</td>
              <td><Pill s="VALID" tone="#1F9D55" /></td>
            </tr>
            <tr>
              <td className="mono small">RB-HMI-DISPLAY · frontend remote evaluation<div className="muted">승격 금지 대상</div></td>
              <td className="small">IVI-HEAD · 표시값 평가</td>
              <td className="small">HMI 표시 경로</td>
              <td className="small">OEM HMI</td>
              <td className="small">frontend profile — 차량 안전 실행 SDK 아님</td>
              <td className="mono small">8.2.0</td>
              <td><Pill s="INVALID" tone="#D64545" /></td>
            </tr>
          </Table></div>

          <div className="row mt" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Gated label="RuntimeBinding · node·service·interface 조회" reasons={[]}
              onClick={() => { audited('RUNTIME_VIEW', 'TOPO-BDC-001@1.4.0', `${rows.length}건 · BOM IBOM-BDC-001@1.1.0`); toast('실행 배정 4건 — node·service·interface 결속'); }} />
            <Gated label="차량 실행 배정 확정" reasons={[...ulBlocks(s06Rules), '서명 스냅샷 없는 정의는 차량 실행 후보가 아니다']}
              onClick={() => toast('실행 배정 확정 불가', 'err')} />
            <Gated label="타 제어기 Gateway report 계약 확인" reasons={[]}
              onClick={() => { audited('GATEWAY_REPORT', 'GW-BDC-REPORT', 'commandId 상관관계 · report v1.2 · ACK 와 분리'); toast('report 계약 v1.2 — ACK 는 적용 결과가 아니다'); }} />
            <span className="small muted">표시값(HMI·Playground)과 차량 로컬 평가는 별도 profile — 서로 승격하지 않는다.</span>
          </div>

          {rebinds && <Reasons title="실행 배정 확인 결과" list={['IVI-HEAD 표시 profile 이 차량 실행 후보로 잡혀 있다 — 분리 필요', '3rd party payload capability 검사 1건 대기']} />}
          <div className="mt">
            <Gated label="배정 결속 재확인" reasons={[]}
              onClick={() => { setRebinds(true); audited('REBIND_CHECK', 'TOPO-BDC-001@1.4.0', 'OEM/3rd party 책임 · SDK Profile 분리 점검'); toast('배정 결속 재확인 — 표시 profile 1건 분리 필요', 'warn'); }} />
          </div>

          <Rules items={s06Rules} title="S06 차량 경계 — 평가 위치·서명 스냅샷·서명·인벤토리" />
        </div>
      );
    },

    // ── S07 발행과 관측 인터페이스 ─────────────────────────────────────
    'UI18-S07': () => (
      <div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <span className="small">단계 <b>{PUB_STAGES.length}</b></span>
          <span className="small">근거 있음 <b>{PUB_STAGES.filter(p => !p.blocked && p.state !== '부분 완료').length}</b></span>
          <span className="small">미확인 <b>{PUB_STAGES.filter(p => p.blocked).length}</b></span>
          <span className="small">전달 commandId <b className="mono">CMD-{digest('cmd-bdc-016', 8)}</b></span>
          <span className="small">readback <b>39/42</b>대</span>
        </div>

        <div className="mt"><Table head={S07_COLS}>
          {PUB_STAGES.map(p => (
            <tr key={p.stage}>
              <td className="small">{p.stage}</td>
              <td className="mono small">{p.ref}</td>
              <td><Pill s={p.state} tone={p.state === '근거 있음' || p.state === '관측' ? '#1F9D55' : p.blocked ? '#D64545' : '#D9822B'} /></td>
              <td className="small">{p.reason}</td>
            </tr>
          ))}
        </Table></div>

        <div className="row mt" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Gated label="PublicationManifest 전달 계약 조회" reasons={[]}
            onClick={() => { audited('PUBLICATION_VIEW', `CMD-${digest('cmd-bdc-016', 8)}`, '전달 접수 42대 · readback 39대 · 미보고 3대'); toast('Manifest 전달 계약 — ACK 42/42 · readback 39/42'); }} />
          <Gated label="명령 상관관계 · 실제 report 계약 확인" reasons={[]}
            onClick={() => { audited('COMMAND_CORRELATION', `CMD-${digest('cmd-bdc-016', 8)}`, 'protocol ACK ≠ readback'); toast('commandId 상관관계 확인 — ACK 와 readback 분리'); }} />
          <Gated label="프로토콜 ACK · readback 구분" reasons={[]}
            onClick={() => { audited('ACK_READBACK_SPLIT', 'readback', 'ACK 42/42 · readback 39/42 · 미보고 3대 UNKNOWN'); toast('ACK 42/42 ≠ readback 39/42 — 미보고 3대는 완료가 아니다', 'warn'); }} />
          <Gated label="발행 후보 등록" kind="primary" reasons={[
            '승인 정본은 C01·C12 — 이 화면에는 승인·발행 권한이 없다',
            ...ulBlocks(s07Rules),
          ]}
            onClick={() => toast('발행 후보 등록 불가', 'err')} />
          <Gated label="도구에서 Flag 전환" kind="danger" reasons={UL_FORBIDDEN_IN_UI} />
        </div>

        <div className="mt"><Reasons list={[
          '도구 표시값은 판정 근거가 아니다 — 근거는 차량 로컬 서명 스냅샷과 C16 평가 결과',
          '전달(ACK)과 적용(readback)과 관측(이벤트)은 서로 다른 단계다',
          ...UL_FORBIDDEN_IN_UI.filter(x => x.includes('승인·발행') || x.includes('Flag 전환')),
        ]} title="발행 권한 차단 — 관측 밖의 조작은 이 화면에 없다" /></div>

        <div className="mt"><Table head={['관측 경로', '정확 참조', '값', '판정 사용']}>
          <tr><td className="small">이벤트 이력</td><td className="mono small">EVT-전달 · 실패 1건</td><td className="mono small">412</td><td><Pill s="사용" tone="#1F9D55" /></td></tr>
          <tr><td className="small">readback 대사</td><td className="mono small">39 / 42대</td><td className="mono small">미보고 3대</td><td><Pill s="부분 판정" tone="#D9822B" /></td></tr>
          <tr><td className="small">차량 effective state</td><td className="mono small">C17 로컬 캐시 · 서명 스냅샷</td><td className="mono small">{digest('snapshot-bdc', 12)}</td><td><Pill s="사용" tone="#1F9D55" /></td></tr>
          <tr><td className="small">도구 Playground 표시값</td><td className="mono small">{digest('pg-value', 12)}</td><td className="mono small">—</td><td><Pill s="판정 근거 아님" tone="#D64545" /></td></tr>
        </Table></div>

        <Rules items={s07Rules} title="S07 발행·관측 경계 — 안전 자동화·관측 창·AI 위임 금지" />
      </div>
    ),

    // ── S08 호환성과 자원 Profile ──────────────────────────────────────
    'UI18-S08': () => (
      <div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <span className="small">Profile <b>{COMPAT_ROWS.length}</b>건</span>
          <span className="small">유효 <b>{COMPAT_ROWS.filter(r => r.valid === 'VALID').length}</b></span>
          <span className="small" style={{ color: 'var(--fail)' }}>미지원 <b>{COMPAT_ROWS.filter(r => r.valid === 'UNSUPPORTED').length}</b></span>
          <span className="small">자원 항목 <b>{RESOURCE_ROWS.length}</b></span>
        </div>

        <div className="mt"><Table head={S08_COLS}>
          {COMPAT_ROWS.map(r => (
            <tr key={r.ref}>
              <td className="mono small">{r.ref}<br /><span className="muted">{r.note}</span></td>
              <td className="small">{r.obj}</td>
              <td className="small">{r.host}</td>
              <td className="small">{r.owner}</td>
              <td className="small">{r.profile}</td>
              <td className="mono small">{r.ver}</td>
              <td><Pill s={r.valid} tone={VALID_TONE[r.valid]} /></td>
            </tr>
          ))}
        </Table></div>

        <div className="row mt" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Gated label="서버 SDK adapter 버전 행렬 조회" reasons={[]}
            onClick={() => { audited('SDK_MATRIX_VIEW', 'ADP-NODE@8.2.0', `adapter ${COMPAT_ROWS.length}행 · 구형 1건 · 미지원 2건`); toast('SDK 행렬 — 구형 1건 · 미지원 2건'); }} />
          <Gated label="차량 발행 후보 승격" reasons={[...ulBlocks(s08Rules), '미지원 전략 후보는 전체 거부 — 부분 채택하지 않는다']}
            onClick={() => toast('발행 후보 승격 불가', 'err')} />
          <Gated label="Docker 결과 · Provider 호환성 증거 연결" reasons={['콘테이너 빌드·기동 시험 결과 미기록(NOT_RUN) — 증거 없이 호환성 판정하지 않는다']}
            onClick={() => toast('호환성 증거 없음', 'warn')} />
        </div>

        <div className="mt"><Table head={['자원 항목', '한계', '현재 값', '판정']}>
          {RESOURCE_ROWS.map(r => (
            <tr key={r.item}>
              <td className="small">{r.item}</td>
              <td className="mono small">{r.limit}</td>
              <td className="mono small">{r.actual}</td>
              <td><Pill s={r.verdict} tone={r.ok ? '#1F9D55' : '#D9822B'} /></td>
            </tr>
          ))}
        </Table></div>

        <div className="mt"><Table head={['무료 에디션 한계', '영향', '보상 책임 Core', '증적']}>
          {UL_LIMITS.map(l => (
            <tr key={l.limit}>
              <td className="small">{l.limit}</td>
              <td className="small muted">{l.impact}</td>
              <td className="small">{l.compensates}</td>
              <td className="small muted">{l.evidence}</td>
            </tr>
          ))}
        </Table></div>
        <Note>상품 한도를 FP 도메인 제약으로 복사하지 않는다 — 상한은 실제 측정 후 승인한다.</Note>

        <Rules items={s08Rules} title="S08 호환성 경계 — 전략 지원표·artifact 증거·자원 상한" />
      </div>
    ),

    // ── S09 연계 설정과 자동화 범위 ────────────────────────────────────
    'UI18-S09': () => (
      <div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <span className="small">연계 시스템 <b>{systems.length}</b>건</span>
          <span className="small">자동화 단계 <b>{AUTOMATION_ROWS.filter(a => a.state === 'ON').length}</b></span>
          <span className="small">차단 단계 <b>{AUTOMATION_ROWS.filter(a => a.state === '차단').length}</b></span>
          <span className="small">미도입 항목 <b>{UL_USAGE.filter(u => u.verdict.startsWith('미사용')).length}</b></span>
        </div>

        <div className="mt"><Table head={S09_COLS}>
          {systems.map(s => (
            <tr key={`set-${s.id}`} onClick={() => setSelSys(s.id)} style={{ cursor: 'pointer', background: s.id === sysSel?.id ? 'var(--surface-2)' : undefined }}>
              <td>{s.name}<br /><span className="mono small muted">{s.id}</span></td>
              <td className="small">{s.owned}</td>
              <td className="small">{s.dir}</td>
              <td className="small">{s.contract}</td>
              <td className="mono small">{s.last}</td>
              <td><State s={s.state} /></td>
              <td>{s.pending.length === 0 ? <span className="muted small">0</span> : <b>{s.pending.length}</b>}</td>
            </tr>
          ))}
        </Table></div>

        {sysSel && (
          <div className="card mt" style={{ background: 'var(--surface-2)' }}>
            <b className="small">{sysSel.id} · 연계 설정</b>
            <div className="kv mt small">
              <div>자동화 범위</div><div>{sysSel.automation}</div>
              <div>계약</div><div>{sysSel.contract}</div>
              <div>완료 이벤트</div><div>{sysSel.event}</div>
              <div>연결 상태</div><div><State s={sysSel.state} /></div>
            </div>
            <div className="row mt" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Gated label="webhook · CI/CT 알림 연결" reasons={can('edit') ? [] : ['편집 권한 없음']}
                onClick={() => {
                  setAlerts(a => ({ ...a, 'CI/CT 결과 알림': !a['CI/CT 결과 알림'] }));
                  audited('ALERT_CHANNEL', 'CI/CT', `CI/CT 알림 ${alerts['CI/CT 결과 알림'] ? 'OFF' : 'ON'} · Webhook 미사용 유지`);
                  toast(`CI/CT 알림 ${alerts['CI/CT 결과 알림'] ? 'OFF' : 'ON'} — Webhook 은 열지 않는다`);
                }} />
              <Gated label="Import · Export 승인 경계 확인" reasons={[
                '승인·secret·runtime actual 은 반입하지 않는다 — 부트스트랩 구성만 옮긴다',
                'Export 반입 dry-run hash 미기록 1건',
              ]}
                onClick={() => toast('Import·Export 승인 경계 확인', 'warn')} />
              <Gated label="Edge · Terraform 도입 범위 검토" reasons={['검토 기록 없음 — 미도입으로 유지한다', ...ulBlocks(s09Rules)]}
                onClick={() => toast('도입 범위 검토 기록 없음', 'warn')} />
              <Gated label="미도입 항목 상태 표시" reasons={[]}
                onClick={() => { audited('NOT_ADOPTED_VIEW', 'UL-USAGE', '미사용 5건 · 부트스트랩 한정 1건'); toast('미도입 항목 — 대체 소유 Core 를 함께 표시'); }} />
            </div>
            {sysSel.pending.length > 0 && <Reasons list={sysSel.pending} title="연결 전 확인 대기" />}
          </div>
        )}

        <div className="mt"><Table head={['단계', '자동화 범위', '승인 경계', '상태']}>
          {AUTOMATION_ROWS.map(a => (
            <tr key={a.step}>
              <td className="small">{a.step}</td>
              <td className="small">{a.scope}</td>
              <td className="small muted">{a.gate}</td>
              <td><Pill s={a.state} tone={a.ok ? '#1F9D55' : '#D64545'} /></td>
            </tr>
          ))}
        </Table></div>

        <div className="mt"><Table head={['채널·연계', '용도', '판정', '차단 사유']}>
          {CHANNELS.map(c => {
            const blocked = c.block.length > 0;
            return (
              <tr key={c.name}>
                <td className="small">{c.name}</td>
                <td className="small muted">{c.use}</td>
                <td><Pill s={c.verdict} tone={blocked ? '#D9822B' : '#1F9D55'} /></td>
                <td className="small">{c.block[0] || <span className="muted">—</span>}</td>
              </tr>
            );
          })}
        </Table></div>

        <div className="mt"><Table head={['항목', '무료 에디션', '판정', '사유', '대체 소유']}>
          {UL_USAGE.map(u => (
            <tr key={u.feature}>
              <td className="small">{u.feature}</td>
              <td className="small muted">{u.edition}</td>
              <td><Pill s={u.verdict} tone={u.verdict.startsWith('미사용') ? '#D9822B' : '#1F9D55'} /></td>
              <td className="small muted">{u.reason}</td>
              <td className="small">{u.replacedBy || '—'}</td>
            </tr>
          ))}
        </Table></div>
        <Note>미도입은 정상 상태가 아니다 — 대체 소유 Core 와 검증 증적 없이는 도입으로 바꾸지 않는다.</Note>

        <Rules items={s09Rules} title="S09 설정 경계 — 링크·Edge·화면 패턴" />
      </div>
    ),
  };

  const kpis: Kpi[] = [
    { v: systems.length, l: '연계 시스템' },
    { v: systems.filter(s => s.state === 'HEALTHY').length, l: '정상(HEALTHY)' },
    { v: systems.filter(s => s.state !== 'HEALTHY').length, l: '조치 필요' },
    { v: pendingTotal, l: '미해결 작업' },
    { v: ALL_UL.length, l: '검토 항목' },
    { v: ALL_UL.filter(u => u.verdict === 'FAIL').length, l: '검토 차단' },
  ];

  return (
    <CanonicalScreen screenId="UI18" core="C32 Legacy 시스템 연계" kpis={kpis} areas={areas}
      head={
        <div className="card" style={{ background: 'var(--surface-2)' }}>
          <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <span className="small">수집 기준 <b className="mono">{CAP_CUR.at} {CAP_CUR.rev}</b></span>
            <span className="small">raw <b className="mono">{digest('raw-r121', 12)}</b></span>
            <span className="small">정규화 <b className="mono">{digest('norm-r121', 12)}</b></span>
            <span className="small">검토 항목 <b>{ALL_UL.length}</b> · 통과 {ALL_UL.filter(u => u.verdict === 'PASS').length} · 주의 {ALL_UL.filter(u => u.verdict === 'WARN').length} · 차단 <b style={{ color: 'var(--fail)' }}>{ALL_UL.filter(u => u.verdict === 'FAIL').length}</b></span>
            <span className="small muted">이 화면은 수집·비교·관측만 한다 — 도구에서 승인·발행·Flag 전환을 수행하지 않는다.</span>
          </div>
        </div>
      } />
  );
}
