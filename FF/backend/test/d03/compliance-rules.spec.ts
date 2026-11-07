// 컴플라이언스 룰 레지스트리(D03-01, FR-CRC-001·002) — 등록 검증·중복 409·승인 요청/결정(작성자≠승인자)·수정 버전(Major.Minor)·변경 이력·
// 만료 자동 전환과 알림, 정책 배포 검증(적용 룰 선정·미충족 룰 ID·항목 저장)·배포 시점 재판정·검증 결과 조회.
Object.assign(process.env, { FF_SCHEDULER: 'manual', GLEO_MODE: 'internal', CARLA_RUNNER: require('node:path').resolve(__dirname, '..', 'fixtures', 'fake-carla', 'ffcarla_cli.mjs'), FF_EVIDENCE_DIR: require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'ff-cr-')) });
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Clock } from '../../src/kernel/clock';
import { ComplianceRuleService } from '../../src/domains/d03-safety/compliance-checker/compliance-rule.service';
import { actor, bootApp } from '../helpers';

const REG = actor('usr-steward', 'REGULATORY_OWNER');
const FSM = actor('usr-quality', 'SAFETY_OFFICER');
const CSM = actor('usr-integrator', 'SECURITY_OFFICER');
const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const RELEASE = actor('han.release', 'RELEASE_MANAGER');

afterAll(() => {
  for (const k of ['FF_SCHEDULER', 'GLEO_MODE', 'CARLA_RUNNER', 'FF_EVIDENCE_DIR']) delete process.env[k];
});

const body = (o: Record<string, unknown> = {}) => ({
  ruleId: 'CR-PRV-001',
  name: '차량 식별자 대상 지정 금지',
  type: 'PRIVACY',
  scope: { markets: ['KR'] },
  criteria: [{ check: 'NO_VEHICLE_ID_TARGETING' }],
  approverIds: ['usr-quality'],
  evidence: { url: 'https://www.law.go.kr/법령/개인정보보호법', docName: '개인정보 보호법', clause: '제23조', memo: '차량 식별자는 개인정보' },
  validFrom: '2026-01-01',
  validTo: null,
  ...o,
});

