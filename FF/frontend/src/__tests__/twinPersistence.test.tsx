import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createTwinProvider, TwinProvider, TWIN_NOW_MS, useTwin } from '../state/twinStore';
import * as E from '../data/twin/engine';
import * as T from '../data/twin/types';

const KEY = 'fp.twin.v1';

function Probe() {
  const twin = useTwin();
  return <output data-testid="twin-state">{JSON.stringify({
    rate: twin.rate, scope: twin.scope, targetRule: twin.targetRule,
    simInputs: twin.simInputs, result: twin.simResult, totalMatched: twin.impact.totalMatched,
  })}</output>;
}

function mount(raw: string) {
  localStorage.setItem(KEY, raw);
  render(<TwinProvider><Probe /></TwinProvider>);
  return JSON.parse(screen.getByTestId('twin-state').textContent!);
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe('Twin 시연 설정 복구', () => {
  it.each(['null', '[]', '"old"', '1', 'true', '{broken'])('객체가 아닌 저장값 %s 때문에 루트 렌더가 중단되지 않는다', (raw) => {
    const state = mount(raw);
    expect(state.rate).toBe(1);
    expect(state.scope).toBe('CANARY');
    expect(state.simInputs).toEqual(E.DEFAULT_SIM_INPUTS);
    expect(state.targetRule).toEqual(T.DEMO_TARGET_RULE);
    expect(state.result).toEqual(E.runSimulation(E.DEFAULT_SIM_INPUTS, TWIN_NOW_MS));
  });

  it('불완전한 시뮬레이션·대상 조건은 기본값을 보충하고 유효한 사용자 설정을 보존한다', () => {
    const state = mount(JSON.stringify({ rate: 0, scope: 'WAVE', simInputs: { killSwitch: true }, targetRule: { region: ['EU'] } }));
    expect(state.rate).toBe(0);
    expect(state.scope).toBe('WAVE');
    expect(state.simInputs).toEqual({ ...E.DEFAULT_SIM_INPUTS, killSwitch: true });
    expect(state.result.effective).toBe('OFF');
    expect(state.targetRule.region).toEqual(['EU']);
    expect(state.targetRule.requiredCapability).toEqual(T.DEMO_TARGET_RULE.requiredCapability);
    const expectedVins = createTwinProvider().getSnapshot().verdicts.filter(({ twin }) =>
      twin.identity.region === 'EU' && T.DEMO_TARGET_RULE.vehicleModel.includes(twin.identity.vehicleModel));
    expect(state.totalMatched).toBe(expectedVins.length);
  });

  it('중첩 필드의 잘못된 타입·열거값·날짜 범위 숫자를 엔진에 전달하지 않는다', () => {
    const state = mount(JSON.stringify({
      rate: 4, scope: 'PROD',
      simInputs: { telemetryAgeSeconds: 1e100, batteryTemperature: {}, batterySoc: '62', network: 'BROKEN', bmsSoftwareVersion: [], killSwitch: 'false', hardwareCapability: null },
      targetRule: { region: {}, vehicleModel: [null], requiredCapability: 42, minimumBinaryVersion: [], modelYear: ['2027'], entitlementId: {} },
    }));
    expect(state.rate).toBe(1);
    expect(state.scope).toBe('CANARY');
    expect(state.simInputs).toEqual(E.DEFAULT_SIM_INPUTS);
    expect(state.targetRule).toEqual(T.DEMO_TARGET_RULE);
    expect(state.result.createdAt).toBe(new Date(TWIN_NOW_MS).toISOString().replace('.000Z', 'Z'));
    expect(state.totalMatched).toBeGreaterThan(0);
  });

  it.each(E.SIM_PRESETS.map(p => [p.id, E.simInputsFor(p)] as const))('유효한 %s 시나리오는 저장 전과 같은 판정을 유지한다', (_id, simInputs) => {
    const targetRule = { region: [], vehicleModel: [], requiredCapability: [], minimumBinaryVersion: '' };
    const state = mount(JSON.stringify({ rate: 5, scope: 'FLEET', simInputs, targetRule }));
    expect(state.rate).toBe(5);
    expect(state.scope).toBe('FLEET');
    expect(state.simInputs).toEqual(simInputs);
    expect(state.targetRule).toEqual(targetRule);
    expect(state.result).toEqual(E.runSimulation(simInputs, TWIN_NOW_MS));
  });

  it('0·false 값은 보존하고 JSON의 무한대 숫자는 복구한다', () => {
    const state = mount('{"rate":0,"simInputs":{"ambientTemperature":1e400,"telemetryAgeSeconds":0,"batterySoc":0,"killSwitch":false,"hardwareCapability":false}}');
    expect(state.simInputs).toEqual({ ...E.DEFAULT_SIM_INPUTS, telemetryAgeSeconds: 0, batterySoc: 0, hardwareCapability: false });
    expect(state.rate).toBe(0);
  });

  it('손상된 시연 설정만 다시 저장하며 인증·업무 캐시는 그대로 둔다', () => {
    localStorage.setItem('ff.auth', '1');
    localStorage.setItem('fp.state.v2', '{"role":"operator"}');
    localStorage.setItem('ff.workbench.queries', '{"private":"preserve"}');
    mount(JSON.stringify({ rate: 'bad', simInputs: { telemetryAgeSeconds: null } }));
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ rate: 1, simInputs: E.DEFAULT_SIM_INPUTS });
    expect(localStorage.getItem('ff.auth')).toBe('1');
    expect(localStorage.getItem('fp.state.v2')).toBe('{"role":"operator"}');
    expect(localStorage.getItem('ff.workbench.queries')).toBe('{"private":"preserve"}');
  });

  it('브라우저가 저장소 접근을 거부해도 기본 시연을 렌더한다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    render(<TwinProvider><Probe /></TwinProvider>);
    expect(JSON.parse(screen.getByTestId('twin-state').textContent!).simInputs).toEqual(E.DEFAULT_SIM_INPUTS);
  });
});
