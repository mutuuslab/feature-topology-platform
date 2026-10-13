// 정책 게이트 사례 — 보고서 부록 D.4 판정 예와 코드 패키지 시험(tools/test_platform_and_openfeature.py)의 변형을 그대로 옮긴다.
// 골든 시험(rules/policy-gate.test.ts)과 Python 게이트 대조(tools/gate-parity.ts)가 같은 사례를 쓴다.
import type { GateRegistry } from '../rules/policy-gate';
import { loadGuide } from './fixtures';

export interface GateCase {
  name: string;
  /** 보고서 시험 카탈로그 ID */
  tc: string;
  cmd: any;
  registry: GateRegistry;
  now: string;
  /** 반드시 실패해야 하는 규칙 */
  fail: string[];
  /** 실패하면 안 되는 규칙(빈 배열 + pass=true면 전부 통과) */
  notFail?: string[];
  pass?: boolean;
}

/** 예제 판정 시각(패키지 시험 NOW) */
export const GATE_NOW = '2026-10-13T00:30:00Z';

const ex = (name: string) => structuredClone(loadGuide(`schema/examples/${name}`));
const REG = (): GateRegistry => ex('registry.json');
const OK = 'kill_safety_dc2_eu.ok.json';

function variant(id: string, version: string, request: string) {
  const c = ex(OK);
  c.feature.id = id;
  c.feature.version = version;
  c.request = request;
  return c;
}