describe('컴플라이언스 룰 레지스트리 (FR-CRC-001)', () => {
  let app: INestApplication;
  let http: () => any;
  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: '2026-10-12T01:00:00.000Z' }));
  });
  afterAll(async () => {
    await app.close();
  });

  it('등록 — 필수 정보·근거·유효 기간, 승인 대기 1.0. 역할·형식·종료일·Feature 실재·승인 대상자에 작성자 금지를 확인한다', async () => {
    await http().post('/api/compliance-rules').set(AUTHOR).send(body()).expect(403);
    const bad = await http().post('/api/compliance-rules').set(REG).send(body({ evidence: { url: 'ftp://x.example/a', docName: '문서' } })).expect(400);
    expect(JSON.stringify(bad.body)).toMatch(/http:\/\/ 또는 https:\/\//);
    await http().post('/api/compliance-rules').set(REG).send(body({ validFrom: '2026-05-01', validTo: '2026-04-30' })).expect(400);
    const ghost = await http().post('/api/compliance-rules').set(REG).send(body({ scope: { markets: ['KR'], featureIds: ['FEAT-99999'] } })).expect(400);
    expect(ghost.body.error.message).toMatch(/FEAT-99999/);
    await http().post('/api/compliance-rules').set(REG).send(body({ approverIds: ['usr-steward'] })).expect(400);
    const r = await http().post('/api/compliance-rules').set(REG).send(body()).expect(201);
    expect(r.body).toMatchObject({ ruleId: 'CR-PRV-001', version: '1.0', status: 'PROPOSED', ownerId: 'usr-steward', validTo: null, evidence: { clause: '제23조' } });
  });

  it('룰 ID 중복은 저장하지 않는다(409)', async () => {
    const dup = await http().post('/api/compliance-rules').set(CSM).send(body({ name: '다른 이름' })).expect(409);
    expect(dup.body.error.message).toMatch(/CR-PRV-001/);
  });

  it('승인 요청 — 요청자·대상 룰 버전·승인 대상자·요청 일시를 저장하고 승인 대상자에게 알린다. 열린 요청이 있으면 409', async () => {
    const q = await http().post('/api/compliance-rules/CR-PRV-001/approval-requests').set(REG).send({ note: '개인정보 검토 요청' }).expect(201);
    expect(q.body).toMatchObject({ ruleId: 'CR-PRV-001', version: '1.0', requestedBy: 'usr-steward', approverIds: ['usr-quality'], requestedAt: '2026-10-12T01:00:00.000Z', status: 'OPEN' });
    await http().post('/api/compliance-rules/CR-PRV-001/approval-requests').set(REG).send({}).expect(409);
    const inbox = await http().get('/api/notifications').set(FSM).expect(200);
    expect(inbox.body.items.some((n: any) => n.eventType === 'compliance.rule.approval-requested' && n.title.includes('CR-PRV-001'))).toBe(true);
  });

  it('승인 — 지정된 승인 대상자 본인만, 승인 상태·승인자·일시·룰 버전을 저장한다', async () => {
    await http().post('/api/compliance-rules/CR-PRV-001/decision').set(CSM).send({ decision: 'APPROVE', reason: '검토 완료' }).expect(403);
    const d = await http().post('/api/compliance-rules/CR-PRV-001/decision').set(FSM).send({ decision: 'APPROVE', reason: '근거 조항 확인' }).expect(201);
    expect(d.body).toMatchObject({ status: 'APPROVED', version: '1.0', decidedBy: 'usr-quality', decidedAt: '2026-10-12T01:00:00.000Z' });
    const detail = (await http().get('/api/compliance-rules/CR-PRV-001').expect(200)).body;
    expect(detail.requests[0]).toMatchObject({ status: 'APPROVED', decidedBy: 'usr-quality', version: '1.0', reason: '근거 조항 확인' });
    expect(detail.versions).toEqual([expect.objectContaining({ version: '1.0', status: 'APPROVED', decidedBy: 'usr-quality' })]);
    await http().post('/api/compliance-rules/CR-PRV-001/decision').set(FSM).send({ decision: 'REJECT', reason: '다시' }).expect(409);
  });

  it('수정 — 소유자만, 부가 정보는 Minor·명칭/지역/기준은 Major, 승인된 룰은 승인 대기로, 이전 버전과 항목별 전후 값을 남긴다', async () => {
    await http().patch('/api/compliance-rules/CR-PRV-001').set(FSM).send({ name: '남의 룰', reason: '수정' }).expect(403);
    const m = await http().patch('/api/compliance-rules/CR-PRV-001').set(REG).send({ evidence: { url: 'https://www.law.go.kr/법령/개인정보보호법', docName: '개인정보 보호법', clause: '제23조·제28조의2', memo: null }, reason: '조항 추가' }).expect(200);
    expect(m.body).toMatchObject({ version: '1.1', status: 'PROPOSED' });
    const M = await http().patch('/api/compliance-rules/CR-PRV-001').set(REG).send({ scope: { markets: ['KR', 'EU'] }, reason: 'EU 확대' }).expect(200);
    expect(M.body).toMatchObject({ version: '2.0', status: 'PROPOSED' });
    await http().patch('/api/compliance-rules/CR-PRV-001').set(REG).send({ scope: { markets: ['KR', 'EU'] }, reason: '같은 값' }).expect(409);
    const detail = (await http().get('/api/compliance-rules/CR-PRV-001').expect(200)).body;
    expect(detail.versions.map((v: any) => [v.version, v.status])).toEqual([
      ['1.0', 'APPROVED'],
      ['1.1', 'PROPOSED'],
      ['2.0', 'PROPOSED'],
    ]);
    const ch = detail.changes.filter((c: any) => c.action === 'UPDATE');
    expect(ch.map((c: any) => [c.version, c.field, c.before, c.after])).toEqual([
      ['1.1', 'evidence.clause', '제23조', '제23조·제28조의2'],
      ['1.1', 'evidence.memo', '차량 식별자는 개인정보', null],
      ['1.1', 'status', 'APPROVED', 'PROPOSED'],
      ['2.0', 'scope.markets', ['KR'], ['KR', 'EU']],
    ]);
    expect(detail.changes.map((c: any) => c.action)).toEqual(expect.arrayContaining(['CREATE', 'REQUEST', 'APPROVE', 'UPDATE']));
    expect(ch.every((c: any) => c.by === 'usr-steward' && c.at)).toBe(true);
  });

  it('조회 — 룰 ID·유형·적용 지역·Feature·상태 필터', async () => {
    await http().post('/api/compliance-rules').set(CSM).send(body({ ruleId: 'CR-SEC-002', name: 'CAL 기준 단계 배포', type: 'SECURITY', scope: { markets: ['US'], featureIds: ['FEAT-00022'] }, criteria: [{ check: 'STAGED_ROLLOUT' }], approverIds: ['usr-steward'] })).expect(201);
    const ids = async (q: string) => (await http().get(`/api/compliance-rules${q}`).expect(200)).body.items.map((r: any) => r.ruleId);
    expect(await ids('')).toEqual(['CR-PRV-001', 'CR-SEC-002']);
    expect(await ids('?type=SECURITY')).toEqual(['CR-SEC-002']);
    expect(await ids('?market=EU')).toEqual(['CR-PRV-001']);
    expect(await ids('?featureId=FEAT-00022')).toEqual(['CR-PRV-001', 'CR-SEC-002']); // 지정 Feature 또는 그 Feature의 판매국이 적용 지역
    expect(await ids('?featureId=FEAT-00010')).toEqual(['CR-PRV-001']); // FEAT-00010은 EU
    expect(await ids('?status=PROPOSED&ruleId=CR-SEC-002')).toEqual(['CR-SEC-002']);
    await http().get('/api/compliance-rules?status=DONE').expect(400);
  });

  it('적용 대상 Feature 후보 — 적용 지역(판매국)·ASIL 기준', async () => {
    const c = (await http().get('/api/compliance-rules/feature-candidates?markets=EU&asil=C').expect(200)).body;
    expect(c.items.length).toBeGreaterThan(0);
    expect(c.items.every((f: any) => f.country === 'EU' && f.asil === 'C')).toBe(true);
    expect(c.items[0]).toEqual(expect.objectContaining({ featureId: expect.any(String), version: expect.any(String), name: expect.any(String), ownerId: expect.any(String) }));
    await http().get('/api/compliance-rules/feature-candidates?markets=XX').expect(400);
  });

  it('만료 — 종료일이 기준일보다 이전이면 Retired로 자동 전환, 변경 이력·알림(룰 ID·명칭·유형·지역·종료일·만료 일시)', async () => {
    await http().post('/api/compliance-rules').set(REG).send(body({ ruleId: 'CR-LEG-003', name: '임시 고지 요건', type: 'LEGAL', scope: { markets: ['KR'], featureIds: ['FEAT-00022'] }, criteria: [{ check: 'REQUIREMENT_TRACE' }], validFrom: '2026-01-01', validTo: '2026-10-12' })).expect(201);
    const svc = app.get(ComplianceRuleService);
    expect(svc.sweep()).toBe(0); // 종료일 당일은 아직 유효
    app.get(Clock).set(new Date('2026-10-13T00:10:00.000Z'));
    expect(svc.sweep()).toBe(1);
    expect(svc.sweep()).toBe(0);
    const r = (await http().get('/api/compliance-rules/CR-LEG-003').expect(200)).body;
    expect(r.rule).toMatchObject({ status: 'RETIRED', retiredAt: '2026-10-13T00:10:00.000Z' });
    expect(r.changes.at(-1)).toMatchObject({ action: 'RETIRE', field: 'status', before: 'PROPOSED', after: 'RETIRED', by: 'system:compliance-expiry' });
    const n = (await http().get('/api/notifications').set(REG).expect(200)).body.items.find((x: any) => x.eventType === 'compliance.rule.expired');
    expect(n.fields.map((f: any) => f.label)).toEqual(['룰 ID', '룰 명칭', '룰 유형', '적용 지역', '유효 종료일', '만료 일시']);
    // Feature Owner 팀(FEAT-00022 = ADAS상품기획팀)·승인 대상자도 받는다
    expect(n.recipients).toEqual(expect.arrayContaining([{ kind: 'team', team: 'ADAS상품기획팀' }, { kind: 'user', id: 'usr-steward' }, { kind: 'user', id: 'usr-quality' }]));
    await http().patch('/api/compliance-rules/CR-LEG-003').set(REG).send({ name: '다시 살리기', reason: '시도' }).expect(409);
    app.get(Clock).set(new Date('2026-10-12T01:00:00.000Z'));
  });
});

