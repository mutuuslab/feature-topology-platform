// 수명주기 격리 — Shadow 경로 권한 없음(ADS-LC01·FFP-F061), 지원 종료·서버 교체 연습(ADS-LC02·FFP-F063) — TC23
import { describe, expect, it } from 'vitest';
import { shadowEnvelope, shadowEnvelopeIssues, supportEndDrill, vehicleAfterServerSwap, vehicleApplyShadow, type SimVehicle } from './lifecycle-isolation';

const VEH: SimVehicle = { vin: 'V', actuator: 'IDLE', acceptedPolicyHash: 'sha256:a', installedSw: '1.2.0', flagValue: false, shadowLog: [], trustedKeys: ['KEY-0001'], lastVerified: { policyHash: 'sha256:a', value: false, keyId: 'KEY-0001' } };

describe('Shadow 격리(LC01)', () => {
  const env = shadowEnvelope({ experimentId: 'EXP-1', featureId: 'FEAT-00004', flagKey: 'hda2_speed' });
  it('봉투는 출력·활성화·설치 권한이 모두 없다', () => {
    expect(env.capabilities).toEqual({ output: false, activation: false, install: false });
    expect(shadowEnvelopeIssues(env)).toEqual([]);
  });
  it('권한을 켠 봉투는 와이어 검사에서 거부', () => {
    expect(shadowEnvelopeIssues({ ...env, capabilities: { output: true, activation: false, install: false } }).map((i) => i.code)).toEqual(['SHADOW_CAPABILITY_FORBIDDEN']);
    expect(shadowEnvelopeIssues({ ...env, mode: 'LIVE' }).map((i) => i.code)).toEqual(['SHADOW_MODE_REQUIRED']);
  });
  it('실운행 Shadow 결과는 액추에이터·정책 수락·설치 상태를 바꾸지 못하고 판단 기록만 남긴다', () => {
    const after = vehicleApplyShadow(VEH, env, [{ decision: 'ACTIVATE', value: true }, { decision: 'INSTALL', value: '2.0.0' }]);
    expect(after).toMatchObject({ actuator: 'IDLE', acceptedPolicyHash: 'sha256:a', installedSw: '1.2.0', flagValue: false });
    expect(after.shadowLog).toHaveLength(2);
    const bad = vehicleApplyShadow(VEH, { ...env, capabilities: { output: true, activation: true, install: true } }, [{ decision: 'ACTIVATE', value: true }]);
    expect(bad).toMatchObject({ actuator: 'IDLE', flagValue: false, shadowLog: [] });
  });
});

describe('지원 종료·서버 교체 연습(LC02)', () => {
  it('서버 교체 뒤 모르는 키 게시본은 받지 않고 마지막 검증 기준선을 유지 — 미승인 ON 초기화 없음', () => {
    const after = vehicleAfterServerSwap(VEH, { keyId: 'KEY-9999', value: true, policyHash: 'sha256:z' });
    expect(after).toMatchObject({ flagValue: false, acceptedPolicyHash: 'sha256:a' });
    const none = vehicleAfterServerSwap({ ...VEH, lastVerified: null, flagValue: true }, null);
    expect(none.flagValue).toBe(false);
  });
  it('연습 판정 — 기준선 유지·차단 유지·키 갱신·미승인 ON 없음 네 칸, 하나라도 실패면 실패', () => {
    const base = {
      featureId: 'FEAT-00004', version: '4.1.0', lifecycle: 'DEPRECATED',
      baseline: { policyId: 'POL-1', contentHash: 'sha256:a', safeDefault: false },
      kill: { active: true, killId: 'KILL-1' },
      keys: [{ keyId: 'KEY-0001', purpose: 'policy', status: 'ACTIVE', notAfter: '2027-06-01T00:00:00Z' }, { keyId: 'KEY-0002', purpose: 'kill', status: 'ACTIVE', notAfter: '2027-06-01T00:00:00Z' }],
      vehicles: [VEH, { ...VEH, vin: 'V2' }],
      now: Date.parse('2026-11-06T00:00:00Z'),
      horizonDays: 90,
    };
    const ok = supportEndDrill(base);
    expect(ok.checks.map((c) => [c.id, c.result])).toEqual([['BASELINE_KEPT', 'PASS'], ['BLOCK_KEPT', 'PASS'], ['KEY_RENEWAL', 'PASS'], ['NO_UNAPPROVED_ON', 'PASS']]);
    expect(ok.passed).toBe(true);
    const bad = supportEndDrill({ ...base, baseline: null, keys: [{ keyId: 'KEY-0001', purpose: 'policy', status: 'ACTIVE', notAfter: '2026-12-01T00:00:00Z' }], vehicles: [{ ...VEH, lastVerified: null, flagValue: true }] });
    expect(bad.checks.filter((c) => c.result === 'FAIL').map((c) => c.id)).toEqual(['BASELINE_KEPT', 'KEY_RENEWAL']);
    expect(bad.checks.find((c) => c.id === 'NO_UNAPPROVED_ON')?.result).toBe('PASS');
    expect(bad.passed).toBe(false);
  });
});
