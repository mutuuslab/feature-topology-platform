// Legacy 연계 설정·브리지·변환 규칙(FR-LGCY-001-001~006)과 Legacy↔SDV 메시지 변환(FR-SDVI-001-002)
import { describe, expect, it } from 'vitest';
import type { LegacyVehicle } from './ext';
import { CreateLegacyLinkBody, legacyBridge, legacyLinkProblems, legacyRunDue, legacyToSdv, mergeLegacyRules, toLegacyCodingMessage, type LegacyLinkConfig } from './legacy-link';

const erp: LegacyLinkConfig = { system: 'ERP-TMA', name: 'TMA 공장 ERP', kind: 'PLANT-ERP', endpoint: 'https://erp.tma.example/api', bridgeType: 'BATCH', schedule: 'DAILY', plant: 'TMA', status: 'ACTIVE', note: null };
const dms: LegacyLinkConfig = { system: 'DMS-KR', name: '국내 딜러 DMS', kind: 'DEALER-DMS', endpoint: 'https://dms.example/hook', bridgeType: 'REALTIME', schedule: null, plant: null, status: 'ACTIVE', note: null };
const LF: LegacyVehicle = { vin: 'KMH-LF-0001', vehicleModel: 'LF', modelYear: '2019', market: 'KR', architecture: 'LEGACY', codingUnit: 'BCM' };

