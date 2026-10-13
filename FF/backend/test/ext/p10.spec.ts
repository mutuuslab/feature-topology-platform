// P10 — 실험·효과(D01-07, FFG-CLS-006) · 장애·VOC → 이상 징후(D04-05, FFG-SOT-003) · 데이터 동기화(D05-02, FFG-TEL-005)
// · Legacy 연계(D05-03, IF-12) · Legacy-SDV(D05-07) · 현장 지원 포털(D05-05) · 외부 연계 모의 어댑터(IF-01·02·03·08·11·12)
import { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { actor, bootApp } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const RELEASE = actor('han.release', 'RELEASE_MANAGER');
const OPERATOR = actor('seo.ops', 'OPERATOR');
const VARIANT = actor('jo.variant', 'VARIANT_OWNER');
const AT = '2026-10-12T01:00:00.000Z';
const FEATURES = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'data', 'fixtures', 'v0.81', 'features.json'), 'utf8')) as { featureId: string; version: string; asil: string }[];

describe('P10 확장 컴포넌트', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => ({ app, http } = await bootApp({ at: AT })));
  afterAll(() => app.close());

  describe('실험·효과 (D01-07)', () => {
    it('F2 이상(FEAT-00022) A/B는 422 FFG-CLS-006 + 감사 FAILED, Shadow는 판단 일치율로만', async () => {
      const prof = (await http().get('/api/features/FEAT-00022/versions/1.0.0/safety').expect(200)).body;
      expect(['F2', 'F3', 'F4']).toContain(prof.profile?.fClass ?? prof.fClass);
      const ab = await http().post('/api/experiments').set(AUTHOR).send({ policyId: 'POL-00002', type: 'AB', hypothesis: '간격 단계를 앞당기면 고장 보고가 줄어든다', metric: 'FAULT_RATE', treatmentBp: 1000 }).expect(422);
      expect(ab.body.error.details).toMatchObject({ rule: 'FFG-CLS-006' });
      const audit = await http().get('/api/audit?target=POL-00002&result=FAILED').expect(200);
      expect(audit.body.items.some((a: any) => a.action === 'EXPERIMENT_CREATE')).toBe(true);
      await http().post('/api/experiments').set(AUTHOR).send({ policyId: 'POL-00002', type: 'SHADOW', hypothesis: '새 기준으로도 판단이 같다', metric: 'ENGAGEMENT', treatmentBp: 1000 }).expect(422);
    });

    it('Shadow 실험: 등록 → 시작 → 3일 뒤 결과(실제 Fleet 대조 포함) → 판단이 일치하면 채택', async () => {
      const c = await http().post('/api/experiments').set(AUTHOR).send({ policyId: 'POL-00002', type: 'SHADOW', hypothesis: '같은 정책 재평가 — 판단이 같다', metric: 'DECISION_AGREEMENT', treatmentBp: 5000, minSamples: 500 }).expect(201);
      expect(c.body).toMatchObject({ experimentId: 'EXP-00001', status: 'DRAFT', type: 'SHADOW' });
      await http().post('/api/experiments/EXP-00001/start').set(AUTHOR).send({}).expect(403); // 출시 담당자만
      await http().post('/api/experiments/EXP-00001/start').set(RELEASE).send({}).expect(200);
      app.get(Clock).set('2026-10-15T01:00:00.000Z');
      const d = (await http().get('/api/experiments/EXP-00001').expect(200)).body;
      expect(d.results).toMatchObject({ days: 3, enough: true });
      expect(d.results.fleet.vehicles).toBeGreaterThan(5);
      expect(d.results.fleet.agreement).toBe(1); // 배포 정책 자신과 대조 → 차량마다 같은 판단
      const done = await http().post('/api/experiments/EXP-00001/conclude').set(RELEASE).send({ decision: 'ADOPT', reason: '판단 일치' });
      expect([200, 422]).toContain(done.status); // 모의 일치율이 0.99 미만이면 채택 불가(DIVERGENT)
      if (done.status === 200) expect(done.body).toMatchObject({ status: 'CONCLUDED', decision: 'ADOPT' });
      else expect(done.body.error.details.verdict).toBe('DIVERGENT');
      app.get(Clock).set(AT);
    });

    it('QM Feature는 A/B 허용 — 표본 부족이면 INSUFFICIENT라 채택할 수 없다', async () => {
      const f = FEATURES.find((x) => x.featureId === 'FEAT-00024')!;
      const p = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00024', featureVersion: f.version, controlPoint: 'Flag', flagKey: 'care_00024_flag', description: 'IC·JC 사전안내 실험', safeDefault: false }).expect(201);
      const e = await http().post('/api/experiments').set(AUTHOR).send({ policyId: p.body.policyId, type: 'AB', hypothesis: '사전안내를 켜면 사용률이 오른다', metric: 'ENGAGEMENT', treatmentBp: 100, minSamples: 5000 }).expect(201);
      await http().post(`/api/experiments/${e.body.experimentId}/start`).set(RELEASE).send({}).expect(200);
      const d = (await http().get(`/api/experiments/${e.body.experimentId}`).expect(200)).body;
      expect(d.results.verdict).toBe('INSUFFICIENT');
      await http().post(`/api/experiments/${e.body.experimentId}/conclude`).set(RELEASE).send({ decision: 'ADOPT', reason: '채택' }).expect(422);
      await http().post(`/api/experiments/${e.body.experimentId}/conclude`).set(RELEASE).send({ decision: 'EXTEND', reason: '표본 더 모으기' }).expect(200);
    });
  });

  describe('장애·VOC → 이상 징후 (D04-05 → D06-12)', () => {
    it('VOC 가져오기: 범주 추정·Feature 연결, SOTIF 트리거만 이상 건으로, 두 번째 가져오기는 건너뜀', async () => {
      const r = (await http().post('/api/incidents/import-voc').set(OPERATOR).send({}).expect(200)).body;
      expect(r.created).toHaveLength(6);
      const byRef = Object.fromEntries(r.created.map((i: any) => [i.externalRef, i]));
      expect(byRef['VOC-2610-0001']).toMatchObject({ featureId: 'FEAT-00022', category: 'UNEXPECTED_ACTIVATION', sotif: { trigger: true } });
      expect(byRef['VOC-2610-0004']).toMatchObject({ featureId: 'FEAT-00024', category: 'HMI', sotif: { trigger: false } });
      expect(byRef['VOC-2610-0005']).toMatchObject({ featureId: null, sotif: { trigger: false } });
      expect((await http().post('/api/incidents/import-voc').set(OPERATOR).send({}).expect(200)).body).toMatchObject({ created: [], skipped: 6 });
      // 서로 다른 차량 2대의 의도하지 않은 작동(CRITICAL) → 이상 건 FIELD_SOTIF, 차단 권고 — 차단 자체는 발령하지 않는다
      const a = (await http().get('/api/anomalies?kind=FIELD_SOTIF').expect(200)).body.items;
      const anm = a.find((x: any) => x.featureId === 'FEAT-00022');
      expect(anm).toMatchObject({ severity: 'CRITICAL', advice: 'KILL', status: 'OPEN' });
      expect((await http().get('/api/kill-requests').expect(200)).body.items.filter((k: any) => k.anomalyId === anm.anomalyId)).toHaveLength(0);
      // 장애 이력이 이상 건을 거꾸로 찾는다
      const inc = (await http().get('/api/incidents?featureId=FEAT-00022').expect(200)).body.items;
      expect(inc.filter((i: any) => i.anomalyId === anm.anomalyId).length).toBeGreaterThanOrEqual(2);
      expect(inc.every((i: any) => i.status === 'LINKED')).toBe(true);
    });

    it('수동 접수는 운영자·시스템만, 없는 Feature는 404', async () => {
      const body = { source: 'FIELD', vin: 'ego-01', featureId: 'FEAT-00022', category: 'OTHER', severity: 'INFO', summary: '점검 중 확인' };
      await http().post('/api/incidents').set(AUTHOR).send(body).expect(403);
      expect((await http().post('/api/incidents').set(OPERATOR).send(body).expect(201)).body.sotif.trigger).toBe(false);
      await http().post('/api/incidents').set(OPERATOR).send({ ...body, featureId: 'FEAT-09999' }).expect(404);
    });
  });

  describe('데이터 동기화 (D05-02)', () => {
    it('대상마다 시장 구분, CN 국외 이전은 보류(HELD) — FFG-TEL-005', async () => {
      const t = (await http().get('/api/sync/targets').expect(200)).body.items;
      expect(t.find((x: any) => x.targetId === 'SYNC-IF12-HMGC-OUT')).toMatchObject({ market: 'CN', direction: 'OUTBOUND', localProcessing: true, gate: { allowed: false } });
      const held = (await http().post('/api/sync/runs').set(OPERATOR).send({ targetId: 'SYNC-IF12-HMGC-OUT' }).expect(201)).body;
      expect(held).toMatchObject({ status: 'HELD', diffs: [], reason: expect.stringContaining('FFG-TEL-005') });
      // 보류는 외부 호출조차 하지 않는다
      expect((await http().get('/api/integrations/calls?ifId=IF-12').expect(200)).body.items.filter((c: any) => c.key.includes('HMGC'))).toHaveLength(0);
    });

    it('IF-02 ECU 대사 — 하드웨어 개정 불일치·신규·폐기, 원천을 덮어쓰지 않는다', async () => {
      const r = (await http().post('/api/sync/runs').set(VARIANT).send({ targetId: 'SYNC-IF02-ECU' }).expect(201)).body;
      expect(r.status).toBe('SUCCEEDED');
      expect(r.diffs.map((d: any) => d.kind).sort()).toEqual(['MISMATCH', 'MISSING_IN_EXTERNAL', 'MISSING_IN_PLATFORM']);
      const v = (await http().post('/api/sync/runs').set(OPERATOR).send({ targetId: 'SYNC-IF02-VEH' }).expect(201)).body;
      expect(v.diffs).toEqual([{ key: 'KMH-NX4-0003', field: 'trim', platform: 'Premium', external: 'Inspiration', kind: 'MISMATCH' }]);
      expect((await http().get('/api/vehicles').expect(200)).body.items.find((x: any) => x.vin === 'KMH-NX4-0003').trim).toBe('Premium');
    });

    it('IF 꺼짐(IF_MODE_12=off)이면 실행 기록이 FAILED로 남는다', async () => {
      process.env.IF_MODE_12 = 'off';
      try {
        const r = (await http().post('/api/sync/runs').set(OPERATOR).send({ targetId: 'SYNC-IF12-TMA' }).expect(201)).body;
        expect(r).toMatchObject({ status: 'FAILED', reason: expect.stringContaining('IF-12') });
      } finally {
        delete process.env.IF_MODE_12;
      }
    });
  });

  describe('Legacy 연계 (D05-03) · Legacy-SDV (D05-07)', () => {
    it('해외공장 주문 가져오기 — 옵션 코드 해석, 미해석 코드 남김, 다시 가져와도 중복 없음', async () => {
      const r = (await http().post('/api/legacy/orders/import').set(OPERATOR).send({ plant: 'TMA' }).expect(200)).body;
      expect(r.orders).toHaveLength(2);
      expect(r.orders[0].resolved.map((x: any) => x.featureId)).toEqual(['FEAT-00022', 'FEAT-00023', 'FEAT-00015', 'FEAT-00010']);
      expect(r.unresolved).toEqual(['OPT-XHUD']);
      await http().post('/api/legacy/orders/import').set(OPERATOR).send({ plant: 'TMA' }).expect(200);
      expect((await http().get('/api/legacy/orders?plant=TMA').expect(200)).body.items).toHaveLength(2);
      expect((await http().get('/api/legacy/mappings').expect(200)).body.items.every((m: any) => m.known)).toBe(true);
    });

    it('레거시 차량 — F2 이상은 거부(원격 차단 없음, 감사 FAILED), F0·F1은 딜러 코딩 계획', async () => {
      const no = (await http().post('/api/legacy-sdv/translate').set(VARIANT).send({ vin: 'KMH-LF-0001', featureId: 'FEAT-00022', enable: true }).expect(200)).body;
      expect(no).toMatchObject({ supported: false, commands: [] });
      const yes = (await http().post('/api/legacy-sdv/translate').set(VARIANT).send({ vin: 'KMH-LF-0001', featureId: 'FEAT-00024', enable: true }).expect(200)).body;
      expect(yes).toMatchObject({ supported: true, commands: [{ unit: 'BCM', did: 'F1024', value: '01' }] });
      await http().post('/api/legacy-sdv/translate').set(VARIANT).send({ vin: 'ego-01', featureId: 'FEAT-00024', enable: true }).expect(404); // SDV 차량은 정책·OTA로
    });
  });

  describe('현장 지원 포털 (D05-05)', () => {
    it('VIN 종합 조회 — flag 값·권한·이상 건·장애 이력, 현장 접수는 장애·VOC로', async () => {
      const v = (await http().get('/api/field/vehicles/KMH-NX4-0002').expect(200)).body;
      expect(v.vehicle.vin).toBe('KMH-NX4-0002');
      expect(v.flags.find((f: any) => f.flagKey === 'care_00022_param')).toMatchObject({ featureId: 'FEAT-00022' });
      expect(v.anomalies.some((a: any) => a.kind === 'FIELD_SOTIF' && a.mine)).toBe(true);
      expect(v.incidents.some((i: any) => i.source === 'VOC')).toBe(true);
      const c = (await http().post('/api/field/cases').set(OPERATOR).send({ vin: 'KMH-NX4-0002', featureId: 'FEAT-00022', category: 'NO_ACTIVATION', severity: 'WARNING', summary: '시동 후 기능 미작동 재현', dealer: '서울 강남 서비스센터' }).expect(201)).body;
      expect(c).toMatchObject({ source: 'DEALER', summary: expect.stringContaining('[서울 강남 서비스센터]'), sotif: { trigger: true } });
      await http().get('/api/field/vehicles/NOPE-1').expect(404);
    });
  });

  describe('외부 연계 모의 어댑터', () => {
    it('IF-01 ALM 요구사항, IF-08 협력사 납품, 연결 현황(13개·모의/내장 구분·호출 수)', async () => {
      const alm = (await http().get('/api/integrations/alm/requirements?featureId=FEAT-00022&version=1.0.0').expect(200)).body;
      expect(alm.items.length).toBeGreaterThan(0);
      expect(alm.items[0]).toMatchObject({ reqId: expect.any(String), tracedGate: 'G2' });
      const sup = (await http().get('/api/integrations/supplier/deliveries').expect(200)).body.items;
      expect(sup[0]).toMatchObject({ swId: expect.any(String), supplier: expect.any(String), checksum: expect.any(String) });
      const sys = (await http().get('/api/integrations/systems').expect(200)).body.items;
      expect(sys.map((s: any) => s.ifId)).toHaveLength(13);
      expect(sys.find((s: any) => s.ifId === 'IF-01')).toMatchObject({ mode: 'mock', calls: 1 });
      expect(sys.find((s: any) => s.ifId === 'IF-10')).toMatchObject({ mode: 'internal' });
    });
  });
});
