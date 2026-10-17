// 전세계 차량 지도 (D02-03) — 위치(약 1 km·모의)·구독 상태·기능 활성, 사람 역할 누구나 열람·감사(지도는 10분에 한 번, 상세는 매번), 움직임, 합성 모집단.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/kernel/audit.service';
import { Clock } from '../../src/kernel/clock';
import { FleetRepo } from '../../src/domains/d01-policy/policy-repos';
import { actor, bootApp } from '../helpers';

const OPERATOR = actor('seo.ops', 'OPERATOR');
const AUDITOR = actor('jung.audit', 'AUDITOR');
const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const decimals = (x: number) => (String(x).split('.')[1] ?? '').length;

describe('전세계 차량 지도 (D02-03)', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: '2026-10-12T01:00:00.000Z' }));
  });
  afterAll(async () => {
    await app.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE']) delete process.env[k];
  });
  const advance = (ms: number) => {
    const clock = app.get(Clock);
    clock.set(new Date(clock.now().getTime() + ms));
  };
  const mapAudits = (actorId: string) => app.get(AuditService).list({ actorId }).filter((a) => a.action === 'FLEET_LOCATION_VIEW');

  it('데모 Fleet — 차량마다 약 1 km 위치·구독·활성 상태, 국가별 집계, 개인정보 안내', async () => {
    const r = (await http().get('/api/fleet/map').set(OPERATOR).expect(200)).body;
    expect(r.items).toHaveLength(app.get(FleetRepo).vehicles().length);
    expect(r.precision).toMatchObject({ level: 'COARSE', degrees: 0.01 });
    expect(r.privacy).toMatch(/모의 좌표/);
    for (const v of r.items.filter((x: any) => x.position?.precision === 'COARSE')) {
      expect(decimals(v.position.lat)).toBeLessThanOrEqual(2);
      expect(decimals(v.position.lng)).toBeLessThanOrEqual(2);
    }
    const offline = r.items.find((x: any) => x.vin === 'KMH-NX4-0003');
    expect(offline.position.precision).toBe('REGION'); // 위치 공유 미동의 → 지역 대표점
    const kr = r.summary.find((s: any) => s.country === 'KR');
    expect(kr.total).toBe(r.items.filter((x: any) => x.country === 'KR').length);
    expect(r.items.every((x: any) => ['ON', 'OFF', 'DISABLED', 'UNKNOWN'].includes(x.activation))).toBe(true);
    expect(r.items.find((x: any) => x.vin === 'KMH-NX4-0001').subscription).toBe('PAID'); // 구독 고객 차량
    // 새 시드에는 적용된 게시본이 없다 — 온라인 차량은 비활성, 오프라인 차량은 단정하지 않고 미확인
    expect(r.flagKeys).toEqual([]);
    expect(r.items.filter((x: any) => x.link === 'ONLINE').every((x: any) => x.activation === 'OFF')).toBe(true);
    expect(offline.activation).toBe('UNKNOWN');
  });

  it('열람 감사 — 지도는 같은 계정 10분에 한 번, 지나면 다시 남는다', async () => {
    const before = mapAudits('jung.audit').length;
    expect((await http().get('/api/fleet/map').set(AUDITOR).expect(200)).body.audited).toBe(true);
    expect((await http().get('/api/fleet/map').set(AUDITOR).expect(200)).body.audited).toBe(false);
    expect(mapAudits('jung.audit')).toHaveLength(before + 1);
    advance(11 * 60_000);
    expect((await http().get('/api/fleet/map').set(AUDITOR).expect(200)).body.audited).toBe(true);
    expect(mapAudits('jung.audit')).toHaveLength(before + 2);
  });

  it('누구나 열람(사용자 결정 2026-10-17) — Feature 작성자도 보고 열람이 감사에 남는다, 차량 신원은 403', async () => {
    const r = (await http().get('/api/fleet/map').set(AUTHOR).expect(200)).body;
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.precision.level).toBe('COARSE'); // 정밀도는 그대로
    expect(mapAudits('kim.author').length).toBeGreaterThan(0);
    await http().get('/api/fleet/map/vehicles/ego-01').set(AUTHOR).expect(200);
    await http().get('/api/fleet/map').set(actor('vehicle-x', 'VEHICLE')).expect(403);
    const denied = app.get(AuditService).list({ actorId: 'vehicle-x', result: 'DENIED' });
    expect(denied.some((a) => a.target === '/api/fleet/map')).toBe(true);
  });

  it('움직이는 차량은 시간이 지나면 위치가 바뀌고, 오프라인 차량은 멈춰 있다', async () => {
    const at = async () => (await http().get('/api/fleet/map').set(OPERATOR).expect(200)).body.items;
    const a = await at();
    advance(4 * 60_000);
    const b = await at();
    const pos = (xs: any[], vin: string) => xs.find((x) => x.vin === vin);
    expect(pos(a, 'ego-01').moving).toBe(true);
    expect(pos(b, 'ego-01').position).not.toEqual(pos(a, 'ego-01').position);
    expect(pos(b, 'KMH-NX4-0003')).toMatchObject({ moving: false, stale: true, link: 'OFFLINE' });
    expect(pos(b, 'KMH-NX4-0003').position).toEqual(pos(a, 'KMH-NX4-0003').position);
  });

  it('한 대 상세 — 정밀 위치(소수 4자리)·권한·런타임, 열람마다 감사', async () => {
    const before = mapAudits('seo.ops').filter((x) => x.target === '/api/fleet/map/vehicles/ego-01').length;
    const r = (await http().get('/api/fleet/map/vehicles/ego-01').set(OPERATOR).expect(200)).body;
    await http().get('/api/fleet/map/vehicles/ego-01').set(OPERATOR).expect(200);
    expect(r.vehicle.position.precision).toBe('PRECISE');
    expect(decimals(r.vehicle.position.lat)).toBeGreaterThan(2);
    expect(Array.isArray(r.runtime.flags)).toBe(true);
    expect(Array.isArray(r.grants)).toBe(true);
    expect(mapAudits('seo.ops').filter((x) => x.target === '/api/fleet/map/vehicles/ego-01')).toHaveLength(before + 2);
    await http().get('/api/fleet/map/vehicles/NOPE-0001').set(OPERATOR).expect(404);
  });

  it('합성 모집단 — 정지 위치·구독 상태만(런타임 없음), 상품 필터', async () => {
    const synthetic = [...app.get(FleetRepo).profiles().values()].filter((p) => p.source === 'SYNTHETIC').length;
    // 세계 범위 — 상한(MAP_POINT_LIMIT)을 넘으면 점 대신 묶음. 점 + 생략 = 전체
    const world = (await http().get('/api/fleet/map?source=SYNTHETIC&catalogId=CAT-00019').set(OPERATOR).expect(200)).body;
    expect(world.items.length + world.pointsOmitted).toBe(synthetic);
    // 수도권 범위로 좁히면 점으로
    const r = (await http().get('/api/fleet/map?source=SYNTHETIC&catalogId=CAT-00019&zoom=11&bbox=126.5,37.2,127.5,37.9').set(OPERATOR).expect(200)).body;
    if (synthetic) expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((x: any) => x.source === 'SYNTHETIC' && x.activation === null && !x.moving)).toBe(true);
    if (synthetic) {
      expect(new Set(r.items.map((x: any) => x.subscription)).size).toBeGreaterThan(1);
      const one = r.items.find((x: any) => x.position?.precision === 'COARSE');
      const d = (await http().get(`/api/fleet/map/vehicles/${one.vin}`).set(OPERATOR).expect(200)).body;
      expect(d.vehicle.position.precision).toBe('PRECISE');
      expect(d.runtime).toBeNull();
    }
  });
});
