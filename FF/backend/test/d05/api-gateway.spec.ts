// 외부 API 게이트웨이(D05-01, FR-AGW-001-003~007) — API 키 발급(원문 1회·해시 저장)·조회(빈 목록·상태·마지막 사용)·삭제(폐기 키 401),
// 키→역할(SYSTEM·AUDITOR, 역할 검사 그대로), 런타임 명세 GET /api/openapi.json(최신 경로 표·ETag), 버전 정책(현재·폐기 예고 호환·지원 종료 410+Sunset).
import { INestApplication } from '@nestjs/common';
import { ROUTES } from '@ff/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../../src/kernel/db';
import { Clock } from '../../src/kernel/clock';
import { actor, bootApp } from '../helpers';

const CSM = actor('usr-csm', 'SECURITY_OFFICER');
const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const AT = '2026-11-07T01:00:00.000Z';

describe('API 키 (FR-AGW-001-003~005)', () => {
  let app: INestApplication;
  let http: () => any;
  let get: <T>(t: any) => T;
  let sysKey = '';
  let readKey = '';
  beforeAll(async () => ({ app, http, get } = await bootApp({ at: AT })));
  afterAll(() => app.close());

  it('발급한 키가 없으면 데모 기본 SDK 키(AK-0000, OFREP 평가용 조회 전용)만', async () => {
    expect((await http().get('/api/api-keys').expect(200)).body.items.map((k: any) => [k.keyId, k.state, k.role])).toEqual([['AK-0000', 'ACTIVE', 'AUDITOR']]);
  });

  it('발급 — 보안 담당·운영 리더만, 원문은 응답 한 번뿐이고 저장소에는 해시만', async () => {
    await http().post('/api/api-keys').set(AUTHOR).send({ name: 'VOC 수집기', system: '고객센터', role: 'SYSTEM', reason: '연계' }).expect(403);
    await http().post('/api/api-keys').set(CSM).send({ name: 'VOC 수집기', system: '고객센터', role: 'OPERATOR', reason: '연계' }).expect(400);
    await http().post('/api/api-keys').set(CSM).send({ name: 'VOC 수집기', system: '고객센터', role: 'SYSTEM', expiresOn: '2026-11-06', reason: '연계' }).expect(400);
    const r = await http().post('/api/api-keys').set(CSM).send({ name: '해외공장 주문 수집', system: 'TMA 공장 ERP', role: 'SYSTEM', reason: 'IF-12 주문 자동 가져오기' }).expect(201);
    expect(r.body).toMatchObject({ keyId: 'AK-0001', role: 'SYSTEM', state: 'ACTIVE', createdBy: 'usr-csm', expiresOn: '2027-11-07', lastUsedAt: null });
    expect(r.body.secret).toMatch(/^ffk_AK-0001_[A-Za-z0-9_-]{43}$/);
    expect(r.body.prefix).toBe(r.body.secret.slice(0, 'ffk_AK-0001_'.length + 4));
    sysKey = r.body.secret;
    readKey = (await http().post('/api/api-keys').set(CSM).send({ name: '감사 조회', system: '외부 감사 도구', role: 'AUDITOR', expiresOn: '2026-11-30', reason: '분기 감사' }).expect(201)).body.secret;
    // 원문·해시는 다시 나오지 않는다 — 목록·감사·이벤트·DB 문서
    const list = await http().get('/api/api-keys').expect(200);
    expect(list.body.items.map((k: any) => [k.keyId, k.state, k.role])).toEqual([
      ['AK-0002', 'ACTIVE', 'AUDITOR'],
      ['AK-0001', 'ACTIVE', 'SYSTEM'],
      ['AK-0000', 'ACTIVE', 'AUDITOR'],
    ]);
    const db = get<Db>(DB);
    const audit = JSON.stringify(db.all('SELECT * FROM audit'));
    const events = JSON.stringify(db.all('SELECT * FROM events'));
    for (const text of [JSON.stringify(list.body), audit, events, JSON.stringify(db.all('SELECT doc FROM api_key'))]) expect(text).not.toContain(sysKey.slice('ffk_AK-0001_'.length + 4));
    const row = db.get<{ hash: string }>("SELECT hash FROM api_key WHERE key_id = 'AK-0001'")!;
    expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(audit).toContain('API_KEY_ISSUE');
  });

  it('키로 인증 — 키에 묶인 역할로 경로 역할 검사, 행위자 머리글은 무시, 마지막 사용 시각', async () => {
    const r = await http().post('/api/legacy/orders/import').set({ 'X-Api-Key': sysKey, 'X-Actor-Id': 'someone', 'X-Actor-Role': 'OPERATOR' }).send({ plant: 'TMA' }).expect(200);
    expect(r.body.plant).toBe('TMA');
    const a = await http().get('/api/audit?action=PLANT_ORDER_IMPORT').expect(200);
    expect(a.body.items[0]).toMatchObject({ actorId: 'apikey:AK-0001', actorRole: 'SYSTEM' });
    // 조회 전용 키는 쓰기 경로에서 역할 거부(403·DENIED), 읽기는 된다
    await http().post('/api/legacy/orders/import').set({ 'X-Api-Key': readKey }).send({ plant: 'TMA' }).expect(403);
    await http().get('/api/legacy/orders').set({ 'X-Api-Key': readKey }).expect(200);
    const list = (await http().get('/api/api-keys').expect(200)).body.items;
    expect(list.find((k: any) => k.keyId === 'AK-0001').lastUsedAt).toBe(AT);
  });

  it('틀린 키·모양이 다른 키는 401', async () => {
    const wrong = sysKey.slice(0, -1) + (sysKey.endsWith('A') ? 'B' : 'A');
    const r = await http().get('/api/legacy/orders').set({ 'X-Api-Key': wrong }).expect(401);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');
    await http().get('/api/legacy/orders').set({ 'X-Api-Key': 'not-a-key' }).expect(401);
    await http().get('/api/legacy/orders').set({ 'X-Api-Key': `ffk_AK-0099_${'x'.repeat(43)}` }).expect(401);
  });

  it('삭제 — 폐기 상태로 남기고 해시를 지운다. 폐기 키는 401 UNAUTHENTICATED, 두 번째 삭제 409·없는 키 404', async () => {
    await http().delete('/api/api-keys/AK-0001').set(AUTHOR).send({ reason: '연계 종료' }).expect(403);
    const r = await http().delete('/api/api-keys/AK-0001').set(CSM).send({ reason: '연계 종료' }).expect(200);
    expect(r.body).toMatchObject({ keyId: 'AK-0001', state: 'REVOKED', revokedBy: 'usr-csm', revokeReason: '연계 종료', revokedAt: AT });
    const denied = await http().post('/api/legacy/orders/import').set({ 'X-Api-Key': sysKey }).send({ plant: 'TMA' }).expect(401);
    expect(denied.body.error).toMatchObject({ code: 'UNAUTHENTICATED', message: expect.stringMatching(/폐기/) });
    expect(get<Db>(DB).get<{ hash: string | null }>("SELECT hash FROM api_key WHERE key_id = 'AK-0001'")!.hash).toBeNull();
    await http().delete('/api/api-keys/AK-0001').set(CSM).send({ reason: '다시' }).expect(409);
    await http().delete('/api/api-keys/AK-0404').set(CSM).send({ reason: '없음' }).expect(404);
    const list = (await http().get('/api/api-keys').expect(200)).body.items;
    expect(list.find((k: any) => k.keyId === 'AK-0001').state).toBe('REVOKED');
    const audit = (await http().get('/api/audit?targetPrefix=AK-').expect(200)).body.items.map((x: any) => x.action);
    expect(audit).toEqual(expect.arrayContaining(['API_KEY_ISSUE', 'API_KEY_REVOKE']));
  });

  it('만료일이 지난 키는 401', async () => {
    get<Clock>(Clock).set(new Date('2026-12-01T00:00:00.000Z'));
    const r = await http().get('/api/legacy/orders').set({ 'X-Api-Key': readKey }).expect(401);
    expect(r.body.error.message).toMatch(/만료/);
    expect((await http().get('/api/api-keys').expect(200)).body.items.find((k: any) => k.keyId === 'AK-0002').state).toBe('EXPIRED');
    get<Clock>(Clock).set(new Date(AT));
  });
});

