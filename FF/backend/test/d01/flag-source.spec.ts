// 개발자/CI 소스 스냅샷 — 권한·엄격한 계약·멱등/충돌·최신 스캔의 삭제 반영·감사/outbox 원자성·실제 게시본 집계.
import type { INestApplication } from '@nestjs/common';
import { canonicalJson, FeatureFlagRow, FlagSourceManifest, type Policy, type Publication } from '@ff/contracts';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FlagSourceService } from '../../src/domains/d01-policy/policy-store/flag-source.service';
import { PolicyRepo } from '../../src/domains/d01-policy/policy-repos';
import { DB, type Db } from '../../src/kernel/db';
import { EventService } from '../../src/kernel/event.service';
import { actor, bootApp } from '../helpers';

const DEV = actor('usr-source-dev', 'IMPLEMENTER');
const usage = (flagKey = 'care_00022_signal', path = 'src/distance.ts', line = 8) => ({ flagKey, path, line, symbol: 'client.getBooleanValue', method: 'getBooleanValue', safeDefault: 'EXPLICIT_FALSE', contentHash: `sha256:${'c'.repeat(64)}` });
const manifest = (name: string, overrides: Record<string, unknown> = {}) => ({ format: 'ff-flag-source/v1', provider: 'GITLAB', repository: `https://gitlab.example.test/vehicle/${name}`, commit: 'a'.repeat(40), scannedAt: '2026-11-05T00:00:00.000Z', filesScanned: 1, unresolvedCalls: 0, usages: [usage()], ...overrides });

