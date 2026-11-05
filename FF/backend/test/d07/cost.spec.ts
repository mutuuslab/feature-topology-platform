// SW 개발비 산정 API(D07-01, 20-94) — 계수 표 시드·열람 권한, 과제·Feature 담기(D-COST-9), 엔진과 같은 금액,
// 공수만 보는 역할의 금액 제거(D-COST-4), 작성자 ≠ 승인자(SOD-16), 승인 결과 고정·봉인(D-COST-5), 열람 감사 COST_VIEW.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CostBasis, CostSettingsInput, costEngineSettings, estimate, type CostRefFacts } from '@ff/contracts';
import { DB, type Db } from '../../src/kernel/db';
import { entryData, readCell, readZip, sharedStrings, sheetPaths } from '../../src/kernel/xlsx-patch';
import { actor, bootApp, withRef } from '../helpers';
import { CostDemoSeed } from '../../src/domains/d07-cost/estimation/cost-demo-seed';

const EST = actor('kim.cost', 'COST_ESTIMATOR');
const APPROVER = actor('lee.approver', 'COST_APPROVER');
const SAME_AS_EST = actor('kim.cost', 'COST_APPROVER');
const VIEWER = actor('park.viewer', 'COST_VIEWER');
const ADMIN = actor('lee.approver', 'COST_BASIS_ADMIN');
const AUTHOR = actor('kim.author', 'FEATURE_AUTHOR');
const DEV = actor('han.dev', 'IMPLEMENTER');

const FF = join(__dirname, '..', '..', '..');
const BASIS = CostBasis.parse(JSON.parse(readFileSync(join(FF, 'data', 'reference', 'cost-basis', 'v1.3.json'), 'utf8')));
const REFS: CostRefFacts[] = (JSON.parse(readFileSync(join(FF, 'data', 'reference', 'feature-db', 'v1.3', 'refs.json'), 'utf8')) as any[])
  .sort((a, b) => (a.refId < b.refId ? -1 : 1))
  .map((r, ord) => ({ refId: r.refId, ord, tshirt: r.tshirt, asilRep: r.asilRep, lifecycle: r.lifecycle, autoQuality: r.autoQuality, benchmarkEur: r.benchmarkEur ?? null, bundleId: r.bundleId || null, bundleRep: !!r.bundleRep, sizeEvidenceGrade: r.sizeEvidenceGrade || null, duplicateOf: r.duplicateOf || null, requires: r.requires ?? [] }));

