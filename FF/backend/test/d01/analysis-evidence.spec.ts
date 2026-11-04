// 분석 근거·Gate 조건(담당자 웨이브 W3) — P3-3 HARA·TARA·SOTIF·형식승인 영향 기록(담당 역할 개인 서명), P3-1 대표 ASIL 변경 사유 검토,
// G2 PASS 근거, G7 SM·CSM 두 사람 서명, P3-4 판정 Evidence 원장·딥링크, P3-10 단계 가드 문구(코드 없음).
import { afterEach, describe, expect, it } from 'vitest';
import { DB, type Db } from '../../src/kernel/db';
import { actor, bootApp, nextRefId, withRef } from '../helpers';
import { AnalysisEvidenceService } from '../../src/domains/d01-policy/topology/analysis-evidence.service';

let close: (() => Promise<void>) | null = null;
afterEach(async () => close?.());
async function boot() {
  const b = await bootApp({ at: '2026-11-05T00:00:00Z' });
  close = () => b.app.close();
  return { ...b, db: b.get<Db>(DB) };
}
const AUTHOR = actor('usr-author', 'FEATURE_AUTHOR');
const APPROVER = actor('usr-approver', 'FEATURE_APPROVER');
const JUDGE = actor('usr-quality', 'GATE_JUDGE');
const SM = actor('usr-safety2', 'SAFETY_OFFICER');
const CSM = actor('usr-integrator', 'SECURITY_OFFICER');
const CSM_AS_SM = actor('usr-integrator', 'SAFETY_OFFICER');
const REG = actor('usr-steward', 'REGULATORY_OWNER');
const ARC = actor('usr-integrator', 'IMPLEMENTER');

