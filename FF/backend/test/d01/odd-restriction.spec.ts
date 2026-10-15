// ODD 축소 정책 (D01-06, 보고서 v1.1 14.7 · FFG-SOT-002) — 수용 기준: 등급 없는 ODD 축소 정책의 배포 0건.
// 트리거 조건 대응으로 Feature를 제한하는 정책은 새 Feature Version으로 등록하고, 7장 등급(안전 분류 확정)과 일반 승인 절차를 그대로 따른다.
// 정책 검증의 차량 시나리오 검증(D06-03)·안전 동작 검증(D06-06)은 시험 대역 vECU 실행을 근거로 쓴다
Object.assign(process.env, { VECU_DIR: require('node:path').resolve(__dirname, '..', 'fixtures', 'fake-vecu'), FF_EVIDENCE_DIR: require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'ff-odd-')) });
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { actor, bootApp, confirmSafety } from '../helpers';

const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const APPROVER = actor('lee.approver', 'FEATURE_APPROVER');
const JUDGE = actor('choi.judge', 'GATE_JUDGE');
const RELEASE = actor('park.release', 'RELEASE_MANAGER');
const ODD = { triggerId: 'TRG-FOG-CUTIN (안개 속 끼어들기)', basisRef: 'ANM-00001' };

describe('ODD 축소 정책 (FFG-SOT-002)', () => {
  let b: Awaited<ReturnType<typeof bootApp>>;
  beforeAll(async () => {
    b = await bootApp({ at: '2026-10-15T01:00:00.000Z' });
  });
  afterAll(async () => {
    await b.app.close();
    for (const k of ['VECU_DIR', 'FF_EVIDENCE_DIR']) delete process.env[k];
  });

  /** 새 Version → (등급 수정) → 안전 분류 확정 → G1~G3 → APPROVED → G4 */
  const prepare = async (patch?: Record<string, unknown>) => {
    const http = b.http;
    const v = await http().post('/api/features/FEAT-00022/versions').set(AUTHOR).send({ baseVersion: '1.0.0', reason: 'ODD 축소(안개 조건 제한)', changes: { description: '안개 조건 제한' } }).expect(201);
    const ver: string = v.body.feature.version;
    if (patch) await http().put(`/api/features/FEAT-00022/versions/${ver}/safety`).set(AUTHOR).send(patch).expect(200);
    await confirmSafety(http, 'FEAT-00022', ver);
    for (const g of ['G1', 'G2', 'G3']) await http().post(`/api/features/FEAT-00022/versions/${ver}/gates`).set(JUDGE).send({ gate: g, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${g}` }).expect(201);
    await http().post(`/api/features/FEAT-00022/versions/${ver}/transitions`).set(APPROVER).send({ to: 'APPROVED', reason: '승인' }).expect(200);
    await http().post(`/api/features/FEAT-00022/versions/${ver}/gates`).set(JUDGE).send({ gate: 'G4', inputResult: 'PASS', rationale: '확인', evidenceRef: 'EV-G4' }).expect(201);
    return ver;
  };
  /** 정책 작성 → 가상검증 → G5~G7 → 검증(GO) → 승인(일반 절차) */
  const approvedPolicy = async (ver: string, flagKey: string) => {
    const http = b.http;
    const c = await http().post('/api/policies').set(AUTHOR).send({ featureId: 'FEAT-00022', featureVersion: ver, controlPoint: 'Signal', flagKey, description: '안개 조건에서 기능 제한', safeDefault: false, oddRestriction: { ...ODD, baseVersion: '1.0.0' } }).expect(201);
    await http().post('/api/virtual-validations').set(AUTHOR).send({ policyId: c.body.policyId }).expect(201);
    for (const g of ['G5', 'G6', 'G7']) await http().post(`/api/features/FEAT-00022/versions/${ver}/gates`).set(JUDGE).send({ gate: g, inputResult: 'PASS', rationale: '확인', evidenceRef: `EV-${g}` }).expect(201);
    const val = await http().post(`/api/policies/${c.body.policyId}/validate`).set(AUTHOR).send({}).expect(200);
    expect(val.body.run.reasons).toEqual([]);
    await http().post(`/api/policies/${c.body.policyId}/decision`).set(APPROVER).send({ decision: 'APPROVE', reason: '검증 GO' }).expect(200);
    return c.body.policyId as string;
  };

  it('FFG-SOT-002 ODD 축소는 새 Feature Version으로만 — 같은 Version·없는 축소 전 Version은 등록 거부(감사 FAILED)', async () => {
    const http = b.http;
    const base = { featureId: 'FEAT-00022', featureVersion: '1.0.0', controlPoint: 'Signal', flagKey: 'care_00022_odd_same', description: '안개 조건 제한', safeDefault: false };
    const same = await http().post('/api/policies').set(AUTHOR).send({ ...base, oddRestriction: { ...ODD, baseVersion: '1.0.0' } }).expect(422);
    expect(same.body.error.details).toMatchObject({ rule: 'FFG-SOT-002', findings: [expect.objectContaining({ code: 'NOT_NEW_VERSION' })] });
    const unknown = await http().post('/api/policies').set(AUTHOR).send({ ...base, oddRestriction: { ...ODD, baseVersion: '0.9.9' } }).expect(422);
    expect(unknown.body.error.details.findings.map((f: any) => f.code)).toEqual(['BASE_UNKNOWN']);
    const audit = (await http().get('/api/audit?target=care_00022_odd_same').expect(200)).body.items;
    expect(audit.some((a: any) => a.action === 'POLICY_CREATE' && a.result === 'FAILED')).toBe(true);
  });

  it('FFG-SOT-002 축소 Version의 등급이 축소 전보다 낮으면 승인을 거쳤어도 배포 거부', async () => {
    const http = b.http;
    const before = (await http().get('/api/features/FEAT-00022/versions/1.0.0/safety').expect(200)).body;
    expect(before.profile?.fClass ?? before.fClass).toBe('F3');
    const ver = await prepare({ fClass: 'F2' });
    const pid = await approvedPolicy(ver, 'care_00022_odd_low');
    const r = await http().post(`/api/policies/${pid}/deploy`).set(RELEASE).send({ reason: 'ODD 축소 배포' }).expect(422);
    expect(r.body.error.details.findings).toEqual([expect.objectContaining({ code: 'CLASS_DOWNGRADE' })]);
    expect((await http().get(`/api/policies/${pid}`).expect(200)).body.policy.status).toBe('APPROVED');
  });

  it('FFG-SOT-002 새 Version·확정 등급·일반 승인을 거친 축소 정책은 배포되고, 정책 내용(해시)에 트리거 조건이 남는다', async () => {
    const http = b.http;
    const ver = await prepare({ fClass: 'F3' }); // 새 Version 분류 초안은 추정값 — 축소 전과 같은 등급으로 확정
    const pid = await approvedPolicy(ver, 'care_00022_odd_ok');
    const d = await http().post(`/api/policies/${pid}/deploy`).set(RELEASE).send({ reason: 'ODD 축소 배포' }).expect(200);
    expect(d.body).toMatchObject({ status: 'DEPLOYED', featureVersion: ver, oddRestriction: { ...ODD, baseVersion: '1.0.0' } });
  });
});
