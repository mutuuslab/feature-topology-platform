import type { INestApplication } from '@nestjs/common';
import { CostBasis } from '@ff/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CostService } from '../../src/domains/d07-cost/estimation/cost.service';
import { CostShowcaseSeed } from '../../src/domains/d07-cost/estimation/cost-showcase-seed';
import { AuditService } from '../../src/kernel/audit.service';
import { DB, type Db } from '../../src/kernel/db';
import { actor, bootApp, withRef } from '../helpers';
const EST = actor('kim.cost', 'COST_ESTIMATOR');
const APPROVER = actor('lee.approver', 'COST_APPROVER');
const VIEW = actor('park.viewer', 'COST_VIEWER');
const ADMIN = actor('lee.admin', 'COST_BASIS_ADMIN');
const DEV = actor('han.dev', 'IMPLEMENTER');
const REF = 'BC-BCM-001';
const BASIS = CostBasis.parse(JSON.parse(readFileSync(join(__dirname, '../../../data/reference/cost-basis/v1.3.json'), 'utf8')));

describe('C4 교정·승인 후 실적', () => {
  let app: INestApplication;
  let http: Awaited<ReturnType<typeof bootApp>>['http'];
  let db: Db;
  let service: CostService;
  let audit: AuditService;
  let n = 0;
  beforeAll(async () => { const boot = await bootApp(); ({ app, http } = boot); db = boot.get<Db>(DB); service = boot.get(CostService); audit = boot.get(AuditService); });
  afterAll(() => app.close());
  const addFeature = async (id: string) => {
    const body = withRef({ name: `C4 실적 ${++n}`, description: '실적 검토', country: 'KR', vehicleModel: `C4-${n}`, trim: 'Premium', ownerId: '구매본부', asil: 'QM' }, REF);
    const f = (await http().post('/api/features').set(actor('usr-author', 'FEATURE_AUTHOR')).send(body).expect(201)).body;
    await http().post(`/api/cost/projects/${id}/features`).set(EST).send({ featureId: f.featureId, version: f.version }).expect(201);
  };
  const create = async (features = 1) => {
    const id = (await http().post('/api/cost/projects').set(EST).send({ name: 'C4 산정' }).expect(201)).body.estId;
    for (let i = 0; i < features; i++) await addFeature(id);
    return id as string;
  };
  const detail = async (id: string, who = EST) => (await http().get(`/api/cost/projects/${id}`).set(who).expect(200)).body;
  const approve = async (id: string) => {
    await http().post(`/api/cost/projects/${id}/transitions`).set(EST).send({ action: 'SUBMIT', reason: '실적 검토 요청' }).expect(201);
    await http().post(`/api/cost/projects/${id}/transitions`).set(actor('kim.cost', 'COST_APPROVER')).send({ action: 'APPROVE', reason: '자기 승인 시도' }).expect(403);
    await http().post(`/api/cost/projects/${id}/transitions`).set(APPROVER).send({ action: 'APPROVE', reason: '실적 검토 승인' }).expect(201);
  };

  it('벤치마크 교정은 구매 역할만 보고, 제안은 현재 계수 표를 자동 변경하지 않는다', async () => {
    await http().get('/api/cost/calibration').set(DEV).expect(403);
    expect(() => service.calibration({ id: 'dev', role: 'IMPLEMENTER', correlationId: 'test' })).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    for (const who of [EST, VIEW, ADMIN, APPROVER]) {
      const c = (await http().get('/api/cost/calibration').set(who).expect(200)).body;
      expect(c).toMatchObject({ basisVersion: 'v1.3', anchorEur: 10000, mre: { n: 0, projects: 0, avg: null } });
      expect(c.samples.filter((s: any) => s.kind === 'single')).toHaveLength(17);
      expect(c.samples.filter((s: any) => s.kind === 'bundle')).toHaveLength(4);
      expect(c.suggestion).toBeGreaterThan(0);
    }
    expect((await http().get('/api/cost/basis/v1.3').set(ADMIN).expect(200)).body.basis.benchmark.anchorEur).toBe(10000);
  });

  it('중복 기준 행 실적 합산·추가/수정/삭제·승인불변·모든 승인 과제 집계·개정 이관을 검증한다', async () => {
    const id = await create(2);
    let d = await detail(id);
    expect(d.mre).toMatchObject({ n: 0, missing: 1, avg: null });
    for (const [index, line] of d.lines.entries()) await http().patch(`/api/cost/projects/${id}/lines/${line.lineNo}`).set(EST).send({ actual: index === 0 ? 1.25 : 2.75 }).expect(200);
    await http().put(`/api/cost/projects/${id}/actuals/${REF}`).set(EST).send({ actual: 6 }).expect(409);
    await approve(id);
    d = await detail(id);
    const approved = JSON.stringify(d.result);
    const approvals = JSON.stringify(d.approvals);
    const sealed = db.get<{ doc_sealed: string }>('SELECT doc_sealed FROM cost_result_doc WHERE est_id = ? AND rev = 1', id)!.doc_sealed;
    expect(d.actuals).toEqual([{ refId: REF, actual: 4, override: false }]);
    const expected = d.result.lines.reduce((sum: number, line: any) => sum + line.e, 0);
    expect(d.mre.rows).toEqual([{ refId: REF, e: expected, actual: 4, mre: Math.abs(expected - 4) / 4 }]);
    for (const who of [DEV, APPROVER, VIEW, ADMIN]) await http().put(`/api/cost/projects/${id}/actuals/${REF}`).set(who).send({ actual: 6 }).expect(403);
    expect(() => service.putActual({ id: 'dev', role: 'IMPLEMENTER', correlationId: 'test' }, id, REF, { actual: 6 })).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    for (const body of [{ actual: 0 }, { actual: -1 }, { actual: 100001 }, { actual: 3, money: 3 }, {}]) await http().put(`/api/cost/projects/${id}/actuals/${REF}`).set(EST).send(body).expect(400);
    await http().put(`/api/cost/projects/${id}/actuals/NOPE-001`).set(EST).send({ actual: 6 }).expect(404);
    for (const actual of [10, 6]) {
      d = (await http().put(`/api/cost/projects/${id}/actuals/${REF}`).set(EST).send({ actual }).expect(200)).body;
      expect(d.actuals).toEqual([{ refId: REF, actual, override: true }]);
      expect(d.mre.rows[0].mre).toBe(Math.abs(expected - actual) / actual);
      expect(JSON.stringify(d.result)).toBe(approved);
      expect(JSON.stringify(d.approvals)).toBe(approvals);
      expect(db.get<{ n: number }>('SELECT count(*) AS n FROM cost_actual WHERE est_id = ?', id)!.n).toBe(1);
    }
    d = (await http().put(`/api/cost/projects/${id}/actuals/${REF}`).set(EST).send({ actual: null }).expect(200)).body;
    expect(d.actuals).toEqual([{ refId: REF, actual: 4, override: false }]);
    expect(d.mre.rows[0].actual).toBe(4);
    await http().put(`/api/cost/projects/${id}/actuals/${REF}`).set(EST).send({ actual: null }).expect(200);
    await http().put(`/api/cost/projects/${id}/actuals/${REF}`).set(EST).send({ actual: 6 }).expect(200);
    const second = await create();
    const secondLine = (await detail(second)).lines[0].lineNo;
    await http().patch(`/api/cost/projects/${second}/lines/${secondLine}`).set(EST).send({ actual: 2 }).expect(200);
    await approve(second);
    const c = (await http().get('/api/cost/calibration').set(VIEW).expect(200)).body;
    expect(c.mre).toMatchObject({ projects: 2, n: 2 });
    expect(c.mre.rows.map((row: any) => [row.estId, row.actual])).toEqual([[id, 6], [second, 2]]);
    expect(c.mre.byComponent).toHaveLength(1);
    expect(c.mre.byComponent[0].n).toBe(2);
    expect(c.mre.avg).toBe(c.mre.rows.reduce((sum: number, row: any) => sum + row.mre, 0) / 2);
    const masked = await detail(id, DEV);
    expect(masked.actuals[0].actual).toBe(6);
    for (const field of ['totalCost', 'laborKrw', 'benchEur', 'blendedRate', 'unitPrice']) expect(JSON.stringify(masked)).not.toContain(`"${field}"`);
    await http().post(`/api/cost/projects/${id}/transitions`).set(EST).send({ action: 'REVISE', reason: '실적 반영 재산정' }).expect(201);
    const revised = await detail(id);
    expect(revised.lines.map((line: any) => line.inputs.actual)).toEqual([6, null]);
    expect(revised.mre.rows[0].actual).toBe(6);
    expect(db.get<{ n: number }>('SELECT count(*) AS n FROM cost_actual WHERE est_id = ?', id)!.n).toBe(0);
    expect(db.get<{ doc_sealed: string }>('SELECT doc_sealed FROM cost_result_doc WHERE est_id = ? AND rev = 1', id)!.doc_sealed).toBe(sealed);
    expect((await http().get('/api/cost/calibration').set(VIEW).expect(200)).body.mre).toMatchObject({ projects: 1, n: 1 });
    await http().put(`/api/cost/projects/${id}/actuals/${REF}`).set(EST).send({ actual: 9 }).expect(409);
    await approve(id);
    expect((await detail(id)).mre.rows[0].actual).toBe(6);
    expect(db.get<{ doc_sealed: string }>('SELECT doc_sealed FROM cost_result_doc WHERE est_id = ? AND rev = 1', id)!.doc_sealed).toBe(sealed);
  });

  it('MRE 제외 행도 실적을 조회·지울 수 있고, 실패한 저장은 원자적으로 롤백된다', async () => {
    const id = await create();
    const line = (await detail(id)).lines[0];
    await http().patch(`/api/cost/projects/${id}/lines/${line.lineNo}`).set(EST).send({ qty: 0 }).expect(200);
    await approve(id);
    const written = (await http().put(`/api/cost/projects/${id}/actuals/${REF}`).set(EST).send({ actual: 9 }).expect(200)).body;
    expect(written.mre.n).toBe(0);
    expect(written.actuals).toEqual([{ refId: REF, actual: 9, override: true }]);
    const originalRecord = audit.record.bind(audit);
    const fail = vi.spyOn(audit, 'record').mockImplementation((...args) => { if (args[1] === 'COST_ACTUAL_PUT') throw new Error('audit failure'); return originalRecord(...args); });
    try { await http().put(`/api/cost/projects/${id}/actuals/${REF}`).set(EST).send({ actual: 8 }).expect(500); } finally { fail.mockRestore(); }
    expect((await detail(id)).actuals[0].actual).toBe(9);
    const cleared = (await http().put(`/api/cost/projects/${id}/actuals/${REF}`).set(EST).send({ actual: null }).expect(200)).body;
    expect(cleared.actuals).toEqual([]);
  });

  it('제안은 관리자 새 초안·발행을 거쳐야 적용되고 이전 승인 원문은 유지된다', async () => {
    const before = db.all('SELECT * FROM cost_result_doc ORDER BY est_id, rev');
    const c = (await http().get('/api/cost/calibration').set(ADMIN).expect(200)).body;
    const anchorEur = Math.round(c.suggestion * 10) / 10;
    const body = { basis: { ...BASIS, version: 'v1.3-c4', benchmark: { ...BASIS.benchmark, anchorEur } }, note: '교정 제안 채택' };
    await http().post('/api/cost/basis').set(EST).send(body).expect(403);
    await http().post('/api/cost/basis').set(ADMIN).send({ ...body, basis: { ...body.basis, benchmark: { ...body.basis.benchmark, anchorEur: 0 } } }).expect(400);
    await http().post('/api/cost/basis').set(ADMIN).send(body).expect(201);
    expect((await http().get('/api/cost/calibration').set(ADMIN).expect(200)).body.anchorEur).toBe(10000);
    await http().post('/api/cost/basis/v1.3-c4/publish').set(ADMIN).send({ reason: '교정 검토 완료' }).expect(201);
    expect((await http().get('/api/cost/calibration').set(ADMIN).expect(200)).body.anchorEur).toBe(anchorEur);
    expect(db.all('SELECT * FROM cost_result_doc ORDER BY est_id, rev')).toEqual(before);
  });
});

