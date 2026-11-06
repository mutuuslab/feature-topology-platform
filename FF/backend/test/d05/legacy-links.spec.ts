// Legacy 연계 설정(D05-03, FR-LGCY-001-001~006) — 등록(중복 409·조합 검사)·조회(빈 목록)·수정(없는 설정 404·브리지 다시 구성)·삭제(활성 422),
// 설정 → 데이터 브리지(유형·방향·주기) 구성과 실행(주기·수동, 실패 기록), 변환 규칙 등록·수정(미해석 코드 해소),
// Legacy↔SDV 메시지 변환(D05-07, FR-SDVI-001-002) — 레거시 코딩 → SDV Feature 상태, SDV → 레거시 코딩, 실패 사유·시각 기록.
Object.assign(process.env, { FF_SCHEDULER: 'manual' });
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LegacyLinkService } from '../../src/domains/d05-ext/legacy/legacy-config.service';
import { Clock } from '../../src/kernel/clock';
import { actor, bootApp } from '../helpers';

const IMPL = actor('usr-impl', 'IMPLEMENTER');
const OPS = actor('seo.ops', 'OPERATOR');
const VARIANT = actor('choi.variant', 'VARIANT_OWNER');
const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const AT = '2026-11-07T01:00:00.000Z';

afterAll(() => {
  delete process.env.FF_SCHEDULER;
  delete process.env.IF_MODE_12;
});

const erp = (o: Record<string, unknown> = {}) => ({ system: 'ERP-TMA', name: 'TMA 공장 ERP', kind: 'PLANT-ERP', endpoint: 'https://erp.tma.example/api/orders', bridgeType: 'BATCH', schedule: 'DAILY', plant: 'TMA', ...o });
const dms = (o: Record<string, unknown> = {}) => ({ system: 'DMS-KR', name: '국내 딜러 DMS', kind: 'DEALER-DMS', endpoint: 'https://dms.example.kr/hook', bridgeType: 'REALTIME', status: 'ACTIVE', ...o });

