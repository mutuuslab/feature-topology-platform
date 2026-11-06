// 감사·이력 조회 보강 (기능명세서 B4, D01-10·D04-04·D06-04) — 정책 조회 감사, 수정 항목·변경 전후 값, 정책 운영 현황,
// 기간 조건(감사·이벤트), 감사·검증 이력 내보내기(CSV·JSON, 행 체인 해시·파일 SHA-256·서명, 민감 값 가림).
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal' });
import { createHash, createPublicKey, verify } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalJson, exportSignedPayload, parseExportFile, SENSITIVE_MASK } from '@ff/contracts';
import type { Actor } from '../../src/kernel/actor';
import { AuditService } from '../../src/kernel/audit.service';
import { DB, type Db } from '../../src/kernel/db';
import { PkiService } from '../../src/domains/d06-qsec/pki-kms/pki.service';
import { actor, bootApp } from '../helpers';

const OWNER = actor('usr-author', 'FEATURE_AUTHOR');
const VIEWER = actor('usr-viewer', 'AUDITOR');
const OPSLEAD = actor('usr-opslead', 'OPS_LEAD');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('감사·이력 조회 보강 (B4)', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  const http = () => b.http();
  let pid: string;
  beforeAll(async () => {
    b = await bootApp({ at: '2026-11-06T01:00:00.000Z' });
    const c = await http().post('/api/policies').set(OWNER).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Flag', flagKey: 'care_00022_flag', description: '감사 시험', safeDefault: false, entitlementCatalogId: 'CAT-00019' }).expect(201);
    pid = c.body.policyId;
  });
  afterAll(async () => {
    await b.app.close();
    delete process.env.FF_SCHEDULER;
    delete process.env.GLEO_MODE;
  });

  it('FR-AUD-001-001 정책 조회 → 조회자·정책·일시 감사, 같은 사람의 10분 안 재조회는 한 번', async () => {
    await http().get(`/api/policies/${pid}`).set(VIEWER).expect(200);
    await http().get(`/api/policies/${pid}`).set(VIEWER).expect(200);
    await http().get(`/api/policies/${pid}`).set(OPSLEAD).expect(200);
    const views = (await http().get(`/api/audit?target=${pid}&action=POLICY_VIEW`).expect(200)).body.items;
    expect(views.map((v: any) => v.actorId).sort()).toEqual(['usr-opslead', 'usr-viewer']);
    expect(views[0].at).toBe('2026-11-06T01:00:00.000Z');
  });

  it('FR-AUD-001-002·FR-EVT-001-004 정책 수정 → 수정 항목·변경 전후 값을 감사와 이벤트 이력에', async () => {
    await http().patch(`/api/policies/${pid}`).set(OWNER).send({ description: '감사 시험 — 고침', rollout: { mode: 'COHORT', basisPoints: 500 } }).expect(200);
    const a = (await http().get(`/api/audit?target=${pid}&action=POLICY_UPDATE`).expect(200)).body.items[0];
    expect(a.after.changes).toEqual(
      expect.arrayContaining([
        { field: 'description', before: '감사 시험', after: '감사 시험 — 고침', masked: false },
        { field: 'rollout.basisPoints', before: 10000, after: 500, masked: false },
        { field: 'rollout.mode', before: 'ALL', after: 'COHORT', masked: false },
      ]),
    );
    const ev = (await http().get(`/api/events?type=policy.updated&aggregate=${pid}`).expect(200)).body.items[0];
    expect(ev.payload).toMatchObject({ policyId: pid, revision: 2 });
    expect(ev.payload.changes).toHaveLength(a.after.changes.length);
    // Feature 설정 변경도 변경 전후 값을 이벤트에 싣는다
    const f = (await http().get('/api/features?latestOnly=true&lifecycle=PROPOSED').expect(200)).body.items[0];
    expect(f).toBeTruthy();
    await http().patch(`/api/features/${f.featureId}/versions/${f.version}`).set(OWNER).send({ description: '변경 전후 값 시험 설명' }).expect(200);
    const fe = (await http().get(`/api/events?type=feature.updated&aggregate=${f.featureId}@${f.version}`).expect(200)).body.items.at(-1);
    expect(fe.payload.changes).toEqual([{ field: 'description', before: expect.any(String), after: '변경 전후 값 시험 설명', masked: false }]);
  });

  it('FR-AUD-002-001 정책 운영 현황 — 정책별 조회·수정·승인·배포 횟수와 최종 행위 일시', async () => {
    const s = (await http().get(`/api/audit/policy-stats?policyId=${pid}`).expect(200)).body.items[0];
    expect(s).toMatchObject({ policyId: pid, views: 2, updates: 2, approvals: 0, deploys: 0, lastAt: '2026-11-06T01:00:00.000Z' });
    const all = (await http().get('/api/audit/policy-stats').expect(200)).body.items;
    expect(all.length).toBeGreaterThan(1);
    expect(all.every((x: any) => typeof x.views === 'number')).toBe(true);
  });

  it('FR-AUD-002-002·FR-EVT-002-004 기간 조건 — 일치하는 이력이 없으면 빈 목록, 읽을 수 없는 기간은 400', async () => {
    expect((await http().get(`/api/audit?target=${pid}&from=2026-11-06&to=2026-11-06`).expect(200)).body.items.length).toBeGreaterThan(0);
    expect((await http().get(`/api/audit?target=${pid}&from=2030-01-01`).expect(200)).body.items).toEqual([]);
    await http().get('/api/audit?from=어제').expect(400);
    expect((await http().get('/api/events?from=2026-11-06&to=2026-11-06&type=policy.created').expect(200)).body.items.length).toBe(1);
    expect((await http().get('/api/events?to=2020-01-01').expect(200)).body.items).toEqual([]);
    await http().get('/api/events?from=2026-11-07&to=2026-11-01').expect(400);
  });

  it('FR-AUD-002-003 감사 내보내기(CSV) — # 머리 줄에 범위·행 수·SHA-256·서명, 데이터 해시와 서명이 맞다, 내보낸 사실도 감사에', async () => {
    await http().get('/api/audit/export?format=csv').set(OWNER).expect(403); // 작성자는 받을 수 없다
    const r = await http().get(`/api/audit/export?format=csv&from=2026-11-06&targetPrefix=${pid}`).set(VIEWER).buffer(true).parse((res: any, cb: any) => {
      let s = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (s += c));
      res.on('end', () => cb(null, s));
    }).expect(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="FF_audit_2026-11-06_now_/);
    const text = (r.body as string).replace(new RegExp('^' + String.fromCharCode(0xfeff)), '');
    const lines = text.split('\r\n');
    const head = lines.filter((l) => l.startsWith('#'));
    const data = lines.filter((l) => !l.startsWith('#')).join('\r\n');
    expect(data.split('\r\n')[0]).toBe('id,at,actorId,actorRole,action,target,result,reason,before,after,changes,prevHash,hash');
    const sum = /# sha256=([0-9a-f]{64})/.exec(head.join('\n'))![1];
    expect(sha(data)).toBe(sum);
    expect(r.headers['x-ff-export-sha256']).toBe(sum);
    const rows = Number(/rows=(\d+)/.exec(head.join('\n'))![1]);
    expect(rows).toBe(4); // 생성·조회 2·수정
    const [alg, keyId, signature] = String(r.headers['x-ff-export-signature']).split(':');
    expect(alg).toBe('Ed25519');
    // 기간 날짜는 한국 시간 — 11-06 0시(KST) = 11-05 15:00Z
    const period = { from: '2026-11-05T15:00:00.000Z', to: null };
    const generatedAt = /generatedAt=(\S+)/.exec(head.join('\n'))![1];
    const pki = b.get(PkiService);
    const payload = exportSignedPayload({ kind: 'audit', generatedAt, generatedBy: 'usr-viewer', period, filters: { targetPrefix: pid }, rows, sha256: sum });
    const sig = pki.sign(payload, 'export');
    expect(sig.keyId).toBe(keyId);
    expect(pki.verify(payload, { ...sig, signature }, undefined, 'export').valid).toBe(true);
    // 제3자 검증 — 서버 내부 없이 파일과 공개 키 목록(GET /api/pki/keys)만으로 해시·서명을 확인한다(하네스 리뷰)
    const parsed = parseExportFile(r.body as string);
    expect(parsed.mismatches).toEqual([]);
    expect(parsed.payload).toEqual(payload);
    expect(sha(parsed.data)).toBe(parsed.payload.sha256);
    const key = (await http().get('/api/pki/keys').expect(200)).body.items.find((k: any) => k.keyId === parsed.signature.keyId);
    expect(key.purpose).toBe('export');
    const signedHash = 'sha256:' + sha(canonicalJson(parsed.payload));
    expect(parsed.payloadHash).toBe(signedHash);
    expect(verify(null, Buffer.from(signedHash), createPublicKey(key.publicKeyPem), Buffer.from(parsed.signature.signature, 'base64'))).toBe(true);
    // 머리 줄의 내보낸 사람만 바꾼 파일은 어긋남으로 잡힌다
    expect(parseExportFile((r.body as string).replace('generatedBy=usr-viewer', 'generatedBy=usr-opslead')).mismatches.length).toBe(1);
    // 행마다 체인 해시
    expect(data.split('\r\n')[1].split(',').at(-1)).toMatch(/^[0-9a-f]{64}$/);
    const ex = (await http().get('/api/audit?action=AUDIT_EXPORT').expect(200)).body.items[0];
    expect(ex).toMatchObject({ actorId: 'usr-viewer', after: { rows: 4, sha256: sum } });
  });

  it('감사 내보내기(JSON) — 민감 값(금액)은 가리고 변경 전후 값은 바뀐 사실만, 체인 끝은 마지막 행 해시', async () => {
    const audit = b.get(AuditService);
    const who: Actor = { id: 'usr-steward', role: 'REFDB_ADMIN', correlationId: 'audit-export-test' };
    b.get<Db>(DB).tx(() => audit.record(who, 'REFDB_CHANGE_DECIDE', 'BC-TEST-001', { before: { benchmarkEur: 1200, name: '가' }, after: { benchmarkEur: 1500, name: '나' }, componentId: 'D01-01' }));
    const r = await http().get('/api/audit/export?format=json&targetPrefix=BC-TEST').set(VIEWER).expect(200);
    const env = JSON.parse(typeof r.body === 'object' && r.body.rows ? JSON.stringify(r.body) : r.text);
    expect(env).toMatchObject({ kind: 'audit', generatedBy: 'usr-viewer', filters: { targetPrefix: 'BC-TEST' }, integrity: { rows: 1 } });
    const row = env.rows[0];
    expect(row.before).toEqual({ benchmarkEur: SENSITIVE_MASK, name: '가' });
    expect(row.changes).toEqual([
      { field: 'benchmarkEur', before: SENSITIVE_MASK, after: SENSITIVE_MASK, masked: true },
      { field: 'name', before: '가', after: '나', masked: false },
    ]);
    expect(env.integrity.chainTo).toBe(row.hash);
    expect(env.integrity.sha256).toBe(sha(canonicalJson(env.rows)));
    await http().get('/api/audit/export?format=xml').set(VIEWER).expect(400);
  });

  it('FR-VHM-002-003 검증 이력 내보내기 — 기간 지정, 정책별, 서명', async () => {
    await http().post(`/api/policies/${pid}/validate`).set(OWNER).send({}).expect(200);
    const r = await http().get(`/api/policies/validations/export?format=json&from=2026-11-01&policyId=${pid}`).set(OPSLEAD).expect(200);
    const env = JSON.parse(typeof r.body === 'object' && r.body.rows ? JSON.stringify(r.body) : r.text);
    expect(env).toMatchObject({ kind: 'validations', integrity: { rows: 1 }, filters: { policyId: pid } });
    expect(env.rows[0]).toMatchObject({ policyId: pid, policyRevision: 2 });
    expect(env.rows[0].results.length).toBe(8);
    expect(env.integrity.signature.alg).toBe('Ed25519');
    const empty = await http().get('/api/policies/validations/export?format=json&from=2030-01-01').set(OPSLEAD).expect(200);
    expect(JSON.parse(empty.text).rows).toEqual([]);
  });
});

