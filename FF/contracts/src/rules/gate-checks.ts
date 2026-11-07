// Gate 자동 검사 (P10, D01-02 · FR-REG-005-001·002·004·006·007·020) — 사람의 Gate 판정과 별도로, 전이 요청 때 데이터로 다시 확인하는 조건.
// 전이(정의 승인·검증 완료·출시)는 해당 Gate의 자동 검사가 모두 통과해야 한다 — 판정 PASS 뒤에 바뀐 데이터도 막는다(fail-closed, FFG-LCY-002).
// 사실(facts)은 백엔드가 모으고, 판정은 이 순수 함수 하나 — 화면(Gate 탭)이 같은 결과를 보인다.
// Variant Rule은 독립 엔티티가 아니다(결정 D8) — Feature의 Variant 조건(국가·차종·트림·UPG-VC, rules/variant.ts)으로 확인한다.
import { GATE_META, type Asil, type GateId, type Lifecycle } from '../enums';

export type GateCheckKey =
  | 'OWNER'
  | 'REQUIRES_RELEASED'
  | 'VARIANT_RULE'
  | 'TEST_EVIDENCE'
  | 'SAFETY_EVIDENCE'
  | 'SAFE_DEFAULT'
  | 'ROLLBACK_PLAN'
  | 'KILL_READY'
  | 'DEPLOY_METHOD'
  | 'TELEMETRY'
  | 'AUDIT_LOG'
  | 'ALERT_RULE';

export interface GateCheck {
  gate: GateId;
  key: GateCheckKey;
  label: string;
  pass: boolean;
  /** 사람이 읽는 근거·부족한 것 */
  detail: string;
}

export interface GateCheckPolicy {
  policyId: string;
  flagKey: string;
  status: string;
  safeDefault: boolean;
  rolloutMode: 'ALL' | 'NONE' | 'COHORT';
}

export interface GateCheckFacts {
  ownerId: string;
  asil: Asil;
  /** 이 Version이 원천인 REQUIRES 관계와 대상 Version의 지금 Lifecycle(대상 미확정·미등록이면 null) */
  requires: { dependencyId: string; targetFeatureId: string; targetVersion: string | null; targetLifecycle: Lifecycle | null }[];
  variant: { country: string; vehicleModel: string; trim: string; upgVc: string[] };
  /** 필수 Test Case와 Evidence가 있는 수, Evidence 없는 필수 Test Case ID(추적 연결 P3) */
  tests: { required: number; withEvidence: number; missing: string[] };
  /** 이 Version의 분석 기록(HARA·TARA) — 안전·보안 등급 적합성 증거 */
  analysis: { hara: boolean; tara: boolean; securityRelevant: boolean };
  controlPoints: number;
  /** 구현 연결 SW 수(OTA로 나가는 SW) */
  swCount: number;
  /** 이 Version의 정책(Control Point별 최신 개정) */
  policies: GateCheckPolicy[];
  /** Flag Registry 결속(긴급 차단 대상) — 결속 안 됨·퇴역은 차단할 수 없다 */
  flags: { flagKey: string; bound: boolean; retired: boolean }[];
  /** 같은 Feature의 출시된 이전 Version(되돌릴 곳) */
  priorReleased: string | null;
  /** 운영 관측 — Lake 연결 상태 */
  telemetry: { connected: boolean };
  /** 이 Feature를 대상으로 남은 감사 기록 수 */
  auditEntries: number;
  /** 운영 경보 이벤트별 수신 규칙의 수신자 수 */
  alertRules: { event: string; name: string; recipients: number }[];
}

/** 전이별로 다시 확인하는 Gate — 표 10의 전이 Gate와 같다 */
export const TRANSITION_CHECK_GATES: Partial<Record<Lifecycle, GateId[]>> = { APPROVED: ['G1', 'G3'], VERIFIED: ['G4', 'G5'], RELEASED: ['G8', 'G9'] };
/** 출시 전 운영 경보가 있어야 하는 이벤트 — 긴급 차단·이상·배포 중단·롤백 실패 */
export const OPS_ALERT_EVENTS = ['kill.issued', 'anomaly.opened', 'rollout.halt-required', 'rollback.failed'] as const;

const ROLLOUT_LABEL: Record<GateCheckPolicy['rolloutMode'], string> = { ALL: '전체', COHORT: '코호트', NONE: '대상 없음' };
const SAFE_DEFAULT_OFF_ASIL: readonly Asil[] = ['B', 'C', 'D'];
const APPROVED_POLICY = ['APPROVED', 'DEPLOYED'];