describe('Legacy 연계 설정·브리지 (FR-LGCY-001-001~005)', () => {
  let app: INestApplication;
  let http: () => any;
  let get: <T>(t: any) => T;
  beforeAll(async () => ({ app, http, get } = await bootApp({ at: AT })));
  afterAll(() => app.close());

  it('등록된 설정이 없으면 빈 목록', async () => {
    expect((await http().get('/api/legacy/links').expect(200)).body).toEqual({ items: [] });
  });

  it('등록 — 연계 담당만, 설정에서 브리지를 구성한다. 기본은 비활성', async () => {
    await http().post('/api/legacy/links').set(AUTHOR).send(erp()).expect(403);
    const r = await http().post('/api/legacy/links').set(IMPL).send(erp()).expect(201);
    expect(r.body).toMatchObject({ linkId: 'LNK-0001', system: 'ERP-TMA', status: 'INACTIVE', version: 1, createdBy: 'usr-impl', lastRun: null });
    expect(r.body.bridge).toMatchObject({ bridgeId: 'BRG-ERP-TMA', type: 'BATCH', direction: 'INBOUND', ifId: 'IF-12', ruleSystem: 'PLANT-ERP', trigger: expect.stringContaining('매일') });
    const list = (await http().get('/api/legacy/links').expect(200)).body.items;
    expect(list.map((l: any) => l.system)).toEqual(['ERP-TMA']);
  });

  it('같은 시스템은 저장하지 않고 409, 종류·브리지 조합이 틀리면 400(이유 목록)', async () => {
    const dup = await http().post('/api/legacy/links').set(IMPL).send(erp({ name: '다른 이름' })).expect(409);
    expect(dup.body.error.message).toMatch(/ERP-TMA/);
    const bad = await http().post('/api/legacy/links').set(IMPL).send(erp({ system: 'ERP-HMA', bridgeType: 'REALTIME', schedule: null, plant: 'HMA' })).expect(400);
    expect(bad.body.error.details.problems).toEqual([expect.stringMatching(/실시간 브리지를 쓸 수 없습니다/)]);
    expect((await http().get('/api/legacy/links').expect(200)).body.items).toHaveLength(1);
  });

  it('수정 — 변경 내용·버전·감사(전후), 브리지를 다시 구성. 없는 설정 404', async () => {
    await http().patch('/api/legacy/links/LNK-0404').set(IMPL).send({ schedule: 'HOURLY', reason: '주기 변경' }).expect(404);
    await http().patch('/api/legacy/links/LNK-0001').set(IMPL).send({ bridgeType: 'FILE', reason: '파일로' }).expect(400); // https 주소는 파일 브리지가 아니다
    const r = await http().patch('/api/legacy/links/LNK-0001').set(IMPL).send({ schedule: 'HOURLY', status: 'ACTIVE', reason: '주문 반영 주기 단축' }).expect(200);
    expect(r.body).toMatchObject({ schedule: 'HOURLY', status: 'ACTIVE', version: 2, updatedBy: 'usr-impl' });
    expect(r.body.bridge.trigger).toMatch(/매시/);
    const a = (await http().get('/api/audit?action=LEGACY_LINK_UPDATE').expect(200)).body.items[0];
    expect(a.before).toMatchObject({ schedule: 'DAILY', status: 'INACTIVE' });
    expect(a.reason).toBe('주문 반영 주기 단축');
  });

  it('브리지 실행 — 활성 설정에서 IF-12 주문을 가져와 변환, 최근 실행을 남긴다. 실시간 브리지는 메시지로만', async () => {
    const r = await http().post('/api/legacy/links/LNK-0001/run').set(OPS).send({}).expect(200);
    expect(r.body.lastRun).toMatchObject({ status: 'SUCCEEDED', orders: 2, unresolved: ['OPT-XHUD'], by: 'seo.ops', at: AT });
    expect((await http().get('/api/legacy/orders?plant=TMA').expect(200)).body.items).toHaveLength(2);
    await http().post('/api/legacy/links').set(IMPL).send(dms()).expect(201);
    const rt = await http().post('/api/legacy/links/LNK-0002/run').set(OPS).send({}).expect(422);
    expect(rt.body.error.message).toMatch(/실시간/);
  });

  it('주기 실행 — 주기가 지난 활성 배치 브리지만, 시스템 행위자로', async () => {
    const svc = get<LegacyLinkService>(LegacyLinkService);
    expect(svc.runDue()).toEqual([]);
    get<Clock>(Clock).set(new Date('2026-11-07T02:00:00.000Z'));
    expect(svc.runDue()).toEqual(['LNK-0001']);
    const l = (await http().get('/api/legacy/links').expect(200)).body.items.find((x: any) => x.linkId === 'LNK-0001');
    expect(l.lastRun).toMatchObject({ status: 'SUCCEEDED', by: 'system:legacy-bridge', at: '2026-11-07T02:00:00.000Z' });
  });

  it('실행 실패(IF-12 꺼짐) — 최근 실행 FAILED·사유, 연계 오류 이력', async () => {
    process.env.IF_MODE_12 = 'off';
    get<Clock>(Clock).set(new Date('2026-11-07T03:00:00.000Z'));
    const r = await http().post('/api/legacy/links/LNK-0001/run').set(OPS).send({}).expect(422);
    expect(r.body.error.message).toMatch(/꺼져 있습니다/);
    delete process.env.IF_MODE_12;
    const l = (await http().get('/api/legacy/links').expect(200)).body.items.find((x: any) => x.linkId === 'LNK-0001');
    expect(l.lastRun).toMatchObject({ status: 'FAILED', reason: expect.stringMatching(/꺼져 있습니다/), at: '2026-11-07T03:00:00.000Z' });
    const errs = (await http().get('/api/integrations/errors?system=LEGACY').expect(200)).body.items;
    expect(errs[0]).toMatchObject({ errorType: 'CONNECTION_OFF', target: expect.stringContaining('TMA') });
  });

  it('삭제 — 활성 연계는 거부(422, 삭제 불가 메시지), 비활성으로 바꾼 뒤 삭제', async () => {
    const no = await http().delete('/api/legacy/links/LNK-0001').set(IMPL).send({ reason: '공장 이전' }).expect(422);
    expect(no.body.error.message).toMatch(/활성 상태인 연계 설정은 삭제할 수 없습니다/);
    await http().delete('/api/legacy/links/LNK-0404').set(IMPL).send({ reason: '없음' }).expect(404);
    await http().patch('/api/legacy/links/LNK-0001').set(IMPL).send({ status: 'INACTIVE', reason: '공장 이전 준비' }).expect(200);
    expect((await http().delete('/api/legacy/links/LNK-0001').set(IMPL).send({ reason: '공장 이전' }).expect(200)).body).toEqual({ linkId: 'LNK-0001', deleted: true });
    expect((await http().get('/api/legacy/links').expect(200)).body.items.map((l: any) => l.linkId)).toEqual(['LNK-0002']);
    const a = (await http().get('/api/audit?action=LEGACY_LINK_DELETE').expect(200)).body.items;
    expect(a.map((x: any) => x.result)).toEqual(['ALLOWED', 'FAILED']);
  });
});

