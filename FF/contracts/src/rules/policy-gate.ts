// 플랫폼 정책 게이트 (D03-02 배포 안전성 검증) — kill_command v2를 서명해 내보내기 전 마지막 플랫폼 검사(보고서 8장·부록 D.4).
// 규칙 순서·조건은 코드 패키지 tools/platform_policy_gate.py의 evaluate()와 같다 — tools/gate-parity.ts가 같은 사례로 두 구현을 규칙 단위로 대조한다.
// 차량(LPC·Safety Guard)이 안전 관련 검사를 모두 다시 하고, 여기는 플랫폼만 할 수 있는 검사(Registry 상태·등급 정합, 승인·역할과 원장의 Kill 승인자,
// 유효기간, 명령 순번, 이동 시간 창 누적 상한, 시장·법규 사전조건, Evidence)를 더한다. 대량 조치 상한은 서명 HSM 정책 엔진이 다시 집행한다(FFG-SEC-003).
import type { DeactClass, FClass } from '../schemas/safety';
import { KillCommandV2, wireErrors } from '../schemas/wire';

const F_RANK: Record<FClass, number> = { F0: 0, F1: 1, F2: 2, F3: 3, F4: 4 };

/** Registry 스냅샷의 Feature 항목(보고서 D.6) — 원천은 Feature Registry + 안전 분류 + BOM Baseline */
export interface GateFeature {
  name?: string;
  version: string;
  status: string; // RELEASED · DECOMMISSIONED · 그 밖(거부)
  f_class: FClass;
  deact_class: DeactClass;
  gsr_mandatory: boolean;
  max_vehicles: number;
  max_per_window: number;
  markets_approved: string[];
  type_approval_relevant: boolean;
  ads_feature?: boolean;
  profile?: { takeover_ms?: number; ramp_ms?: number; fault_ramp_ms?: number; max_pending_ms?: number; max_cycle_wait_ms?: number };
}
/** 명령 원장(감사 이력 기반) — Feature별 마지막 명령 순번·직전 Kill 승인자·최근 조치 */
export interface GateLedger {
  last_order_seq?: number;
  last_kill_approvers?: string[];
  recent?: { request: string; vehicles: number; at: string }[];
}
export interface GatePolicy {
  max_command_ttl_hours: number;
  canary_max_vehicles: number;
  max_not_before_lead_hours: number;
  kill_window_hours: number;
  max_clock_skew_seconds?: number;
}
export interface GateRegistry {
  features: Record<string, GateFeature>;
  policy: GatePolicy;
  ledger?: Record<string, GateLedger>;
}
export interface GateFinding {
  rule: string;
  ok: boolean;
  message: string;
}
export interface GateVerdict {
  result: 'PASS' | 'FAIL' | 'SCHEMA_FAIL';
  findings: GateFinding[];
  /** SCHEMA_FAIL일 때 FFG-PLT-001 오류 */
  errors: string[];
}

/** 보고서 예시 Registry의 정책값(schema/examples/registry.json) */
export const DEFAULT_GATE_POLICY: GatePolicy = { max_command_ttl_hours: 24, canary_max_vehicles: 100, max_not_before_lead_hours: 1, kill_window_hours: 24, max_clock_skew_seconds: 300 };

const ts = (s: string) => Date.parse(s);
const H = 3600_000;

/**
 * 게이트 판정 — 규칙별 결과(통과도 남긴다). 스키마 검사는 gateVerdict가 먼저 한다.
 * @rule FFG-PLT-002, FFG-PLT-003, FFG-PLT-004, FFG-PLT-005, FFG-PLT-006, FFG-PLT-007, FFG-PLT-008, FFG-PLT-009, FFG-PLT-010, FFG-PLT-017, FFG-SEC-003, FFG-CLS-009, FFG-ADS-010 — 플랫폼 게이트 판정(HSM 쪽 누적 상한 재집행은 WP4)
 */