describe('선택 산정 시연 데이터', () => {
  it('기본2과제는 보존하고 선택 시22과제·상태3종·승인후실적을 멱등하게 더한다', async () => {
    const previous = process.env.FF_SHOWCASE;
    process.env.FF_SHOWCASE = '1';
    const { app, http, get } = await bootApp({ costDemo: true });
    try {
      const db = get<Db>(DB);
      expect(db.get<{ n: number }>('SELECT count(*) AS n FROM cost_project')!.n).toBe(24);
      const rows = db.all<{ status: string; created_by: string; doc: string }>('SELECT status, created_by, doc FROM cost_project');
      expect(new Set(rows.map((row) => row.status))).toEqual(new Set(['DRAFT', 'SUBMITTED', 'APPROVED']));
      const approvals = db.all<{ approved_by: string }>('SELECT approved_by FROM cost_result');
      expect(approvals.every((row) => row.approved_by === 'usr-approver')).toBe(true);
      expect(rows.every((row) => row.created_by === 'usr-viewer')).toBe(true);
      const c = (await http().get('/api/cost/calibration').set(VIEW).expect(200)).body;
      expect(c.mre.projects).toBe(7);
      expect(c.mre.n).toBeGreaterThan(0);
      expect(c.mre.byComponent.length).toBeGreaterThan(0);
      get(CostShowcaseSeed).onApplicationBootstrap();
      expect(db.get<{ n: number }>('SELECT count(*) AS n FROM cost_project')!.n).toBe(24);
    } finally {
      await app.close();
      if (previous === undefined) delete process.env.FF_SHOWCASE; else process.env.FF_SHOWCASE = previous;
    }
  });
});
