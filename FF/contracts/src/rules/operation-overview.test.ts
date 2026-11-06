// 홈 수신 현황 서버 요약 — 화면이 전체 목록으로 세던 값과 같아야 한다(홈이 전체 목록을 받지 않게 바꾼 뒤에도 숫자는 전체 기준)
import { describe, expect, it } from 'vitest';
import { ATTENTION_TOP, buildOperationModel, OPERATION_PAGE, operationSummary, recentEvents, REPLY_GAP_TOP, timelinePoints, type OperationInput } from './operation-overview';

const flag = (value: boolean, publicationId = 'PUB-1', reason = 'MATCH') => ({ flagKey: 'flag_a', publicationId, sequence: 1, local: { value, reason }, drift: false, server: { value, reason } });
const vins = Array.from({ length: 30 }, (_, i) => `V${String(i + 1).padStart(2, '0')}`);
const INPUT: OperationInput = {
  runtime: vins.map((vin, i) => ({ vin, scope: 'x', quality: i % 7 ? 'TRUSTED' : 'UNTRUSTED', link: 'ONLINE', flags: i % 5 ? [flag(i % 2 === 0)] : [], last: null, label: '서버만 쓰는 칸', featureState: {} }) as never),
  vehicles: vins.map((vin, i) => ({ vin, country: i % 3 ? 'KR' : 'US', vehicleModel: i % 2 ? 'NX4' : 'GN7', trim: 'P', swVersion: '1.0' }) as never),
  policies: [
    { policyId: 'POL-1', revision: 2, featureId: 'F1', featureVersion: '1.0.0', flagKey: 'flag_a', status: 'DEPLOYED' },
    { policyId: 'POL-2', revision: 1, featureId: 'F1', featureVersion: '1.0.0', flagKey: 'flag_b', status: 'VALIDATED' },
  ],
  features: [{ featureId: 'F1', version: '1.0.0', country: 'KR', vehicleModel: 'NX4' }],
  publications: [
    { publicationId: 'PUB-1', kind: 'POLICY', status: 'CONFIRMED', createdAt: '2026-11-05T01:00:00Z', payload: { targets: vins, flagKey: 'flag_a', featureId: 'F1', policy: { policyId: 'POL-1', revision: 2, description: '서버만 쓰는 정책 본문' } as never } },
    { publicationId: 'PUB-2', kind: 'KILL', status: 'DIVERGED', createdAt: '2026-11-05T02:00:00Z', payload: { targets: vins.slice(0, 3), flagKey: null, featureId: 'F1', policy: null } },
    { publicationId: 'PUB-3', kind: 'POLICY', status: 'DISPATCHED', createdAt: '2026-11-05T02:30:00Z', payload: { targets: vins.slice(20), flagKey: 'flag_b', featureId: 'F1', policy: { policyId: 'POL-2', revision: 1, description: '서버만 쓰는 정책 본문' } as never } },
  ],
  readbacks: vins.map((vin, i) => ({ vin, publicationId: 'PUB-1', at: `2026-11-05T01:0${i % 5}:00Z`, metricType: i % 9 ? 'READBACK' : 'ACK', observed: i % 4 ? 'h' : 'REJECTED', ...(i % 4 ? {} : { rejectReason: 'SIGNATURE_INVALID' }), policyHash: 'sha256:서버만' }) as never),
  syncs: [{ at: '2026-11-05T00:50:00Z', request: { policyId: 'POL-1', revision: 2, mode: 'live' }, response: { outcome: 'SYNCED' } }],
};
const ALL = { country: '', model: '', flag: '' };

describe('홈 수신 현황 서버 요약', () => {
  it('건수·묶음·시각 분포는 전체 목록으로 센 모델과 같고, 표는 첫 쪽만 싣는다', () => {
    const model = buildOperationModel(INPUT, ALL);
    const s = operationSummary(INPUT, '2026-11-05T03:00:00Z', true);
    expect({ total: s.total, received: s.received, unknown: s.unknown, deployed: s.deployed, approvals: s.approvals, rejected: s.rejected }).toEqual({ total: 30, received: model.received, unknown: model.unknown, deployed: model.deployed, approvals: model.approvals, rejected: model.rejected });
    expect(s.rejected).toBeGreaterThan(0);
    expect(s.countryGroups).toEqual(model.countryGroups);
    expect(s.modelGroups).toEqual(model.modelGroups);
    const ready = { DEPLOY: true, SYNC: true, READBACK: true };
    expect(s.points).toEqual(timelinePoints(model.events, ready));
    expect(s.recent).toEqual(recentEvents(model.events, ready));
    expect(s.points.reduce((n, p) => n + p.count, 0)).toBe(model.events.length);
    expect(s.rows).toHaveLength(OPERATION_PAGE);
    expect(s.rows.map((r) => [r.runtime.vin, r.state, r.readback?.at])).toEqual(model.rows.slice(0, OPERATION_PAGE).map((r) => [r.runtime.vin, r.state, r.readback?.at]));
    expect(s.preparationIssues).toEqual(model.preparationIssues.map(({ publicationId, policyId, revision, reason }) => ({ publicationId, policyId, revision, reason })));
    expect(s.preparationIssues.length).toBeGreaterThan(0);
    expect([s.countries, s.models, s.flags]).toEqual([model.countries, model.models, model.flags]);
  });

  it('표에 쓰지 않는 서버 칸은 싣지 않고, 표가 가리키는 게시본의 정책 판만 싣는다', () => {
    const s = operationSummary(INPUT, '2026-11-05T03:00:00Z', true);
    const text = JSON.stringify(s);
    expect(text).not.toContain('서버만');
    expect(text).not.toContain('"server"');
    expect(s.publications).toEqual([{ publicationId: 'PUB-1', policy: { policyId: 'POL-1', revision: 2 } }]);
    // 전체 목록(차량 30대·회신 30건)보다 작다 — 차량 수가 늘어도 표·묶음 크기만큼
    expect(text.length).toBeLessThan(JSON.stringify(INPUT).length);
  });

  it('회신을 읽을 수 없는 역할이면 회신 칸을 비운다(범주 밖 데이터를 싣지 않는다)', () => {
    const s = operationSummary(INPUT, '2026-11-05T03:00:00Z', false);
    expect(s.readbacks).toBe(false);
    expect(s.rejected).toBe(0);
    expect(s.rows.every((r) => r.readback === undefined)).toBe(true);
    expect(s.points.some((p) => p.phase === 'READBACK')).toBe(false);
    expect(s.recent.some((e) => e.phase === 'READBACK')).toBe(false);
    expect(s.total).toBe(30);
    // 회신을 못 읽으면 '회신 대기'도 셀 수 없다 — 대상 전부를 대기로 세지 않는다
    expect(s.replyGaps).toEqual([]);
    expect(s.attention.counts.REJECTED).toBe(0);
  });
});