export function evaluateGate(cmd: KillCommandV2, registry: GateRegistry, now: Date): GateFinding[] {
  const out: GateFinding[] = [];
  const add = (rule: string, ok: boolean, message: string) => out.push({ rule, ok, message });
  const feat = cmd.feature;
  const reg = registry.features[feat.id];
  const led = registry.ledger?.[feat.id] ?? {};
  const pol = registry.policy;
  const req = cmd.request;
  const reason = cmd.reason.category;
  const market = cmd.target.market;
  const nowMs = now.getTime();

  // FFG-PLT-002 Registry 상태 — RELEASED만, 폐기(DECOMMISSIONED)는 비활성화만
  const released = !!reg && (reg.status === 'RELEASED' || (reg.status === 'DECOMMISSIONED' && req === 'deactivate'));
  const verOk = released && reg.version === feat.version;
  add('FFG-PLT-002', verOk, verOk ? 'Registry에서 RELEASED인 Feature Version' : 'Registry에 없거나 RELEASED가 아닌 Feature·Version');
  if (!reg) return out;

  // FFG-CLS-009 Registry 자체 정합(등급과 비활성화 프로파일)
  const prof = reg.profile ?? {};
  const dc = reg.deact_class;
  const fr = F_RANK[reg.f_class];
  const issues: string[] = [];
  if (fr >= 2 && dc === 'DC0') issues.push(`${reg.f_class}에 DC0(안전 관련 기능의 즉시 비활성화)`);
  if (dc === 'DC2' && !((prof.takeover_ms ?? 0) > 0 && (prof.ramp_ms ?? 0) > 0)) issues.push('DC2는 takeover_ms·ramp_ms > 0');
  if (fr >= 2 && dc !== 'DC4' && !((prof.fault_ramp_ms ?? 0) > 0)) issues.push('F2 이상은 fault_ramp_ms > 0');
  if (dc === 'DC1' && !((prof.max_pending_ms ?? 0) > 0)) issues.push('DC1은 max_pending_ms > 0');
  if ((dc === 'DC1' || dc === 'DC2' || dc === 'DC3') && !((prof.max_cycle_wait_ms ?? 0) > 0)) issues.push(`${dc}는 max_cycle_wait_ms > 0(상업 사유 대기 상한)`);
  add('FFG-CLS-009', !issues.length, issues.length ? `Registry 오류: ${issues.join('; ')}` : '비활성화 등급과 프로파일 정합');

  // FFG-ADS-002 ADS 기능은 원격 종료 경로가 있어야 한다(DC4 금지)
  if (reg.ads_feature) {
    const ok = dc !== 'DC4';
    add('FFG-ADS-002', ok, ok ? 'ADS 기능에 원격 종료 경로가 있음' : 'ADS 기능이 DC4 — 원격 종료 불가(UN ADS GTR 제안 4.1.4.4)');
  }

  // FFG-ADS-010 폐기된 기능은 다시 켜거나 복원할 수 없다
  if (reg.status === 'DECOMMISSIONED') {
    const ok = req === 'deactivate';
    add('FFG-ADS-010', ok, ok ? '폐기 기능의 비활성화' : `폐기된 기능의 ${req}는 금지(UN ADS GTR 제안 5.3.2.16(e))`);
  }

  // FFG-PLT-003 등급은 Registry 데이터 — 운영자가 고르지 않는다
  {
    const ok = feat.deact_class === reg.deact_class && feat.f_class === reg.f_class;
    add('FFG-PLT-003', ok, ok ? 'f_class·deact_class가 Registry와 같음' : `선언 ${feat.f_class}/${feat.deact_class} ≠ Registry ${reg.f_class}/${reg.deact_class}`);
  }

  // FFG-PLT-004 DC4·법규 의무 기능은 런타임 Flag가 아니다 — 원격 요청 자체를 받지 않는다
  {
    const ok = !(reg.deact_class === 'DC4' || reg.gsr_mandatory);
    add('FFG-PLT-004', ok, ok ? 'DC4·법규 의무 기능 아님' : 'DC4·법규 의무 시스템에는 원격 요청(비활성화·활성화·복원) 금지');
  }

  // FFG-PLT-005 2인 승인·F 등급별 역할, 복원 승인자는 Kill 승인자와 달라야 한다(원장)
  const approvers = cmd.approvals.map((a) => a.approver_id);
  const roles = new Set(cmd.approvals.map((a) => a.role));
  {
    const distinct = new Set(approvers).size === approvers.length && approvers.length >= 2;
    const needFsm = fr >= 2 && (req === 'deactivate' || req === 'restore') && (reason === 'SAFETY' || reason === 'SECURITY');
    const signed = cmd.approvals.every((a) => (a.approval_sig ?? '').length >= 64);
    const overlap = req === 'restore' ? approvers.filter((a) => (led.last_kill_approvers ?? []).includes(a)).sort() : [];
    const ok = distinct && signed && (!needFsm || roles.has('FSM')) && !overlap.length;
    add(
      'FFG-PLT-005',
      ok,
      ok
        ? '서로 다른 2인이 개인 서명, 필요한 역할 포함'
        : `승인은 서로 다른 2인 이상·개인 서명(approval_sig), F2 이상 안전·보안 조치는 FSM 필수, 복원 승인자는 Kill 승인자와 달라야 함${overlap.length ? ` (겹침: ${overlap.join(', ')})` : ''}`,
    );
  }

  // FFG-PLT-006 상업·운영 사유는 지연 등급(DC3)과 사용자 고지
  if ((reason === 'COMMERCIAL' || reason === 'OPERATIONAL') && fr >= 2) {
    const ok = cmd.user_notice.required === true && !!cmd.user_notice.text_ref;
    add('FFG-PLT-006', ok, ok ? '사용자 고지 준비됨(다음 시동에 적용, DC3)' : 'F2 이상 상업 변경은 사용자 고지 필요(UN R156 7.2.2.2), DC3로 적용');
  }

  // FFG-PLT-007 메시지 유효기간 — 미리 서명해 둔 미래 명령·만료 명령 거부
  {
    const nb = ts(cmd.validity.not_before);
    const ex = ts(cmd.validity.expires_at);
    const iss = ts(cmd.issued_at);
    const ttlH = (ex - nb) / H;
    const leadH = (nb - iss) / H;
    const problems: string[] = [];
    if (!(ttlH > 0 && ttlH <= pol.max_command_ttl_hours)) problems.push(`유효기간 ${ttlH.toFixed(1)} h가 (0, ${pol.max_command_ttl_hours}] h 밖`);
    if (!(leadH >= 0 && leadH <= pol.max_not_before_lead_hours)) problems.push(`not_before가 issued_at보다 ${leadH.toFixed(1)} h 뒤(허용 0..${pol.max_not_before_lead_hours} h)`);
    const skew = pol.max_clock_skew_seconds ?? 300;
    if ((iss - nowMs) / 1000 > skew) problems.push(`issued_at ${cmd.issued_at}이 미래(> ${skew} s) — 미리 서명된 명령`);
    if (ex <= nowMs) problems.push('게이트 시각에 이미 만료([not_before, expires_at))');
    add('FFG-PLT-007', !problems.length, problems.length ? problems.join('; ') : `유효기간 ${ttlH.toFixed(1)} h, 선행 ${leadH.toFixed(2)} h`);
  }

  // FFG-PLT-017 명령 순번 = 원장 + 1 (빈칸·재전송·소진 없음)
  {
    const expect = (led.last_order_seq ?? 0) + 1;
    const ok = cmd.command_seq === expect;
    add('FFG-PLT-017', ok, ok ? `명령 순번 ${cmd.command_seq}이 원장에 이어짐` : `명령 순번 ${cmd.command_seq} ≠ 원장 + 1 (${expect})`);
  }

  // FFG-PLT-008 범위 상한, 넓히는 조치(활성화·복원)는 Canary 상한
  const n = cmd.scope.vehicle_ids.length;
  {
    let cap = reg.max_vehicles;
    if (req === 'activate' || req === 'restore') cap = Math.min(cap, pol.canary_max_vehicles);
    const ok = n <= cmd.scope.max_vehicles && cmd.scope.max_vehicles <= cap;
    add('FFG-PLT-008', ok, ok ? `범위 ${n} ≤ 선언 ${cmd.scope.max_vehicles} ≤ 상한 ${cap}` : `범위 상한 위반(n=${n}, 선언=${cmd.scope.max_vehicles}, 상한=${cap})`);
  }

  // FFG-SEC-003 대량 조치 — 메시지 단위가 아니라 이동 시간 창 누적
  if (req === 'deactivate' || req === 'restore') {
    const window = pol.kill_window_hours * H;
    const recent = (led.recent ?? []).filter((r) => r.request === req && nowMs - ts(r.at) <= window).reduce((a, r) => a + r.vehicles, 0);
    const total = recent + n;
    const ok = total <= reg.max_per_window || (roles.has('FSM') && roles.has('CSM'));
    add(
      'FFG-SEC-003',
      ok,
      ok ? `${req}: ${pol.kill_window_hours} h 창 누적 ${total}대(상한 ${reg.max_per_window})` : `${req}: 창 누적 ${total}대 > 상한 ${reg.max_per_window} — FSM + CSM 승인과 단계 실행 필요`,
    );
  }

  // FFG-PLT-009 시장·법규 사전조건
  {
    const regu = cmd.regulatory;
    const problems: string[] = [];
    if (!reg.markets_approved.includes(market)) problems.push(`${market} 시장 승인 없음`);
    if (reg.type_approval_relevant && req === 'activate' && regu.type_approval_impact === 'EXTENSION_REQUIRED') problems.push('형식승인 확장 대기(UN R156 7.1.1.9 / 2018/858 Art.33-34)');
    if (market === 'CN' && (req === 'activate' || req === 'restore') && fr >= 2) {
      if (!regu.cn_filing_id) problems.push('중국: OTA 신고·변경 허가 ID 없음(MIIT/SAMR 2025)');
      if (!cmd.user_notice.user_confirmation_required) problems.push('중국: 차량 내 사용자 확인 필요(GB 44496-2024)');
    }
    if (reason === 'SAFETY' && req === 'deactivate' && fr >= 2 && !(regu.recall_campaign_id || regu.containment_justification)) problems.push('안전 Kill은 리콜 캠페인 ID나 봉쇄 결정 근거가 필요');
    add('FFG-PLT-009', !problems.length, problems.length ? problems.join('; ') : '시장·법규 사전조건 충족');
  }

  // FFG-PLT-010 넓히는 조치는 BOM Baseline·SBOM 참조
  if (req === 'activate' || req === 'restore') {
    const ok = !!cmd.evidence.bom_baseline_id && !!cmd.evidence.sbom_ref;
    add('FFG-PLT-010', ok, ok ? 'BOM Baseline·SBOM 참조됨' : '활성화·복원은 bom_baseline_id와 sbom_ref 필요');
  }
  return out;
}

/**
 * 스키마(FFG-PLT-001) → 규칙 판정. 화면 실시간 체크리스트와 서버 판정이 같은 함수를 쓴다.
 * @rule FFG-PLT-001 — 플랫폼 쪽 스키마 적합성(차량 LPC 쪽 재검사는 vECU·FF_IMP)
 */
export function gateVerdict(cmd: unknown, registry: GateRegistry, now: Date): GateVerdict {
  const errors = wireErrors(KillCommandV2, cmd);
  if (errors.length) return { result: 'SCHEMA_FAIL', findings: [{ rule: 'FFG-PLT-001', ok: false, message: errors.join('; ') }], errors };
  const findings = evaluateGate(cmd as KillCommandV2, registry, now);
  return { result: findings.every((f) => f.ok) ? 'PASS' : 'FAIL', findings, errors: [] };
}

/** 실패한 규칙 ID — 시험·대조용 */
export const failedRules = (findings: GateFinding[]) => findings.filter((f) => !f.ok).map((f) => f.rule);