describe('연계 설정 (FR-LGCY-001-001·005)', () => {
  it('등록 본문 — 시스템 코드·주소 방식을 거르고 기본은 비활성', () => {
    expect(CreateLegacyLinkBody.parse({ system: 'ERP-TMA', name: 'TMA 공장 ERP', kind: 'PLANT-ERP', endpoint: 'https://erp.tma.example/api', bridgeType: 'BATCH', schedule: 'DAILY', plant: 'TMA' })).toMatchObject({ status: 'INACTIVE', note: null });
    expect(CreateLegacyLinkBody.safeParse({ ...erp, system: 'erp tma' }).success).toBe(false);
    expect(CreateLegacyLinkBody.safeParse({ ...erp, endpoint: 'ftp://erp.example' }).success).toBe(false);
  });

  it('조합 검사 — 종류별 브리지 유형·주소 방식·주기·공장', () => {
    expect(legacyLinkProblems(erp)).toEqual([]);
    expect(legacyLinkProblems(dms)).toEqual([]);
    expect(legacyLinkProblems({ ...erp, bridgeType: 'REALTIME', schedule: null })).toEqual([expect.stringMatching(/실시간 브리지를 쓸 수 없습니다/)]);
    expect(legacyLinkProblems({ ...erp, bridgeType: 'FILE', schedule: 'HOURLY' })).toEqual(expect.arrayContaining([expect.stringMatching(/sftp:\/\//), expect.stringMatching(/DAILY·WEEKLY/)]));
    expect(legacyLinkProblems({ ...erp, schedule: null })).toEqual([expect.stringMatching(/실행 주기가 필요합니다/)]);
    expect(legacyLinkProblems({ ...erp, plant: null })).toEqual([expect.stringMatching(/공장/)]);
    expect(legacyLinkProblems({ ...dms, schedule: 'DAILY' })).toEqual([expect.stringMatching(/주기를 비우세요/)]);
  });

  it('설정 → 브리지 — 유형·방향·IF·규칙 묶음·단계, 같은 설정이면 같은 브리지', () => {
    expect(legacyBridge(erp)).toMatchObject({ bridgeId: 'BRG-ERP-TMA', type: 'BATCH', direction: 'INBOUND', ifId: 'IF-12', ruleSystem: 'PLANT-ERP', trigger: expect.stringContaining('매일') });
    expect(legacyBridge({ ...erp, bridgeType: 'FILE', endpoint: 'sftp://erp.tma.example/in' }).steps[0]).toMatch(/파일/);
    expect(legacyBridge(dms)).toMatchObject({ direction: 'BIDIRECTIONAL', ifId: null, ruleSystem: 'DEALER-DMS' });
    expect(legacyBridge(erp)).toEqual(legacyBridge({ ...erp }));
  });

  it('주기 실행 — 활성 배치·파일만, 마지막 실행 뒤 주기가 지나면', () => {
    const run = (at: string) => ({ at, status: 'SUCCEEDED' as const, orders: 1, unresolved: [], reason: null, by: 'system' });
    expect(legacyRunDue({ ...erp, lastRun: null }, '2026-11-07T00:00:00Z')).toBe(true);
    expect(legacyRunDue({ ...erp, lastRun: run('2026-11-06T01:00:00Z') }, '2026-11-07T00:00:00Z')).toBe(false);
    expect(legacyRunDue({ ...erp, lastRun: run('2026-11-06T00:00:00Z') }, '2026-11-07T00:00:00Z')).toBe(true);
    expect(legacyRunDue({ ...erp, status: 'INACTIVE', lastRun: null }, '2026-11-07T00:00:00Z')).toBe(false);
    expect(legacyRunDue({ ...dms, lastRun: null }, '2026-11-07T00:00:00Z')).toBe(false);
  });
});

describe('변환 규칙 (FR-LGCY-001-006)', () => {
  it('기본 규칙 + 등록 규칙 — 같은 코드는 등록이 이긴다', () => {
    const base = [{ legacyCode: 'OPT-FSD3', system: 'PLANT-ERP' as const, description: 'FSD', featureId: 'FEAT-00022', note: null }];
    const reg = [{ legacyCode: 'OPT-FSD3', system: 'PLANT-ERP' as const, description: 'FSD EU', featureId: 'FEAT-00025', note: 'EU 분기', source: 'REGISTERED' as const, version: 1, updatedBy: 'usr-impl', updatedAt: '2026-11-07T00:00:00Z' }];
    expect(mergeLegacyRules(base, [])).toEqual([{ ...base[0], source: 'FIXTURE', version: 0, updatedBy: null, updatedAt: null }]);
    expect(mergeLegacyRules(base, reg)).toEqual(reg);
  });
});

describe('Legacy ↔ SDV 메시지 (FR-SDVI-001-002)', () => {
  const feats = ['FEAT-00022', 'FEAT-00024', 'FEAT-00018', 'FEAT-01018'];
  const msg = { format: 'LGC-CODING-1', system: 'DMS-KR', vin: 'KMH-LF-0001', unit: 'BCM', records: [{ did: 'F1024', value: '01' }], readAt: '2026-11-07T01:00:00Z' };
  it('레거시 코딩 메시지 → SDV Feature 상태', () => {
    expect(legacyToSdv(msg, LF, feats)).toEqual({ ok: true, message: { format: 'SDV-FEATURE-STATE-1', vin: 'KMH-LF-0001', observedAt: '2026-11-07T01:00:00.000Z', features: [{ featureId: 'FEAT-00024', state: 'ENABLED', source: { unit: 'BCM', did: 'F1024' } }] } });
  });
  it.each([
    [{ format: 'LGC-CODING-9' }, /모르는 메시지 형식/],
    [{ unit: 'IBU' }, /코딩 제어기는 BCM/],
    [{ records: [{ did: 'X999', value: '01' }] }, /F1NNN/],
    [{ records: [{ did: 'F1999', value: '01' }] }, /대응하는 Feature가 없습니다/],
    [{ records: [{ did: 'F1018', value: '01' }] }, /여러 Feature/],
    [{ records: [{ did: 'F1024', value: '07' }] }, /켜짐\(01\)·꺼짐\(00\)/],
    [{ readAt: 'yesterday' }, /올바른 시각/],
  ])('변환 실패 — %o → 사유', (patch, reason) => {
    const r = legacyToSdv({ ...msg, ...patch }, LF, feats);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(reason);
  });
  it('레거시 차량이 아니면 실패', () => {
    expect(legacyToSdv(msg, undefined, feats)).toMatchObject({ ok: false, reason: expect.stringMatching(/레거시 차량 목록에 없습니다/) });
  });
  it('SDV 켜기·끄기 → 레거시 코딩 메시지 형식', () => {
    expect(toLegacyCodingMessage('KMH-LF-0001', [{ unit: 'BCM', did: 'F1024', value: '00' }])).toEqual({ format: 'LGC-CODING-1', vin: 'KMH-LF-0001', unit: 'BCM', records: [{ did: 'F1024', value: '00' }] });
  });
});
