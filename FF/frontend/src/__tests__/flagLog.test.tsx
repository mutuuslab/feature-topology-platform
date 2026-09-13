/**
 * §17.3 Feature Flag 데이터 로그 — 모델 + 터미널 계약.
 *
 * 로그는 `DigitalTwinPort.journal` 과 Twin 감사 이력에서만 파생된다(새로 지어내지 않는다).
 * 여기서는 (1) 순수 모델의 결정성·정렬·필터 규칙과 (2) 터미널 DOM 계약(레벨/채널/검색/
 * clear/정지 안내)을 검증한다. 3D 는 관여하지 않으므로 fiber 스텁이 필요 없다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createTwinProvider } from '../state/twinStore';
import type { MockTwinProvider } from '../data/twin/simulator';
import { LOG_LEVELS, buildLogLines, filterLog, logClock, logCounts, type LogLine } from '../components/flagLog';
import FlagLogTerminal from '../components/FlagLogTerminal';

const seed = () => createTwinProvider();

/**
 * 실제 데모 경로를 그대로 실행해 로그를 만든다 — Canary 활성화 → tick → Kill-Switch.
 * 스냅샷을 손으로 만들지 않으므로, 로그가 화면용 가짜 데이터가 아님을 함께 검증한다.
 */
function scenario(): { provider: MockTwinProvider; lines: LogLine[] } {
  const provider = seed();
  provider.activatePolicy('CANARY');
  for (let i = 0; i < 3; i++) provider.step(5);
  provider.killSwitch(['VIN-DEMO-001'], { ko: '센서 이상 — 안전 정지', en: 'sensor fault — safe stop' });
  return { provider, lines: buildLogLines(provider.getSnapshot()) };
}

const levelHistogram = (lines: LogLine[]) => {
  const out: Record<string, number> = {};
  for (const l of lines) out[l.level] = (out[l.level] ?? 0) + 1;
  return out;
};

/** 터미널이 실제로 검색하는 텍스트 — 모델과 화면이 같은 규칙을 쓰는지 확인하는 기준. */
const mentions = (l: LogLine, q: string) =>
  `${l.event} ${l.message.ko} ${l.detail} ${l.vin} ${l.channel}`.toLowerCase().includes(q);

beforeEach(() => {
  localStorage.setItem('fp.twin.v1', JSON.stringify({ rate: 0 }));
});

afterEach(cleanup);