export function gateCases(): GateCase[] {
  const cases: GateCase[] = [
    { name: 'D.4 정상 안전 Kill(DC2·EU)', tc: 'TC-FF-45', cmd: ex(OK), registry: REG(), now: GATE_NOW, fail: [], pass: true },
    { name: 'D.4 DC4·의무 기능(AEB) Kill', tc: 'TC-FF-45', cmd: ex('kill_dc4_aeb.gate_fail.json'), registry: REG(), now: GATE_NOW, fail: ['FFG-PLT-004'] },
    { name: 'D.4 같은 승인자 2회', tc: 'TC-FF-45', cmd: ex('kill_same_approver.gate_fail.json'), registry: REG(), now: GATE_NOW, fail: ['FFG-PLT-005'] },
    { name: 'D.4 운영자가 DC0을 고름', tc: 'TC-FF-45', cmd: ex('kill_operator_chose_dc0.gate_fail.json'), registry: REG(), now: GATE_NOW, fail: ['FFG-PLT-003'] },
    { name: 'D.4 상업 만료에 고지 없음', tc: 'TC-FF-45', cmd: ex('expiry_without_notice.gate_fail.json'), registry: REG(), now: GATE_NOW, fail: ['FFG-PLT-006'] },
    {
      name: 'D.4 중국 활성화 신고 ID 없음(SBOM·BOM은 있음)',
      tc: 'TC-FF-53',
      cmd: ex('activate_cn_missing_filing.gate_fail.json'),
      registry: REG(),
      now: GATE_NOW,
      fail: ['FFG-PLT-009'],
      notFail: ['FFG-PLT-010'],
    },
  ];

  const restore = ex(OK);
  restore.request = 'restore';
  restore.approvals[0].approver_id = 'u-3003'; // 원장의 직전 Kill 승인자
  cases.push({ name: 'Kill 승인자가 복원 승인', tc: 'TC-FF-16', cmd: restore, registry: REG(), now: GATE_NOW, fail: ['FFG-PLT-005'] });

  const future = ex(OK);
  future.validity = { not_before: '2030-01-01T00:00:00Z', expires_at: '2030-01-01T12:00:00Z' };
  cases.push({ name: '2030년 유효 명령(미리 서명)', tc: 'TC-FF-46', cmd: future, registry: REG(), now: GATE_NOW, fail: ['FFG-PLT-007'] });

  const expired = ex(OK);
  expired.validity = { not_before: '2020-01-01T00:00:00Z', expires_at: '2020-01-01T12:00:00Z' };
  expired.issued_at = '2019-12-31T23:59:00Z';
  cases.push({ name: '2020년 만료 명령', tc: 'TC-FF-46', cmd: expired, registry: REG(), now: GATE_NOW, fail: ['FFG-PLT-007'] });

  const issuedFuture = ex(OK);
  issuedFuture.validity.not_before = issuedFuture.issued_at;
  cases.push({
    name: '미래 issued_at(게이트 시각보다 2시간 뒤)',
    tc: 'TC-FF-46',
    cmd: issuedFuture,
    registry: REG(),
    now: new Date(Date.parse(issuedFuture.issued_at) - 2 * 3600_000).toISOString(),
    fail: ['FFG-PLT-007'],
  });

  const exhaust = ex(OK);
  exhaust.command_seq = 4294967295;
  cases.push({ name: '명령 순번 소진 시도(4294967295)', tc: 'TC-FF-47', cmd: exhaust, registry: REG(), now: GATE_NOW, fail: ['FFG-PLT-017'] });

  const mass = REG();
  mass.ledger!['FEAT-00022'].recent!.push({ request: 'deactivate', vehicles: 4999, at: '2026-10-12T23:00:00Z' });
  cases.push({ name: '24시간 누적 대상 차량 상한 초과(분할 대량 Kill)', tc: 'TC-FF-48', cmd: ex(OK), registry: mass, now: GATE_NOW, fail: ['FFG-SEC-003'] });

  const dc0 = REG();
  dc0.features['FEAT-00022'].deact_class = 'DC0';
  cases.push({ name: 'Registry F3 + DC0', tc: 'TC-FF-49', cmd: ex(OK), registry: dc0, now: GATE_NOW, fail: ['FFG-CLS-009'] });

  const dc4Act = ex('kill_dc4_aeb.gate_fail.json');
  dc4Act.request = 'activate';
  cases.push({ name: 'DC4 활성화 요청', tc: 'TC-FF-49', cmd: dc4Act, registry: REG(), now: GATE_NOW, fail: ['FFG-PLT-004'] });

  const issued = ex(OK).issued_at as string;
  const noCycle = REG();
  noCycle.features['FEAT-00022'].profile!.max_cycle_wait_ms = 0;
  cases.push({ name: 'DC2 프로파일에 다음 시동 대기 상한 없음', tc: 'TC-FF-49', cmd: ex(OK), registry: noCycle, now: issued, fail: ['FFG-CLS-009'] });

  const adsDc4 = REG();
  adsDc4.features['FEAT-00060'].deact_class = 'DC4';
  const adsCmd = variant('FEAT-00060', '1.0.0', 'deactivate');
  adsCmd.feature.deact_class = 'DC4';
  adsCmd.feature.f_class = 'F4';
  cases.push({ name: 'ADS 기능을 DC4로 분류', tc: 'TC-FF-49', cmd: adsCmd, registry: adsDc4, now: issued, fail: ['FFG-ADS-002'] });

  cases.push({ name: '폐기 기능 복원', tc: 'TC-FF-49', cmd: variant('FEAT-00061', '0.9.0', 'restore'), registry: REG(), now: issued, fail: ['FFG-ADS-010'] });
  cases.push({ name: '폐기 기능 비활성화는 허용', tc: 'TC-FF-49', cmd: variant('FEAT-00061', '0.9.0', 'deactivate'), registry: REG(), now: issued, fail: [], notFail: ['FFG-ADS-010', 'FFG-PLT-002'] });

  // 보고서 표 밖 — 게이트 규칙마다 실패 사례가 있도록 더한 변형(Python 게이트와도 대조된다)
  const unknown = ex(OK);
  unknown.feature.id = 'FEAT-09999';
  cases.push({ name: 'Registry에 없는 Feature', tc: 'TC-FF-45', cmd: unknown, registry: REG(), now: GATE_NOW, fail: ['FFG-PLT-002'] });

  const wide = ex('activate_cn_missing_filing.gate_fail.json');
  wide.target.market = 'EU';
  wide.scope.vehicle_ids = Array.from({ length: 101 }, (_, i) => `VHC-${String(i).padStart(6, '0')}`);
  wide.scope.max_vehicles = 101;
  cases.push({ name: '활성화 범위가 Canary 상한(100대) 초과', tc: 'TC-FF-45', cmd: wide, registry: REG(), now: GATE_NOW, fail: ['FFG-PLT-008'] });

  const noSbom = ex(OK);
  noSbom.request = 'restore';
  noSbom.approvals[0].approver_id = 'u-5005';
  noSbom.approvals[1].approver_id = 'u-6006';
  delete noSbom.evidence.sbom_ref;
  cases.push({ name: 'SBOM 참조 없는 복원', tc: 'TC-FF-45', cmd: noSbom, registry: REG(), now: GATE_NOW, fail: ['FFG-PLT-010'], notFail: ['FFG-PLT-005'] });
  return cases;
}