describe('변환 규칙 (FR-LGCY-001-006)', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => ({ app, http } = await bootApp({ at: AT })));
  afterAll(() => app.close());

  it('조회 — 기본 규칙(모의 외부 시스템 표)에 출처·버전', async () => {
    const items = (await http().get('/api/legacy/mappings').expect(200)).body.items;
    expect(items.find((m: any) => m.legacyCode === 'OPT-FSD3')).toMatchObject({ featureId: 'FEAT-00022', source: 'FIXTURE', version: 0, known: true });
  });

  it('등록 — 미해석 코드에 규칙을 더하면 다시 가져올 때 해석된다. 같은 코드 409·없는 Feature 400·역할 403', async () => {
    const first = (await http().post('/api/legacy/orders/import').set(OPS).send({ plant: 'TMA' }).expect(200)).body;
    expect(first.unresolved).toEqual(['OPT-XHUD']);
    const body = { legacyCode: 'OPT-XHUD', system: 'PLANT-ERP', description: 'Head-up Display (AR)', featureId: 'FEAT-00014', reason: '공장 옵션 추가' };
    await http().post('/api/legacy/mappings').set(AUTHOR).send(body).expect(403);
    await http().post('/api/legacy/mappings').set(IMPL).send({ ...body, featureId: 'FEAT-99999' }).expect(400);
    await http().post('/api/legacy/mappings').set(IMPL).send({ ...body, legacyCode: 'OPT-FSD3' }).expect(409);
    const r = await http().post('/api/legacy/mappings').set(IMPL).send(body).expect(201);
    expect(r.body).toMatchObject({ legacyCode: 'OPT-XHUD', source: 'REGISTERED', version: 1, updatedBy: 'usr-impl', featureId: 'FEAT-00014' });
    const again = (await http().post('/api/legacy/orders/import').set(OPS).send({ plant: 'TMA' }).expect(200)).body;
    expect(again.unresolved).toEqual([]);
    expect(again.orders.find((o: any) => o.orderId === 'PO-TMA-26100002').resolved).toContainEqual({ legacyCode: 'OPT-XHUD', featureId: 'FEAT-00014' });
  });

  it('수정 — 변경 내용·버전 저장, 기본 규칙은 등록 규칙으로 덮어쓴다. 없는 코드 404', async () => {
    await http().patch('/api/legacy/mappings/OPT-NOPE').set(IMPL).send({ featureId: 'FEAT-00014', reason: '없음' }).expect(404);
    const r = await http().patch('/api/legacy/mappings/OPT-FSD3').set(VARIANT).send({ featureId: 'FEAT-00025', note: 'EU 사양 분기', reason: 'EU 시장 Feature로 분기' }).expect(200);
    expect(r.body).toMatchObject({ legacyCode: 'OPT-FSD3', featureId: 'FEAT-00025', source: 'REGISTERED', version: 1, note: 'EU 사양 분기', updatedBy: 'choi.variant' });
    const r2 = await http().patch('/api/legacy/mappings/OPT-FSD3').set(VARIANT).send({ description: 'Forward Safe Distance Lv3 (EU)', reason: '설명' }).expect(200);
    expect(r2.body).toMatchObject({ version: 2, featureId: 'FEAT-00025' });
    const items = (await http().get('/api/legacy/mappings').expect(200)).body.items;
    expect(items.find((m: any) => m.legacyCode === 'OPT-FSD3')).toMatchObject({ featureId: 'FEAT-00025', source: 'REGISTERED', version: 2 });
    const a = (await http().get('/api/audit?action=LEGACY_RULE_UPDATE').expect(200)).body.items;
    expect(a).toHaveLength(2);
  });
});

