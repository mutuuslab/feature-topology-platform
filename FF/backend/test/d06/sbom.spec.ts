// SBOM·VEX (D06-11·D06-08, 보고서 v1.1 15장) — 수용 기준: 스키마 검증 실패 상태로 저장된 SBOM 0건(FFG-SBOM-002), 해시 불일치 패키지의
// 서명 0건(SBOM-003), 원산지 속성 누락은 발견으로 보인다(SEC-006·SBOM-007), VEX 판정은 SBOM으로 영향 Feature를 특정한다.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Db } from '../../src/kernel/db';
import { SbomService } from '../../src/domains/d06-qsec/vuln-monitor/sbom.service';
import { actor, bootApp, killV2 } from '../helpers';

const CSM = actor('usr-csm', 'SECURITY_OFFICER');

describe('SBOM·VEX (FFG-SBOM-002·003·007 · FFG-SEC-006)', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => {
    b = await bootApp({ at: '2026-10-12T01:00:00.000Z' });
  });
  afterAll(async () => {
    await b.app.close();
    for (const k of ['FF_SCHEDULER', 'GLEO_MODE']) delete process.env[k];
  });

  it('서명 게시본마다 CycloneDX 1.6 SBOM — 대상 해시 = 게시본 payloadHash, Feature SW·플랫폼 구성요소, 원산지 국가 누락은 발견', async () => {
    const http = b.http;
    const k = await killV2(http, { featureId: 'FEAT-00022', featureVersion: '1.0.0', vins: ['ego-01'], reason: 'SBOM 시험', confirm: 'FEAT-00022' });
    const raw = (await http().get(`/api/publications/${k.publicationId}`).expect(200)).body;
    const pub = raw.publication ?? raw;
    const list = (await http().get('/api/sbom?featureId=FEAT-00022').expect(200)).body.items;
    const s = list.find((x: any) => x.publicationId === k.publicationId);
    expect(s).toMatchObject({ featureVersion: '1.0.0', packageHash: pub.signature.payloadHash.replace('sha256:', '') });
    expect(s.originFindings.length).toBeGreaterThan(0);
    expect(s.originFindings.join()).toMatch(/country 없음/); // 데이터셋에 국가가 없다 — 값을 만들지 않는다
    const bom = (await http().get(`/api/sbom/${encodeURIComponent(s.serial)}`).expect(200)).body;
    expect(bom).toMatchObject({ bomFormat: 'CycloneDX', specVersion: '1.6', metadata: { component: { 'bom-ref': k.publicationId } } });
    expect(bom.components.map((c: any) => c.name)).toContain('ff-platform');
    expect(bom.components.some((c: any) => c['bom-ref'].startsWith('SW-'))).toBe(true);
  });

  it('해시가 맞지 않거나 스키마를 어긴 SBOM은 저장하지 않는다 — 저장된 SBOM은 고칠 수 없다', () => {
    const svc = b.get(SbomService);
    const db = b.get<Db>(DB);
    const n = () => db.get<{ n: number }>('SELECT count(*) AS n FROM sbom')!.n;
    const before = n();
    const good = svc.build('PUB-99999', 'FEAT-00022', '1.0.0', 'sha256:' + 'a'.repeat(64));
    expect(() => svc.attach('PUB-99999', 'FEAT-00022', '1.0.0', good, 'b'.repeat(64))).toThrow(/서명하지 않는다/);
    expect(() => svc.attach('PUB-99999', 'FEAT-00022', '1.0.0', { ...good, specVersion: '1.5' } as any, 'a'.repeat(64))).toThrow(/스키마 위반/);
    expect(n()).toBe(before);
    expect(() => db.run('UPDATE sbom SET doc = ?', '{}')).toThrow(/추가만/);
  });

  it('VEX: Feature SW에 affected → 영향 Feature 특정·보안 조치 권고, not_affected는 근거 없으면 400', async () => {
    const http = b.http;
    const bom = (await http().get(`/api/sbom/${encodeURIComponent((await http().get('/api/sbom?featureId=FEAT-00022').expect(200)).body.items[0].serial)}`).expect(200)).body;
    const sw = bom.components.find((c: any) => c['bom-ref'].startsWith('SW-'))['bom-ref'];
    await http().post('/api/vex').set(CSM).send({ vulnId: 'CVE-2026-0001', affects: [sw], state: 'not_affected' }).expect(400);
    await http().post('/api/vex').set(actor('x', 'OPERATOR')).send({ vulnId: 'CVE-2026-0001', affects: [sw], state: 'affected' }).expect(403);
    const r = (await http().post('/api/vex').set(CSM).send({ vulnId: 'CVE-2026-0001', affects: [sw], state: 'affected', detail: '시험 공지' }).expect(201)).body;
    expect(r.impact).toMatchObject({ action: 'SECURITY_KILL_OR_UPDATE', features: expect.arrayContaining([expect.objectContaining({ featureId: 'FEAT-00022', featureVersion: '1.0.0' })]) });
    const ev = (await http().get('/api/events?type=vex.recorded').expect(200)).body.items.at(-1).payload;
    expect(ev).toMatchObject({ vulnId: 'CVE-2026-0001', state: 'affected' });
    expect((await http().get('/api/vex').expect(200)).body.items).toHaveLength(1);
  });
});
