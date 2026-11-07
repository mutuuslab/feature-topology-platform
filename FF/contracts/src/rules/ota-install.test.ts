// OTA 설치 계약(IF-05 설치 보고, ADS-OTA01·FFP-F037·F038·F039) — 설치 단계·사전조건·보류·실패 원인·안전 상태 증거·확인
import { describe, expect, it } from 'vitest';
import { installStageAxisOf, installFailureCounts, installPreconditions, installView, simulateVehicleInstall, INSTALL_LINEAR, type InstallRecord } from './ota-install';

const NOW = Date.parse('2026-11-06T00:00:00Z');
const ago = (m: number) => new Date(NOW - m * 60_000).toISOString();
const rec = (stage: InstallRecord['stage'], over: Partial<InstallRecord> = {}): InstallRecord => ({ installId: 'INS-1', vin: 'V', stage, at: ago(4), source: 'SIMULATED', ...over });

describe('설치 사전조건(차량 로컬, TC16)', () => {
  it('배터리 부족·정지 유지 상실·DDT 수행 중이면 설치 보류 — 사유는 전원·정지 유지·DDT', () => {
    expect(installPreconditions({ socPct: 60, parkHold: true, ddtActive: false })).toEqual({ ok: true, reason: null });
    expect(installPreconditions({ socPct: 15, parkHold: true, ddtActive: false })).toEqual({ ok: false, reason: 'POWER' });
    expect(installPreconditions({ socPct: 60, parkHold: false, ddtActive: false })).toEqual({ ok: false, reason: 'HOLD' });
    expect(installPreconditions({ socPct: 60, parkHold: true, ddtActive: true })).toEqual({ ok: false, reason: 'DDT' });
  });
  it('시뮬 차량 — 사전조건 실패면 INSTALL_DEFERRED{reason}, 이전 이미지 손상이면 정지 유지·안전 상태 증거 후 재시작해도 같은 상태(TC18)', () => {
    expect(simulateVehicleInstall({ socPct: 10, parkHold: true, ddtActive: false }, 'OK', ago(1))).toMatchObject([{ stage: 'DEFERRED', deferredReason: 'POWER' }]);
    const steps = simulateVehicleInstall({ socPct: 80, parkHold: true, ddtActive: false }, 'VERIFY_FAIL_PREVIOUS_CORRUPT', ago(1));
    expect(steps.map((s) => s.stage)).toEqual(['READY', 'INSTALLING', 'FAILED', 'RECOVERING', 'SAFE_STATE_HELD']);
    expect(steps[2]).toMatchObject({ failureKind: 'VERIFY' });
    expect(steps[4].safeState).toMatchObject({ basis: '이전 이미지 손상 — 복구 불가, 정지 유지' });
    expect(steps[4].safeState?.reachedAt).toBeTruthy();
    expect(simulateVehicleInstall({ socPct: 80, parkHold: true, ddtActive: false }, 'OK', ago(1)).map((s) => s.stage)).toEqual(['READY', 'INSTALLING', 'INSTALLED']);
  });
});

describe('설치 보기 — 5단계 + 갈림 상태', () => {
  it('선형 5단계 이름과 현재 단계 번호, 갈림 상태는 단계가 아니라 사유 줄', () => {
    expect(INSTALL_LINEAR).toEqual(['NOT_STARTED', 'DOWNLOADED', 'READY', 'INSTALLING', 'INSTALLED']);
    const v = installView([rec('DOWNLOADED', { at: ago(30) }), rec('READY', { at: ago(10) }), rec('DEFERRED', { deferredReason: 'POWER' })], { now: NOW, confirmed: false });
    expect(v).toMatchObject({ step: 3, of: 5, branch: { kind: 'DEFERRED', text: '설치 보류 — 전원 부족(차량 보고)' } });
  });
  it('예정 창의 운행 제한은 예상 글자로(완료 시각 약속 없음)', () => {
    const v = installView([rec('NOT_STARTED', { schedule: { windowFrom: ago(-60), windowTo: ago(-180), estDurationMin: 25, driveRestriction: true } })], { now: NOW, confirmed: false });
    expect(v.restriction).toBe('약 25분 운행 제한(예상)');
    expect(v.customerNotice).toBe('설치 중 운행 제한 약 25분(예상)');
    expect(JSON.stringify(v)).not.toMatch(/사용 가능 시각|운행 가능/);
  });
  it('설치됨 보고만으로는 확인되지 않는다 — 차량 형상 보고가 매니페스트와 맞아야 설치 확인됨', () => {
    expect(installView([rec('INSTALLED')], { now: NOW, confirmed: false })).toMatchObject({ step: 4, label: '설치 확인 대기', confirmed: false });
    expect(installView([rec('INSTALLED')], { now: NOW, confirmed: true })).toMatchObject({ step: 5, label: '설치 확인됨', confirmed: true });
  });
  it('보고가 기준 시간을 넘으면 미확인 · 마지막 보고', () => {
    expect(installView([rec('INSTALLING', { at: ago(600) })], { now: NOW, confirmed: false })).toMatchObject({ stale: true, label: '미확인 · 마지막 보고: 설치 중' });
  });
  it('6축 요약 값 대응 — 다운로드됨은 호환·설치로 세지 않음, 실패와 복구 필요를 나눈다', () => {
    expect(installStageAxisOf('DOWNLOADED', false)).toBe('NOT_INSTALLED');
    expect(installStageAxisOf('INSTALLED', true)).toBe('COMPATIBLE');
    expect(installStageAxisOf('INSTALLED', false)).toBe('INSTALLING');
    expect(installStageAxisOf('FAILED', false)).toBe('PARTIAL_FAILURE');
    expect(installStageAxisOf('RECOVERING', false)).toBe('RECOVERY_NEEDED');
    expect(installStageAxisOf('SAFE_STATE_HELD', false)).toBe('RECOVERY_NEEDED');
  });
  it('실패 원인 전원·통신·검증을 따로 센다', () => {
    expect(installFailureCounts([rec('FAILED', { failureKind: 'POWER' }), rec('FAILED', { failureKind: 'LINK' }), rec('FAILED', { failureKind: 'LINK' }), rec('INSTALLED')])).toEqual({ POWER: 1, LINK: 2, VERIFY: 0 });
  });
});