describe('Legacy ↔ SDV 메시지 변환 (FR-SDVI-001-002)', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => ({ app, http } = await bootApp({ at: AT })));
  afterAll(() => app.close());

  const msg = (o: Record<string, unknown> = {}) => ({ format: 'LGC-CODING-1', system: 'DMS-KR', vin: 'KMH-LF-0001', unit: 'BCM', records: [{ did: 'F1024', value: '01' }], readAt: '2026-11-07T00:30:00Z', ...o });

  it('형식 표 — 레거시·SDV 메시지 필드', async () => {
    const f = (await http().get('/api/legacy-sdv/formats').expect(200)).body;
    expect(Object.keys(f.formats)).toEqual(['LGC-CODING-1', 'SDV-FEATURE-STATE-1']);
  });

  it('활성 실시간 연계가 없으면 변환 실패 — 사유·시각을 기록', async () => {
    const r = await http().post('/api/legacy-sdv/messages').set(OPS).send(msg()).expect(200);
    expect(r.body).toMatchObject({ messageId: 'LMSG-00001', direction: 'LEGACY_TO_SDV', status: 'FAILED', at: AT, reason: expect.stringMatching(/DMS-KR.*활성/), output: null });
  });

  it('레거시 코딩 메시지 → SDV Feature 상태, 틀린 메시지는 실패 사유로', async () => {
    await http().post('/api/legacy/links').set(IMPL).send(dms()).expect(201);
    const ok = await http().post('/api/legacy-sdv/messages').set(OPS).send(msg()).expect(200);
    expect(ok.body).toMatchObject({ status: 'CONVERTED', formatIn: 'LGC-CODING-1', formatOut: 'SDV-FEATURE-STATE-1', system: 'DMS-KR', reason: null });
    expect(ok.body.output).toEqual({ format: 'SDV-FEATURE-STATE-1', vin: 'KMH-LF-0001', observedAt: '2026-11-07T00:30:00.000Z', features: [{ featureId: 'FEAT-00024', state: 'ENABLED', source: { unit: 'BCM', did: 'F1024' } }] });
    const bad = await http().post('/api/legacy-sdv/messages').set(OPS).send(msg({ records: [{ did: 'F1024', value: '07' }] })).expect(200);
    expect(bad.body).toMatchObject({ status: 'FAILED', reason: expect.stringMatching(/켜짐\(01\)/) });
    await http().post('/api/legacy-sdv/messages').set(AUTHOR).send(msg()).expect(403);
  });

  it('SDV → 레거시 — 코딩 계획에 레거시 메시지 형식을 싣고 기록, F2 이상 거부도 실패로 기록', async () => {
    const yes = await http().post('/api/legacy-sdv/translate').set(VARIANT).send({ vin: 'KMH-LF-0001', featureId: 'FEAT-00024', enable: false }).expect(200);
    expect(yes.body.message).toEqual({ format: 'LGC-CODING-1', vin: 'KMH-LF-0001', unit: 'BCM', records: [{ did: 'F1024', value: '00' }] });
    await http().post('/api/legacy-sdv/translate').set(VARIANT).send({ vin: 'KMH-LF-0001', featureId: 'FEAT-00022', enable: true }).expect(200);
    const log = (await http().get('/api/legacy-sdv/messages?vin=KMH-LF-0001').expect(200)).body.items;
    expect(log.map((m: any) => [m.direction, m.status])).toEqual([
      ['SDV_TO_LEGACY', 'FAILED'],
      ['SDV_TO_LEGACY', 'CONVERTED'],
      ['LEGACY_TO_SDV', 'FAILED'],
      ['LEGACY_TO_SDV', 'CONVERTED'],
      ['LEGACY_TO_SDV', 'FAILED'],
    ]);
    expect(log[0]).toMatchObject({ formatIn: 'SDV-FEATURE-STATE-1', reason: expect.stringMatching(/안전 관련/), at: AT });
    expect((await http().get('/api/legacy-sdv/messages?status=FAILED').expect(200)).body.items).toHaveLength(3);
  });
});