describe('Git Flag 소스 가져오기 (D01-06)', () => {
  let app: INestApplication;
  let http: Awaited<ReturnType<typeof bootApp>>['http'];
  let db: Db;
  let sources: FlagSourceService;
  let events: EventService;
  let policies: PolicyRepo;
  beforeAll(async () => {
    const boot = await bootApp();
    ({ app, http } = boot);
    db = boot.get<Db>(DB);
    sources = boot.get(FlagSourceService);
    events = boot.get(EventService);
    policies = boot.get(PolicyRepo);
  });
  afterAll(() => app.close());

  it('쓰기 신원과 구현 담당 역할을 요구한다 — 서비스 직접 호출도 같은 역할 검사', async () => {
    const body = manifest('denied');
    await http().post('/api/flag-sources').send(body).expect(401);
    for (const role of ['FEATURE_AUTHOR', 'FEATURE_APPROVER', 'AUDITOR']) await http().post('/api/flag-sources').set(actor('usr-not-dev', role)).send(body).expect(403);
    expect(() => sources.import({ id: 'usr-not-dev', role: 'AUDITOR', roles: ['IMPLEMENTER'], correlationId: 'test' }, body)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(db.get<{ n: number }>('SELECT count(*) AS n FROM flag_source_manifest WHERE repository = ?', body.repository)!.n).toBe(0);
  });

  it('경로·저장소·커밋·파일 해시 일관성과 추가 필드를 HTTP 및 서비스에서 거부한다', async () => {
    const original = manifest('validation');
    const bad = [
      { ...original, token: 'unwanted' },
      { ...original, repository: 'https://user:secret@gitlab.example.test/a/b' },
      { ...original, repository: `${original.repository}?token=secret` },
      { ...original, commit: 'abc1234' },
      { ...original, usages: [{ ...usage(), path: '../secret.ts' }] },
      { ...original, usages: [{ ...usage(), path: 'C:/secret.ts' }] },
      { ...original, usages: [{ ...usage(), line: 0 }] },
      { ...original, usages: [{ ...usage(), contentHash: 'sha256:short' }] },
      { ...original, usages: [usage(), { ...usage(), line: 9, contentHash: `sha256:${'d'.repeat(64)}` }] },
    ];
    for (const body of bad) await http().post('/api/flag-sources').set(DEV).send(body).expect(400);
    expect(() => sources.import({ id: 'usr-source-dev', role: 'IMPLEMENTER', correlationId: 'test' }, bad[0])).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    expect(db.get<{ n: number }>('SELECT count(*) AS n FROM flag_source_manifest WHERE repository = ?', original.repository)!.n).toBe(0);
  });

  it('정규 내용·작성자를 읽어 돌려주고, 키 순서·주소 표기만 다른 재시도는 같은 기록이다', async () => {
    const body = manifest('idempotent');
    const first = (await http().post('/api/flag-sources').set(DEV).send(body).expect(201)).body;
    expect(first).toMatchObject({ manifest: FlagSourceManifest.parse(body), importedBy: 'usr-source-dev', provenance: 'CI_IMPORT', latest: true });
    expect(first.contentHash).toBe('sha256:' + createHash('sha256').update(canonicalJson(first.manifest)).digest('hex'));
    const equivalent = Object.fromEntries(Object.entries({ ...body, repository: `${body.repository}.git/`, commit: 'A'.repeat(40), scannedAt: '2026-11-05T09:00:00+09:00' }).reverse());
    const duplicate = (await http().post('/api/flag-sources').set(actor('usr-other-dev', 'IMPLEMENTER')).send(equivalent).expect(201)).body;
    expect(duplicate).toEqual(first);
    const read = (await http().get('/api/flag-sources').expect(200)).body.find((r: { manifestId: string }) => r.manifestId === first.manifestId);
    expect(read).toEqual(first);
    expect(db.get<{ n: number }>('SELECT count(*) AS n FROM flag_source_manifest WHERE repository = ?', body.repository)!.n).toBe(1);
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM audit WHERE action = 'FLAG_SOURCE_IMPORT' AND target = ?", first.manifestId)!.n).toBe(1);
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM events WHERE type = 'flag.sources.imported' AND aggregate = ?", first.manifestId)!.n).toBe(1);
    const event = JSON.parse(db.get<{ payload: string }>("SELECT payload FROM events WHERE type = 'flag.sources.imported' AND aggregate = ?", first.manifestId)!.payload);
    expect(event).toMatchObject({ repository: body.repository, commit: body.commit, contentHash: first.contentHash, provenance: 'CI_IMPORT', usages: 1 });
    await http().post('/api/flag-sources').set(DEV).send({ ...body, usages: [usage('care_00022_signal', 'src/distance.ts', 9)] }).expect(409);
    const rescan = (await http().post('/api/flag-sources').set(DEV).send({ ...body, scannedAt: '2026-11-06T00:00:00.000Z' }).expect(201)).body;
    expect(rescan).toEqual(first);
    expect(db.get<{ n: number }>('SELECT count(*) AS n FROM flag_source_manifest WHERE repository = ?', body.repository)!.n).toBe(1);
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM audit WHERE action = 'FLAG_SOURCE_IMPORT' AND target = ?", first.manifestId)!.n).toBe(1);
    expect(() => db.run('UPDATE flag_source_manifest SET imported_by = ? WHERE manifest_id = ?', 'tampered', first.manifestId)).toThrow();
    expect(() => db.run('DELETE FROM flag_source_manifest WHERE manifest_id = ?', first.manifestId)).toThrow();
  });

  it('최신 스캔에서 없어진 사용처는 현재 연결에서 사라지고, 나중에 가져온 옛 스캔은 되돌리지 않는다', async () => {
    const body = manifest('latest-removal', { usages: [usage('source_removed'), usage('source_kept', 'src/distance.ts', 9)] });
    await http().post('/api/flag-sources').set(DEV).send(body).expect(201);
    const newer = { ...body, commit: 'b'.repeat(40), scannedAt: '2026-11-07T00:00:00.000Z', usages: [usage('source_kept')] };
    await http().post('/api/flag-sources').set(DEV).send(newer).expect(201);
    await http().post('/api/flag-sources').set(DEV).send({ ...body, commit: 'd'.repeat(40), scannedAt: '2026-11-06T00:00:00.000Z' }).expect(201);
    const flags = (await http().get('/api/feature-flags').expect(200)).body as FeatureFlagRow[];
    expect(flags.some((f) => f.flagKey === 'source_removed')).toBe(false);
    expect(flags.find((f) => f.flagKey === 'source_kept')).toMatchObject({ featureId: null, version: null, featureName: null, policy: null, publication: null, sources: [expect.objectContaining({ commit: newer.commit, provenance: 'CI_IMPORT' })] });
    const history = (await http().get('/api/flag-sources').expect(200)).body.filter((r: { manifest: { repository: string } }) => r.manifest.repository === body.repository);
    expect(history).toHaveLength(3);
    expect(history.filter((r: { latest: boolean }) => r.latest).map((r: { manifest: { commit: string } }) => r.manifest.commit)).toEqual([newer.commit]);
    await http().post('/api/flag-sources').set(DEV).send({ ...newer, commit: 'e'.repeat(40), scannedAt: '2026-11-08T00:00:00.000Z', filesScanned: 0, usages: [] }).expect(201);
    expect((await http().get('/api/feature-flags').expect(200)).body.some((f: FeatureFlagRow) => f.flagKey === 'source_kept')).toBe(false);
  });

  it('저장소별 최신 사용처를 모으고 Feature·version 필터와 명시적인 미연결 행을 제공한다', async () => {
    const body = manifest('linked', { provider: 'GITHUB', usages: [usage(), usage('source_unmatched', 'src/한 글#?.ts', 4)], filesScanned: 2 });
    await http().post('/api/flag-sources').set(DEV).send(body).expect(201);
    await http().post('/api/flag-sources').set(DEV).send(manifest('second-repo', { commit: 'f'.repeat(64) })).expect(201);
    const rows = (await http().get('/api/feature-flags?featureId=FEAT-00022&version=1.0.0').expect(200)).body as FeatureFlagRow[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(FeatureFlagRow.safeParse(row).success).toBe(true);
      expect(row).toMatchObject({ featureId: 'FEAT-00022', version: '1.0.0' });
    }
    const signal = rows.find((r) => r.flagKey === 'care_00022_signal')!;
    expect(signal.featureName).toBeTruthy();
    expect(signal.policy).toMatchObject({ status: 'DEPLOYED', controlPoint: 'Signal' });
    expect(signal.sources.filter((s) => s.repository === body.repository)).toHaveLength(1);
    expect(signal.sources.find((s) => s.repository.endsWith('/second-repo'))?.commit).toHaveLength(64);
    const unmatched = (await http().get('/api/feature-flags').expect(200)).body.find((r: FeatureFlagRow) => r.flagKey === 'source_unmatched');
    expect(unmatched).toMatchObject({ featureId: null, version: null, featureName: null, policy: null, publication: null });
    expect(unmatched.sources[0].url).toBe(`${body.repository}/blob/${body.commit}/src/%ED%95%9C%20%EA%B8%80%23%3F.ts#L4`);
    expect(rows.some((r) => r.flagKey === 'source_unmatched')).toBe(false);
    expect((await http().get('/api/feature-flags?featureId=FEAT-99999').expect(200)).body).toEqual([]);
    await http().get('/api/feature-flags?featureId=bad').expect(400);
    await http().get('/api/feature-flags?version=latest').expect(400);
  });

  it('차량 확인 수는 같은 Feature·version·Flag의 최신 게시본에서만 온다 — 정책 상태로 추정하지 않는다', async () => {
    const p = policies.byFlag('care_00022_signal')[0];
    const insert = (id: string, at: string, policy: Policy, extra: Partial<Publication['payload']> = {}, status: Publication['status'] = 'PARTIAL') => {
      const scope = `flag:${policy.flagKey}`;
      const sequence = (db.get<{ n: number }>('SELECT max(sequence) AS n FROM publication WHERE scope_key = ?', scope)?.n ?? 0) + 1;
      const publication: Publication = {
        publicationId: id, kind: 'POLICY', status, confirmed: status === 'CONFIRMED' ? 8 : 3, denominator: 8, nodes: [], ackOnly: [], closedAt: null,
        payload: { publicationId: id, kind: 'POLICY', sequence, featureId: policy.featureId, featureVersion: policy.featureVersion, flagKey: policy.flagKey, policy, kill: null, targets: [], desired: policy.contentHash, issuedAt: at, ...extra },
        signature: { keyId: 'KEY-0001', alg: 'Ed25519', payloadHash: `sha256:${'a'.repeat(64)}`, signature: 'test-projection-only' },
        campaignId: null, channel: 'OTA', createdBy: 'usr-test', createdAt: at, deadlineAt: at,
      };
      db.run('INSERT INTO publication (publication_id, kind, status, scope_key, sequence, created_at, doc) VALUES (?, ?, ?, ?, ?, ?, ?)', id, 'POLICY', publication.status, scope, sequence, at, JSON.stringify(publication));
    };
    insert('PUB-99001', '2030-01-01T00:00:00.000Z', p);
    insert('PUB-99002', '2030-01-02T00:00:00.000Z', { ...p, featureVersion: '9.0.0' });
    insert('PUB-99003', '2030-01-03T00:00:00.000Z', { ...p, featureId: 'FEAT-99999' });
    insert('PUB-99004', '2030-01-04T00:00:00.000Z', p, { featureVersion: '9.0.0' });
    const row = (await http().get('/api/feature-flags?featureId=FEAT-00022&version=1.0.0').expect(200)).body.find((f: FeatureFlagRow) => f.flagKey === p.flagKey);
    expect(row.publication).toEqual({ publicationId: 'PUB-99001', status: 'PARTIAL', confirmed: 3, denominator: 8 });
    insert('PUB-99005', '2030-01-05T00:00:00.000Z', p, {}, 'CONFIRMED');
    const fresh = { ...p, policyId: policies.nextId(), status: 'DRAFT' as const, revision: 1 };
    db.tx(() => policies.insert(fresh));
    const changedPolicy = (await http().get('/api/feature-flags?featureId=FEAT-00022&version=1.0.0').expect(200)).body.find((f: FeatureFlagRow) => f.flagKey === p.flagKey);
    expect(changedPolicy).toMatchObject({ policy: { policyId: fresh.policyId, status: 'DRAFT' }, publication: null });
    insert('PUB-99006', '2030-01-06T00:00:00.000Z', fresh, {}, 'CONFIRMED');
    db.tx(() => policies.update({ ...fresh, revision: 2 }, { kind: 'UPDATE', by: 'usr-source-dev', at: '2030-01-07T00:00:00.000Z' }));
    const changedRevision = (await http().get('/api/feature-flags?featureId=FEAT-00022&version=1.0.0').expect(200)).body.find((f: FeatureFlagRow) => f.flagKey === p.flagKey);
    expect(changedRevision).toMatchObject({ policy: { policyId: fresh.policyId, revision: 2 }, publication: null });
    const noPublication = { ...p, policyId: policies.nextId(), flagKey: 'source_no_publication', revision: 1 };
    db.tx(() => policies.insert(noPublication));
    const absent = (await http().get('/api/feature-flags?featureId=FEAT-00022&version=1.0.0').expect(200)).body.find((f: FeatureFlagRow) => f.flagKey === noPublication.flagKey);
    expect(absent).toMatchObject({ policy: { status: 'DEPLOYED' }, publication: null, sources: [] });
  });

  it('이벤트 훅 실패 시 소스·감사·이벤트를 함께 롤백한다', async () => {
    const body = manifest('rollback');
    const before = db.get<{ n: number }>("SELECT count(*) AS n FROM audit WHERE action = 'FLAG_SOURCE_IMPORT'")!.n;
    events.onPublish((event) => { if (event.type === 'flag.sources.imported' && (event.payload as { repository: string }).repository === body.repository) throw new Error('injected outbox failure'); });
    await http().post('/api/flag-sources').set(DEV).send(body).expect(500);
    expect(db.get<{ n: number }>('SELECT count(*) AS n FROM flag_source_manifest WHERE repository = ?', body.repository)!.n).toBe(0);
    expect(db.get<{ n: number }>("SELECT count(*) AS n FROM audit WHERE action = 'FLAG_SOURCE_IMPORT'")!.n).toBe(before);
    expect(db.all<{ payload: string }>("SELECT payload FROM events WHERE type = 'flag.sources.imported'").some((r) => JSON.parse(r.payload).repository === body.repository)).toBe(false);
  });

  it('실제 데모 스냅샷은 DEMO로 표시되고 부팅 재호출은 중복을 만들지 않는다', () => {
    const first = sources.list().filter((r) => r.provenance === 'DEMO');
    expect(first.length).toBeGreaterThan(0);
    const fixture = FlagSourceManifest.parse(JSON.parse(readFileSync(join(__dirname, '../../../data/fixtures/demo/flag-sources.json'), 'utf8')));
    expect(first[0].manifest).toEqual(fixture);
    expect(first[0].manifest.usages.length).toBeGreaterThan(0);
    sources.onApplicationBootstrap();
    expect(sources.list().filter((r) => r.provenance === 'DEMO')).toEqual(first);
    const append = vi.spyOn(sources as any, 'append');
    const seedBefore = process.env.FF_SEED;
    const envBefore = process.env.FF_ENV;
    try {
      process.env.FF_SEED = 'none';
      sources.onApplicationBootstrap();
      process.env.FF_SEED = 'v0.81';
      process.env.FF_ENV = 'production';
      sources.onApplicationBootstrap();
      expect(append).not.toHaveBeenCalled();
    } finally {
      if (seedBefore === undefined) delete process.env.FF_SEED; else process.env.FF_SEED = seedBefore;
      if (envBefore === undefined) delete process.env.FF_ENV; else process.env.FF_ENV = envBefore;
      append.mockRestore();
    }
  });
});

describe('Git 소스 저장 근거 무결성', () => {
  it('DB 보호를 우회해 변조한 스냅샷을 조회·현재 연결·동일 커밋 재시도에서 신뢰하지 않는다', async () => {
    const { app, http, get } = await bootApp();
    try {
      const body = manifest('tamper');
      const saved = (await http().post('/api/flag-sources').set(DEV).send(body).expect(201)).body;
      const db = get<Db>(DB);
      db.exec('DROP TRIGGER flag_source_manifest_no_update');
      db.run('UPDATE flag_source_manifest SET doc = ? WHERE manifest_id = ?', canonicalJson({ ...body, usages: [usage('tampered_flag')] }), saved.manifestId);
      await http().get('/api/flag-sources').expect(500);
      await http().get('/api/feature-flags').expect(500);
      await http().post('/api/flag-sources').set(DEV).send(body).expect(500);
    } finally {
      await app.close();
    }
  });
});