describe('컴플라이언스 기반 배포 전 자동 검증·차단 (FR-CRC-002)', () => {
  let app: INestApplication;
  let http: () => any;
  const policy = async (flagKey: string, over: Record<string, unknown> = {}) => {
    const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Parameter', flagKey, description: `파라미터 ${flagKey}`, safeDefault: false, entitlementCatalogId: 'CAT-00019', ...over }).expect(201);
    await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: c.body.policyId }).expect(201);
    return c.body.policyId as string;
  };
  const approveRule = async (ruleId: string, b: Record<string, unknown>) => {
    await http().post('/api/compliance-rules').set(REG).send(body({ ruleId, ...b })).expect(201);
    await http().post(`/api/compliance-rules/${ruleId}/approval-requests`).set(REG).send({}).expect(201);
    await http().post(`/api/compliance-rules/${ruleId}/decision`).set(FSM).send({ decision: 'APPROVE', reason: '확인' }).expect(201);
  };
  beforeAll(async () => {
    ({ app, http } = await bootApp({ at: '2026-10-12T01:00:00.000Z' }));
  });
  afterAll(async () => {
    await app.close();
  });

  it('적용 룰 조회 — Feature·대상 지역·배포 유형·Safety/Security 등급으로 고르고 승인·유효 기간 여부를 함께 준다', async () => {
    await approveRule('CR-SAF-010', { name: 'ASIL B 단계 배포', type: 'SAFETY', scope: { markets: ['KR'], asil: ['B'], rolloutModes: ['ALL'] }, criteria: [{ check: 'STAGED_ROLLOUT' }] });
    await http().post('/api/compliance-rules').set(REG).send(body({ ruleId: 'CR-SEC-011', name: 'CAL2 TARA 기록', type: 'SECURITY', scope: { markets: ['KR'], cal: ['CAL2'] }, criteria: [{ check: 'TARA_RECORDED' }] })).expect(201);
    await approveRule('CR-SEC-012', { name: 'CAL4 Gate', type: 'SECURITY', scope: { markets: ['KR'], cal: ['CAL4'] }, criteria: [{ check: 'GATE_PASS', gate: 'G7' }] });
    const id = await policy('care_00022_cr_a');
    const a = (await http().get(`/api/compliance-rules/applicable?policyId=${id}`).expect(200)).body;
    expect(a).toMatchObject({ policyId: id, featureId: 'FEAT-00022', market: 'KR', rolloutMode: 'ALL', asil: 'B', cal: 'CAL2' });
    expect(a.rules.map((r: any) => [r.ruleId, r.approved, r.applied])).toEqual([
      ['CR-SAF-010', true, true],
      ['CR-SEC-011', false, false],
    ]);
    await http().get('/api/compliance-rules/applicable').expect(400);
    await http().get('/api/compliance-rules/applicable?policyId=POL-99999').expect(404);
  });

  it('검증 — 적용 룰 미충족이면 BLOCKED, 검증 이력에 미충족 룰 ID·항목·사유를 저장한다', async () => {
    const id = await policy('care_00022_cr_b', { rollout: { mode: 'ALL', basisPoints: 10000 } });
    const v = (await http().post(`/api/policies/${id}/validate`).set(AUTHOR).send({}).expect(200)).body;
    expect(v.run.decision).toBe('BLOCKED');
    const d03 = v.run.results.find((r: any) => r.componentId === 'D03-01');
    expect(d03.result).toBe('FAIL');
    expect(d03.findings.filter((f: any) => f.result === 'FAIL')).toEqual([expect.objectContaining({ ruleId: 'CR-SAF-010', item: 'STAGED_ROLLOUT', message: expect.stringMatching(/코호트 단계 배포/) })]);
    expect(d03.rules.filter((r: any) => r.applied).map((r: any) => `${r.ruleId}@${r.version}`)).toEqual(['CR-SAF-010@1.0']);
    const stored = (await http().get(`/api/policies/validations?policyId=${id}`).expect(200)).body.items[0];
    expect(stored.results.find((r: any) => r.componentId === 'D03-01').findings[0]).toMatchObject({ ruleId: 'CR-SAF-010', item: 'STAGED_ROLLOUT' });
  });

  it('배포 시점 재판정 — 승인 뒤 새로 적용되는 룰을 충족하지 못하면 배포를 막고 사유를 남긴다, 유효 기간이 지난 룰은 빼고 본다', async () => {
    // 시험 차량 하나를 빼는 조건 — 차량 식별자(vehicleKey)로 대상을 고른다. 검증 때는 이 기준을 가진 룰이 없다
    const id = await policy('care_00022_cr_c', { rollout: { mode: 'COHORT', basisPoints: 10000 }, strategies: [{ name: '시험 차량 제외', constraints: [{ contextName: 'vehicleKey', operator: 'IN', values: ['ZZZ-NONE'], inverted: true }] }] });
    const vr = (await http().post(`/api/policies/${id}/validate`).set(AUTHOR).send({}).expect(200)).body.run;
    expect(vr.reasons).toEqual([]);
    expect(vr.decision).toBe('GO');
    await http().post(`/api/policies/${id}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: 'GO 확인' }).expect(200);
    // 승인 뒤 승인된 새 룰 — 차량 식별자 대상 지정 금지(오늘 하루만 유효)
    await approveRule('CR-PRV-013', { name: '차량 식별자 대상 지정 금지(임시)', type: 'PRIVACY', scope: { markets: ['KR'], featureIds: ['FEAT-00022'] }, criteria: [{ check: 'NO_VEHICLE_ID_TARGETING' }], validFrom: '2026-10-12', validTo: '2026-10-12' });
    const blocked = await http().post(`/api/policies/${id}/deploy`).set(RELEASE).send({ reason: '배포' }).expect(422);
    expect(blocked.body.error.message).toMatch(/CR-PRV-013/);
    expect(blocked.body.error.details.findings).toEqual([expect.objectContaining({ ruleId: 'CR-PRV-013', item: 'NO_VEHICLE_ID_TARGETING' })]);
    const checks = (await http().get(`/api/compliance-validations?policyId=${id}`).expect(200)).body.items;
    expect(checks[0]).toMatchObject({ stage: 'DEPLOY', policyId: id, featureId: 'FEAT-00022', market: 'KR', result: 'FAIL', unmet: [expect.objectContaining({ ruleId: 'CR-PRV-013', item: 'NO_VEHICLE_ID_TARGETING' })] });
    expect(checks.some((c: any) => c.stage === 'VALIDATE' && c.result === 'PASS')).toBe(true);
    // 다음 날 — 그 룰의 종료일이 배포 시점보다 이전이라 적용하지 않는다
    app.get(Clock).set(new Date('2026-10-13T02:00:00.000Z'));
    const ok = await http().post(`/api/policies/${id}/deploy`).set(RELEASE).send({ reason: '배포' }).expect(200);
    expect(ok.body.status).toBe('DEPLOYED');
  });

  it('검증 결과 조회 — 배포(정책) ID·Feature ID·대상 지역 필터', async () => {
    const all = (await http().get('/api/compliance-validations').expect(200)).body.items;
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect((await http().get('/api/compliance-validations?featureId=FEAT-00022&market=KR').expect(200)).body.items.length).toBe(all.filter((x: any) => x.featureId === 'FEAT-00022').length);
    expect((await http().get('/api/compliance-validations?market=EU').expect(200)).body.items).toEqual([]);
    const blocked = all.find((x: any) => x.stage === 'VALIDATE' && x.result === 'FAIL');
    expect(blocked).toMatchObject({ decision: 'BLOCKED', unmet: [expect.objectContaining({ ruleId: 'CR-SAF-010', item: 'STAGED_ROLLOUT', message: expect.any(String) })] });
  });
});