describe('flagLog — 순수 모델', () => {
  it('저널과 감사 이력을 합쳐 시간 오름차순으로 만든다 (결정적)', () => {
    const snapshot = seed().getSnapshot();
    const a = buildLogLines(snapshot);
    const b = buildLogLines(snapshot);

    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);

    for (let i = 1; i < a.length; i++) expect(a[i].ms).toBeGreaterThanOrEqual(a[i - 1].ms);
    expect(a[0].seq).toBe(1);
    expect(a.map((l) => l.seq)).toEqual(a.map((_, i) => i + 1));
    expect(new Set(a.map((l) => l.id)).size).toBe(a.length);
    for (const l of a) expect(LOG_LEVELS).toContain(l.level);
  });

  it('같은 시각·같은 tick 이면 저널 발행 순서를 지킨다', () => {
    const provider = seed();
    provider.activatePolicy('CANARY'); // 여러 이벤트가 같은 at 으로 발행된다
    const lines = buildLogLines(provider.getSnapshot()).filter((l) => l.origin === 'JOURNAL');

    const groups = new Map<number, number[]>();
    for (const l of lines) {
      const seq = Number.parseInt(l.id.replace(/[^0-9]/g, ''), 10);
      groups.set(l.ms, [...(groups.get(l.ms) ?? []), seq]);
    }
    let checked = 0;
    for (const seqs of groups.values()) {
      if (seqs.length < 2) continue;
      checked++;
      expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('감사 이력은 빠짐없이 로그로 옮긴다 (TRACE · OPERATOR)', () => {
    const provider = seed();
    const snapshot = provider.getSnapshot();
    const audits = buildLogLines(snapshot).filter((l) => l.origin === 'AUDIT');

    expect(audits.length).toBe(snapshot.twins.reduce((n, t) => n + t.auditTrail.length, 0));
    expect(audits.length).toBeGreaterThan(0);
    for (const l of audits) {
      expect(l.channel).toBe('OPERATOR');
      expect(l.level).toBe('TRACE');
      expect(l.event.startsWith('audit.')).toBe(true);
      expect(l.vin).toMatch(/^#\d{3}$/);
    }
  });

  it('브로드캐스트는 존재하지 않는 VIN 을 만들지 않고 수량만 노출한다', () => {
    const { lines } = scenario();
    const fleet = lines.filter((l) => l.scope === 'FLEET');

    expect(fleet.length).toBeGreaterThan(0);
    for (const l of fleet) expect(l.vin).toMatch(/^전체( \d+대)?$/);
    expect(fleet.some((l) => l.event === 'kill-switch.requested')).toBe(true);
    expect(lines.some((l) => l.event === 'vehicle.context.updated' && /^전체 \d+대$/.test(l.vin))).toBe(true);

    const perVin = lines.filter((l) => l.scope === 'VIN');
    expect(perVin.length).toBeGreaterThan(0);
    for (const l of perVin) expect(l.vin).toMatch(/^#\d{3}$/);
  });

  it('레벨/채널/VIN/검색/clear 필터가 각각 동작한다', () => {
    const { lines } = scenario();

    const errors = filterLog(lines, { level: 'ERROR' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((l) => l.level === 'ERROR')).toBe(true);
    expect(errors.some((l) => l.event === 'kill-switch.applied' && l.channel === 'OPERATOR')).toBe(true);

    const policy = lines.filter((l) => l.channel === 'POLICY');
    expect(policy.length).toBeGreaterThan(0);
    expect(filterLog(lines, { channel: 'POLICY' }).length).toBe(policy.length);
    expect(filterLog(lines, { channel: 'POLICY', level: 'INFO' }).length).toBeGreaterThan(0);

    const vin = (lines.find((l) => l.scope === 'VIN') as LogLine).vin;
    const byVin = filterLog(lines, { vin });
    expect(byVin.length).toBeGreaterThan(0);
    expect(byVin.every((l) => l.vin === vin)).toBe(true);

    const hit = filterLog(lines, { query: 'kill-switch' });
    expect(hit.length).toBeGreaterThan(0);
    expect(hit.length).toBe(filterLog(lines, { query: 'KILL-SWITCH' }).length);
    for (const l of hit) expect(mentions(l, 'kill-switch')).toBe(true);

    const lastTwo = filterLog(lines, { afterSeq: lines[lines.length - 3].seq });
    expect(lastTwo.map((l) => l.seq)).toEqual(lines.slice(-2).map((l) => l.seq));

    expect(filterLog(lines, { level: 'ALL', channel: 'ALL', vin: 'ALL' }).length).toBe(lines.length);
  });

  it('집계와 타임스탬프 포맷', () => {
    const { lines } = scenario();
    const counts = logCounts(lines);
    const histogram = levelHistogram(lines);

    expect(counts.total).toBe(lines.length);
    expect(counts.error).toBe(histogram.ERROR);
    expect(counts.warn).toBe(histogram.WARN ?? 0);
    expect(counts.pass).toBe(histogram.PASS ?? 0);
    expect(counts.error + counts.warn + counts.pass).toBeLessThanOrEqual(lines.length);
    expect(logClock('2026-09-13T10:00:12.250Z')).toBe('10:00:12.250');
  });

  it('정지 상태에서도 +5s 스텝은 실제 저널 라인을 늘린다', () => {
    const provider = seed();
    const before = buildLogLines(provider.getSnapshot()).length;
    provider.step(5);
    const after = buildLogLines(provider.getSnapshot());

    expect(after.length).toBeGreaterThan(before);
    const last = after[after.length - 1];
    expect(last.event).toBe('vehicle.context.updated');
    expect(last.simTick).toBe(1);
  });

  it('tick 을 거듭하면 라인이 계속 쌓인다 (live 스트림의 근거)', () => {
    const provider = seed();
    provider.setRate(1);
    const counts: number[] = [];
    for (let i = 0; i < 4; i++) {
      provider.tick(1000);
      counts.push(buildLogLines(provider.getSnapshot()).length);
    }
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
  });

  it('tail 한도를 넘으면 오래된 라인만 버리고 순번은 유지한다', () => {
    const { provider } = scenario();
    const lines = buildLogLines(provider.getSnapshot());
    const trimmed = buildLogLines(provider.getSnapshot(), { limit: 3 });

    expect(trimmed.length).toBe(3);
    expect(trimmed.map((l) => l.seq)).toEqual(lines.slice(-3).map((l) => l.seq));
  });
});

describe('FlagLogTerminal — 화면 계약', () => {
  it('정지 상태를 안내하고 라인을 렌더한다', () => {
    const provider = seed();
    render(<FlagLogTerminal snapshot={provider.getSnapshot()} lang="ko" />);

    expect(screen.getByTestId('flaglog').getAttribute('aria-label')).toBe('Feature Flag 데이터 로그');
    expect(screen.getByText(/PAUSED/)).toBeTruthy();
    expect(screen.getByText(/정지 상태/)).toBeTruthy();
    expect(screen.getByTestId('flaglog-body').getAttribute('role')).toBe('log');
    expect(screen.getAllByTestId('flaglog-row').length).toBe(buildLogLines(provider.getSnapshot()).length);
  });

  it('레벨 칩과 검색으로 라인을 좁히고, clear 로 비운다', () => {
    const { provider } = scenario();
    const { rerender } = render(<FlagLogTerminal snapshot={provider.getSnapshot()} lang="ko" />);
    const total = screen.getAllByTestId('flaglog-row').length;
    expect(total).toBe(buildLogLines(provider.getSnapshot()).length);

    fireEvent.click(screen.getByRole('button', { name: /^ERROR/ }));
    const errRows = screen.getAllByTestId('flaglog-row');
    expect(errRows.length).toBeGreaterThan(0);
    expect(errRows.length).toBeLessThan(total);
    expect(errRows.every((r) => r.textContent?.includes('ERROR'))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /^ALL/ }));
    expect(screen.getAllByTestId('flaglog-row').length).toBe(total);

    fireEvent.change(screen.getByRole('searchbox', { name: '로그 검색' }), { target: { value: '존재하지않는문자열' } });
    expect(screen.queryAllByTestId('flaglog-row').length).toBe(0);
    expect(screen.getByText(/필터에 맞는 라인이 없습니다/)).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox', { name: '로그 검색' }), { target: { value: 'kill-switch' } });
    const grepRows = screen.getAllByTestId('flaglog-row');
    expect(grepRows.length).toBeGreaterThan(0);
    for (const r of grepRows) expect((r.textContent ?? '').toLowerCase()).toContain('kill-switch');

    fireEvent.change(screen.getByRole('searchbox', { name: '로그 검색' }), { target: { value: '' } });
    fireEvent.change(screen.getByRole('combobox', { name: '채널 필터' }), { target: { value: 'POLICY' } });
    const policyRows = screen.getAllByTestId('flaglog-row');
    expect(policyRows.length).toBeGreaterThan(0);
    expect(policyRows.every((r) => r.textContent?.includes('POLICY'))).toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: '채널 필터' }), { target: { value: 'ALL' } });

    fireEvent.click(screen.getByRole('button', { name: 'clear' }));
    expect(screen.queryAllByTestId('flaglog-row').length).toBe(0);
    expect(screen.getByText(/필터에 맞는 라인이 없습니다/)).toBeTruthy();

    // clear 이후 새로 도착한 라인은 그대로 보인다.
    provider.step(5);
    rerender(<FlagLogTerminal snapshot={provider.getSnapshot()} lang="ko" />);
    const fresh = screen.getAllByTestId('flaglog-row');
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((r) => r.textContent?.includes('vehicle.context.updated'))).toBe(true);
  });

  it('재생 중이면 LIVE 로 표시하고 자동 스크롤을 켤 수 있다', () => {
    const provider = createTwinProvider({ rate: 1 });
    provider.tick(1000);
    render(<FlagLogTerminal snapshot={provider.getSnapshot()} lang="en" />);

    expect(screen.getByText(/LIVE 1×/)).toBeTruthy();
    expect(screen.queryByText(/정지 상태/)).toBeNull();
    const follow = screen.getByRole('button', { name: '자동 스크롤' });
    expect(follow.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(follow);
    expect(follow.getAttribute('aria-pressed')).toBe('false');

    const rows = screen.getAllByTestId('flaglog-row');
    expect(rows.length).toBe(buildLogLines(provider.getSnapshot()).length);
    // 영어 로케일에서도 같은 라인 수 — 로그는 이벤트에서만 파생된다.
    expect(rows.length).toBeGreaterThan(0);
  });

  it('VIN 필터 목록은 로그에 실제로 등장한 값만 제공한다', () => {
    const { provider } = scenario();
    const lines = buildLogLines(provider.getSnapshot());
    render(<FlagLogTerminal snapshot={provider.getSnapshot()} lang="ko" />);

    const select = screen.getByRole('combobox', { name: 'VIN 필터' }) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options[0]).toBe('ALL');
    expect(options.length).toBe(new Set(lines.map((l) => l.vin)).size + 1);
    for (const v of options.slice(1)) expect(v).toMatch(/^(#\d{3}|전체( \d+대)?)$/);
  });
});