describe('SW 개발비 산정 (D07-01)', () => {
  let app: INestApplication;
  let http: () => any;
  let db: Db;
  beforeAll(async () => {
    const b = await bootApp();
    ({ app, http } = b);
    db = b.get<Db>(DB);
  });
  afterAll(() => app.close());

  const feature = async (refs: { refId: string; role: 'PRIMARY' | 'INCLUDED' }[], asil = 'QM') => {
    const body = withRef({ name: `산정 시험 ${Math.random().toString(36).slice(2, 8)}`, description: '개발비 산정 시험', requirementIds: ['REQ-COST-1'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: '구매본부', asil });
    const r = await http().post('/api/features').set(AUTHOR).send({ ...body, featureRefs: [body.featureRefs[0], ...refs] }).expect(201);
    return { featureId: r.body.featureId as string, version: r.body.version as string, primary: body.featureRefs[0].refId };
  };
  const newProject = async (name = 'BCM 신규 개발') => (await http().post('/api/cost/projects').set(EST).send({ name, target: 'BCM / 신규 차종 1종' }).expect(201)).body.estId as string;

  describe('계수 표', () => {
    it('빈 DB에 v1.3이 발행 상태로 들어가고, 표 내용(단가)은 산정 역할만 본다 — 열람은 감사 COST_VIEW', async () => {
      const list = (await http().get('/api/cost/basis').expect(200)).body;
      expect(list.latest).toBe('v1.3');
      expect(list.items[0]).toMatchObject({ version: 'v1.3', status: 'PUBLISHED' });
      await http().get('/api/cost/basis/v1.3').set(DEV).expect(403);
      const d = (await http().get('/api/cost/basis/v1.3').set(VIEWER).expect(200)).body;
      expect(d.basis.rates.kosa['IT PM'].monthly).toBe(10086804);
      const audit = (await http().get('/api/audit?target=basis:v1.3').expect(200)).body.items;
      expect(audit.some((a: any) => a.action === 'COST_VIEW' && a.actorId === 'park.viewer')).toBe(true);
    });

    it('DB에는 봉인된 표만 남는다 — 단가 숫자가 평문으로 없다', () => {
      const r = db.get<{ doc_sealed: string }>('SELECT doc_sealed FROM cost_basis WHERE version = ?', 'v1.3')!;
      expect(r.doc_sealed.startsWith('ffenc1.')).toBe(true);
      expect(r.doc_sealed).not.toContain('10086804');
    });

    it('원가 기준 관리자만 새 버전 초안·발행 — 형식이 틀리거나 같은 이름이면 거부', async () => {
      await http().post('/api/cost/basis').set(EST).send({ basis: { ...BASIS, version: 'v1.4' }, note: '환율 갱신' }).expect(403);
      await http().post('/api/cost/basis').set(ADMIN).send({ basis: { ...BASIS, version: 'v1.3' }, note: '같은 이름' }).expect(409);
      await http().post('/api/cost/basis').set(ADMIN).send({ basis: { version: 'v9' }, note: '모자람' }).expect(400);
    });
  });

  describe('과제와 Feature 담기', () => {
    it('Feature 후보 목록은 전체 연결 대신 연결 수를 제공한다 — 연결된 Feature를 담을 수 있게', async () => {
      const f = await feature([{ refId: 'BC-BCM-004', role: 'INCLUDED' }]);
      const list = (await http().get(`/api/features?q=${f.featureId}&latestOnly=true`).expect(200)).body;
      expect(list.items.find((row: any) => row.featureId === f.featureId)).toMatchObject({ featureRefCount: 2 });
    });

    it('작성 역할만 만든다 — 최신 계수 표·Feature DB 발행을 고정', async () => {
      await http().post('/api/cost/projects').set(DEV).send({ name: 'x' }).expect(403);
      const id = await newProject();
      const d = (await http().get(`/api/cost/projects/${id}`).set(EST).expect(200)).body;
      expect(d.project).toMatchObject({ estId: id, status: 'DRAFT', basisVersion: 'v1.3', currency: 'KRW' });
      expect(d.project.refRelease).toBeTruthy();
      expect(d.lines).toEqual([]);
    });

    it('Feature를 담으면 연결(대표+포함)이 기준 행마다 한 줄 — 금액은 같은 입력의 엔진 계산과 같다', async () => {
      const id = await newProject();
      const f = await feature([{ refId: 'BC-BCM-004', role: 'INCLUDED' }]);
      const d = (await http().post(`/api/cost/projects/${id}/features`).set(EST).send({ featureId: f.featureId, version: f.version }).expect(201)).body;
      expect(d.lines.map((l: any) => [l.refId, l.role])).toEqual([[f.primary, 'PRIMARY'], ['BC-BCM-004', 'INCLUDED']]);
      const drivers = Object.fromEntries(Object.keys(BASIS.cocomo).map((k) => [k, 'N']));
      const s = CostSettingsInput.parse({ drivers });
      const direct = estimate({ basis: BASIS, settings: costEngineSettings(s), refs: new Map(REFS.map((r) => [r.refId, r])), mbd: [], lines: [{ refId: f.primary, qty: 1, asil: 'QM' }, { refId: 'BC-BCM-004', qty: 1, asil: 'QM' }] });
      expect(Math.abs(d.result.totals.totalCost - direct.totals.totalCost)).toBeLessThan(1);
      expect(d.result.view).toBe('FULL');
      // 같은 Feature 버전은 두 번 담지 않는다
      await http().post(`/api/cost/projects/${id}/features`).set(EST).send({ featureId: f.featureId, version: f.version }).expect(409);
    });

    it('개발 역할(공수만)에는 원화·단가·벤치마크가 응답에 아예 없다', async () => {
      const id = await newProject();
      const f = await feature([]);
      await http().post(`/api/cost/projects/${id}/features`).set(EST).send({ featureId: f.featureId, version: f.version }).expect(201);
      const d = (await http().get(`/api/cost/projects/${id}`).set(DEV).expect(200)).body;
      expect(d.view).toBe('MM_ONLY');
      expect(d.result.view).toBe('MM_ONLY');
      expect(d.result.totals.totalMm).toBeGreaterThan(0);
      const text = JSON.stringify(d);
      for (const k of ['laborKrw', 'totalCost', 'benchEur', 'blendedRate', 'roleRates', 'reserveKrw', 'unitPrice']) expect(text, k).not.toContain(`"${k}"`);
      const list = (await http().get('/api/cost/projects').set(DEV).expect(200)).body;
      expect(list.view).toBe('MM_ONLY');
      expect(JSON.stringify(list)).not.toContain('totalCost');
    });

    it('줄 입력 — 계수 표에 없는 변경 유형은 400, 맞는 값이면 결과가 바뀐다', async () => {
      const id = await newProject();
      const f = await feature([]);
      const d0 = (await http().post(`/api/cost/projects/${id}/features`).set(EST).send({ featureId: f.featureId, version: f.version }).expect(201)).body;
      const lineNo = d0.lines[0].lineNo;
      await http().patch(`/api/cost/projects/${id}/lines/${lineNo}`).set(EST).send({ changeType: '전면 재작성' }).expect(400);
      const d1 = (await http().patch(`/api/cost/projects/${id}/lines/${lineNo}`).set(EST).send({ changeType: '재사용(무수정 통합)', variants: 2 }).expect(200)).body;
      expect(d1.result.totals.eFeat).toBeLessThan(d0.result.totals.eFeat);
    });

    it('Feature DB 연결이 없는 Feature(데모 시드 미연결)와 요청 중 기준 행은 담을 수 없다', async () => {
      const id = await newProject();
      const legacy = db.all<{ feature_id: string; version: string; doc: string }>('SELECT feature_id, version, doc FROM feature_version').find((r) => !(JSON.parse(r.doc).featureRefs ?? []).length);
      expect(legacy).toBeDefined();
      await http().post(`/api/cost/projects/${id}/features`).set(EST).send({ featureId: legacy!.feature_id, version: legacy!.version }).expect(400);
      const req = await http().post('/api/refdb/requests').set(AUTHOR).send({ domain: 'Body & Comfort', component: 'Body controller', nameEn: 'Cost test pending', nameKo: '산정 시험 요청 행', tshirt: 'S', asilRep: 'QM', evidence: '시험' });
      if (req.status === 201) {
        const pendingId = req.body.refId ?? req.body.ref?.refId;
        const f = await http().post('/api/features').set(AUTHOR).send(withRef({ name: `요청 중 연결 ${Math.random().toString(36).slice(2, 7)}`, description: 'x', requirementIds: ['REQ-1'], country: 'KR', vehicleModel: 'NX4 PE', trim: 'Premium', ownerId: 'x', asil: 'QM' }, pendingId));
        if (f.status === 201) await http().post(`/api/cost/projects/${id}/features`).set(EST).send({ featureId: f.body.featureId, version: f.body.version }).expect(400);
      }
    });
  });

  describe('전이 — 제출·승인·반려·개정', () => {
    it('작성자는 자기 과제를 승인할 수 없다(SOD-16) — 다른 승인자가 승인하면 결과가 고정·봉인되고 고칠 수 없다', async () => {
      const id = await newProject('승인 시험');
      const f = await feature([]);
      await http().post(`/api/cost/projects/${id}/features`).set(EST).send({ featureId: f.featureId, version: f.version }).expect(201);
      await http().post(`/api/cost/projects/${id}/transitions`).set(APPROVER).send({ action: 'APPROVE', reason: '제출 전' }).expect(409);
      await http().post(`/api/cost/projects/${id}/transitions`).set(EST).send({ action: 'SUBMIT', reason: '검토 요청' }).expect(201);
      const sod = await http().post(`/api/cost/projects/${id}/transitions`).set(SAME_AS_EST).send({ action: 'APPROVE', reason: '자기 승인' }).expect(403);
      expect(sod.body.error.code).toBe('SEPARATION_OF_DUTY');
      const before = (await http().get(`/api/cost/projects/${id}`).set(VIEWER).expect(200)).body.result.totals.totalCost;
      expect((await http().post(`/api/cost/projects/${id}/transitions`).set(APPROVER).send({ action: 'APPROVE', reason: '구매 검토 완료' }).expect(201)).body).toMatchObject({ status: 'APPROVED', rev: 1 });
      await http().patch(`/api/cost/projects/${id}`).set(EST).send({ name: '바꿈' }).expect(409);
      const sealed = db.get<{ doc_sealed: string }>('SELECT doc_sealed FROM cost_result_doc WHERE est_id = ? AND rev = 1', id)!;
      expect(sealed.doc_sealed.startsWith('ffenc1.')).toBe(true);
      expect(sealed.doc_sealed).not.toContain('totalCost');
      expect(() => db.run('UPDATE cost_result SET reason = ? WHERE est_id = ?', 'x', id)).toThrow(/추가만/);
      // 새 계수 표를 발행해도 승인된 결과는 그대로
      await http().post('/api/cost/basis').set(ADMIN).send({ basis: { ...BASIS, version: 'v1.3-rate', rates: { ...BASIS.rates, daysPerMonth: 30 } }, note: '월 환산 일수 변경 시험' }).expect(201);
      await http().post('/api/cost/basis/v1.3-rate/publish').set(ADMIN).send({ reason: '시험 발행' }).expect(201);
      const after = (await http().get(`/api/cost/projects/${id}`).set(VIEWER).expect(200)).body;
      expect(after.result.totals.totalCost).toBe(before);
      expect(after.approvals).toHaveLength(1);
      // 개정하면 DRAFT — 최신 계수 표로 맞출 수 있다
      await http().post(`/api/cost/projects/${id}/transitions`).set(EST).send({ action: 'REVISE', reason: '사양 변경' }).expect(201);
      const revised = (await http().patch(`/api/cost/projects/${id}`).set(EST).send({ useLatestBasis: true }).expect(200)).body;
      expect(revised.project.basisVersion).toBe('v1.3-rate');
    });

    it('승인자는 반려할 수 있고(DRAFT로), 작성 역할이 아니면 제출할 수 없다', async () => {
      const id = await newProject('반려 시험');
      const f = await feature([]);
      await http().post(`/api/cost/projects/${id}/features`).set(EST).send({ featureId: f.featureId, version: f.version }).expect(201);
      await http().post(`/api/cost/projects/${id}/transitions`).set(APPROVER).send({ action: 'SUBMIT', reason: '대신 제출' }).expect(403);
      await http().post(`/api/cost/projects/${id}/transitions`).set(EST).send({ action: 'SUBMIT', reason: '검토 요청' }).expect(201);
      expect((await http().post(`/api/cost/projects/${id}/transitions`).set(APPROVER).send({ action: 'REJECT', reason: '공통 인력 확인' }).expect(201)).body.status).toBe('DRAFT');
    });

    it('담긴 Feature가 없으면 제출할 수 없다', async () => {
      const id = await newProject('빈 과제');
      await http().post(`/api/cost/projects/${id}/transitions`).set(EST).send({ action: 'SUBMIT', reason: '빈 제출' }).expect(422);
    });
  });

  describe('검토 체크리스트(07)', () => {
    it('계수 표의 38항목(구매 핵심 12) — 작성자·승인자가 상태를 바꾸고 완료율은 확인 ÷ (전체 − 해당 없음)', async () => {
      const id = await newProject('체크리스트 시험');
      const d0 = (await http().get(`/api/cost/projects/${id}`).set(EST).expect(200)).body.checks;
      expect(d0.items).toHaveLength(38);
      expect(d0.items.filter((i: any) => i.purchaseKey)).toHaveLength(12);
      expect(d0.rate).toBe(0);
      await http().put(`/api/cost/projects/${id}/checks/1`).set(EST).send({ status: '확인' }).expect(200);
      await http().put(`/api/cost/projects/${id}/checks/2`).set(APPROVER).send({ status: '해당 없음', memo: '요구 확정' }).expect(200);
      const d1 = (await http().put(`/api/cost/projects/${id}/checks/3`).set(EST).send({ status: '보완 필요' }).expect(200)).body;
      expect(d1.rate).toBeCloseTo(1 / 37, 12);
      expect(d1.open).toBe(1);
      expect(d1.items[1]).toMatchObject({ no: 2, status: '해당 없음', memo: '요구 확정', updatedBy: 'lee.approver' });
      await http().put(`/api/cost/projects/${id}/checks/1`).set(DEV).send({ status: '확인' }).expect(403);
      await http().put(`/api/cost/projects/${id}/checks/99`).set(EST).send({ status: '확인' }).expect(404);
      await http().put(`/api/cost/projects/${id}/checks/1`).set(EST).send({ status: '끝' }).expect(400);
    });
  });

  describe('엑셀 내보내기(D-COST-13)', () => {
    const open = (buf: Buffer) => {
      const entries = readZip(buf);
      const paths = sheetPaths(entries);
      const shared = sharedStrings(entries);
      const xml = (sheet: string) => entryData(entries.find((e) => e.name === paths.get(sheet))!).toString('utf8');
      return { entries, cell: (sheet: string, ref: string) => readCell(xml(sheet), ref, shared) };
    };
    const download = (id: string, who: Record<string, string>) =>
      http()
        .get(`/api/cost/projects/${id}/export`)
        .set(who)
        .buffer(true)
        .parse((res: any, cb: any) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
    const TEMPLATE = readFileSync(join(FF, 'data', 'source', 'feature_db_v1.3.xlsx'));

    it('원본 양식에 이 과제의 입력만 — 예시 입력은 지우고, 서식 항목은 바이트 그대로, 열면 다시 계산', async () => {
      const id = await newProject('내보내기 시험');
      const f = await feature([{ refId: 'BC-BCM-004', role: 'INCLUDED' }]);
      const d = (await http().post(`/api/cost/projects/${id}/features`).set(EST).send({ featureId: f.featureId, version: f.version }).expect(201)).body;
      const line = d.lines.find((l: any) => l.refId === 'BC-BCM-004');
      await http().patch(`/api/cost/projects/${id}/lines/${line.lineNo}`).set(EST).send({ qty: 2, changeType: '수정(중간)', variants: 3, memo: '윈도 연동' }).expect(200);
      await http().put(`/api/cost/projects/${id}/checks/9`).set(EST).send({ status: '확인', memo: 'AG열 확인' }).expect(200);
      await http().patch(`/api/cost/projects/${id}`).set(EST).send({ settings: { ...d.project.settings, confidence: 'P90', common: { ...d.project.settings.common, qa: 2 } } }).expect(200);
      await download(id, DEV).expect(403);
      const res = await download(id, VIEWER).expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(JSON.parse(decodeURIComponent(res.headers['x-cost-export-warnings']))).toEqual([]);
      const x = open(res.body as Buffer);
      expect(x.cell('02_프로젝트설정', 'C6')).toBe('내보내기 시험');
      expect(x.cell('02_프로젝트설정', 'C11')).toBe('P90');
      expect(x.cell('02_프로젝트설정', 'C53')).toBe(2);
      // 03 — 담은 줄의 입력, 양식 예시(BC-BCM-002 수량 1)는 지움
      const t = open(TEMPLATE);
      const rowOf = (refId: string) => {
        for (let r = 5; r < 3000; r++) if (t.cell('03_FeatureDB', `A${r}`) === refId) return r;
        throw new Error(refId);
      };
      const r4 = rowOf('BC-BCM-004');
      expect([x.cell('03_FeatureDB', `AF${r4}`), x.cell('03_FeatureDB', `AG${r4}`), x.cell('03_FeatureDB', `AI${r4}`), x.cell('03_FeatureDB', `AQ${r4}`)]).toEqual([2, '수정(중간)', 3, '윈도 연동']);
      expect(t.cell('03_FeatureDB', `AF${rowOf('BC-BCM-002')}`)).toBe(1);
      expect(x.cell('03_FeatureDB', `AF${rowOf('BC-BCM-002')}`)).toBeNull();
      expect([x.cell('07_검토체크리스트', 'G15'), x.cell('07_검토체크리스트', 'H15'), x.cell('07_검토체크리스트', 'G7')]).toEqual(['확인', 'AG열 확인', '미확인']);
      // 저장된 계산값(양식 예시의 총개발비)은 남기지 않는다
      expect(t.cell('01_대시보드', 'B6')).toBeCloseTo(1227670384.5, 0);
      expect(x.cell('01_대시보드', 'B6')).toBeNull();
      const before = new Map(t.entries.map((e) => [e.name, e.compressed]));
      for (const name of ['xl/styles.xml', 'xl/sharedStrings.xml', 'xl/theme/theme1.xml']) expect(Buffer.compare(x.entries.find((e) => e.name === name)!.compressed, before.get(name)!), name).toBe(0);
      expect(entryData(x.entries.find((e) => e.name === 'xl/workbook.xml')!).toString()).toContain('fullCalcOnLoad="1"');
      const audit = (await http().get(`/api/audit?target=${id}`).expect(200)).body.items;
      expect(audit.some((a: any) => a.action === 'COST_EXPORT' && a.actorId === 'park.viewer')).toBe(true);
    });

    it('양식과 다른 계수 표로 산정한 과제는 경고를 붙인다', async () => {
      await http().post('/api/cost/basis').set(ADMIN).send({ basis: { ...BASIS, version: 'v1.3-kosa', rates: { ...BASIS.rates, kosa: { ...BASIS.rates.kosa, 'IT PM': { daily: 1, monthly: 20 } } } }, note: 'KOSA 단가 시험' }).expect(201);
      await http().post('/api/cost/basis/v1.3-kosa/publish').set(ADMIN).send({ reason: '시험 발행' }).expect(201);
      const id = await newProject('다른 계수 표');
      const res = await download(id, EST).expect(200);
      expect(JSON.parse(decodeURIComponent(res.headers['x-cost-export-warnings']))).toEqual([expect.stringContaining('KOSA 단가')]);
    });
  });
});

describe('SW 개발비 산정 데모 시드 — 엑셀 예시 과제(BCM)', () => {
  let app: INestApplication;
  let http: () => any;
  let seed: CostDemoSeed;
  const DEMO = JSON.parse(readFileSync(join(FF, 'data', 'fixtures', 'demo', 'cost-demo.json'), 'utf8'));
  beforeAll(async () => {
    const b = await bootApp({ costDemo: true });
    ({ app, http } = b);
    seed = b.get(CostDemoSeed);
  });
  afterAll(() => app.close());

  it('컴포넌트별 FF Feature 10개가 일반 등록으로 들어가고, 기준 행 46개를 대표+포함으로 연결한다', async () => {
    const res = await http().get('/api/features?q=BCM');
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    const list = res.body.items.filter((f: any) => f.name.startsWith('BCM '));
    expect(list).toHaveLength(10);
    const one = (await http().get(`/api/features/${list[0].featureId}/versions/${list[0].version}`).expect(200)).body.feature;
    expect(one.featureRefs[0].role).toBe('PRIMARY');
    expect(DEMO.features.reduce((n: number, f: any) => n + f.refs.length, 0)).toBe(46);
  });

  it('EST-0001(DRAFT)은 엑셀 v1.3 예시와 같은 총개발비(1원 안), EST-0002는 제출·승인되어 고정', async () => {
    const list = (await http().get('/api/cost/projects').set(VIEWER).expect(200)).body;
    expect(list.items.map((p: any) => [p.estId, p.status]).sort()).toEqual([
      ['EST-0001', 'DRAFT'],
      ['EST-0002', 'APPROVED'],
    ]);
    const d1 = (await http().get('/api/cost/projects/EST-0001').set(VIEWER).expect(200)).body;
    expect(d1.lines).toHaveLength(46);
    expect(Math.abs(d1.result.totals.totalCost - DEMO.excelTotalCost)).toBeLessThan(1);
    expect(d1.project.createdBy).toBe('usr-viewer');
    const d2 = (await http().get('/api/cost/projects/EST-0002').set(VIEWER).expect(200)).body;
    expect(d2.approvals).toEqual([expect.objectContaining({ rev: 1, approvedBy: 'usr-approver' })]);
    expect(d2.checks.open).toBe(1);
    const x = await http().get('/api/cost/projects/EST-0001/export').set(VIEWER).expect(200);
    expect(JSON.parse(decodeURIComponent(x.headers['x-cost-export-warnings']))).toEqual([]);
  });

  it('과제가 이미 있으면 다시 넣지 않는다', async () => {
    seed.onModuleInit();
    expect((await http().get('/api/cost/projects').set(VIEWER).expect(200)).body.items).toHaveLength(2);
  });
});