describe('런타임 명세·버전 정책 (FR-AGW-001-006·007)', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => ({ app, http } = await bootApp({ at: AT })));
  afterAll(() => app.close());

  it('GET /api/openapi.json — OpenAPI 3.0.3, 모든 경로, 커밋 사본과 같은 연산, ETag(304)', async () => {
    const r = await http().get('/api/openapi.json').expect(200);
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(r.body).toMatchObject({ openapi: '3.0.3', info: { version: '2026-11' } });
    const ops = (doc: any) => Object.values(doc.paths).flatMap((p: any) => Object.values(p).map((o: any) => o.operationId)).sort();
    expect(ops(r.body)).toEqual(ROUTES.map((x) => x.name).sort());
    const committed = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', 'docs', '80-integration', 'openapi.json'), 'utf8'));
    expect(ops(r.body)).toEqual(ops(committed));
    expect(r.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
    await http().get('/api/openapi.json').set('If-None-Match', r.headers.etag).expect(304);
  });

  it('GET /api/api-versions — 버전별 상태·일정과 명세 요약(같은 해시)', async () => {
    const r = await http().get('/api/api-versions').expect(200);
    expect(r.body).toMatchObject({ header: 'X-Api-Version', current: '2026-11', policy: { compatibility: 'ADDITIVE_ONLY' } });
    expect(r.body.versions.map((v: any) => [v.version, v.state])).toEqual([
      ['2026-11', 'CURRENT'],
      ['2026-06', 'DEPRECATED'],
      ['2025-12', 'RETIRED'],
    ]);
    const spec = await http().get('/api/openapi.json').expect(200);
    expect(r.body.spec).toMatchObject({ openapi: '3.0.3', version: '2026-11', operations: ROUTES.length, url: '/api/openapi.json' });
    expect(`"${r.body.spec.sha256}"`).toBe(spec.headers.etag);
  });

  it('버전 머리글 — 없으면 현재 버전, 폐기 예고 버전은 같은 본문 + Deprecation·Sunset', async () => {
    const cur = await http().get('/api/features').expect(200);
    expect(cur.headers['x-api-version']).toBe('2026-11');
    expect(cur.headers.deprecation).toBeUndefined();
    const old = await http().get('/api/features').set('X-Api-Version', '2026-06').expect(200);
    expect(old.body).toEqual(cur.body);
    expect(old.headers).toMatchObject({ 'x-api-version': '2026-06', deprecation: `@${Date.parse('2026-11-01T00:00:00Z') / 1000}`, sunset: 'Sat, 01 May 2027 00:00:00 GMT' });
    expect(old.headers.link).toContain('/api/api-versions');
  });

  it('지원 종료 버전 → 410 API_VERSION_RETIRED + Sunset + 옮길 버전, 모르는 버전 400 — 쓰기·공개 경로도 같다', async () => {
    const gone = await http().get('/api/features').set('X-Api-Version', '2025-12').expect(410);
    expect(gone.headers.sunset).toBe('Thu, 01 Oct 2026 00:00:00 GMT');
    expect(gone.body.error).toMatchObject({ code: 'API_VERSION_RETIRED', details: { requested: '2025-12', current: '2026-11', sunsetAt: '2026-10-01' } });
    expect(gone.body.error.message).toMatch(/지원이 끝났습니다/);
    await http().post('/api/legacy/orders/import').set({ ...actor('seo.ops', 'OPERATOR'), 'X-Api-Version': '2025-12' }).send({ plant: 'TMA' }).expect(410);
    await http().get('/api/health').set('X-Api-Version', '2025-12').expect(410);
    const bad = await http().get('/api/features').set('X-Api-Version', 'v9').expect(400);
    expect(bad.body.error.details.supported).toEqual(['2026-06', '2026-11']);
  });
});