const c = (gate: GateId, key: GateCheckKey, label: string, pass: boolean, detail: string): GateCheck => ({ gate, key, label, pass, detail });

/** 9 Gate 중 자동 검사가 있는 Gate의 검사 결과 전부(gate 순) */
export function gateChecks(x: GateCheckFacts): GateCheck[] {
  const out: GateCheck[] = [];
  // G1 Feature Gate — Owner 지정, requires 대상 Feature가 Released(FR-REG-005-001)
  out.push(c('G1', 'OWNER', 'Feature Owner 지정', !!x.ownerId.trim(), x.ownerId.trim() ? `담당 ${x.ownerId}` : 'Feature Owner가 없습니다'));
  const notReleased = x.requires.filter((r) => r.targetLifecycle !== 'RELEASED');
  out.push(
    c(
      'G1',
      'REQUIRES_RELEASED',
      '필요(requires) 관계 대상이 출시됨',
      !notReleased.length,
      !x.requires.length ? '필요 관계 없음' : notReleased.length ? notReleased.map((r) => `${r.dependencyId} → ${r.targetFeatureId} ${r.targetVersion ?? '대상 Version 미확정'} ${r.targetLifecycle ?? '미등록'}`).join(', ') : `${x.requires.length}건 모두 RELEASED`,
    ),
  );
  // G3 Variant Gate — Variant 조건(국가·차종·트림·UPG-VC) 등록(FR-REG-005-002)
  const v = x.variant;
  const missingScope = [!v.country && '국가', !v.vehicleModel && '차종', !v.trim && '트림', !v.upgVc.length && 'UPG-VC'].filter(Boolean) as string[];
  out.push(c('G3', 'VARIANT_RULE', 'Variant 조건 등록(국가·차종·트림·UPG-VC)', !missingScope.length, missingScope.length ? `등록되지 않음: ${missingScope.join(', ')}` : `${v.country} · ${v.vehicleModel} · ${v.trim} · UPG-VC ${v.upgVc.join(', ')}`));
  // G4 Control Gate — Safe Default·Rollback Plan·긴급 차단 실행 가능(FR-REG-005-020)
  const offNeeded = SAFE_DEFAULT_OFF_ASIL.includes(x.asil);
  const onDefault = offNeeded ? x.policies.filter((p) => p.safeDefault) : [];
  const sdOk = x.controlPoints > 0 && x.policies.length >= x.controlPoints && !onDefault.length;
  out.push(
    c(
      'G4',
      'SAFE_DEFAULT',
      'Control Point별 Safe Default 등록',
      sdOk,
      x.policies.length < x.controlPoints
        ? `Control Point ${x.controlPoints}개 중 정책(Safe Default) 등록 ${x.policies.length}개`
        : onDefault.length
          ? `ASIL ${x.asil}인데 Safe Default가 ON: ${onDefault.map((p) => p.flagKey).join(', ')} — OFF여야 합니다`
          : x.controlPoints
            ? `${x.policies.length}개 정책 Safe Default ${x.policies.map((p) => `${p.flagKey} ${p.safeDefault ? 'ON' : 'OFF'}`).join(', ')}`
            : 'Control Point가 없습니다',
    ),
  );
  const safeStop = x.policies.length > 0 && x.policies.every((p) => !p.safeDefault);
  out.push(
    c(
      'G4',
      'ROLLBACK_PLAN',
      'Rollback Plan(되돌릴 곳) 정의',
      !!x.priorReleased || safeStop,
      x.priorReleased ? `출시된 이전 Version ${x.priorReleased}로 되돌림` : safeStop ? '최초 출시 — Safe Default(OFF)로 되돌림' : '되돌릴 이전 출시 Version이 없고 Safe Default가 OFF가 아닙니다',
    ),
  );
  const unbound = x.policies.filter((p) => {
    const f = x.flags.find((y) => y.flagKey === p.flagKey);
    return !f || !f.bound || f.retired;
  });
  out.push(
    c('G4', 'KILL_READY', '긴급 차단 실행 가능(Flag 등록)', x.policies.length > 0 && !unbound.length, !x.policies.length ? '차단할 정책 Flag가 없습니다' : unbound.length ? `Flag Registry에 결속되지 않았거나 퇴역: ${unbound.map((p) => p.flagKey).join(', ')}` : `${x.policies.length}개 Flag 결속`),
  );
  // G5 Verification Gate — 필수 Test Case별 Test Evidence, 안전·보안 등급 적합성 증거(FR-REG-005-004)
  const t = x.tests;
  out.push(c('G5', 'TEST_EVIDENCE', '필수 Test Case별 Test Evidence', !t.missing.length, !t.required ? '연결된 필수 Test Case 없음' : t.missing.length ? `Evidence 없음: ${t.missing.join(', ')} (${t.withEvidence}/${t.required})` : `필수 ${t.required}건 모두 Evidence`));
  const a = x.analysis;
  const needHara = x.asil !== 'QM';
  const safetyMissing = [needHara && !a.hara && `ASIL ${x.asil} — HARA`, a.securityRelevant && !a.tara && '보안 관련 — TARA'].filter(Boolean) as string[];
  out.push(c('G5', 'SAFETY_EVIDENCE', '안전·보안 등급 적합성 증거', !safetyMissing.length, safetyMissing.length ? `기록 없음: ${safetyMissing.join(', ')}` : needHara || a.securityRelevant ? `${[a.hara && 'HARA', a.tara && 'TARA'].filter(Boolean).join('·')} 기록` : 'QM·보안 무관 — 추가 증거 대상 아님'));
  // G8 OTA Gate — 배포 방식 확정(FR-REG-005-006): 차량에 무엇으로 나가는가 — OTA SW(구현 연결)·Flag 정책. 정책이 있으면 모두 승인된 배포 범위(전체·코호트·대상 없음)여야
  const unapproved = x.policies.filter((p) => !APPROVED_POLICY.includes(p.status));
  const delivery = [x.swCount ? `OTA SW ${x.swCount}건` : '', ...x.policies.map((p) => `${p.flagKey} ${ROLLOUT_LABEL[p.rolloutMode]}`)].filter(Boolean);
  out.push(
    c(
      'G8',
      'DEPLOY_METHOD',
      '배포 방식 확정(OTA SW·승인된 정책의 배포 범위)',
      !!delivery.length && !unapproved.length,
      unapproved.length ? `승인되지 않은 정책: ${unapproved.map((p) => `${p.policyId} ${p.status}`).join(', ')}` : delivery.length ? delivery.join(', ') : '차량에 보낼 OTA SW·Flag 정책이 없습니다',
    ),
  );
  // G9 Operations Gate — Telemetry 연결·감사 기록·운영 경보 규칙(FR-REG-005-007). 정책 Flag가 있으면 Flag Registry 결속(평가 수집 키)까지
  out.push(
    c('G9', 'TELEMETRY', 'Telemetry 연결', x.telemetry.connected && !unbound.length, !x.telemetry.connected ? 'Data Lake 연결이 꺼져 있습니다' : unbound.length ? `수집 대상 Flag가 결속되지 않았습니다: ${unbound.map((p) => p.flagKey).join(', ')}` : `Data Lake 연결 · Feature 버전 지표${x.policies.length ? ` · Flag ${x.policies.length}개 평가 수집` : ''}`),
  );
  out.push(c('G9', 'AUDIT_LOG', '감사 기록', x.auditEntries > 0, x.auditEntries ? `이 Feature 감사 기록 ${x.auditEntries}건 — 변경·판정이 남는다` : '이 Feature의 감사 기록이 없습니다'));
  const noRecipient = OPS_ALERT_EVENTS.filter((e) => !(x.alertRules.find((r) => r.event === e)?.recipients ?? 0));
  out.push(c('G9', 'ALERT_RULE', '운영 경보 규칙', !noRecipient.length, noRecipient.length ? `수신자가 없는 경보: ${noRecipient.join(', ')}` : x.alertRules.filter((r) => (OPS_ALERT_EVENTS as readonly string[]).includes(r.event)).map((r) => `${r.name} ${r.recipients}`).join(', ')));
  return out;
}

/** 이 전이가 다시 확인하는 Gate의 실패한 자동 검사 */
export function transitionCheckFailures(to: Lifecycle, checks: GateCheck[]): GateCheck[] {
  const gates = TRANSITION_CHECK_GATES[to] ?? [];
  return checks.filter((x) => gates.includes(x.gate) && !x.pass);
}

/** 실패 검사 → 막힌 사유 문구 */
export const gateCheckMessage = (x: GateCheck) => `${x.gate} ${GATE_META[x.gate].name} 자동 검사 — ${x.label}: ${x.detail}`;
