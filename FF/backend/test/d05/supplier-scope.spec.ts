import type { INestApplication } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { actor, bootApp } from '../helpers';
import { FeatureRepo } from '../../src/domains/d01-policy/repos';

let app: INestApplication;
let http: () => any;
const IMPL = actor('usr-p13-scope', 'IMPLEMENTER');
beforeAll(async () => {
  ({ app, http } = await bootApp());
  const repo = app.get(FeatureRepo);
  repo.insert({ ...repo.get('FEAT-00010', '2.0.0')!, version: '3.0.0', lifecycle: 'DEVELOPING', baselineId: null, gateRecordIds: [] }, { createdBy: 'usr-p13-scope', createdAt: '2026-11-08T00:00:00Z' });
});
afterAll(() => app.close());

it('현재 SW 버전으로 협력사 책임 범위와 계약 누락을 조회한다', async () => {
  await http().get('/api/features/FEAT-00010/versions/9.0.0/supplier-scope').expect(404);
  const r = (await http().get('/api/features/FEAT-00010/versions/2.0.0/supplier-scope').expect(200)).body;
  const b = r.suppliers.find((s: any) => s.supplier === 'Tier1-B');
  expect(b.relations).toContain('USED_SW');
  expect(b.sw).toEqual(expect.arrayContaining([expect.objectContaining({ swId: 'SW-DMS-APP', version: '2.0.0' })]));
  expect(b.gaps).toEqual(expect.arrayContaining(['NO_PACKAGE', 'NO_CRITERIA', 'NO_MAPPING']));
  expect(r.contractGaps).toEqual(expect.arrayContaining([expect.objectContaining({ supplier: 'Tier1-B', kind: 'NO_PACKAGE' })]));
  expect(r.directory).toMatchObject({ mode: 'UNCONFIGURED', source: 'UNCONFIRMED' });
  expect(r.traceEvidence).toMatchObject({ scope: 'FEATURE_ID', versionBound: false });
});

it('다른 Feature Version 패키지와 미검증 시험 신고를 완료 근거로 쓰지 않는다', async () => {
  const p = (await http().post('/api/supplier-packages').set(IMPL).send({ featureId: 'FEAT-00010', featureVersion: '2.0.0', supplier: 'Tier1-B', version: '2.0.0' }).expect(201)).body;
  const evidence = { unitPassed: 10, unitTotal: 10, integrationPassed: 10, integrationTotal: 10, coveragePct: 100, buildStatus: 'SUCCESS', buildWarnings: 0, evidenceIds: ['P13-REPORT-01'] };
  await http().post('/api/supplier-packages/' + p.packageId + '/artifacts').set(IMPL).send({ type: 'TEST_EVIDENCE', title: '시험 결과 신고', version: '2.0.0', uri: 'https://supplier.example/reports/test', checksum: 'sha256:' + 'a'.repeat(64), testEvidence: evidence }).expect(201);
  await http().post('/api/supplier-packages').set(IMPL).send({ featureId: 'FEAT-00010', featureVersion: '3.0.0', supplier: 'Tier1-B', version: '3.0.0' }).expect(201);
  const r = (await http().get('/api/features/FEAT-00010/versions/2.0.0/supplier-scope').expect(200)).body;
  const b = r.suppliers.find((s: any) => s.supplier === 'Tier1-B');
  expect(b.latestPackage.packageId).toBe(p.packageId);
  expect(b.evidence.status).toBe('MISSING');
  expect(b.evidence.evidenceIds).toEqual([]);
  const text = JSON.stringify({ package: { featureId: 'FEAT-00010', featureVersion: '2.0.0', packageVersion: '2.0.0' }, testEvidence: evidence });
  const saved = (await http().post('/api/supplier-packages/' + p.packageId + '/artifacts').set(IMPL).send({ type: 'TEST_EVIDENCE', title: '본문 보관 시험 결과', version: '2.0.0', uri: 'https://supplier.example/reports/test', checksum: 'sha256:' + createHash('sha256').update(text).digest('hex'), text, testEvidence: evidence }).expect(201)).body;
  expect(saved.integrity).toBe('VERIFIED');
  const verified = (await http().get('/api/features/FEAT-00010/versions/2.0.0/supplier-scope').expect(200)).body.suppliers.find((s: any) => s.supplier === 'Tier1-B');
  expect(verified.latestPackage.packageId).toBe(p.packageId);
  expect(verified.evidence).toMatchObject({ featureVersion: '2.0.0', verification: 'VERIFIED', source: 'SUPPLIER_PACKAGE_BODY', evidenceIds: ['P13-REPORT-01'], coveragePct: 100 });
});