describe('홈 Top 목록 — 살펴볼 차량·회신 대기 정책', () => {
  it('거부 회신 > 차단 수신 > 미확인 순으로 상한까지, 차량 한 대는 한 번만 센다', () => {
    const model = buildOperationModel(INPUT, ALL);
    const s = operationSummary(INPUT, '2026-11-05T03:00:00Z', true);
    expect(s.attention).toEqual(model.attention);
    const isRejected = (r: (typeof model.rows)[number]) => !!r.readback && (!!r.readback.rejectReason || r.readback.observed === 'REJECTED');
    const rejected = model.rows.filter(isRejected).length;
    expect(rejected).toBeGreaterThan(0);
    expect(s.attention.counts.REJECTED).toBe(rejected);
    expect(s.attention.counts.SAFE).toBe(model.rows.filter((r) => r.state === 'SAFE' && !isRejected(r)).length);
    expect(s.attention.counts.UNKNOWN).toBe(model.rows.filter((r) => r.state === 'UNKNOWN' && !isRejected(r)).length);
    expect(s.attention.vehicles.length).toBe(Math.min(ATTENTION_TOP, rejected + s.attention.counts.SAFE + s.attention.counts.UNKNOWN));
    const order = s.attention.vehicles.map((v) => ['REJECTED', 'SAFE', 'UNKNOWN'].indexOf(v.kind));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(s.attention.vehicles[0]).toMatchObject({ kind: 'REJECTED', reason: 'SIGNATURE_INVALID' });
    expect(new Set(s.attention.vehicles.map((v) => v.vin)).size).toBe(s.attention.vehicles.length);
  });

  it('차단 수신(긴급 차단 사유)은 SAFE로, 신뢰 미확인·보관 정책 없음은 사유를 남긴다', () => {
    const input: OperationInput = { ...INPUT, readbacks: [], runtime: [
      { vin: 'S1', scope: 'x', quality: 'TRUSTED', link: 'ONLINE', flags: [flag(false, 'PUB-1', 'KILL_SWITCH')], last: { at: '2026-11-05T01:00:00Z', detail: '' } },
      { vin: 'U1', scope: 'x', quality: 'UNTRUSTED', link: 'ONLINE', flags: [flag(true)], last: { at: '2026-11-05T02:00:00Z', detail: '' } },
      { vin: 'U2', scope: 'x', quality: 'TRUSTED', link: 'OFFLINE', flags: [], last: null },
      { vin: 'OK', scope: 'x', quality: 'TRUSTED', link: 'ONLINE', flags: [flag(true)], last: null },
    ] };
    const m = buildOperationModel(input, ALL);
    expect(m.safe).toBe(1);
    expect(m.attention.counts).toEqual({ REJECTED: 0, SAFE: 1, UNKNOWN: 2 });
    // 미확인은 마지막 연락이 없거나 오래된 차량부터
    expect(m.attention.vehicles.map((v) => [v.vin, v.kind, v.reason])).toEqual([['S1', 'SAFE', 'KILL_SWITCH'], ['U2', 'UNKNOWN', 'NO_POLICY'], ['U1', 'UNKNOWN', 'UNTRUSTED']]);
  });

  it('회신 대기 정책 — 대상 차량 중 회신(READBACK)이 없는 차량이 많은 게시본부터, 정책 없는 게시본은 뺀다', () => {
    const model = buildOperationModel(INPUT, ALL);
    const s = operationSummary(INPUT, '2026-11-05T03:00:00Z', true);
    expect(s.replyGaps).toEqual(model.replyGaps);
    const replied = new Set(INPUT.readbacks.filter((r) => r.metricType === 'READBACK').map((r) => r.vin)).size;
    expect(s.replyGaps).toEqual([
      { publicationId: 'PUB-1', policyId: 'POL-1', revision: 2, flagKey: 'flag_a', targets: 30, replied, pending: 30 - replied, createdAt: '2026-11-05T01:00:00Z' },
      { publicationId: 'PUB-3', policyId: 'POL-2', revision: 1, flagKey: 'flag_b', targets: 10, replied: 0, pending: 10, createdAt: '2026-11-05T02:30:00Z' },
    ].sort((a, b) => b.pending - a.pending));
    expect(s.replyGaps.length).toBeLessThanOrEqual(REPLY_GAP_TOP);
    // 국가로 거르면 대상도 그 국가 차량만
    const us = buildOperationModel(INPUT, { ...ALL, country: 'US' });
    expect(us.replyGaps.find((g) => g.publicationId === 'PUB-1')?.targets).toBe(10);
  });
});