type Http = () => any;
async function newFeature(http: Http, asil = 'QM', extra: Record<string, unknown> = {}) {
  const body = { name: `분석 근거 시험 ${Math.random().toString(36).slice(2, 7)}`, description: '분석 근거 시험용', requirementIds: ['REQ-T-1'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'QA팀', asil, upgVc: ['F111A114001'], controlPoints: ['Flag'] };
  const r = await http().post('/api/features').set(AUTHOR).send({ ...withRef(body, (extra.refId as string) ?? nextRefId(asil)), ...(extra.asilDeviation ? { asilDeviation: extra.asilDeviation } : {}) }).expect(201);
  return r.body.featureId as string;
}
const url = (id: string, p = '') => `/api/features/${id}/versions/0.1.0${p}`;
const judge = (http: Http, id: string, gate: string, extra: Record<string, unknown> = {}) => http().post(url(id, '/gates')).set(JUDGE).send({ gate, inputResult: 'PASS', rationale: `${gate} 확인`, evidenceRef: `EV-${gate}`, ...extra });
const confirm = (http: Http, id: string) => http().post(url(id, '/safety/confirm')).set(SM).send({ reason: '분류 확정' }).expect(201);
const hara = (http: Http, id: string, who = SM) => http().post(url(id, '/analysis/hara')).set(who).send({ docId: 'HARA-T-001', asil: 'C', safetyGoals: [{ id: 'SG-01', text: '의도하지 않은 감속을 막는다', asil: 'C' }], reason: 'HARA 검토' });
const tara = (http: Http, id: string, who = CSM) => http().post(url(id, '/analysis/tara')).set(who).send({ docId: 'TARA-T-001', threats: [{ id: 'TS-01', text: '신호 재전송', cal: 'CAL3' }], reason: 'TARA 검토' });

describe('G2 PASS — 이 Version의 HARA(+ 보안 관련이면 TARA)', () => {
  it('HARA 없이 G2 PASS는 422(사람이 읽는 사유·감사 FAILED), SM이 HARA를 서명해 남기면 통과', async () => {
    const { http, db } = await boot();
    const id = await newFeature(http); // QM → R0, 보안 관련 아님
    await judge(http, id, 'G1').expect(201);
    await confirm(http, id);
    const r = await judge(http, id, 'G2').expect(422);
    expect(r.body.error.message).toBe('G2을(를) PASS로 판정할 근거가 부족합니다.');
    expect(r.body.error.details.blockers.map((b: any) => b.message)).toEqual([expect.stringContaining('HARA(위험 분석) 기록이 없습니다')]);
    expect(JSON.stringify(r.body.error.details)).not.toMatch(/GUARD_FAILED|usr-/);
    expect(db.get<any>("SELECT result FROM audit WHERE action = 'GATE_JUDGE G2' ORDER BY id DESC LIMIT 1").result).toBe('FAILED');
    // CONDITIONAL은 근거가 빠졌다는 판정으로 남길 수 있다
    await judge(http, id, 'G2', { inputResult: 'CONDITIONAL', evidenceRef: null }).expect(201);
    const h = (await hara(http, id).expect(201)).body;
    expect(h).toMatchObject({ recordId: expect.stringMatching(/^ANL-\d{5}$/), kind: 'HARA', signedBy: 'usr-safety2', signedRole: 'SAFETY_OFFICER', provenance: 'PERSONAL', sig: expect.any(String) });
    await judge(http, id, 'G2').expect(201);
    const v = (await http().get(url(id, '/analysis')).expect(200)).body;
    expect(v.current.HARA).toMatchObject({ recordId: h.recordId, valid: true });
    expect(v.security.relevant).toBe(false);
  });

  it('보안 관련 Feature(R1)는 TARA도 — CSM이 서명해 남긴다. HARA는 SM만, TARA는 CSM만(403)', async () => {
    const { http } = await boot();
    const id = await newFeature(http, 'B'); // B → F2·R1 추정
    await judge(http, id, 'G1').expect(201);
    await confirm(http, id);
    await hara(http, id, CSM).expect(403);
    await hara(http, id).expect(201);
    await tara(http, id, SM).expect(403);
    const r = await judge(http, id, 'G2').expect(422);
    expect(r.body.error.details.blockers.map((b: any) => b.message)).toEqual([expect.stringContaining('TARA(위협 분석) 기록이 없습니다')]);
    await tara(http, id).expect(201);
    await judge(http, id, 'G2').expect(201);
  });

  it('SOTIF는 아키텍트, 형식승인 영향은 법규 담당 — 영향이 있으면 규정을 고른다(400)', async () => {
    const { http } = await boot();
    const id = await newFeature(http);
    await http().post(url(id, '/analysis/sotif')).set(ARC).send({ docId: 'SOTIF-T-1', triggeringConditions: ['역광'], reason: 'SOTIF 분석' }).expect(201);
    await http().post(url(id, '/analysis/homologation')).set(REG).send({ regulations: [], decision: 'EXTENSION', reason: '판단' }).expect(400);
    const h = (await http().post(url(id, '/analysis/homologation')).set(REG).send({ regulations: ['R155', 'R156'], decision: 'NOTIFY', rxswin: ['RX-1'], reason: '기술 기관 통보' }).expect(201)).body;
    expect(h).toMatchObject({ kind: 'HOMOLOGATION', docId: null, content: { regulations: ['R155', 'R156'], decision: 'NOTIFY', rxswin: ['RX-1'] }, signedRole: 'REGULATORY_OWNER' });
    await http().post(url(id, '/analysis/homologation')).set(SM).send({ regulations: [], decision: 'NO_IMPACT', reason: '판단' }).expect(403);
  });

  it('분석 기록은 추가만 — 다시 쓰면 새 기록이 지금 근거, 이전 기록은 이력(DB가 고치기·지우기를 막는다)', async () => {
    const { http, db } = await boot();
    const id = await newFeature(http);
    const a = (await hara(http, id).expect(201)).body;
    const b = (await hara(http, id).expect(201)).body;
    expect(b.supersedes).toBe(a.recordId);
    const v = (await http().get(url(id, '/analysis')).expect(200)).body;
    expect(v.current.HARA.recordId).toBe(b.recordId);
    expect(v.history.map((x: any) => x.recordId)).toEqual([a.recordId, b.recordId]);
    expect(() => db.run('UPDATE analysis_record SET doc = ? WHERE record_id = ?', '{}', a.recordId)).toThrow(/추가만/);
    expect(() => db.run('DELETE FROM analysis_record WHERE record_id = ?', a.recordId)).toThrow(/추가만/);
  });
});

describe('대표 ASIL 변경 사유(P3-1)', () => {
  it('Feature ASIL C ≠ 대표 행 B — 분석 근거에 "B → C · 사유", G2 PASS는 판정자의 ASIL 사유 검토함 확인이 있어야(기록에 남는다)', async () => {
    const { http } = await boot();
    const id = await newFeature(http, 'C', { refId: nextRefId('B'), asilDeviation: { from: 'B', to: 'C', reason: 'HARA 결과 ASIL C 유지' } });
    const v = (await http().get(url(id, '/analysis')).expect(200)).body;
    expect(v.asilDeviation).toMatchObject({ from: 'B', to: 'C', reason: 'HARA 결과 ASIL C 유지', refId: expect.any(String) });
    await judge(http, id, 'G1').expect(201);
    await confirm(http, id);
    await hara(http, id).expect(201);
    await tara(http, id).expect(201);
    const r = await judge(http, id, 'G2').expect(422);
    expect(r.body.error.details.blockers.map((b: any) => b.message)).toEqual(["대표 ASIL B → C 변경 사유를 검토했다는 확인이 없습니다 — 사유를 읽고 'ASIL 사유 검토함'을 고릅니다."]);
    const ok = (await judge(http, id, 'G2', { asilReasonReviewed: true }).expect(201)).body;
    const g2 = (await http().get(url(id, '/gates')).expect(200)).body.gates.find((g: any) => g.gate === 'G2');
    expect(g2.latest.transitionNote).toContain('ASIL 사유 검토함(대표 B → C)');
    expect(ok).toBeTruthy();
    const audit = (await http().get(`/api/audit?target=${id}@0.1.0%23G2`).expect(200)).body.items;
    expect(audit.some((a: any) => a.result === 'ALLOWED' && a.after?.asilReasonReviewed?.to === 'C')).toBe(true);
  });

  it('대표 ASIL과 같으면 확인이 필요 없다', async () => {
    const { http } = await boot();
    const id = await newFeature(http);
    expect((await http().get(url(id, '/analysis')).expect(200)).body.asilDeviation).toBeNull();
  });
});

/** G1~G3 PASS → 정의 승인(자동 DEVELOPING) */
async function toDeveloping(http: Http, id: string) {
  await http().patch(url(id)).set(AUTHOR).send({ functions: [{ functionId: 'FUNC-000056', label: 'Extended Gap Control 기능' }], swIds: ['SW-CARE-SDIST-APP'], swVersions: ['1.2.1'], ecuPnos: ['99211-NX400'] }).expect(200);
  await judge(http, id, 'G1').expect(201);
  await confirm(http, id);
  await hara(http, id).expect(201);
  await tara(http, id).expect(201);
  for (const g of ['G2', 'G3']) await judge(http, id, g).expect(201);
  await http().post(url(id, '/transitions')).set(APPROVER).send({ to: 'APPROVED', reason: '정의 승인' }).expect(200);
}

describe('G7 Safety/Security Gate — SM·CSM 두 사람 서명', () => {
  it.each(['HARA', 'TARA'])('바인딩한 %s 본문을 DB에서 변조하면 기존 G7 서명도 무효이고 PASS할 수 없다', async (kind) => {
    const { http, db } = await boot();
    const id = await newFeature(http, 'B');
    await toDeveloping(http, id);
    for (const g of ['G4', 'G5', 'G6']) await judge(http, id, g).expect(201);
    await http().post(url(id, '/analysis/g7-safety')).set(SM).send({ reason: '안전 근거 확인' }).expect(201);
    await http().post(url(id, '/analysis/g7-security')).set(CSM).send({ reason: '보안 근거 확인' }).expect(201);
    await judge(http, id, 'G7').expect(201);
    const before = (await http().get(url(id, '/analysis')).expect(200)).body;
    expect(before.g7.every((s: any) => s.valid)).toBe(true);
    const record = JSON.parse(db.get<{ doc: string }>('SELECT doc FROM analysis_record WHERE record_id = ?', before.current[kind].recordId)!.doc);
    db.run('DROP TRIGGER analysis_record_no_update');
    db.run('UPDATE analysis_record SET doc = ? WHERE record_id = ?', JSON.stringify({ ...record, reason: 'DB 권한자가 본문을 변조' }), record.recordId);
    const after = (await http().get(url(id, '/analysis')).expect(200)).body;
    expect(after.current[kind].valid).toBe(false);
    expect(after.g7.every((s: any) => !s.valid && !s.stale)).toBe(true);
    await judge(http, id, 'G7').expect(422);
  });

  it('보안 관련이 아니면 null TARA 바인딩을 허용하고, 개인 HARA에 묶인 두 서명은 유효하다', async () => {
    const { http } = await boot();
    const id = await newFeature(http);
    await hara(http, id).expect(201);
    await http().post(url(id, '/analysis/g7-safety')).set(SM).send({ reason: '안전 근거 확인' }).expect(201);
    await http().post(url(id, '/analysis/g7-security')).set(CSM).send({ reason: '보안 비관련 확인' }).expect(201);
    const view = (await http().get(url(id, '/analysis')).expect(200)).body;
    expect(view.security.relevant).toBe(false);
    expect(view.g7.every((s: any) => s.valid && s.bound.TARA === null)).toBe(true);
  });

  it('정상 이관 근거에도 G7 서명할 수 있지만, 이관 TARA가 변조되면 그 서명은 무효다', async () => {
    const { http, db } = await boot();
    const base = '/api/features/FEAT-00010/versions/2.0.0';
    await http().post(`${base}/analysis/g7-safety`).set(SM).send({ reason: '이관 안전 근거 확인' }).expect(201);
    await http().post(`${base}/analysis/g7-security`).set(CSM).send({ reason: '이관 보안 근거 확인' }).expect(201);
    const before = (await http().get(`${base}/analysis`).expect(200)).body;
    expect(before.current.TARA.provenance).toBe('IMPORT');
    expect(before.g7.every((s: any) => s.valid)).toBe(true);
    const record = JSON.parse(db.get<{ doc: string }>('SELECT doc FROM analysis_record WHERE record_id = ?', before.current.TARA.recordId)!.doc);
    db.run('DROP TRIGGER analysis_record_no_update');
    db.run('UPDATE analysis_record SET doc = ? WHERE record_id = ?', JSON.stringify({ ...record, reason: '이관 본문 변조' }), record.recordId);
    const after = (await http().get(`${base}/analysis`).expect(200)).body;
    expect(after.current.TARA.valid).toBe(false);
    expect(after.g7.every((s: any) => !s.valid && !s.stale)).toBe(true);
  });

  it('서명 없이 PASS 422, 한 사람이 두 역할로 서명 불가, 두 사람 서명 뒤 PASS. HARA를 다시 쓰면 이전 서명은 효력이 없다', async () => {
    const { http } = await boot();
    const id = await newFeature(http, 'B');
    await toDeveloping(http, id);
    for (const g of ['G4', 'G5', 'G6']) await judge(http, id, g).expect(201);
    const none = await judge(http, id, 'G7').expect(422);
    expect(none.body.error.details.blockers).toHaveLength(2);
    await http().post(url(id, '/analysis/g7-security')).set(CSM).send({ reason: 'TARA 위협 대응 확인' }).expect(201);
    // 같은 사람(usr-integrator)이 SM 역할로 — 거부
    const same = await http().post(url(id, '/analysis/g7-safety')).set(CSM_AS_SM).send({ reason: '같은 사람' }).expect(422);
    expect(same.body.error.message).toContain('서로 다른 사람');
    await http().post(url(id, '/analysis/g7-safety')).set(SM).send({ reason: 'HARA 안전 목표 반영 확인' }).expect(201);
    await http().post(url(id, '/analysis/g7-safety')).set(SM).send({ reason: '두 번' }).expect(409);
    let v = (await http().get(url(id, '/analysis')).expect(200)).body;
    expect(v.g7.map((s: any) => [s.role, s.valid])).toEqual([
      ['SECURITY_OFFICER', true],
      ['SAFETY_OFFICER', true],
    ]);
    // HARA를 다시 쓰면 SM 서명은 이전 HARA에 묶여 있어 효력이 없다
    await hara(http, id).expect(201);
    v = (await http().get(url(id, '/analysis')).expect(200)).body;
    expect(v.g7.every((s: any) => s.stale && !s.valid)).toBe(true);
    const stale = await judge(http, id, 'G7').expect(422);
    expect(stale.body.error.details.blockers.map((b: any) => b.message).join(' ')).toContain('Safety Manager');
    await http().post(url(id, '/analysis/g7-security')).set(CSM).send({ reason: '다시 확인' }).expect(201);
    await http().post(url(id, '/analysis/g7-safety')).set(SM).send({ reason: '다시 확인' }).expect(201);
    await judge(http, id, 'G7').expect(201);
  });

  it('G7 기능안전 서명 전에 HARA가 있어야 한다', async () => {
    const { http } = await boot();
    const id = await newFeature(http);
    const r = await http().post(url(id, '/analysis/g7-safety')).set(SM).send({ reason: '확인' }).expect(422);
    expect(r.body.error.message).toContain('HARA');
  });
});

describe('Evidence 원장(P3-4)', () => {
  it('Evidence Ref가 있는 판정은 원장에 남고 ?ref=·featureId로 찾는다, 분석 기록 번호(ANL-)는 이 Version의 것만', async () => {
    const { http } = await boot();
    const id = await newFeature(http);
    const before = (await http().get('/api/evidence').expect(200)).body.items.length;
    await http().post(url(id, '/gates')).set(JUDGE).send({ gate: 'G1', inputResult: 'PASS', rationale: '정의 확인', evidenceRef: 'TMS-RUN-7781' }).expect(201);
    const all = (await http().get('/api/evidence').expect(200)).body.items;
    expect(all.length).toBe(before + 1);
    const hit = (await http().get('/api/evidence?ref=tms-run-77').expect(200)).body.items;
    expect(hit).toEqual([expect.objectContaining({ evidenceRef: 'TMS-RUN-7781', featureId: id, featureVersion: '0.1.0', gate: 'G1', gateStatus: 'PASS', judgedAt: expect.any(String) })]);
    expect((await http().get(`/api/evidence?featureId=${id}`).expect(200)).body.items).toHaveLength(1);
    const g1 = (await http().get(url(id, '/gates')).expect(200)).body.gates.find((g: any) => g.gate === 'G1');
    expect(g1.evidence).toMatchObject({ evidenceRef: 'TMS-RUN-7781', resultReason: 'PASS — 정의 확인' });
    // 없는 분석 기록 번호는 거부(외부 Evidence ID는 원장에 이어 붙인다)
    const bad = await http().post(url(id, '/gates')).set(JUDGE).send({ gate: 'G1', inputResult: 'PASS', rationale: '확인', evidenceRef: 'ANL-99999' }).expect(422);
    expect(bad.body.error.message).toContain('ANL-99999');
    const h = (await hara(http, id).expect(201)).body;
    await http().post(url(id, '/gates')).set(JUDGE).send({ gate: 'G1', inputResult: 'PASS', rationale: '확인', evidenceRef: h.recordId }).expect(201);
  });
});

describe('판정 단계 가드 문구(P3-10)·Gate 탭 정보(P3-9)', () => {
  it('단계 밖 Gate 422 사유에 코드가 붙지 않는다, Gate 보기에 단계·절차 Gate', async () => {
    const { http } = await boot();
    const id = await newFeature(http);
    const r = await judge(http, id, 'G4').expect(422);
    expect(r.body.error.message).toBe('G4은(는) DEVELOPING 단계 Gate입니다 — 지금은 PROPOSED 단계라 판정할 수 없습니다.');
    const v = (await http().get(url(id, '/gates')).expect(200)).body;
    expect(v.lifecycle).toBe('PROPOSED');
    expect(v.gates.find((g: any) => g.gate === 'G7').procedureGates).toEqual(['G2', 'G4']);
    expect(v.gates.find((g: any) => g.gate === 'G2').procedureGates).toEqual(['G2', 'G3']);
  });
});

describe('데모 이관 기록', () => {
  it('형식승인 일괄 조회는 IMPORT·PERSONAL 서명을 확인하고, 무효 최신 기록을 과거 유효 기록으로 대체하지 않는다', async () => {
    const context = await boot();
    const { http, db } = context;
    const service = context.get(AnalysisEvidenceService);
    expect(service.validHomologations().has('FEAT-00010@2.0.0')).toBe(true);
    const id = await newFeature(http);
    const key = `${id}@0.1.0`;
    const body = { regulations: [], decision: 'NO_IMPACT', reason: '형식승인 영향 확인' };
    await http().post(url(id, '/analysis/homologation')).set(REG).send(body).expect(201);
    const latest = (await http().post(url(id, '/analysis/homologation')).set(REG).send({ ...body, reason: '다시 확인' }).expect(201)).body;
    expect(service.validHomologations().has(key)).toBe(true);
    db.run('DROP TRIGGER analysis_record_no_update');
    db.run('UPDATE analysis_record SET doc = ? WHERE record_id = ?', JSON.stringify({ ...latest, reason: '최신 판단 본문 변조' }), latest.recordId);
    expect(service.validHomologations().has(key)).toBe(false);
  });

  it('대표 ASIL을 바꾼 시드 Version(FEAT-00010 2.0.0, A→C)에 HARA·TARA·SOTIF·형식승인 판단이 있다(플랫폼 봉인, 유효)', async () => {
    const { http } = await boot();
    const v = (await http().get('/api/features/FEAT-00010/versions/2.0.0/analysis').expect(200)).body;
    expect(Object.keys(v.current).sort()).toEqual(['HARA', 'HOMOLOGATION', 'SOTIF', 'TARA']);
    expect(Object.values(v.current).every((r: any) => r.provenance === 'IMPORT' && r.valid)).toBe(true);
    expect(v.asilDeviation).toMatchObject({ from: 'A', to: 'C' });
  });
});
